import type { CallToolResult } from "@modelcontextprotocol/server";
import { ToolError, toToolError } from "../errors";

export function ok(data: unknown): CallToolResult {
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: "text", text }] };
}

/** Run a tool body, turning any thrown error into an agent-readable tool error. */
export async function run(action: string, fn: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return ok(await fn());
  } catch (err) {
    return toToolError(err, action);
  }
}

/**
 * Parse a point in time into a Slack timestamp string. Accepts a Slack ts
 * ("1712345678.123456"), Unix seconds, an ISO date/time, or a relative
 * duration back from now ("30m", "6h", "2d", "1w").
 */
export function toSlackTs(input: string | undefined): string | undefined {
  if (!input) return undefined;
  const value = input.trim();
  if (/^\d+(\.\d+)?$/.test(value)) return value;
  const relative = /^(\d+)\s*([mhdw])$/i.exec(value);
  if (relative) {
    const unit = { m: 60, h: 3600, d: 86400, w: 604800 }[relative[2]!.toLowerCase() as "m" | "h" | "d" | "w"];
    return String(Math.floor(Date.now() / 1000) - Number(relative[1]) * unit);
  }
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    throw new ToolError(
      `Cannot parse time "${input}". Use a Slack timestamp (1712345678.123456), an ISO date (2026-10-01T09:00:00Z), or a relative duration (30m, 6h, 2d, 1w).`,
    );
  }
  return String(Math.floor(ms / 1000));
}

export function tsToIso(ts: string | undefined): string | undefined {
  return ts ? new Date(Number(ts) * 1000).toISOString() : undefined;
}
