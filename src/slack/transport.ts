import { createServer, type IncomingMessage, type Server } from "node:http";
import type { SlackRuntime } from "./bot";

/**
 * In webhook mode, start an HTTP server that forwards Slack Events API and
 * interactivity requests to the Chat SDK. In socket mode the adapter holds a
 * WebSocket instead, so nothing is started.
 */
export function startEventTransport(runtime: SlackRuntime): Server | undefined {
  const { config, bot, logger } = runtime;
  if (config.mode !== "webhook") return undefined;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (req.method !== "POST" || url.pathname !== config.httpPath) {
      res.writeHead(404).end();
      return;
    }
    try {
      const request = new Request(url, {
        method: "POST",
        headers: toHeaders(req),
        body: await readBody(req),
      });
      const response = await bot.webhooks.slack(request, {
        waitUntil: (task: Promise<unknown>) => {
          task.catch((err) => logger.error("Webhook background task failed", err));
        },
      });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (err) {
      logger.error("Webhook handling failed", err);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  });

  server.listen(config.httpPort, () => {
    logger.info(`Listening for Slack events on http://0.0.0.0:${config.httpPort}${config.httpPath}`);
  });
  return server;
}

function toHeaders(req: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) for (const v of value) headers.append(key, v);
    else if (value !== undefined) headers.set(key, value);
  }
  return headers;
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}
