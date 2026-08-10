import { afterEach, describe, expect, it, vi } from "vitest";

import { createStreamRenderScheduler } from "@/lib/chat/streamRenderScheduler";

describe("stream render scheduler", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("coalesces a burst into one render", () => {
    vi.useFakeTimers();
    const apply = vi.fn();
    const scheduler = createStreamRenderScheduler(apply);

    scheduler.schedule("first");
    scheduler.schedule("second");
    scheduler.schedule("third");
    vi.advanceTimersByTime(50);

    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("applies only the latest payload in the window", () => {
    vi.useFakeTimers();
    const apply = vi.fn();
    const scheduler = createStreamRenderScheduler(apply);

    scheduler.schedule({ content: "partial" });
    scheduler.schedule({ content: "complete" });
    vi.advanceTimersByTime(50);

    expect(apply).toHaveBeenCalledWith({ content: "complete" });
  });

  it("flushes synchronously and cancels the pending timer", () => {
    vi.useFakeTimers();
    const apply = vi.fn();
    const scheduler = createStreamRenderScheduler(apply);

    scheduler.schedule("latest");
    scheduler.flush();

    expect(apply).toHaveBeenCalledWith("latest");
    vi.advanceTimersByTime(50);
    expect(apply).toHaveBeenCalledTimes(1);

    scheduler.flush();
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("cancels without applying the pending payload", () => {
    vi.useFakeTimers();
    const apply = vi.fn();
    const scheduler = createStreamRenderScheduler(apply);

    scheduler.schedule("discarded");
    scheduler.cancel();
    vi.advanceTimersByTime(50);

    expect(apply).not.toHaveBeenCalled();

    scheduler.cancel();
    expect(apply).not.toHaveBeenCalled();
  });

  it("waits for the default 50ms window to expire", () => {
    vi.useFakeTimers();
    const apply = vi.fn();
    const scheduler = createStreamRenderScheduler(apply);

    scheduler.schedule("ready");
    vi.advanceTimersByTime(49);
    expect(apply).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(apply).toHaveBeenCalledWith("ready");
  });
});
