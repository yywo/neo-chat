import { describe, expect, it } from "vitest";
import type { AppExportPayload } from "@/lib/data/appExport";
import { scrubAppExportValue } from "@/lib/data/appExport";
import {
  assembleSyncDocuments,
  overlayLocalOnlySyncFields,
  resetKnowledgeVectorState,
  restoreCompatibleLocalKnowledgeVectorState,
  splitAppExportIntoSyncDocuments,
} from "@/lib/sync/snapshot";
import type { SyncDocumentDescriptor } from "@/lib/sync/types";

describe("sync snapshot partitioning", () => {
  it("splits workspaces, sessions, messages and knowledge collections then reassembles them", () => {
    const data: AppExportPayload["data"] = {
      coreSettings: { state: { theme: "light" }, version: 6 },
      settings: { state: { system: { language: "en" } }, version: 6 },
      chat: {
        state: {
          currentSessionId: "session-1",
          sessions: [{ id: "session-1", title: "One" }],
          workspaces: [{ id: "workspace-1", name: "Work" }],
        },
        version: 6,
      },
      sessionMessages: {
        "session-1": {
          rootMessageIds: [],
          nodesById: {},
          activeChildByParentId: {},
        },
      },
      knowledge: {
        state: {
          collections: [{ id: "collection-1", name: "Docs", files: [] }],
        },
        version: 6,
      },
      memory: { state: { memories: [] }, version: 6 },
    };
    const exported: AppExportPayload = {
      exportVersion: 3,
      storageVersion: 6,
      exportedAt: "2026-07-22T00:00:00.000Z",
      metadata: {
        opfs: { mode: "bundled", includesBlobs: true },
        security: { credentialsIncluded: false, excluded: [] },
      },
      data,
    };
    const documents = splitAppExportIntoSyncDocuments(exported);
    const materialized = new Map(
      documents.map((document) => [
        document.id,
        {
          descriptor: {
            id: document.id,
            kind: document.kind,
            updatedAt: exported.exportedAt,
          } satisfies SyncDocumentDescriptor,
          payload: document.payload,
        },
      ]),
    );

    expect(documents.map((document) => document.id)).toEqual(
      expect.arrayContaining([
        "workspace:workspace-1",
        "session:session-1",
        "session-messages:session-1",
        "knowledge-collection:collection-1",
      ]),
    );
    expect(assembleSyncDocuments(materialized)).toEqual(data);
  });

  it("keeps this device's credentials and caches when applying scrubbed sync data", () => {
    const apiKeySecret = {
      version: 1,
      keyId: "local-key",
      iv: "local-iv",
      ciphertext: "local-provider-secret",
      context: "local:provider:test",
    };
    const localRaw = {
      coreSettings: {
        state: {
          providers: [{ id: "provider-1", name: "Old name", apiKeySecret }],
        },
      },
      settings: {
        state: {
          pluginConfigs: {
            "plugin-1": {
              auth: { localValueSecret: apiKeySecret },
              disabledFunctions: ["old-tool"],
            },
          },
          marketPlugins: [{ id: "cached-plugin" }],
        },
      },
      sessionMessages: {
        "session-1": {
          nodesById: {
            "message-1": {
              id: "message-1",
              attachments: [
                {
                  fileName: "image.png",
                  mimeType: "image/png",
                  url: "opfs://images/image.png",
                  displayCache: { url: "opfs://images/cache.png" },
                },
              ],
            },
          },
        },
      },
    };
    const localScrubbed = scrubAppExportValue(localRaw);
    const synchronized = structuredClone(localScrubbed) as typeof localRaw;
    synchronized.coreSettings.state.providers[0].name = "Synced name";
    synchronized.settings.state.pluginConfigs["plugin-1"].disabledFunctions = [
      "new-tool",
    ];

    const restored = overlayLocalOnlySyncFields(
      localRaw,
      localScrubbed,
      synchronized,
    ) as typeof localRaw;

    expect(JSON.stringify(localScrubbed)).not.toContain(
      "local-provider-secret",
    );
    expect(restored.coreSettings.state.providers[0]).toMatchObject({
      name: "Synced name",
      apiKeySecret,
    });
    expect(restored.settings.state.pluginConfigs["plugin-1"]).toMatchObject({
      disabledFunctions: ["new-tool"],
      auth: { localValueSecret: apiKeySecret },
    });
    expect(
      restored.sessionMessages["session-1"].nodesById["message-1"]
        .attachments[0].displayCache,
    ).toEqual({ url: "opfs://images/cache.png" });
  });

  it("keeps external vector identifiers out of sync documents", () => {
    const exported: AppExportPayload = {
      exportVersion: 3,
      storageVersion: 6,
      exportedAt: "2026-07-22T00:00:00.000Z",
      metadata: {
        opfs: { mode: "bundled", includesBlobs: true },
        security: { credentialsIncluded: false, excluded: [] },
      },
      data: {
        sessionMessages: {},
        knowledge: {
          state: {
            collections: [
              {
                id: "collection-1",
                name: "Docs",
                chunkingRevision: "chunking-a",
                files: [
                  {
                    id: "file-1",
                    name: "guide.md",
                    contentPath: "opfs://knowledge-base/guide.md",
                    storageStatus: "saved",
                    indexStatus: "indexed",
                    status: "indexed",
                    ragId: "external-vector-id",
                    ragChunkCount: 12,
                    indexedChunkingRevision: "chunking-a",
                    indexError: "stale error",
                  },
                ],
              },
            ],
          },
        },
      },
    };

    const documents = splitAppExportIntoSyncDocuments(exported);
    const serialized = JSON.stringify(documents);
    const collection = documents.find(
      (document) => document.id === "knowledge-collection:collection-1",
    )?.payload as {
      files: Array<Record<string, unknown>>;
    };

    expect(serialized).not.toContain("external-vector-id");
    expect(serialized).not.toContain("ragChunkCount");
    expect(serialized).not.toContain("indexedChunkingRevision");
    expect(serialized).not.toContain("indexError");
    expect(collection.files[0]).toMatchObject({
      indexStatus: "not_indexed",
      status: "saved",
    });
  });

  it("preserves only a compatible local index when materializing sync data", () => {
    const localKnowledge = {
      state: {
        collections: [
          {
            id: "collection-1",
            chunkingRevision: "chunking-a",
            files: [
              {
                id: "file-1",
                name: "guide.md",
                contentPath: "opfs://knowledge-base/guide.md",
                storageStatus: "saved",
                indexStatus: "indexed",
                status: "indexed",
                ragId: "local-vector-id",
                ragChunkCount: 8,
                indexedChunkingRevision: "chunking-a",
              },
            ],
          },
        ],
      },
    };
    const synchronized = resetKnowledgeVectorState(localKnowledge);

    const unchanged = restoreCompatibleLocalKnowledgeVectorState(
      localKnowledge,
      synchronized,
      new Set(),
    ) as typeof localKnowledge;
    expect(unchanged.state.collections[0].files[0]).toMatchObject({
      ragId: "local-vector-id",
      ragChunkCount: 8,
      indexStatus: "indexed",
      status: "indexed",
    });

    const downloaded = restoreCompatibleLocalKnowledgeVectorState(
      localKnowledge,
      synchronized,
      new Set(["opfs://knowledge-base/guide.md"]),
    ) as typeof localKnowledge;
    expect(downloaded.state.collections[0].files[0]).toMatchObject({
      indexStatus: "not_indexed",
      status: "saved",
    });
    expect(downloaded.state.collections[0].files[0]).not.toHaveProperty(
      "ragId",
    );

    const changedChunking = structuredClone(
      synchronized,
    ) as typeof localKnowledge;
    changedChunking.state.collections[0].chunkingRevision = "chunking-b";
    const reindexRequired = restoreCompatibleLocalKnowledgeVectorState(
      localKnowledge,
      changedChunking,
      new Set(),
    ) as typeof localKnowledge;
    expect(reindexRequired.state.collections[0].files[0]).toMatchObject({
      indexStatus: "not_indexed",
      status: "saved",
    });
    expect(reindexRequired.state.collections[0].files[0]).not.toHaveProperty(
      "ragId",
    );
  });
});
