import { describe, expect, it } from "vitest";
import {
  applyLocalPayload,
  collectSyncConflicts,
  createSyncDocument,
  loadSyncDocument,
  mergeSyncDocuments,
  readSyncDocumentPayload,
  saveSyncDocument,
  toSyncJson,
} from "@/lib/sync/crdt";
import {
  buildRootSyncIndex,
  resolveStoredSyncConflict,
  ROOT_DOCUMENT_ID,
} from "@/lib/sync/engine";
import { assembleSyncDocuments } from "@/lib/sync/snapshot";
import {
  SYNC_FORMAT_VERSION,
  type SyncDevice,
  type SyncDocumentDescriptor,
  type SyncDocumentIndex,
  type SyncJsonValue,
} from "@/lib/sync/types";

const ACTOR_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACTOR_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ACTOR_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const NOW = "2026-07-22T00:00:00.000Z";
const DEVICE: SyncDevice = {
  id: ACTOR_B,
  name: "Fresh device",
  firstSeenAt: NOW,
  lastSeenAt: NOW,
};

function descriptor(
  id: string,
  kind: SyncDocumentDescriptor["kind"],
): SyncDocumentDescriptor {
  return { id, kind, updatedAt: NOW };
}

describe("encrypted sync engine decisions", () => {
  it("materializes an existing vault on a fresh device without inferring remote tombstones", () => {
    const remoteDescriptors = {
      "chat-meta": descriptor("chat-meta", "chat-meta"),
      "workspace:work-a": descriptor("workspace:work-a", "workspace"),
      "session:session-a": descriptor("session:session-a", "session"),
      "session-messages:session-a": descriptor(
        "session-messages:session-a",
        "session-messages",
      ),
      "knowledge-meta": descriptor("knowledge-meta", "knowledge-meta"),
      "knowledge-collection:collection-a": descriptor(
        "knowledge-collection:collection-a",
        "knowledge-collection",
      ),
      "opfs-manifest": descriptor("opfs-manifest", "opfs-manifest"),
    };
    const remoteRoot: SyncDocumentIndex = {
      formatVersion: SYNC_FORMAT_VERSION,
      vaultId: "vault-a",
      documents: remoteDescriptors,
      devices: { [ACTOR_A]: { ...DEVICE, id: ACTOR_A, name: "Source" } },
    };
    const freshDefaults = [
      { id: "core-settings", kind: "core-settings" as const, payload: {} },
      { id: "settings", kind: "settings" as const, payload: {} },
      { id: "chat-meta", kind: "chat-meta" as const, payload: {} },
      {
        id: "knowledge-meta",
        kind: "knowledge-meta" as const,
        payload: {},
      },
      { id: "memory", kind: "memory" as const, payload: {} },
      {
        id: "opfs-manifest",
        kind: "opfs-manifest" as const,
        payload: {},
      },
    ];

    const freshIndex = buildRootSyncIndex(
      toSyncJson(remoteRoot),
      freshDefaults,
      "vault-a",
      DEVICE,
      NOW,
      { inferTombstones: false },
    );
    for (const id of Object.keys(remoteDescriptors)) {
      expect(freshIndex.documents[id]?.deleted).not.toBe(true);
    }

    const payloads = new Map<string, SyncJsonValue>([
      [
        "chat-meta",
        {
          envelope: {
            state: { currentSessionId: "session-a" },
            version: 6,
          },
          workspaceOrder: ["work-a"],
          sessionOrder: ["session-a"],
        },
      ],
      ["workspace:work-a", { id: "work-a", name: "Remote workspace" }],
      [
        "session:session-a",
        { id: "session-a", title: "Remote session", workspaceId: "work-a" },
      ],
      [
        "session-messages:session-a",
        {
          rootMessageIds: ["message-a"],
          nodesById: {
            "message-a": {
              id: "message-a",
              message: {
                id: "message-a",
                role: "user",
                content: "Remote message",
                attachments: [
                  {
                    fileName: "remote.txt",
                    mimeType: "text/plain",
                    url: "opfs://chat/session-a/remote.txt",
                  },
                ],
              },
              childMessageIds: [],
            },
          },
          activeChildByParentId: {},
        },
      ],
      [
        "knowledge-meta",
        {
          envelope: { state: {}, version: 6 },
          collectionOrder: ["collection-a"],
        },
      ],
      [
        "knowledge-collection:collection-a",
        {
          id: "collection-a",
          name: "Remote collection",
          files: [
            {
              id: "file-a",
              name: "remote.md",
              path: "opfs://knowledge-base/collection-a/remote.md",
            },
          ],
        },
      ],
      [
        "opfs-manifest",
        {
          entries: {
            "opfs://chat/session-a/remote.txt": {
              url: "opfs://chat/session-a/remote.txt",
              mimeType: "text/plain",
              size: 6,
              sha256: "hash",
              chunks: [],
            },
          },
        },
      ],
    ]);
    const materialized = new Map(
      Object.values(freshIndex.documents)
        .filter((entry) => payloads.has(entry.id))
        .map((entry) => [
          entry.id,
          { descriptor: entry, payload: payloads.get(entry.id)! },
        ]),
    );
    const data = assembleSyncDocuments(materialized);
    const chatState = (data.chat as { state: Record<string, unknown> }).state;
    const knowledgeState = (
      data.knowledge as { state: Record<string, unknown> }
    ).state;

    expect(chatState.sessions).toEqual([
      expect.objectContaining({ id: "session-a" }),
    ]);
    expect(chatState.workspaces).toEqual([
      expect.objectContaining({ id: "work-a" }),
    ]);
    expect(data.sessionMessages["session-a"]).toEqual(
      expect.objectContaining({ rootMessageIds: ["message-a"] }),
    );
    expect(knowledgeState.collections).toEqual([
      expect.objectContaining({
        id: "collection-a",
        files: [expect.objectContaining({ id: "file-a" })],
      }),
    ]);

    const establishedIndex = buildRootSyncIndex(
      toSyncJson(remoteRoot),
      freshDefaults,
      "vault-a",
      DEVICE,
      NOW,
      { inferTombstones: true },
    );
    expect(establishedIndex.documents["session:session-a"].deleted).toBe(true);
  });

  it("materializes a non-current conflict choice and keeps it on the next local capture", async () => {
    const original = await createSyncDocument(
      "settings",
      "settings",
      { state: { theme: "system" }, version: 6 },
      ACTOR_A,
    );
    const originalBytes = await saveSyncDocument(original);
    const light = await applyLocalPayload(
      await loadSyncDocument(originalBytes, ACTOR_B),
      { state: { theme: "light" }, version: 6 },
    );
    const dark = await applyLocalPayload(
      await loadSyncDocument(originalBytes, ACTOR_C),
      { state: { theme: "dark" }, version: 6 },
    );
    const conflicted = await mergeSyncDocuments(light, dark);
    const [conflict] = await collectSyncConflicts(conflicted);
    const chosen = conflict.values.find(
      (candidate) =>
        JSON.stringify(candidate) !== JSON.stringify(conflict.currentValue),
    );
    expect(chosen).toBeDefined();

    const rootIndex = buildRootSyncIndex(
      undefined,
      [
        {
          id: "settings",
          kind: "settings",
          payload: readSyncDocumentPayload(conflicted),
        },
      ],
      "vault-a",
      DEVICE,
      NOW,
      { inferTombstones: false },
    );
    const root = await createSyncDocument(
      ROOT_DOCUMENT_ID,
      "root",
      rootIndex,
      ACTOR_B,
    );
    const documents = new Map<string, Uint8Array>([
      [ROOT_DOCUMENT_ID, await saveSyncDocument(root)],
      ["settings", await saveSyncDocument(conflicted)],
    ]);
    let materializedSettings: SyncJsonValue | undefined;
    let refreshCount = 0;

    await resolveStoredSyncConflict(conflict, chosen!, {
      deviceId: ACTOR_B,
      readDocument: async (id) => documents.get(id) || null,
      writeDocument: async (id, bytes) => {
        documents.set(id, bytes);
      },
      applySyncedData: async (data) => {
        materializedSettings = data.settings as SyncJsonValue;
        return true;
      },
      refreshAppState: async () => {
        refreshCount += 1;
      },
    });

    expect(
      (materializedSettings as { state: { theme: string } }).state.theme,
    ).toBe(chosen);
    expect(refreshCount).toBe(1);

    const resolvedBaseline = await loadSyncDocument(
      documents.get("settings")!,
      ACTOR_B,
    );
    expect(await collectSyncConflicts(resolvedBaseline)).toHaveLength(0);
    const nextCapture = await applyLocalPayload(
      resolvedBaseline,
      materializedSettings,
    );
    expect(await collectSyncConflicts(nextCapture)).toHaveLength(0);
    expect(
      (
        readSyncDocumentPayload(nextCapture) as {
          state: { theme: string };
        }
      ).state.theme,
    ).toBe(chosen);
  });
});
