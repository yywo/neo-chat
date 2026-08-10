import { describe, expect, it } from "vitest";

import {
  DEFAULT_SESSION_TITLE,
  getSessionDisplayTitle,
} from "@/lib/chat/sessionTitle";

describe("session title presentation", () => {
  it("localizes only the canonical default title", () => {
    expect(getSessionDisplayTitle(DEFAULT_SESSION_TITLE, "新建对话")).toBe(
      "新建对话",
    );
    expect(getSessionDisplayTitle(DEFAULT_SESSION_TITLE, "新規チャット")).toBe(
      "新規チャット",
    );
  });

  it("preserves user-authored and legacy persisted titles verbatim", () => {
    expect(getSessionDisplayTitle("New Chat notes", "新建对话")).toBe(
      "New Chat notes",
    );
    expect(getSessionDisplayTitle("Budget (Copy)", "新建对话")).toBe(
      "Budget (Copy)",
    );
  });
});
