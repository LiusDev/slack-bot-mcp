import { describe, expect, it } from "vitest";
import { classifyTarget, SlackDirectory, type SlackUser } from "../src/slack/directory";

describe("classifyTarget", () => {
  it.each([
    ["C0123ABCDE", { type: "channel_id", value: "C0123ABCDE" }],
    ["D0123ABCDE", { type: "channel_id", value: "D0123ABCDE" }],
    ["<#C0123ABCDE|general>", { type: "channel_id", value: "C0123ABCDE" }],
    ["U0123ABCDE", { type: "user_id", value: "U0123ABCDE" }],
    ["<@U0123ABCDE>", { type: "user_id", value: "U0123ABCDE" }],
    ["#General", { type: "channel_name", value: "general" }],
    ["Jane.Doe@Example.com", { type: "email", value: "jane.doe@example.com" }],
    ["@jane", { type: "handle", value: "jane" }],
    ["Jane Doe", { type: "name", value: "jane doe" }],
  ])("classifies %s", (input, expected) => {
    expect(classifyTarget(input)).toEqual(expected);
  });
});

describe("searchUsers", () => {
  const user = (id: string, real_name: string, title?: string): SlackUser => ({
    id,
    handle: real_name.toLowerCase().replace(/\s/g, "."),
    real_name,
    display_name: real_name,
    title,
    is_bot: false,
    deleted: false,
  });
  const directory = new SlackDirectory(() => ({}) as never);
  directory.listUsers = async () => [
    user("U1", "Alice Smith", "Backend Engineer"),
    user("U2", "Engineer Bob", "Designer"),
  ];

  it("ignores titles by default", async () => {
    const found = await directory.searchUsers("backend");
    expect(found).toEqual([]);
  });

  it("matches titles with includeTitle, ranked below name matches", async () => {
    const found = await directory.searchUsers("engineer", { includeTitle: true });
    expect(found.map((u) => u.id)).toEqual(["U2", "U1"]);
  });
});
