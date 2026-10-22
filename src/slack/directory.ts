import type { WebClient } from "@slack/web-api";
import { ToolError } from "../errors";

export interface SlackUser {
  id: string;
  handle: string;
  real_name: string;
  display_name: string;
  email?: string;
  title?: string;
  is_bot: boolean;
  deleted: boolean;
  tz?: string;
}

export interface SlackChannel {
  id: string;
  name: string;
  is_private: boolean;
  is_member: boolean;
  is_archived: boolean;
  num_members?: number;
  topic?: string;
  purpose?: string;
}

export type TargetKind =
  | { type: "channel_id"; value: string }
  | { type: "user_id"; value: string }
  | { type: "channel_name"; value: string }
  | { type: "email"; value: string }
  | { type: "handle"; value: string }
  | { type: "name"; value: string };

export interface ResolvedConversation {
  channelId: string;
  /** Set when the target was a user and the conversation is their DM with the bot. */
  user?: SlackUser;
  channelName?: string;
}

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

/**
 * Classify a free-form target string. Accepts IDs (C…/G…/D…, U…/W…),
 * Slack mention markup (<@U…>, <#C…|name>), #channel-name, @handle, email,
 * or a plain name.
 */
export function classifyTarget(raw: string): TargetKind {
  const input = raw.trim();
  const userMention = /^<@([UW][A-Z0-9]+)(?:\|[^>]*)?>$/.exec(input);
  if (userMention?.[1]) return { type: "user_id", value: userMention[1] };
  const channelMention = /^<#([CGD][A-Z0-9]+)(?:\|[^>]*)?>$/.exec(input);
  if (channelMention?.[1]) return { type: "channel_id", value: channelMention[1] };
  if (/^[CGD][A-Z0-9]{6,}$/.test(input)) return { type: "channel_id", value: input };
  if (/^[UW][A-Z0-9]{6,}$/.test(input)) return { type: "user_id", value: input };
  if (input.startsWith("#")) return { type: "channel_name", value: input.slice(1).toLowerCase() };
  if (EMAIL_RE.test(input)) return { type: "email", value: input.toLowerCase() };
  if (input.startsWith("@")) return { type: "handle", value: input.slice(1).toLowerCase() };
  return { type: "name", value: input.toLowerCase() };
}

export function isEmail(input: string): boolean {
  return EMAIL_RE.test(input.trim());
}

const CACHE_TTL_MS = 10 * 60 * 1000;
const PAGE_LIMIT = 200;
const MAX_PAGES = 50;

interface Cached<T> {
  at: number;
  value: Promise<T>;
}

/** Cached lookups of users and channels, plus target resolution. */
export class SlackDirectory {
  private users?: Cached<SlackUser[]>;
  private channels?: Cached<SlackChannel[]>;
  private readonly dmChannels = new Map<string, string>();

  constructor(private readonly client: () => WebClient) {}

  listUsers(): Promise<SlackUser[]> {
    if (!this.users || Date.now() - this.users.at > CACHE_TTL_MS) {
      const value = this.fetchUsers();
      this.users = { at: Date.now(), value };
      value.catch(() => (this.users = undefined));
    }
    return this.users.value;
  }

  listChannels(): Promise<SlackChannel[]> {
    if (!this.channels || Date.now() - this.channels.at > CACHE_TTL_MS) {
      const value = this.fetchChannels();
      this.channels = { at: Date.now(), value };
      value.catch(() => (this.channels = undefined));
    }
    return this.channels.value;
  }

  async userName(userId: string | undefined): Promise<string | undefined> {
    if (!userId) return undefined;
    try {
      const user = (await this.listUsers()).find((u) => u.id === userId);
      return user ? user.display_name || user.real_name || user.handle : undefined;
    } catch {
      return undefined;
    }
  }

  /** Search users by name, handle, display name or email; best matches first. */
  async searchUsers(query: string, opts: { includeBots?: boolean; includeDeleted?: boolean } = {}): Promise<SlackUser[]> {
    const q = query.trim().replace(/^@/, "").toLowerCase();
    const scored: Array<{ user: SlackUser; score: number }> = [];
    for (const user of await this.listUsers()) {
      if (user.deleted && !opts.includeDeleted) continue;
      if (user.is_bot && !opts.includeBots) continue;
      const fields = [user.handle, user.display_name, user.real_name, user.email ?? ""].map((f) => f.toLowerCase());
      let score = 0;
      if (fields.some((f) => f === q)) score = 3;
      else if (fields.some((f) => f.startsWith(q) || f.split(/[\s._-]+/).some((w) => w.startsWith(q)))) score = 2;
      else if (fields.some((f) => f.includes(q))) score = 1;
      if (score > 0) scored.push({ user, score });
    }
    return scored.sort((a, b) => b.score - a.score).map((s) => s.user);
  }

  /** Look up a user by email via `users.lookupByEmail`. Returns undefined if no such user. */
  async findUserByEmail(email: string): Promise<SlackUser | undefined> {
    try {
      const res = await this.client().users.lookupByEmail({ email });
      return res.user ? toSlackUser(res.user) : undefined;
    } catch (err) {
      if ((err as { data?: { error?: string } }).data?.error === "users_not_found") return undefined;
      throw err;
    }
  }

