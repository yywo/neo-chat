import { describe, expect, it } from "vitest";
import {
  getContextUsagePercent,
  summarizeSessionUsage,
} from "@/lib/chat/sessionUsage";
import type { Message } from "@/types";

const message = (overrides: Partial<Message>): Message => ({
  id: "message",
  role: "model",
  content: "",
  timestamp: 1,
  ...overrides,
});

describe("session usage summary", () => {
  it("aggregates recorded provider usage and uses the latest turn as context", () => {
    const summary = summarizeSessionUsage([
      message({
        id: "a",
        usage: {
          prompt_tokens: 100,
          completion_tokens: 20,
          total_tokens: 120,
        },
      }),
      message({
        id: "b",
        usageMetadata: {
          promptTokenCount: 180,
          candidatesTokenCount: 30,
          totalTokenCount: 210,
        },
      }),
    ]);

    expect(summary).toEqual({
      promptTokens: 280,
      completionTokens: 50,
      totalTokens: 330,
      currentContextTokens: 210,
      estimated: false,
    });
  });

  it("falls back to a clearly marked text estimate", () => {
    const summary = summarizeSessionUsage([
      message({ role: "user", content: "hello world" }),
      message({ content: "answer text" }),
    ]);

    expect(summary.estimated).toBe(true);
    expect(summary.totalTokens).toBeGreaterThan(0);
    expect(summary.currentContextTokens).toBe(summary.totalTokens);
  });

  it("bounds context percentages and reports unknown limits", () => {
    expect(getContextUsagePercent(50, 100)).toBe(50);
    expect(getContextUsagePercent(200, 100)).toBe(100);
    expect(getContextUsagePercent(10)).toBeNull();
  });
});
