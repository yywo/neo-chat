import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("message mutation guards", () => {
  it("disables message-tree mutation controls during local generation", () => {
    const shell = readFileSync(
      resolve(process.cwd(), "src/components/app/ChatAppShell.tsx"),
      "utf8",
    );
    const messageItem = readFileSync(
      resolve(process.cwd(), "src/components/chat/MessageItem.tsx"),
      "utf8",
    );

    expect(shell).toMatch(
      /mutationsDisabled=\{\s*isGenerating \|\|\s*isActiveSessionLoading/,
    );
    expect(messageItem).toContain(
      "mutationActionsDisabled || currentBranchIndex === 0",
    );
    expect(messageItem).toContain(
      "mutationActionsDisabled ||\n                          currentBranchIndex === branchCount - 1",
    );
  });

  it("guards edit, delete, retract, and branch switching handlers", () => {
    const chatApp = readFileSync(
      resolve(process.cwd(), "src/components/app/ChatApp.tsx"),
      "utf8",
    );

    for (const handlerName of [
      "handleVersionChange",
      "handleEditMessage",
      "handleDeleteMessage",
      "handleRetractMessage",
    ]) {
      const start = chatApp.indexOf(`const ${handlerName}`);
      const end = chatApp.indexOf("\n  const ", start + 1);
      const handler = chatApp.slice(start, end);

      expect(start).toBeGreaterThan(-1);
      expect(handler).toContain("isGenerating");
      expect(handler).toContain("isActiveSessionLoading");
    }
  });
});
