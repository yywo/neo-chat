import { describe, expect, it, vi } from "vitest";
import type { KnowledgeFile } from "../types";
import {
  filterKnowledgeFiles,
  getKnowledgeFileStatusFilter,
  runKnowledgeFileBatch,
} from "../lib/knowledge/fileProductivity";

function makeFile(
  id: string,
  name: string,
  updates: Partial<KnowledgeFile> = {},
): KnowledgeFile {
  return {
    id,
    name,
    size: 12,
    type: "text/plain",
    uploadedAt: 1,
    status: "saved",
    ...updates,
  };
}

describe("knowledge file productivity helpers", () => {
  it("filters file names case-insensitively within a status bucket", () => {
    const files = [
      makeFile("ready", "Project Notes.md", {
        indexStatus: "indexed",
      }),
      makeFile("processing", "Project Brief.pdf", {
        storageStatus: "parsing",
        status: "parsing",
      }),
      makeFile("error", "PROJECT Errors.txt", {
        indexStatus: "error",
        status: "error",
      }),
      makeFile("other", "Meeting.txt"),
    ];

    expect(filterKnowledgeFiles(files, " project ", "processing")).toEqual([
      files[1],
    ]);
    expect(filterKnowledgeFiles(files, "PROJECT", "error")).toEqual([files[2]]);
    expect(filterKnowledgeFiles(files, "project", "all")).toEqual(
      files.slice(0, 3),
    );
  });

  it("prioritizes errors over processing when deriving filter status", () => {
    const file = makeFile("mixed", "mixed.txt", {
      storageStatus: "parsing",
      indexStatus: "error",
      status: "error",
    });

    expect(getKnowledgeFileStatusFilter(file)).toBe("error");
  });

  it("runs batch operations serially and reports each partial failure", async () => {
    const files = [
      makeFile("one", "one.txt"),
      makeFile("two", "two.txt"),
      makeFile("three", "three.txt"),
    ];
    const order: string[] = [];
    const progress = vi.fn();

    const results = await runKnowledgeFileBatch(
      files,
      async (file) => {
        order.push(`start:${file.id}`);
        await Promise.resolve();
        if (file.id === "two") throw new Error("retry failed");
        order.push(`end:${file.id}`);
      },
      progress,
    );

    expect(order).toEqual([
      "start:one",
      "end:one",
      "start:two",
      "start:three",
      "end:three",
    ]);
    expect(results).toEqual([
      {
        fileId: "one",
        fileName: "one.txt",
        status: "succeeded",
      },
      {
        fileId: "two",
        fileName: "two.txt",
        status: "failed",
        error: "retry failed",
      },
      {
        fileId: "three",
        fileName: "three.txt",
        status: "succeeded",
      },
    ]);
    expect(progress).toHaveBeenCalledTimes(3);
    expect(progress.mock.calls[1]?.[0]).toHaveLength(2);
  });
});
