import { beforeEach, describe, expect, it, vi } from "vitest";
import { BROWSER_SANDBOX_LIMITS } from "../config/limits";

const mocks = vi.hoisted(() => ({
  runInSandbox: vi.fn(),
}));

vi.mock("../utils/sandbox", () => ({
  runInSandbox: mocks.runInSandbox,
}));

import { createJavaScriptBinding } from "../services/api/chat/builtinTools/javascript";

const context = {
  sessionId: "session-1",
  emit: {},
};

describe("run_javascript built-in", () => {
  beforeEach(() => {
    mocks.runInSandbox.mockReset();
  });

  it("executes bounded code with the request signal", async () => {
    const controller = new AbortController();
    mocks.runInSandbox.mockResolvedValue("42");

    const result = await createJavaScriptBinding().execute(
      { code: "return 6 * 7;" },
      { ...context, signal: controller.signal },
    );

    expect(mocks.runInSandbox).toHaveBeenCalledWith(
      "return 6 * 7;",
      controller.signal,
    );
    expect(result).toEqual({ output: "42" });
  });

  it("maps sandbox error strings to structured tool errors", async () => {
    mocks.runInSandbox.mockResolvedValue("log\nError: broken");

    await expect(
      createJavaScriptBinding().execute(
        { code: "throw Error('broken')" },
        context,
      ),
    ).resolves.toMatchObject({
      error: { code: "JAVASCRIPT_EXECUTION_FAILED" },
    });
  });

  it("rejects oversize code before creating a sandbox", async () => {
    const result = await createJavaScriptBinding().execute(
      { code: "x".repeat(BROWSER_SANDBOX_LIMITS.maxCodeChars + 1) },
      context,
    );

    expect(result).toMatchObject({
      error: { code: "JAVASCRIPT_CODE_TOO_LARGE" },
    });
    expect(mocks.runInSandbox).not.toHaveBeenCalled();
  });

  it("propagates request cancellation", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      createJavaScriptBinding().execute(
        { code: "return 1;" },
        { ...context, signal: controller.signal },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.runInSandbox).not.toHaveBeenCalled();
  });
});