  async resolveUser(target: string): Promise<SlackUser> {
    const kind = classifyTarget(target);
    switch (kind.type) {
      case "user_id": {
        const res = await this.client().users.info({ user: kind.value });
        if (!res.user) throw new ToolError(`No Slack user with ID ${kind.value}.`);
        return toSlackUser(res.user);
      }
      case "email": {
        const user = await this.findUserByEmail(kind.value);
        if (!user) {
          throw new ToolError(
            `No Slack user found with email ${kind.value}. Check the address, or search by name with \`users_search\`.`,
          );
        }
        return user;
      }
      case "handle":
      case "name":
        return this.pickOneUser(target, await this.searchUsers(kind.value));
      default:
        throw new ToolError(`"${target}" looks like a channel, not a user. Pass a user ID, @handle, name or email.`);
    }
  }

  /**
   * Resolve a target to a conversation ID. Users (ID, email, @handle, name)
   * resolve to their DM channel with the bot, opening it if needed.
   */
  async resolveConversation(target: string): Promise<ResolvedConversation> {
    const kind = classifyTarget(target);
    switch (kind.type) {
      case "channel_id":
        return { channelId: kind.value };
      case "channel_name":
        return this.resolveChannelName(kind.value, target);
      case "name": {
        const channel = (await this.listChannels()).find((c) => c.name === kind.value);
        if (channel) return { channelId: channel.id, channelName: channel.name };
        const user = await this.resolveUser(target);
        return { channelId: await this.openDm(user.id), user };
      }
      default: {
        const user = await this.resolveUser(target);
        return { channelId: await this.openDm(user.id), user };
      }
    }
  }

  /** Open (or reuse) the bot's DM channel with a user. */
  async openDm(userId: string): Promise<string> {
    const cached = this.dmChannels.get(userId);
    if (cached) return cached;
    const res = await this.client().conversations.open({ users: userId });
    const id = res.channel?.id;
    if (!id) throw new ToolError(`Slack did not return a DM channel for user ${userId}.`);
    this.dmChannels.set(userId, id);
    return id;
  }

  private async resolveChannelName(name: string, target: string): Promise<ResolvedConversation> {
    const channels = await this.listChannels();
    const channel = channels.find((c) => c.name === name);
    if (channel) return { channelId: channel.id, channelName: channel.name };
    const similar = channels
      .filter((c) => c.name.includes(name) || name.includes(c.name))
      .slice(0, 5)
      .map((c) => `#${c.name} (${c.id})`);
    throw new ToolError(
      [
        `Channel ${target} not found.`,
        similar.length > 0 ? `Similar channels: ${similar.join(", ")}.` : undefined,
        "Private channels are only visible after the bot is invited. You can also pass the channel ID (C…) directly.",
      ]
        .filter(Boolean)
        .join(" "),
    );
  }

  private pickOneUser(target: string, matches: SlackUser[]): SlackUser {
    if (matches.length === 0) {
      throw new ToolError(`No Slack user matches "${target}". Try \`users_search\` with part of the name or the email.`);
    }
    const q = target.trim().replace(/^@/, "").toLowerCase();
    const exact = matches.filter((u) =>
      [u.handle, u.display_name, u.real_name, u.email ?? ""].some((f) => f.toLowerCase() === q),
    );
    if (exact.length === 1) return exact[0]!;
    if (matches.length === 1) return matches[0]!;
    const candidates = (exact.length > 1 ? exact : matches)
      .slice(0, 10)
      .map((u) => `- ${u.real_name || u.display_name} (@${u.handle}, ${u.id}${u.email ? `, ${u.email}` : ""})`);
    throw new ToolError(
      `"${target}" matches several users. Ask the user which one they mean, then retry with the user ID:\n${candidates.join("\n")}`,
    );
  }

  private async fetchUsers(): Promise<SlackUser[]> {
    const users: SlackUser[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await this.client().users.list({ limit: PAGE_LIMIT, cursor });
      for (const member of res.members ?? []) users.push(toSlackUser(member));
      cursor = res.response_metadata?.next_cursor || undefined;
      if (!cursor) break;
    }
    return users;
  }

  private async fetchChannels(): Promise<SlackChannel[]> {
    const channels: SlackChannel[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await this.client().conversations.list({
        types: "public_channel,private_channel",
        exclude_archived: true,
        limit: PAGE_LIMIT,
        cursor,
      });
      for (const c of res.channels ?? []) channels.push(toSlackChannel(c));
      cursor = res.response_metadata?.next_cursor || undefined;
      if (!cursor) break;
    }
    return channels;
  }
}

interface RawUser {
  id?: string;
  name?: string;
  real_name?: string;
  deleted?: boolean;
  is_bot?: boolean;
  tz?: string;
  profile?: { display_name?: string; real_name?: string; email?: string; title?: string };
}

export function toSlackUser(u: RawUser): SlackUser {
  return {
    id: u.id ?? "",
    handle: u.name ?? "",
    real_name: u.real_name ?? u.profile?.real_name ?? "",
    display_name: u.profile?.display_name ?? "",
    email: u.profile?.email || undefined,
    title: u.profile?.title || undefined,
    is_bot: Boolean(u.is_bot) || u.id === "USLACKBOT",
    deleted: Boolean(u.deleted),
    tz: u.tz,
  };
}

interface RawChannel {
  id?: string;
  name?: string;
  is_private?: boolean;
  is_member?: boolean;
  is_archived?: boolean;
  num_members?: number;
  topic?: { value?: string };
  purpose?: { value?: string };
}

export function toSlackChannel(c: RawChannel): SlackChannel {
  return {
    id: c.id ?? "",
    name: c.name ?? "",
    is_private: Boolean(c.is_private),
    is_member: Boolean(c.is_member),
    is_archived: Boolean(c.is_archived),
    num_members: c.num_members,
    topic: c.topic?.value || undefined,
    purpose: c.purpose?.value || undefined,
  };
}
