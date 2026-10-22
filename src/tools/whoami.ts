import type { McpServer } from "@modelcontextprotocol/server";
import type { SlackRuntime } from "../slack/bot";
import { TOOL_SCOPES } from "../slack/scopes";
import { VERSION } from "../version";
import { run } from "./util";

export function registerWhoamiTool(server: McpServer, rt: SlackRuntime): void {
  server.registerTool(
    "whoami",
    {
      title: "Slack bot status",
      description:
        "Show the server version, which Slack bot and workspace this server is connected to, the connection mode, the OAuth scopes the bot has, and which tools are missing scopes. Call this first when a Slack action fails with a permission error.",
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    () =>
      run("check the Slack connection", async () => {
        const id = await rt.ready;
        const missing = id.scopes
          ? Object.fromEntries(
              Object.entries(TOOL_SCOPES)
                .map(([tool, scopes]) => [tool, scopes.filter((s) => !id.scopes!.includes(s))] as const)
                .filter(([, scopes]) => scopes.length > 0),
            )
          : "unknown (Slack did not report the token's scopes)";
        return {
          bot_user_id: id.userId,
          bot_id: id.botId,
          team: id.team,
          team_id: id.teamId,
          workspace_url: id.url,
          server_version: VERSION,
          mode: rt.config.mode,
          event_connection: rt.eventStatus(),
          scopes: id.scopes,
          missing_scopes_by_tool: missing,
          allowed_post_targets: rt.config.allowedTargets ?? "any",
        };
      }),
  );
}
