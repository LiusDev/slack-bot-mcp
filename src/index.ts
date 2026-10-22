import "./stdout-guard";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { ConfigError, loadConfig } from "./config";
import { createStderrLogger } from "./logger";
import { createSlackRuntime } from "./slack/bot";
import { startEventTransport } from "./slack/transport";
import { registerAllTools } from "./tools";
import { VERSION } from "./version";

const HELP = `slack-bot-mcp ${VERSION}
MCP server that lets AI agents work in Slack through a bot. Speaks MCP over stdio.

Usage:
  slack-bot-mcp              Start the server (normally launched by an MCP client)
  slack-bot-mcp --version    Print the version
  slack-bot-mcp --help       Print this help

Required environment:
  SLACK_BOT_TOKEN            Bot token (xoxb-...)
  SLACK_APP_TOKEN            App-level token (xapp-...), needed in socket mode

Docs: https://github.com/LiusDev/slack-bot-mcp#readme
`;

function main(): void {
  // stdout belongs to MCP once the server starts, so CLI flags write to it directly and exit.
  const args = process.argv.slice(2);
  if (args.includes("--version") || args.includes("-v")) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(HELP);
    return;
  }

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
      { name: "slack-bot-mcp", version: VERSION },
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
