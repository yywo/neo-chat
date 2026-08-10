import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("PluginMarket MCP composition", () => {
  it("places Plugins and MCP as full-page source tabs above search", () => {
    const pluginMarket = readFileSync(
      resolve(process.cwd(), "src/components/plugin/PluginMarket.tsx"),
      "utf8",
    );

    expect(pluginMarket).toContain('MarketSource = "plugins" | "mcp"');
    expect(pluginMarket).toContain("fetchMcpServerPage");
    expect(pluginMarket).toContain("sourceTabs");
    expect(pluginMarket).toContain("mcpPageCursors");
    expect(pluginMarket).toContain("mcpNextCursor");
    expect(pluginMarket).toContain('t("pageCurrent", { currentPage })');
    expect(pluginMarket).toContain('t("pageOf", { currentPage, totalPages })');
    expect(pluginMarket).toContain("showCustomMcpServerModal");
    expect(pluginMarket).toContain("CustomMcpServerModal");
    expect(pluginMarket).toContain("McpInstallAuthModal");
    expect(pluginMarket).toContain("installCustomMcpServer");
    expect(pluginMarket).toContain(
      'plugin.source === "mcp" && isPluginAuthRequired(plugin)',
    );
    expect(pluginMarket).toContain("installPlugin(plugin, authValue)");
    expect(pluginMarket).toContain("discoverMcpBridgeServers");
    expect(pluginMarket).toContain(
      'serverConfig?.deployment?.mode === "local"',
    );
    expect(pluginMarket).toContain('source: "bridge"');
    expect(pluginMarket).toContain('window.addEventListener("offline"');
    expect(pluginMarket).toContain('t("mcpOfflineUnavailable")');
    expect(pluginMarket).toContain("!isOnline || isLoading");
    expect(pluginMarket).not.toContain("bridgeCommand");
    expect(pluginMarket).not.toContain("bridgeArgs");
    expect(pluginMarket).not.toContain("bridgeEnvironment");
    expect(pluginMarket).toContain('activeSource === "mcp"');
    expect(pluginMarket).toContain('plugin.source === "mcp"');
    expect(pluginMarket).toContain('plugin.source !== "mcp"');
    expect(pluginMarket).toContain('t("mcp")');
    expect(pluginMarket).toContain('t("plugins")');
    expect(pluginMarket).not.toContain(
      "shadow-[0_10px_30px_rgba(15,23,42,0.08)]",
    );
    expect(pluginMarket).not.toContain(
      "shadow-[0_8px_18px_rgba(37,99,235,0.24)]",
    );
    const sourceTabsIndex = pluginMarket.indexOf(
      'aria-label={t("sourceTabsAria")}',
    );
    const searchIndex = pluginMarket.indexOf('name="plugin-search"');
    const installedSectionIndex = pluginMarket.indexOf("{/* Installed Section");
    const availableSectionIndex = pluginMarket.indexOf("{/* Available Section");
    expect(sourceTabsIndex).toBeGreaterThan(-1);
    expect(searchIndex).toBeGreaterThan(-1);
    expect(installedSectionIndex).toBeGreaterThan(-1);
    expect(availableSectionIndex).toBeGreaterThan(-1);
    expect(sourceTabsIndex).toBeLessThan(searchIndex);
    expect(sourceTabsIndex).toBeLessThan(installedSectionIndex);
    expect(sourceTabsIndex).toBeLessThan(availableSectionIndex);
  });
});
