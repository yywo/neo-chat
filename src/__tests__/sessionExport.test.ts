import { describe, expect, it, vi } from "vitest";
import type { Message, MessageOutputBlock, Session } from "../types";
import { createSessionExportPayload } from "../lib/chat/sessionExport";
import {
  createModelResponseBranch,
  normalizeSessionMessageTree,
} from "../lib/chat/messageTree";

const makeSession = (id: string): Session => ({
  id,
  title: "Chat",
  messageCount: 1,
  updatedAt: 1,
  model: "model",
});

const makeMessage = (id: string, content: string): Message => ({
  id,
  role: "user",
  content,
  timestamp: 1,
});

const makeTaskPlanBlock = (title: string): MessageOutputBlock => ({
  id: `plan-${title}`,
  type: "task_plan",
  steps: [
    { title, status: "in_progress" },
    { title: "Verify export", status: "pending" },
  ],
  note: "Keep every branch.",
});

const withTaskPlan = (message: Message, title: string): Message => ({
  ...message,
  outputBlocks: [makeTaskPlanBlock(title)],
});

describe("session export payloads", () => {
  it("uses the active in-memory snapshot for the current session", async () => {
    const activeMessage = withTaskPlan(
      makeMessage("m1", "unsynced active text"),
      "Export active array",
    );
    const loadMessages = vi.fn(() =>
      Promise.resolve([makeMessage("db", "stale db text")]),
    );

    const payload = await createSessionExportPayload({
      session: makeSession("active"),
      currentSessionId: "active",
      activeMessages: [activeMessage],
      loadMessages,
    });

    expect(payload.messages).toEqual([activeMessage]);
    expect(loadMessages).not.toHaveBeenCalled();
  });

  it("loads inactive session messages through the supplied storage reader", async () => {
    const storedMessage = withTaskPlan(
      makeMessage("m2", "stored inactive text"),
      "Export inactive array",
    );
    const loadMessages = vi.fn(() => Promise.resolve([storedMessage]));

    const payload = await createSessionExportPayload({
      session: makeSession("inactive"),
      currentSessionId: "active",
      activeMessages: [makeMessage("m1", "active text")],
      loadMessages,
    });

    expect(loadMessages).toHaveBeenCalledWith("inactive");
    expect(payload.messages).toEqual([storedMessage]);
  });

  it("exports the current path and complete message tree for tree-backed sessions", async () => {
    let tree = normalizeSessionMessageTree([
      makeMessage("u1", "prompt"),
      withTaskPlan(
        { ...makeMessage("m1", "answer"), role: "model" as const },
        "Preserve inactive branch",
      ),
      makeMessage("u2", "follow up"),
    ]);
    tree = createModelResponseBranch(tree, "m1", {
      ...withTaskPlan(
        makeMessage("m1b", "alternate answer"),
        "Preserve active branch",
      ),
      role: "model",
    });
    const loadMessages = vi.fn(() => Promise.resolve(tree as any));

    const payload = await createSessionExportPayload({
      session: makeSession("inactive"),
      currentSessionId: "active",
      activeMessages: [],
      loadMessages,
    });

    expect(payload.messages.map((message) => message.id)).toEqual([
      "u1",
      "m1b",
    ]);
    expect((payload as any).messageTree).toEqual(tree);
    const inactivePlan =
      payload.messageTree?.nodesById.m1?.message.outputBlocks?.[0];
    const activePlan =
      payload.messageTree?.nodesById.m1b?.message.outputBlocks?.[0];
    expect(inactivePlan?.type).toBe("task_plan");
    expect(
      inactivePlan?.type === "task_plan"
        ? inactivePlan.steps[0]?.title
        : undefined,
    ).toBe("Preserve inactive branch");
    expect(activePlan?.type).toBe("task_plan");
    expect(
      activePlan?.type === "task_plan" ? activePlan.steps[0]?.title : undefined,
    ).toBe("Preserve active branch");
  });

  it("normalizes task plans in the active in-memory message tree", async () => {
    const activeMessage = withTaskPlan(
      { ...makeMessage("m1", "active answer"), role: "model" },
      "Export active tree",
    );
    const activeMessageTree = normalizeSessionMessageTree([activeMessage]);
    const loadMessages = vi.fn(() => Promise.resolve([]));

    const payload = await createSessionExportPayload({
      session: makeSession("active"),
      currentSessionId: "active",
      activeMessages: [activeMessage],
      activeMessageTree,
      loadMessages,
    });

    expect(payload.messages[0]?.outputBlocks?.[0]).toEqual(
      makeTaskPlanBlock("Export active tree"),
    );
    expect(
      payload.messageTree?.nodesById.m1?.message.outputBlocks?.[0],
    ).toEqual(makeTaskPlanBlock("Export active tree"));
    expect(loadMessages).not.toHaveBeenCalled();
  });

  it("drops invalid task plans while preserving unknown output blocks", async () => {
    const futureBlock = {
      id: "future-1",
      type: "future_output",
      payload: { preserved: true },
    };
    const storedMessage = {
      ...makeMessage("m1", "stored text"),
      outputBlocks: [
        futureBlock,
        {
          id: "invalid-plan",
          type: "task_plan",
          steps: [],
        },
      ],
    } as unknown as Message;

    const payload = await createSessionExportPayload({
      session: makeSession("inactive"),
      currentSessionId: "active",
      activeMessages: [],
      loadMessages: () => Promise.resolve([storedMessage]),
    });

    expect(payload.messages[0]?.outputBlocks).toEqual([futureBlock]);
  });

  it("propagates inactive storage read failures instead of returning an empty export", async () => {
    await expect(
      createSessionExportPayload({
        session: makeSession("inactive"),
        currentSessionId: "active",
        activeMessages: [],
        loadMessages: () => Promise.reject(new Error("storage failed")),
      }),
    ).rejects.toThrow("storage failed");
  });
});
