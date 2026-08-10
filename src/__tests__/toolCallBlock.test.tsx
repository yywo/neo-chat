// @vitest-environment jsdom

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import ToolCallBlock from "@/components/content/ToolCallBlock";
import type { ToolCall } from "@/types";
import contentMessages from "@/i18n/locales/en/Content.json";

afterEach(cleanup);

function renderBlock(
  toolCall: ToolCall,
  handlers: {
    onDecision?: (toolCallId: string, decision: string) => void;
    onRevoke?: (toolCall: ToolCall) => void;
  } = {},
) {
  return renderBlocks([toolCall], handlers);
}

function renderBlocks(
  toolCalls: ToolCall[],
  handlers: {
    onDecision?: (toolCallId: string, decision: string) => void;
    onRevoke?: (toolCall: ToolCall) => void;
  } = {},
) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ Content: contentMessages }}>
      <ToolCallBlock
        toolCalls={toolCalls}
        onConfirmationDecision={handlers.onDecision}
        onRevokeSessionApproval={handlers.onRevoke}
      />
    </NextIntlClientProvider>,
  );
}

const awaitingWriteCall: ToolCall = {
  id: "call-1",
  name: "create_issue",
  pluginId: "tracker",
  pluginTitle: "Issue Tracker",
  functionFingerprint: "fingerprint-1",
  risk: "write",
  args: { title: "Bug", apiKey: "do-not-display" },
  status: "awaiting_confirmation",
  confirmation: { required: true, state: "pending" },
};

describe("ToolCallBlock confirmation controls", () => {
  it("shows redacted write confirmation and returns the selected decision", async () => {
    const onDecision = vi.fn();
    renderBlock(awaitingWriteCall, { onDecision });

    expect(screen.getByText("Allow once")).toBeTruthy();
    expect(screen.getByText("Allow for this chat")).toBeTruthy();
    expect(screen.queryByText("do-not-display")).toBeNull();

    await userEvent.click(screen.getByText("Allow for this chat"));
    expect(onDecision).toHaveBeenCalledWith("call-1", "allow_session");
  });

  it("does not offer session permission for destructive calls", () => {
    renderBlock(
      {
        ...awaitingWriteCall,
        id: "call-destructive",
        risk: "destructive",
      },
      { onDecision: vi.fn() },
    );

    expect(screen.getByText("Allow once")).toBeTruthy();
    expect(screen.queryByText("Allow for this chat")).toBeNull();
  });

  it("allows an existing session permission to be revoked", async () => {
    const onRevoke = vi.fn();
    const approvedCall: ToolCall = {
      ...awaitingWriteCall,
      status: "success",
      result: { ok: true },
      confirmation: {
        required: true,
        state: "approved",
        decision: "allow_session",
        decidedAt: Date.now(),
      },
    };
    renderBlock(approvedCall, { onRevoke });

    await userEvent.click(screen.getByText("Revoke permission for this chat"));
    expect(onRevoke).toHaveBeenCalledWith(
      expect.objectContaining({
        id: approvedCall.id,
        pluginId: approvedCall.pluginId,
        functionFingerprint: approvedCall.functionFingerprint,
        risk: approvedCall.risk,
      }),
    );
  });

  it("distinguishes one-time approval from session approval", () => {
    renderBlock({
      ...awaitingWriteCall,
      status: "success",
      result: { ok: true },
      confirmation: {
        required: true,
        state: "approved",
        decision: "allow_once",
        decidedAt: Date.now(),
      },
    });

    expect(screen.getByText("Allowed once")).toBeTruthy();
    expect(screen.queryByText("Allowed for this chat")).toBeNull();
  });

  it("shows interrupted confirmation separately from user denial", () => {
    renderBlock({
      ...awaitingWriteCall,
      status: "error",
      errorInfo: {
        code: "CONFIRMATION_INTERRUPTED",
        message: "Approval was interrupted",
      },
      confirmation: {
        required: true,
        state: "interrupted",
        decidedAt: Date.now(),
      },
    });

    expect(screen.getByText("Approval interrupted")).toBeTruthy();
    expect(screen.queryByText("Denied")).toBeNull();
  });
});

describe("ToolCallBlock built-in tool presentation", () => {
  it("uses the localized built-in name in the active tool title", () => {
    renderBlock({
      id: "web-search",
      name: "web_search",
      args: { query: "release notes" },
      status: "pending",
    });

    expect(screen.getByText("Running Web search…")).toBeTruthy();
  });

  it("shows distinct names and icons for all Agent built-ins", async () => {
    const { container } = renderBlocks(
      [
        ["web-search", "web_search"],
        ["knowledge-search", "search_knowledge"],
        ["load-skill", "load_skill"],
        ["run-javascript", "run_javascript"],
        ["task-plan", "update_task_plan"],
      ].map(([id, name]) => ({
        id,
        name,
        args: {},
        result: { ok: true },
        status: "success" as const,
      })),
    );

    await userEvent.click(screen.getByRole("button", { name: "Used 5 Tools" }));

    [
      "Web search",
      "Knowledge search",
      "Load skill",
      "Run JavaScript",
      "Update task plan",
    ].forEach((label) => expect(screen.getByText(label)).toBeTruthy());
    [
      "lucide-search",
      "lucide-book-open",
      "lucide-sparkles",
      "lucide-square-code",
      "lucide-list-checks",
    ].forEach((className) =>
      expect(container.querySelector(`.${className}`)).toBeTruthy(),
    );
  });

  it("keeps the existing formatter and wrench icon for plugin tools", async () => {
    const { container } = renderBlock({
      id: "plugin-tool",
      name: "create_issue",
      pluginId: "tracker",
      args: {},
      result: { ok: true },
      status: "success",
    });

    await userEvent.click(screen.getByRole("button", { name: "Used 1 Tool" }));

    expect(screen.getByText("Create Issue")).toBeTruthy();
    expect(container.querySelector(".lucide-wrench")).toBeTruthy();
  });
});

describe("ToolCallBlock image results", () => {
  it("renders generated images inside the expanded tool result", async () => {
    renderBlock({
      id: "image-tool",
      name: "generate_image",
      args: { prompt: "A red panda" },
      result: { imageBase64: "[image omitted]", imageCount: 1 },
      resultImages: [
        {
          id: "image-1",
          mimeType: "image/png",
          url: "https://example.com/generated.png",
          fileName: "plugin-image.png",
        },
      ],
      status: "success",
    });

    await userEvent.click(screen.getByRole("button", { name: "Used 1 Tool" }));

    expect(
      screen.getByRole("img", { name: "plugin-image.png" }).getAttribute("src"),
    ).toBe("https://example.com/generated.png");
  });
});
