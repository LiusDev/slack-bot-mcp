import "./stdout-guard";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { ConfigError, loadConfig } from "./config";
import { createStderrLogger } from "./logger";
import { createSlackRuntime } from "./slack/bot";
import { startEventTransport } from "./slack/transport";
import { registerAllTools } from "./tools";

declare const __PKG_VERSION__: string;

function main(): void {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(`slack-bot-mcp: ${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }

  const logger = createStderrLogger(config.logLevel);
  const runtime = createSlackRuntime(config, logger);
  // Tools await `runtime.ready`, so a failed Slack start-up surfaces as a
  // tool error instead of crashing the server.
  runtime.ready.catch(() => {});
  const httpServer = startEventTransport(runtime);

  const stdio = serveStdio(() => {
    const server = new McpServer(
      { name: "slack-bot-mcp", version: typeof __PKG_VERSION__ === "string" ? __PKG_VERSION__ : "dev" },
      { capabilities: { tools: {} } },
    );
    registerAllTools(server, runtime);
    return server;
  });

  let shuttingDown = false;
  const shutdown = async (reason: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`Shutting down (${reason})`);
    const timer = setTimeout(() => process.exit(0), 3000);
    timer.unref();
    await Promise.allSettled([stdio.close(), runtime.bot.shutdown(), new Promise((r) => httpServer?.close(r) ?? r(undefined))]);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  // The socket connection keeps the process alive; exit when the MCP client goes away.
  process.stdin.on("end", () => void shutdown("stdin closed"));
  process.stdin.on("close", () => void shutdown("stdin closed"));
}

main();
