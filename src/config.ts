import fs from "node:fs";
import yaml from "yaml";
import { GatewayConfig, UpstreamConfig } from "./types/index.js";

/**
 * Loads and parses the gateway configuration from a YAML file.
 */
export function loadConfig(configPath: string): GatewayConfig {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Configuration file not found at: ${configPath}`);
  }

  const rawContent = fs.readFileSync(configPath, "utf-8");
  const parsed = yaml.parse(rawContent) as GatewayConfig;

  // Basic validation
  if (!parsed.version) {
    throw new Error("Missing 'version' field in configuration");
  }
  if (!parsed.server || typeof parsed.server.port !== "number") {
    throw new Error("Invalid or missing 'server.port' in configuration");
  }
  if (!parsed.secrets || !parsed.secrets.provider) {
    throw new Error("Missing 'secrets.provider' in configuration");
  }
  if (!Array.isArray(parsed.upstreams)) {
    throw new Error("Missing or invalid 'upstreams' list in configuration");
  }

  for (const upstream of parsed.upstreams) {
    if (!upstream.id || !upstream.path || !upstream.target) {
      throw new Error(`Invalid upstream definition: missing id, path, or target`);
    }
    if (!upstream.policies || !upstream.policies.role_mappings) {
      throw new Error(`Upstream '${upstream.id}' is missing role_mappings policy`);
    }
  }

  return parsed;
}

/**
 * Finds an upstream configuration by requested path
 */
export function findUpstreamByPath(config: GatewayConfig, requestPath: string): UpstreamConfig | undefined {
  return config.upstreams.find((upstream) => {
    return requestPath === upstream.path || requestPath.startsWith(`${upstream.path}/`);
  });
}
