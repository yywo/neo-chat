/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createBrowserAppExportPayload: vi.fn(),
  listOPFSDirectory: vi.fn(),
}));

vi.mock("@/lib/data/appExport", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/data/appExport")>()),
  createBrowserAppExportPayload: mocks.createBrowserAppExportPayload,
}));
vi.mock("@/utils/opfs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/opfs")>()),
  listOPFSDirectory: mocks.listOPFSDirectory,
}));

import { inspectLocalStorageHealth } from "@/lib/data/storageHealth";

describe("local storage health inspection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: {
        estimate: vi.fn().mockResolvedValue({
          usage: 1024,
          quota: 4096,
        }),
      },
    });
    mocks.createBrowserAppExportPayload.mockResolvedValue({
      data: {
        sessionMessages: {
          session: {
            nodesById: {
              message: {
                message: {
                  attachments: [
                    {
                      fileName: "kept.txt",
                      mimeType: "text/plain",
                      url: "opfs://chat/session/kept.txt",
                    },
                    {
                      fileName: "missing.txt",
                      mimeType: "text/plain",
                      url: "opfs://chat/session/missing.txt",
                    },
                  ],
                },
              },
            },
          },
        },
      },
    });
    mocks.listOPFSDirectory.mockImplementation(async (directory: string) =>
      directory === "chat"
        ? ["chat/session/kept.txt", "chat/session/orphan.txt"]
        : [],
    );
  });

  it("reports quota, missing references, and orphans without deleting files", async () => {
    await expect(inspectLocalStorageHealth()).resolves.toEqual({
      quota: { usage: 1024, quota: 4096 },
      opfs: {
        referencedCount: 2,
        storedCount: 2,
        orphanCount: 1,
        missingCount: 1,
      },
    });
    expect(mocks.listOPFSDirectory).toHaveBeenCalledTimes(4);
    expect(navigator.storage.estimate).toHaveBeenCalledOnce();
  });
});
