import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { ToolError } from "../errors";
import type { SlackRuntime } from "../slack/bot";
import { isEmail } from "../slack/directory";
import { requireScopes } from "../slack/scopes";
import { run } from "./util";

export function registerUserTools(server: McpServer, rt: SlackRuntime): void {
  server.registerTool(
    "users_search",
    {
      title: "Search Slack users",
      description:
        "Find workspace members by email, real name, display name, @handle or job title. Returns user IDs to use with send_message and other tools. Exact matches come first.",
      inputSchema: z.object({
        query: z.string().min(1).describe("Email address, full or partial name, display name, @handle, or job title"),
        limit: z.number().int().min(1).max(100).default(10).describe("Maximum number of users to return"),
        include_bots: z.boolean().default(false).describe("Include bot users in the results"),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ query, limit, include_bots }) =>
      run("search Slack users", async () => {
        const id = await rt.ready;
        if (isEmail(query)) {
          // Without users:read.email Slack silently omits emails, so a search
          // would wrongly report "not found". Report the missing scope instead.
          requireScopes(id, ["users:read.email"], "look up users by email");
          const user = await rt.directory.findUserByEmail(query.trim());
          if (!user) return { users: [], note: `No Slack user has the email ${query}.` };
          return { users: [user] };
        }
        requireScopes(id, ["users:read"], "list workspace members");
        const users = await rt.directory.searchUsers(query, { includeBots: include_bots, includeTitle: true });
        if (users.length === 0) {
          return { users: [], note: `No user matches "${query}". Try a shorter part of the name, or the email.` };
        }
        return { users: users.slice(0, limit), total_matches: users.length };
      }),
  );

  server.registerTool(
    "user_info",
    {
      title: "Get Slack user details",
      description: "Get profile details for one Slack user, identified by user ID (U…), email, or @handle.",
      inputSchema: z.object({
        user: z.string().min(1).describe("User ID (U…), email address, or @handle"),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ user }) =>
      run("get Slack user details", async () => {
        const id = await rt.ready;
        if (isEmail(user)) requireScopes(id, ["users:read.email"], "look up users by email");
        const found = await rt.directory.resolveUser(user);
        const res = await rt.adapter.webClient.users.info({ user: found.id });
        const profile = res.user?.profile;
        if (!res.user) throw new ToolError(`No Slack user with ID ${found.id}.`);
        return {
          ...found,
          phone: profile?.phone || undefined,
          status_text: profile?.status_text || undefined,
          status_emoji: profile?.status_emoji || undefined,
          is_admin: res.user.is_admin,
          tz_label: res.user.tz_label,
        };
      }),
  );
}
