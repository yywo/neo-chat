import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readProjectFile(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("image compression wiring", () => {
  it("compresses selected, dropped, and pasted images before Base64 and cache writes", () => {
    const source = readProjectFile("src/components/chat/MessageInput.tsx");
    const pipeline = source.slice(
      source.indexOf("const processSelectedFiles"),
      source.indexOf("const handleFileSelect"),
    );

    expect(pipeline.indexOf("selectChatAttachmentFiles")).toBeLessThan(
      pipeline.indexOf("compressImageFile"),
    );
    expect(pipeline.indexOf("compressImageFile")).toBeLessThan(
      pipeline.indexOf("fileToBase64(preparedFile)"),
    );
    expect(pipeline.indexOf("fileToBase64(preparedFile)")).toBeLessThan(
      pipeline.indexOf("ensureImageDisplayCache"),
    );

    const dropHandler = source.slice(
      source.indexOf("const handleComposerDrop"),
      source.indexOf("const handleComposerPaste"),
    );
    const pasteHandler = source.slice(
      source.indexOf("const handleComposerPaste"),
      source.indexOf("return (", source.indexOf("const handleComposerPaste")),
    );
    expect(dropHandler).toContain("processSelectedFiles(files)");
    expect(pasteHandler).toContain("processSelectedFiles(files)");
  });

  it("compresses workspace images after raw validation and before OPFS writes", () => {
    const source = readProjectFile(
      "src/components/layout/WorkspaceSettingsModal.tsx",
    );
    const pipeline = source.slice(
      source.indexOf("const handleFileUpload"),
      source.indexOf("const handleRemoveFile"),
    );

    expect(pipeline.indexOf("selectWorkspaceFilesForUpload")).toBeLessThan(
      pipeline.indexOf("compressImageFile"),
    );
    expect(pipeline.indexOf("compressImageFile")).toBeLessThan(
      pipeline.indexOf("saveToOPFS"),
    );
    expect(pipeline).toContain("saveToOPFS(\n            preparedFile");
  });

  it("uses the same prepared attachments for message persistence and model processing", () => {
    const source = readProjectFile("src/components/app/ChatApp.tsx");
    const pipeline = source.slice(
      source.indexOf("const processPromptForModel"),
      source.indexOf("const createAgentToolStreamOptions"),
    );

    expect(
      pipeline.indexOf("prepareConversationImageAttachments"),
    ).toBeLessThan(pipeline.indexOf("processMessageForSending"));
    expect(pipeline).toContain("attachments: preparedAttachments");
  });

  it("prepares direct, streamed, and plugin inline images before storing them", () => {
    const source = readProjectFile("src/services/api/chatService.ts");
    const direct = source.slice(
      source.indexOf("export const generateImage"),
      source.indexOf("// Export types"),
    );
    const streamed = source.slice(
      source.indexOf('case "image":'),
      source.indexOf('case "usage":'),
    );
    const pluginStart = source.indexOf("const roundPluginImages");
    const pluginPreparation = source.indexOf(
      "prepareGeneratedImageAttachments",
      pluginStart,
    );
    const pluginResultImages = source.indexOf(
      "resultImages,",
      pluginPreparation,
    );

    expect(direct.indexOf("compressImageAttachments")).toBeLessThan(
      direct.indexOf("stripAttachmentsDisplayCacheForModel"),
    );
    expect(direct.indexOf("prepareGeneratedImageAttachments")).toBeLessThan(
      direct.indexOf("return {\n      images"),
    );
    expect(streamed.indexOf("prepareGeneratedImageAttachments")).toBeLessThan(
      streamed.indexOf("appendImage(image)"),
    );
    expect(pluginPreparation).toBeGreaterThan(pluginStart);
    expect(pluginPreparation).toBeLessThan(pluginResultImages);
  });

  it("keeps browser compression out of server image normalization routes", () => {
    const normalization = readProjectFile("src/lib/utils/generatedImages.ts");
    const route = readProjectFile("src/app/api/chat/generate-image/route.ts");
    const compression = readProjectFile("src/lib/utils/imageCompression.ts");

    expect(normalization).not.toContain("browser-image-compression");
    expect(normalization).not.toContain("imageCompression");
    expect(route).not.toContain("browser-image-compression");
    expect(route).not.toContain("@/lib/utils/imageCompression");
    expect(compression).toContain('"use client"');
    expect(compression).toContain('import("browser-image-compression")');
    expect(compression).toContain("useWebWorker: false");
  });
});
