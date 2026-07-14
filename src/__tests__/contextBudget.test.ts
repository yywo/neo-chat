import { describe, expect, it } from "vitest";
import {
  allocateContextBudget,
  estimateContextTokens,
  trimTextToEstimatedTokens,
} from "../lib/chat/contextBudget";

describe("context budget planning", () => {
  it("estimates tokens from text with a stable fallback", () => {
    expect(estimateContextTokens("")).toBe(0);
    expect(estimateContextTokens("abcd")).toBe(1);
    expect(estimateContextTokens("a".repeat(401))).toBe(101);
  });

  it("allocates bounded budgets for mixed context sources", () => {
    const budget = allocateContextBudget({
      modelInputTokenLimit: 8_000,
      reservedOutputTokens: 1_000,
      sources: {
        history: 20_000,
        attachments: 8_000,
        search: 12_000,
        rag: 12_000,
        tools: 6_000,
      },
    });

    expect(budget.totalAvailableTokens).toBe(7_000);
    expect(budget.allocations.history.maxTokens).toBeGreaterThan(
      budget.allocations.search.maxTokens,
    );
    expect(budget.allocations.attachments.maxTokens).toBeGreaterThan(0);
    expect(budget.allocations.tools.maxTokens).toBeLessThanOrEqual(700);
    expect(budget.totalAllocatedTokens).toBeLessThanOrEqual(7_000);
  });

  it("caps reserved output tokens so models with output >= context still get input budget", () => {
    const budget = allocateContextBudget({
      modelInputTokenLimit: 4_096,
      reservedOutputTokens: 32_768,
      sources: {},
    });

    expect(budget.totalAvailableTokens).toBeGreaterThan(0);
    expect(budget.totalAvailableTokens).toBeLessThanOrEqual(4_096);
    expect(budget.totalAvailableTokens).toBeGreaterThanOrEqual(2_048);
  });

  it("uses the default context limit when metadata context is missing but output is large", () => {
    const budget = allocateContextBudget({
      reservedOutputTokens: 64_000,
      sources: {},
    });

    expect(budget.totalAvailableTokens).toBeGreaterThan(0);
    expect(budget.totalAvailableTokens).toBeLessThanOrEqual(32_000);
  });

  it("does not over-reserve when output is much smaller than context", () => {
    const budget = allocateContextBudget({
      modelInputTokenLimit: 128_000,
      reservedOutputTokens: 16_000,
      sources: {},
    });

    expect(budget.totalAvailableTokens).toBe(128_000 - 16_000);
  });

  it("trims text to an estimated token budget without splitting below zero", () => {
    expect(trimTextToEstimatedTokens("abcdefghij", 2)).toBe("abcdefgh");
    expect(trimTextToEstimatedTokens("abcdefghij", 0)).toBe("");
    expect(trimTextToEstimatedTokens("short", 10)).toBe("short");
  });
});
