import type { WebClient } from "@slack/web-api";
import { MissingScopeError } from "../errors";

/** Bot token scopes each tool relies on. Used by `whoami` and pre-flight checks. */
export const TOOL_SCOPES: Record<string, string[]> = {
  users_search: ["users:read", "users:read.email"],
  user_info: ["users:read"],
  channels_list: ["channels:read", "groups:read", "im:read", "mpim:read"],
  send_message: ["chat:write", "im:write"],
  delete_message: ["chat:write"],
  conversations_history: ["channels:history", "groups:history", "im:history", "mpim:history"],
  conversations_replies: ["channels:history", "groups:history", "im:history", "mpim:history"],
  reactions_add: ["reactions:write"],
  reactions_remove: ["reactions:write"],
  wait_for_reply: ["channels:history", "groups:history", "im:history"],
  check_replies: ["channels:history", "groups:history", "im:history"],
};

export interface BotIdentity {
  userId?: string;
  botId?: string;
  teamId?: string;
  team?: string;
  url?: string;
  /** Scopes granted to the token, from the `x-oauth-scopes` header. Undefined if Slack did not report them. */
  scopes?: string[];
}

export async function fetchBotIdentity(client: WebClient): Promise<BotIdentity> {
  const res = await client.auth.test();
  return {
    userId: res.user_id,
    botId: res.bot_id,
    teamId: res.team_id,
    team: res.team,
    url: res.url,
    scopes: res.response_metadata?.scopes,
  };
}

/** Throw a MissingScopeError if the token is known to lack any of `needed`. */
export function requireScopes(identity: BotIdentity, needed: string[], context: string): void {
  if (!identity.scopes) return;
  const missing = needed.filter((s) => !identity.scopes!.includes(s));
  if (missing.length > 0) throw new MissingScopeError(missing, identity.scopes, context);
}
