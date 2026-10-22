import { createSlackAdapter, type SlackAdapter } from "@chat-adapter/slack";
import { createMemoryState } from "@chat-adapter/state-memory";
import { Chat, type Logger, type Message, type Thread } from "chat";
import type { Config } from "../config";
import { ToolError } from "../errors";
import { SlackDirectory } from "./directory";
import { Inbox } from "./inbox";
import { PendingStore } from "./pending";
import { type BotIdentity, fetchBotIdentity } from "./scopes";

export interface SlackRuntime {
  config: Config;
  bot: Chat<{ slack: SlackAdapter }>;
  adapter: SlackAdapter;
  directory: SlackDirectory;
  inbox: Inbox;
  pending: PendingStore;
  logger: Logger;
  /**
   * Resolves with the bot identity once SLACK_BOT_TOKEN is verified. Every
   * tool awaits this; tools call the Web API directly and do not need events.
   */
  ready: Promise<BotIdentity>;
  /**
   * Resolves once the event connection is up (Socket Mode WebSocket, or the
   * adapter is initialized in webhook mode). Only get_inbox depends on it.
   */
  events: Promise<void>;
  /** Human-readable event connection status, for whoami. */
  eventStatus: () => string;
}

/**
 * Build the Chat SDK bot. Event handlers are registered once and work the
 * same in socket and webhook mode; the mode only changes the adapter config
 * and whether an HTTP server receives events (see transport.ts).
 */
export function createSlackRuntime(config: Config, logger: Logger): SlackRuntime {
  const adapter = createSlackAdapter({
    mode: config.mode,
    botToken: config.botToken,
    appToken: config.appToken,
    signingSecret: config.signingSecret,
    logger: logger.child("slack"),
    // Fail fast on rate limits so the agent gets a clear error instead of a
    // tool call that hangs while the client retries for minutes.
    webClientOptions: { rejectRateLimitedCalls: true, retryConfig: { retries: 2 }, timeout: 30_000 },
  });

  const bot = new Chat({
    userName: "slack-bot-mcp",
    adapters: { slack: adapter },
    state: createMemoryState(),
    logger: logger.child("chat"),
  });

  const directory = new SlackDirectory(() => adapter.webClient);
  const inbox = new Inbox();
  const pending = new PendingStore(config.stateDir, config.pendingTtlDays);

  const record = async (thread: Thread, message: Message, isMention: boolean) => {
    if (message.author.isMe) return;
    const { channel, threadTs } = adapter.decodeThreadId(thread.id);
    inbox.push({
      channel_id: channel,
      thread_ts: threadTs || message.id,
      ts: message.id,
      user_id: message.author.userId,
      user_name: message.author.fullName || message.author.userName,
      text: message.text,
      is_dm: thread.isDM,
      is_mention: isMention,
    });
  };
  bot.onDirectMessage((thread, message) => record(thread, message, Boolean(message.isMention)));
  bot.onNewMention((thread, message) => record(thread, message, true));

  const ready = fetchBotIdentity(adapter.webClient);
  ready.then(
    (id) => logger.info(`Authenticated as bot ${id.userId} in team ${id.team}`),
    (err) => logger.error("SLACK_BOT_TOKEN check failed", err),
  );

  let eventStatus = "connecting";
  const events = bot.initialize().then(
    () => {
      eventStatus = config.mode === "socket" ? "connected (Socket Mode)" : `listening (webhook on ${config.httpPath})`;
    },
    (err: unknown) => {
      const code = (err as { data?: { error?: string } }).data?.error ?? (err as Error).message;
      const hint =
        config.mode === "socket"
          ? "Check SLACK_APP_TOKEN: it must be an app-level token (xapp-…) with the connections:write scope, and Socket Mode must be enabled in the Slack app settings."
          : "Check SLACK_BOT_TOKEN and SLACK_SIGNING_SECRET.";
      eventStatus = `failed: ${code}`;
      logger.error("Slack event connection failed", err);
      throw new ToolError(
        `The Slack event connection is down (${code}). ${hint} Sending messages, searching users and reading history still work; only get_inbox needs the event connection.`,
      );
    },
  );
  events.catch(() => {});

  return { config, bot, adapter, directory, inbox, pending, logger, ready, events, eventStatus: () => eventStatus };
}
