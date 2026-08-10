import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("first-run model CTA", () => {
  it("keeps sending disabled and links an empty model state to Providers", () => {
    const shell = readFileSync(
      resolve(process.cwd(), "src/components/app/ChatAppShell.tsx"),
      "utf8",
    );

    expect(shell).toContain(
      "isModelBootstrapReady && availableModels.length === 0",
    );
    expect(shell).toContain('t("noModelsTitle")');
    expect(shell).toContain('t("noModelsDescription")');
    expect(shell).toContain('navigateToPanel("settings", "providers")');
    expect(shell).toContain('t("configureProviders")');
  });

  it("localizes the empty model guidance in English, Chinese, and Japanese", () => {
    for (const locale of ["en", "zh", "ja"]) {
      const messages = JSON.parse(
        readFileSync(
          resolve(process.cwd(), `src/i18n/locales/${locale}/ChatApp.json`),
          "utf8",
        ),
      ) as Record<string, string>;

      expect(messages.noModelsTitle).toBeTruthy();
      expect(messages.noModelsDescription).toBeTruthy();
      expect(messages.configureProviders).toBeTruthy();
    }
  });

  it("renders search as a modal while retaining the chat surface", () => {
    const shell = readFileSync(
      resolve(process.cwd(), "src/components/app/ChatAppShell.tsx"),
      "utf8",
    );

    expect(shell).not.toContain('viewMode === "search" ? (');
    expect(shell).toContain('inert={viewMode === "search" ? true : undefined}');
    expect(shell).toContain('viewMode === "search" && (');
    expect(shell).toContain("<GlobalSearchCenter");
  });
});
