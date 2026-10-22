import type { CallToolResult } from "@modelcontextprotocol/server";

/**
 * An error whose message is already written for the agent: what went wrong
 * and what to do next. Thrown by tools for input/resolution problems.
 */
export class ToolError extends Error {}

/** Thrown when a feature needs an OAuth scope the bot token does not have. */
export class MissingScopeError extends ToolError {
  constructor(
    readonly needed: string[],
    readonly provided: string[] | undefined,
    context: string,
  ) {
    super(missingScopeMessage(needed.join(","), provided?.join(","), context));
  }
}

const REINSTALL_HINT =
  "A Slack workspace admin must add it under api.slack.com/apps → your app → OAuth & Permissions → Bot Token Scopes, then reinstall the app to the workspace.";

function missingScopeMessage(needed: string | undefined, provided: string | undefined, context: string): string {
  return [
    `Permission denied: the Slack bot is missing the OAuth scope \`${needed ?? "unknown"}\` needed to ${context}.`,
    provided ? `Scopes the bot currently has: ${provided}.` : undefined,
    REINSTALL_HINT,
    "Tell the user which scope is missing; retrying will not help until the app is updated.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Agent-facing explanations for Slack Web API error codes. */
const SLACK_ERRORS: Record<string, string> = {
  not_in_channel:
    "The bot is not a member of this channel. Ask the user to invite it with `/invite @<bot name>` in that channel. For public channels, adding the `chat:write.public` scope also lets the bot post without joining.",
  channel_not_found:
    "Channel not found. Either the ID/name is wrong, or it is a private channel the bot has not been invited to (private channels are invisible to the bot until it is invited).",
  user_not_found: "User not found. Check the user ID, or search with `users_search` first.",
  users_not_found: "No Slack user has this email address in the workspace (or the user is not visible to the bot).",
  is_archived: "The channel is archived; nobody can post to it. Ask the user to unarchive it or choose another channel.",
  cant_dm_bot: "Cannot send a direct message to a bot user.",
  user_is_bot: "This action is not allowed on a bot user.",
  msg_too_long: "The message is too long. Split it into several shorter messages.",
  no_text: "The message is empty. Provide some text.",
  thread_not_found: "Thread not found. Check `thread_ts`; it must be the timestamp of an existing message in this channel.",
  message_not_found: "Message not found. Check the channel and message timestamp.",
  cant_delete_message:
    "The bot can only delete messages it posted itself. This message belongs to someone else; ask its author or a workspace admin to delete it.",
  compliance_exports_prevent_deletion: "The workspace's compliance export settings prevent deleting messages.",
  already_reacted: "The bot already added this reaction to the message.",
  no_reaction: "The bot has not added this reaction to the message, so there is nothing to remove.",
  invalid_name: "Unknown emoji name. Use a Slack emoji name without colons, for example `thumbsup` or `white_check_mark`.",
  too_many_reactions: "The message already has the maximum number of reactions.",
  restricted_action:
    "The workspace settings do not allow the bot to do this here (for example, posting is restricted to admins in this channel).",
  ekm_access_denied: "Access denied by the workspace's Enterprise Key Management policy.",
  team_access_not_granted: "The bot token has no access to this workspace or channel (Slack Connect / Enterprise Grid restriction).",
  invalid_auth: "SLACK_BOT_TOKEN is invalid. Check the token configured for this MCP server.",
  not_authed: "No Slack token was sent. Check that SLACK_BOT_TOKEN is configured for this MCP server.",
  token_revoked: "SLACK_BOT_TOKEN has been revoked. Reinstall the Slack app and update the token.",
  token_expired: "SLACK_BOT_TOKEN has expired. Generate a new token and update the configuration.",
  account_inactive: "The Slack app or bot user has been deactivated. Reinstall the app and update SLACK_BOT_TOKEN.",
  not_allowed_token_type:
    "This Slack API method does not accept a bot token (xoxb-). The action is not available to bots.",
};

interface SlackLikeError {
  code?: string;
  message?: string;
  retryAfter?: number;
  retryAfterMs?: number;
  data?: { error?: string; needed?: string; provided?: string };
  statusCode?: number;
}

export function errorText(text: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text }] };
}

/** Convert any thrown value into an MCP tool error result the agent can act on. */
export function toToolError(err: unknown, action: string): CallToolResult {
  return errorText(describeError(err, action));
}

export function describeError(err: unknown, action: string): string {
  if (err instanceof ToolError) return err.message;

  const e = (typeof err === "object" && err !== null ? err : {}) as SlackLikeError;
  const slackCode = e.code === "slack_webapi_platform_error" ? e.data?.error : undefined;

  if (slackCode === "missing_scope") {
    return missingScopeMessage(e.data?.needed, e.data?.provided, action);
  }
  if (slackCode === "ratelimited" || e.code === "slack_webapi_rate_limited_error" || e.code === "RATE_LIMITED") {
    const seconds = e.retryAfter ?? (e.retryAfterMs !== undefined ? Math.ceil(e.retryAfterMs / 1000) : undefined);
    return `Slack rate limit hit while trying to ${action}.${seconds ? ` Retry after ${seconds} seconds.` : " Wait a little before retrying."}`;
  }
  if (slackCode) {
    const explanation = SLACK_ERRORS[slackCode] ?? "Slack rejected the request.";
    return `Failed to ${action}: Slack API error \`${slackCode}\`.\n${explanation}`;
  }
  if (e.code === "slack_webapi_request_error") {
    return `Failed to ${action}: could not reach Slack (${e.message ?? "network error"}). Check network connectivity and retry.`;
  }
  if (e.code === "slack_webapi_http_error") {
    return `Failed to ${action}: Slack returned HTTP ${e.statusCode ?? "error"}. Retry later.`;
  }
  const message = err instanceof Error ? err.message : String(err);
  return `Failed to ${action}: ${message}`;
}
