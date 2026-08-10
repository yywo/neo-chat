import { describe, expect, it, vi } from "vitest";

import {
  buildReplyPromptContext,
  createStreamCheckpointController,
  hasUnsafeContinuationToolState,
  markStaleGenerationInterrupted,
  recoverPersistedGeneration,
  runWithPreOutputRetry,
  trimContinuationOverlap,
} from "@/lib/chat/streamResilience";
import type { Message, ToolCall } from "@/types";

describe("stream resilience", () => {
  it("retries recoverable failures only before output or tool activity", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const run = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new TypeError("network unavailable"))
      .mockResolvedValue("done");
    const resultPromise = runWithPreOutputRetry({
      run,
      hasVisibleOutput: () => false,
      hasToolActivity: () => false,
    });
    await vi.advanceTimersByTimeAsync(500);
    await expect(resultPromise).resolves.toBe("done");
    expect(run).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("does not retry after visible output", async () => {
    const error = new TypeError("network unavailable");
    await expect(
      runWithPreOutputRetry({
        run: () => Promise.reject(error),
        hasVisibleOutput: () => true,
        hasToolActivity: () => false,
      }),
    ).rejects.toBe(error);
  });

  it("checkpoints at 750ms or 2KiB and can be flushed explicitly", async () => {
    let now = 0;
    const persist = vi.fn(async () => undefined);
    const checkpoint = createStreamCheckpointController({
      persist,
      now: () => now,
    });

    checkpoint.record(100);
    expect(persist).not.toHaveBeenCalled();
    now = 751;
    checkpoint.record(101);
    await Promise.resolve();
    expect(persist).toHaveBeenCalledTimes(1);
    await checkpoint.flush();
    expect(persist).toHaveBeenCalledTimes(2);
  });

  it("removes only a conservative continuation overlap", () => {
    const repeated = "This is a sufficiently long repeated sentence.";
    expect(
      trimContinuationOverlap(`Before ${repeated}`, `${repeated} After`),
    ).toBe(" After");
    expect(trimContinuationOverlap("short", "short answer")).toBe(
      "short answer",
    );
  });

  it("blocks continuation for non-terminal or write-capable tools", () => {
    const tool = (updates: Partial<ToolCall>): ToolCall => ({
      id: "tool-1",
      name: "demo",
      args: {},
      status: "success",
      ...updates,
    });
    expect(hasUnsafeContinuationToolState([tool({ status: "running" })])).toBe(
      true,
    );
    expect(hasUnsafeContinuationToolState([tool({ risk: "write" })])).toBe(
      true,
    );
    expect(hasUnsafeContinuationToolState([tool({ risk: "read" })])).toBe(
      false,
    );
  });

  it("escapes reply context and marks stale foreign streams interrupted", () => {
    expect(
      buildReplyPromptContext({
        messageId: "m1",
        role: "model",
        excerpt: "<script>& text",
      }),
    ).toContain("&lt;script&gt;&amp; text");

    const message: Message = {
      id: "m2",
      role: "model",
      content: "partial",
      timestamp: 1,
      generation: {
        status: "streaming",
        requestId: "request",
        ownerDeviceId: "other",
        model: "TEST:model",
        attempt: 0,
        checkpointAt: 1,
      },
    };
    expect(
      markStaleGenerationInterrupted(message, "local", 120_002).generation,
    ).toMatchObject({ status: "interrupted" });
  });

  it("recovers a persisted local stream after reload", () => {
    const message: Message = {
      id: "m3",
      role: "model",
      content: "partial",
      timestamp: 1,
      generation: {
        status: "streaming",
        requestId: "request",
        ownerDeviceId: "local",
        model: "TEST:model",
        attempt: 0,
        checkpointAt: 1,
      },
    };

    expect(
      recoverPersistedGeneration(message, "local", false, 2).generation,
    ).toMatchObject({ status: "interrupted" });
    expect(recoverPersistedGeneration(message, "local", true, 2)).toBe(message);
  });
});
