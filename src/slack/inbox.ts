import { EventEmitter } from "node:events";

export interface InboxMessage {
  channel_id: string;
  /** Parent thread timestamp; equals `ts` for top-level messages. */
  thread_ts: string;
  ts: string;
  user_id: string;
  user_name: string;
  text: string;
  is_dm: boolean;
  is_mention: boolean;
  received_at: string;
  read: boolean;
}

export interface InboxQuery {
  channelId?: string;
  sinceTs?: string;
  unreadOnly?: boolean;
  limit?: number;
}

/**
 * In-memory ring buffer of messages addressed to the bot (DMs and mentions),
 * fed by Slack events. Each MCP server process has its own inbox.
 */
export class Inbox {
  private readonly messages: InboxMessage[] = [];
  private readonly events = new EventEmitter();

  constructor(private readonly capacity = 500) {
    this.events.setMaxListeners(0);
  }

  push(message: Omit<InboxMessage, "read" | "received_at">): void {
    if (this.messages.some((m) => m.channel_id === message.channel_id && m.ts === message.ts)) return;
    const entry: InboxMessage = { ...message, received_at: new Date().toISOString(), read: false };
    this.messages.push(entry);
    if (this.messages.length > this.capacity) this.messages.shift();
    this.events.emit("message", entry);
  }

  /** Messages matching the query, oldest first, capped at `limit` (most recent kept). */
  list(query: InboxQuery = {}): InboxMessage[] {
    const matches = this.messages.filter(
      (m) =>
        (!query.channelId || m.channel_id === query.channelId) &&
        (!query.sinceTs || Number(m.ts) > Number(query.sinceTs)) &&
        (!query.unreadOnly || !m.read),
    );
    return query.limit ? matches.slice(-query.limit) : matches;
  }

  markRead(messages: InboxMessage[]): void {
    for (const m of messages) m.read = true;
  }

  /** Resolves when a message for `channelId` arrives, or after `ms`, whichever comes first. */
  nextFor(channelId: string, ms: number): Promise<void> {
    return new Promise((resolve) => {
      const onMessage = (m: InboxMessage) => {
        if (m.channel_id === channelId) done();
      };
      const timer = setTimeout(() => done(), ms);
      const done = () => {
        clearTimeout(timer);
        this.events.off("message", onMessage);
        resolve();
      };
      this.events.on("message", onMessage);
    });
  }
}
