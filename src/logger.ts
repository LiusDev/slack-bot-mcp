import { format } from "node:util";
import type { Logger } from "chat";

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

/** Logger that writes to stderr only, so it never interferes with MCP stdio. */
export function createStderrLogger(level: LogLevel, prefix = "slack-bot-mcp"): Logger {
  const write = (lvl: Exclude<LogLevel, "silent">, message: string, args: unknown[]) => {
    if (ORDER[lvl] < ORDER[level]) return;
    const extra = args.length > 0 ? ` ${format(...args)}` : "";
    process.stderr.write(`[${new Date().toISOString()}] ${lvl.toUpperCase()} [${prefix}] ${message}${extra}\n`);
  };
  return {
    child: (childPrefix) => createStderrLogger(level, `${prefix}:${childPrefix}`),
    debug: (message, ...args) => write("debug", message, args),
    info: (message, ...args) => write("info", message, args),
    warn: (message, ...args) => write("warn", message, args),
    error: (message, ...args) => write("error", message, args),
  };
}
