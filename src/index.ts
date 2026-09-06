import express, { Request, Response, NextFunction } from "express";
import path from "node:path";
import { loadConfig, findUpstreamByPath } from "./config.js";
import { verifyToken, extractBearerToken } from "./auth/jwt.js";
import { maskTools, isToolCallAllowed } from "./pep/masking.js";
import { validateSqlQuery } from "./pep/firewall.js";
import { defaultAuditLogger } from "./audit/logger.js";
import { AuthContext, GatewayConfig, McpRequest, ToolDefinition } from "./types/index.js";

// Extend Express Request with authenticated AuthContext
declare global {
  namespace Express {
    interface Request {
      authContext?: AuthContext;
    }
  }
}

const CONFIG_PATH = process.env.GATEWAY_CONFIG_PATH || path.resolve("config/gateway-config.example.yaml");
let config: GatewayConfig;

try {
  config = loadConfig(CONFIG_PATH);
  defaultAuditLogger.log({
    event_type: "CONFIG_LOADED",
    decision: "INFO",
    details: { configPath: CONFIG_PATH, upstreamCount: config.upstreams.length },
  });
} catch (err: any) {
  console.error(`Failed to load gateway configuration: ${err.message}`);
  process.exit(1);
}

const app = express();
app.use(express.json());

// CORS configuration
if (config.server.cors) {
  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = config.server.cors?.origin;
    if (Array.isArray(origin)) {
      const reqOrigin = req.headers.origin;
      if (reqOrigin && origin.includes(reqOrigin)) {
        res.setHeader("Access-Control-Allow-Origin", reqOrigin);
      }
    } else if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
    }
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (config.server.cors?.credentials) {
      res.setHeader("Access-Control-Allow-Credentials", "true");
    }
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });
}

// Health check endpoint
app.get("/healthz", (_req: Request, res: Response) => {
  res.status(200).json({ status: "healthy", version: config.version, timestamp: new Date().toISOString() });
});

// Authentication & PEP Ingress Middleware
app.use(async (req: Request, res: Response, next: NextFunction) => {
  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    defaultAuditLogger.log({
      event_type: "AUTH_FAILED",
      decision: "DENY",
      reason: "Missing Authorization Bearer token",
      details: { path: req.path, ip: req.ip },
    });
    res.status(401).json({ error: "Unauthorized: Missing Bearer Token" });
    return;
  }

  try {
    const authContext = verifyToken(token, config);
    req.authContext = authContext;
    next();
  } catch (err: any) {
    defaultAuditLogger.log({
      event_type: "AUTH_FAILED",
      decision: "DENY",
      reason: err.message,
      details: { path: req.path, ip: req.ip },
    });
    res.status(401).json({ error: "Unauthorized: Invalid or expired Bearer Token" });
  }
});

// Upstream PEP Proxy Route
app.all("/mcp/*", async (req: Request, res: Response) => {
  const authContext = req.authContext!;
  const upstream = findUpstreamByPath(config, req.path);

  if (!upstream) {
    res.status(404).json({ error: `No upstream MCP server configured for path: ${req.path}` });
    return;
  }

  // Handle MCP JSON-RPC Message
  if (req.method === "POST") {
    const mcpReq = req.body as McpRequest;

    // 1. Intercept tools/call
    if (mcpReq.method === "tools/call" && mcpReq.params?.name) {
      const toolName = mcpReq.params.name;

      // Check tool permission (RBAC)
      if (!isToolCallAllowed(toolName, authContext.roles, upstream)) {
        defaultAuditLogger.log({
          event_type: "ACCESS_BLOCKED",
          client_id: authContext.clientId,
          roles: authContext.roles,
          upstream_id: upstream.id,
          method: "tools/call",
          tool_name: toolName,
          decision: "DENY",
          reason: `Tool '${toolName}' is not allowed for roles [${authContext.roles.join(", ")}]`,
        });

        res.status(403).json({
          jsonrpc: "2.0",
          id: mcpReq.id,
          error: {
            code: -32600,
            message: `Execution denied: Tool '${toolName}' is not permitted by ZTA policy.`,
          },
        });
        return;
      }

      // Query Firewall: check SQL argument if applicable
      const queryArg = mcpReq.params.arguments?.query || mcpReq.params.arguments?.sql;
      if (typeof queryArg === "string" && upstream.policies.firewall?.enforce_sql_check) {
        const firewallDecision = validateSqlQuery(queryArg, upstream.policies.firewall, authContext.roles);

        if (!firewallDecision.allowed) {
          defaultAuditLogger.log({
            event_type: "FIREWALL_VIOLATION",
            client_id: authContext.clientId,
            roles: authContext.roles,
            upstream_id: upstream.id,
            method: "tools/call",
            tool_name: toolName,
            decision: "DENY",
            reason: firewallDecision.reason,
            details: {
              ruleViolated: firewallDecision.ruleViolated,
              querySnippet: queryArg.substring(0, 100),
            },
          });

          res.status(403).json({
            jsonrpc: "2.0",
            id: mcpReq.id,
            error: {
              code: -32600,
              message: firewallDecision.reason || "Query blocked by ZTA SQL Firewall.",
            },
          });
          return;
        }
      }
    }

    // 2. Intercept tools/list (Context Masking)
    if (mcpReq.method === "tools/list") {
      try {
        // Forward tools/list to upstream target
        const upstreamUrl = upstream.target;
        const upstreamResponse = await fetch(upstreamUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(mcpReq),
        });

        const data = (await upstreamResponse.json()) as any;
        if (data.result?.tools && Array.isArray(data.result.tools)) {
          const originalTools = data.result.tools as ToolDefinition[];
          const masked = maskTools(originalTools, authContext.roles, upstream);
          data.result.tools = masked;

          defaultAuditLogger.log({
            event_type: "ACCESS_ALLOWED",
            client_id: authContext.clientId,
            roles: authContext.roles,
            upstream_id: upstream.id,
            method: "tools/list",
            decision: "ALLOW",
            details: {
              originalCount: originalTools.length,
              maskedCount: masked.length,
            },
          });
        }

        res.status(upstreamResponse.status).json(data);
        return;
      } catch (err: any) {
        res.status(502).json({ error: `Failed to proxy to upstream: ${err.message}` });
        return;
      }
    }

    // Forward other POST requests directly to upstream target
    try {
      const response = await fetch(upstream.target, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mcpReq),
      });
      const data = await response.json();
      res.status(response.status).json(data);
    } catch (err: any) {
      res.status(502).json({ error: `Upstream error: ${err.message}` });
    }
    return;
  }

  // Handle GET / SSE proxying
  res.status(501).json({ message: "SSE streaming proxy endpoint initialized" });
});

const PORT = config.server.port || 8080;
const HOST = config.server.host || "0.0.0.0";

if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, HOST, () => {
    console.log(`[ZTA MCP Gateway] Server running at http://${HOST}:${PORT}`);
    console.log(`[ZTA MCP Gateway] Loaded ${config.upstreams.length} upstream(s)`);
  });
}

export { app };
