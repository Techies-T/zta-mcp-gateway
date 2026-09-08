import crypto from "node:crypto";

export type AuditEventType =
  | "ACCESS_ALLOWED"
  | "ACCESS_BLOCKED"
  | "FIREWALL_VIOLATION"
  | "TOOL_EXECUTION"
  | "AUTH_FAILED"
  | "CONFIG_LOADED";

export interface AuditLogEntry {
  timestamp: string;
  event_id: string;
  event_type: AuditEventType;
  client_id?: string;
  roles?: string[];
  upstream_id?: string;
  method?: string;
  tool_name?: string;
  decision: "ALLOW" | "DENY" | "INFO";
  reason?: string;
  details?: Record<string, any>;
}

export class AuditLogger {
  private outputStream: (entryJson: string) => void;

  constructor(customOutput?: (entryJson: string) => void) {
    this.outputStream = customOutput || ((msg) => process.stdout.write(msg + "\n"));
  }

  log(params: Omit<AuditLogEntry, "timestamp" | "event_id">): AuditLogEntry {
    const entry: AuditLogEntry = {
      timestamp: new Date().toISOString(),
      event_id: crypto.randomUUID(),
      ...params,
    };

    this.outputStream(JSON.stringify(entry));
    return entry;
  }
}

export const defaultAuditLogger = new AuditLogger();
