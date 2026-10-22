import { describe, expect, it } from "vitest";
import { classifyTarget } from "../src/slack/directory";

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
