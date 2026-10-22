# slack-bot-mcp

An MCP server that lets an AI agent work in Slack as a bot. The agent can send DMs and channel messages, find members by email or name, read history and threads, react to messages, and wait for replies.

It is built on [Chat SDK](https://chat-sdk.dev) (`chat` + `@chat-adapter/slack`). By default it receives events over Socket Mode, so it needs no public URL. Set `SLACK_MODE=webhook` to receive events through a Request URL instead.

## Quick start

```bash
SLACK_BOT_TOKEN=xoxb-... SLACK_APP_TOKEN=xapp-... npx -y @liusdev/slack-bot-mcp
# or
SLACK_BOT_TOKEN=xoxb-... SLACK_APP_TOKEN=xapp-... pnpm dlx @liusdev/slack-bot-mcp
```

Check the installed version with `npx -y @liusdev/slack-bot-mcp -v` (or `--version`); `--help` lists usage. The `whoami` tool also reports `server_version`.

### Claude Code

```bash
claude mcp add slack-bot \
  -e SLACK_BOT_TOKEN=xoxb-... \
  -e SLACK_APP_TOKEN=xapp-... \
  -- npx -y @liusdev/slack-bot-mcp
```

### Claude Desktop, Cursor and other MCP clients

```json
{
  "mcpServers": {
    "slack-bot": {
      "command": "npx",
      "args": ["-y", "@liusdev/slack-bot-mcp"],
      "env": {
        "SLACK_BOT_TOKEN": "xoxb-...",
        "SLACK_APP_TOKEN": "xapp-..."
      }
    }
  }
}
```

## Create the Slack app

A Slack [app manifest](https://docs.slack.dev/app-manifests/) is a YAML file that describes an app's configuration. The manifest below sets up everything this server needs in one step:

- a bot user that people can DM (the App Home **Messages** tab)
- the bot token scopes the tools use
- the `app_mention` and `message.im` events, which feed `get_inbox`
- Socket Mode, so no public URL is needed

1. Go to [api.slack.com/apps](https://api.slack.com/apps), click **Create New App**, choose **From an app manifest**, pick your workspace, and paste the manifest below.
2. Under **Basic Information → App-Level Tokens**, generate a token with the `connections:write` scope. This is `SLACK_APP_TOKEN` (`xapp-…`).
3. Under **OAuth & Permissions**, install the app to the workspace and copy the **Bot User OAuth Token**. This is `SLACK_BOT_TOKEN` (`xoxb-…`).
4. Invite the bot to any private channel it should read or post in: `/invite @AI Assistant`.

```yaml
display_information:
  name: AI Assistant
features:
  app_home:
    messages_tab_enabled: true
    messages_tab_read_only_enabled: false
  bot_user:
    display_name: AI Assistant
    always_online: true
oauth_config:
  scopes:
    bot:
      - app_mentions:read
      - channels:history
      - channels:read
      - chat:write
      - chat:write.public
      - groups:history
      - groups:read
      - im:history
      - im:read
      - im:write
      - mpim:history
      - mpim:read
      - reactions:read
      - reactions:write
      - users:read
      - users:read.email
settings:
  event_subscriptions:
    bot_events:
      - app_mention
      - message.im
  interactivity:
    is_enabled: true
  org_deploy_enabled: false
  socket_mode_enabled: true
  token_rotation_enabled: false
```

### Use an existing app

To reuse an app you already created, open it at [api.slack.com/apps](https://api.slack.com/apps) and select **App Manifest** in the sidebar. Merge in the scopes, events, `socket_mode_enabled` and `app_home` settings above. Do not paste over the whole manifest: that replaces the app's current configuration and can drop scopes, events or Request URLs it already uses. Save, then click **Reinstall to Workspace** under **OAuth & Permissions** so new scopes take effect. If the app has no app-level token yet, create one as in step 2.

You can drop scopes you do not need. Tools that lack a scope return an error that names the missing scope. `chat:write.public` lets the bot post in public channels without being invited first.

## Tools

| Tool | What it does | Bot scopes |
|---|---|---|
| `whoami` | Bot identity, connection status, granted scopes, and the scopes each tool is missing | none |
| `users_search` | Find members by email, name, display name or @handle | `users:read`, `users:read.email` |
| `user_info` | Profile of one user (ID, email or @handle) | `users:read` |
| `channels_list` | List channels, filtered by type, name or membership | `channels:read`, `groups:read`, `im:read`, `mpim:read` |
| `send_message` | Post to a channel, a thread, or a user's DM (Markdown or plain text). `expect_reply: true` saves the message as a pending question | `chat:write`, `im:write` |
| `delete_message` | Delete a message the bot posted (bots cannot delete other people's messages) | `chat:write` |
| `conversations_history` | Read recent messages in a channel or DM | `channels:history`, `groups:history`, `im:history`, `mpim:history` |
| `conversations_replies` | Read a thread | same as above |
| `reactions_add`, `reactions_remove` | Add or remove an emoji reaction | `reactions:write` |
| `wait_for_reply` | Wait briefly (default 45 s) for a reply; saves the question as pending on timeout | history scopes |
| `check_replies` | Check all pending questions, or one conversation, once and return any answers | history scopes |
| `get_inbox` | DMs and @mentions the bot received while the server was running | `app_mention` and `message.im` events |

Wherever a tool takes a channel or user, you can pass:

- a channel ID (`C…`), `#channel-name`, or Slack markup (`<#C…>`)
- a user ID (`U…`), `@handle`, email, or display name

For a user, the tool opens a DM with them. If a name matches several users, the tool returns the candidates so the agent can ask which one you mean.

Bot tokens cannot call Slack's `search.messages` API, so this server has no message search.

### Errors

Every tool returns failures as an MCP tool error (`isError: true`). The text says what failed, why, and what to do. For example:

```
Permission denied: the Slack bot is missing the OAuth scope `reactions:write` needed to add the :eyes: reaction.
Scopes the bot currently has: chat:write,users:read.
A Slack workspace admin must add it under api.slack.com/apps → your app → OAuth & Permissions → Bot Token Scopes, then reinstall the app to the workspace.
```

The server also explains common Slack errors: `not_in_channel`, `channel_not_found`, `users_not_found`, `is_archived`, `invalid_auth`, and rate limits with the retry delay. Without `users:read.email`, Slack silently leaves emails out of user lists. In that case, email lookups report the missing scope instead of "user not found".

## Configuration

| Variable | Required | Default | Description |
|---|---|---|---|
| `SLACK_BOT_TOKEN` | yes | | Bot token, `xoxb-…` |
| `SLACK_APP_TOKEN` | socket mode | | App-level token with `connections:write`, `xapp-…` |
| `SLACK_MODE` | no | `socket` | `socket` or `webhook` |
| `SLACK_SIGNING_SECRET` | webhook mode | | Signing secret from **Basic Information** |
| `SLACK_MCP_HTTP_PORT` | no | `3000` | Port for incoming Slack events in webhook mode |
| `SLACK_MCP_HTTP_PATH` | no | `/slack/events` | Path for incoming Slack events in webhook mode |
| `SLACK_MCP_ALLOWED_CHANNELS` | no | any | Comma-separated targets `send_message` may post to: channel IDs, `#names`, user IDs or emails |
| `SLACK_MCP_LOG_LEVEL` | no | `info` | `debug`, `info`, `warn`, `error` or `silent`. Logs go to stderr |
| `SLACK_MCP_STATE_DIR` | no | `~/.slack-bot-mcp` | Where pending questions are stored, one JSON file per workspace |
| `SLACK_MCP_PENDING_TTL_DAYS` | no | `7` | Pending questions older than this are dropped |

### Webhook mode

Set `SLACK_MODE=webhook` and `SLACK_SIGNING_SECRET`. The server then listens on `SLACK_MCP_HTTP_PORT`. In the app settings, turn off Socket Mode and set the Request URL under **Event Subscriptions** and **Interactivity** to `https://<your-host>/slack/events`.

## Waiting for replies

People may answer in a minute or the next morning. Polling inside one agent turn is cheap for the server but not for the agent: every `wait_for_reply` call is a model turn that re-reads the whole conversation. So the server keeps waits short and remembers what it is waiting for:

1. The agent sends the question with `send_message` and `expect_reply: true`. The server saves it as a pending question in `SLACK_MCP_STATE_DIR`, which outlives the MCP process and the agent session.
2. If a quick answer is likely, the agent calls `wait_for_reply` once or twice. After two timeouts the tool tells the agent to stop and report back to the user.
3. Later, `check_replies` with no arguments checks every pending question in one call, returns the answers, and removes answered questions from the list.

Something has to run the agent again for step 3; the server cannot wake an agent. Slack's official MCP server has no wait tool either, so agents using it re-read threads the same way. Options:

- The user asks: "check Slack replies".
- A loop in an open session, for example `/loop 30m check Slack replies and continue` in Claude Code.
- A scheduled run, for example a cron job at 8:00 running `claude -p "check Slack replies and continue"`.

Each check is one short turn, instead of one turn every minute.

To let a single `wait_for_reply` call block longer, raise your client's tool timeout and pass a larger `timeout_seconds` (up to 300). In Claude Code, set `MCP_TOOL_TIMEOUT` in milliseconds, for example `MCP_TOOL_TIMEOUT=320000`.

## Running several instances

Every tool except `get_inbox` calls the Slack Web API directly with the bot token. Those tools give the same results no matter how many agents run this server at once. Keep in mind:

- **Events are split.** Slack delivers each event to only one of an app's open Socket Mode connections. Each instance's `get_inbox` therefore sees only part of the incoming messages. `wait_for_reply` and `check_replies` read the Web API, so they are not affected.
- **Connection limit.** Slack allows at most 10 Socket Mode connections per app. Instances beyond that cannot open a socket, so their `get_inbox` reports the connection error. Their other tools still work.
- **Rate limits are shared.** All instances spend the same token's Slack rate limits. A tool that hits a limit fails at once and says how long to wait.

## Development

```bash
pnpm install
pnpm dev          # rebuild on change
pnpm test
pnpm typecheck
pnpm build
npx @modelcontextprotocol/inspector node dist/index.js   # try the tools interactively
```

## Releasing

Pushing a `v*` tag publishes to npm through GitHub Actions (`.github/workflows/publish.yml`). The workflow authenticates with [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers), so the repository stores no npm token.

```bash
npm version patch        # or minor / major: bumps package.json, commits, and tags
git push --follow-tags   # the tag triggers the publish workflow
```

The workflow fails if the tag does not match the `package.json` version.
