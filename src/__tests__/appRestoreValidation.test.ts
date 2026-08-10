import { describe, expect, it, vi } from "vitest";
import {
  STORAGE_KEYS,
  validateRestoredAppData,
} from "../store/storage/storageConfig";
import type {
  AppRestoreDb,
  AppRestoreSnapshot,
} from "../lib/data/appRestoreJournal";

function createSnapshot(): AppRestoreSnapshot {
  return {
    version: 1,
    transactionId: "restore-validation",
    managedDbKeys: [
      STORAGE_KEYS.SETTINGS,
      STORAGE_KEYS.CHAT,
      STORAGE_KEYS.KNOWLEDGE,
      STORAGE_KEYS.MEMORY,
      "session_messages_session-1",
    ],
    dbEntries: [],
    localStorageEntries: [],
    stagedOpfsUrls: [],
    previousOpfsUrls: [],
  };
}

function createDb(initial: Record<string, unknown>) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: vi.fn(async (key: string) => values.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: unknown) => {
      values.set(key, value);
      return value;
    }),
    removeItem: vi.fn(async (key: string) => {
      values.delete(key);
    }),
    keys: vi.fn(async () => [...values.keys()]),
  } satisfies AppRestoreDb & { keys(): Promise<string[]> };
}

function validChatState(currentSessionId: string | null = "session-1") {
  return JSON.stringify({
    state: {
      sessions: [
        {
          id: "session-1",
          title: "Restored chat",
          messageCount: 1,
          model: "provider:model",
          updatedAt: 1,
        },
      ],
      currentSessionId,
      workspaces: [],
    },
    version: 5,
  });
}

function validMessageTree() {
  return {
    nodesById: {
      message1: {
        id: "message1",
        message: {
          id: "message1",
          role: "user",
          content: "hello",
          timestamp: 1,
        },
        childMessageIds: [],
      },
    },
    rootMessageIds: ["message1"],
    activeRootMessageId: "message1",
  };
}

describe("restored application startup validation", () => {
  it("accepts a consistent chat state and message tree", async () => {
    const db = createDb({
      [STORAGE_KEYS.CHAT]: validChatState(),
      "session_messages_session-1": validMessageTree(),
    });

    await expect(
      validateRestoredAppData(createSnapshot(), db),
    ).resolves.toBeUndefined();
  });

  it("rejects a current session reference that no longer exists", async () => {
    const db = createDb({
      [STORAGE_KEYS.CHAT]: validChatState("missing-session"),
      "session_messages_session-1": validMessageTree(),
    });

    await expect(validateRestoredAppData(createSnapshot(), db)).rejects.toThrow(
      "points to a session that does not exist",
    );
  });

  it("rejects a malformed message tree even when it is not current", async () => {
    const db = createDb({
      [STORAGE_KEYS.CHAT]: validChatState(),
      "session_messages_session-1": validMessageTree(),
      session_messages_orphan: {
        nodesById: { broken: null },
        rootMessageIds: ["broken"],
      },
    });

    await expect(validateRestoredAppData(createSnapshot(), db)).rejects.toThrow(
      "session_messages_orphan is inconsistent",
    );
  });

  it("rejects message data without a matching chat session", async () => {
    const db = createDb({
      [STORAGE_KEYS.CHAT]: validChatState(),
      "session_messages_session-1": validMessageTree(),
      session_messages_orphan: validMessageTree(),
    });

    await expect(validateRestoredAppData(createSnapshot(), db)).rejects.toThrow(
      "session_messages_orphan has no matching chat session",
    );
  });

  it("rejects a non-empty chat session without persisted message data", async () => {
    const db = createDb({
      [STORAGE_KEYS.CHAT]: validChatState(),
    });

    await expect(validateRestoredAppData(createSnapshot(), db)).rejects.toThrow(
      "session session-1 has no matching message data",
    );
  });

  it("rejects a session message count that differs from its active path", async () => {
    const db = createDb({
      [STORAGE_KEYS.CHAT]: validChatState(),
      "session_messages_session-1": {
        nodesById: {},
        rootMessageIds: [],
      },
    });

    await expect(validateRestoredAppData(createSnapshot(), db)).rejects.toThrow(
      "does not match the session message count",
    );
  });

  it.each([
    [
      "missing root",
      {
        ...validMessageTree(),
        rootMessageIds: ["missing"],
      },
    ],
    [
      "broken parent reference",
      {
        nodesById: {
          message1: {
            ...validMessageTree().nodesById.message1,
            parentMessageId: "missing",
          },
        },
        rootMessageIds: [],
      },
    ],
    [
      "broken child reference",
      {
        nodesById: {
          message1: {
            ...validMessageTree().nodesById.message1,
            childMessageIds: ["missing"],
          },
        },
        rootMessageIds: ["message1"],
        activeRootMessageId: "message1",
      },
    ],
    [
      "invalid active root",
      {
        ...validMessageTree(),
        activeRootMessageId: "missing",
      },
    ],
    [
      "invalid active child",
      {
        nodesById: {
          message1: {
            ...validMessageTree().nodesById.message1,
            activeChildMessageId: "missing",
          },
        },
        rootMessageIds: ["message1"],
        activeRootMessageId: "message1",
      },
    ],
  ])("rejects a message tree with a %s", async (_label, tree) => {
    const db = createDb({
      [STORAGE_KEYS.CHAT]: validChatState(),
      "session_messages_session-1": tree,
    });

    await expect(validateRestoredAppData(createSnapshot(), db)).rejects.toThrow(
      "session_messages_session-1 is inconsistent",
    );
  });

  it("rejects unsupported keys in the rollback snapshot", async () => {
    const snapshot = createSnapshot();
    snapshot.managedDbKeys.push("unmanaged-secret-store");
    const db = createDb({
      [STORAGE_KEYS.CHAT]: validChatState(),
      "session_messages_session-1": validMessageTree(),
    });

    await expect(validateRestoredAppData(snapshot, db)).rejects.toThrow(
      "unsupported storage key",
    );
  });
});
