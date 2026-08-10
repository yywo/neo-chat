import { describe, expect, it } from "vitest";
import {
  filterSettingsSearchEntries,
  type SettingsSearchEntry,
} from "../components/settings/SettingsPage";

const entries: SettingsSearchEntry[] = [
  {
    id: "providers",
    label: "模型供应商",
    description: "配置模型和密钥",
    keywords: "API 工具 推理",
  },
  {
    id: "sync",
    label: "加密同步",
    description: "配置 WebDAV 或 S3",
    keywords: "恢复码 设备 冲突",
  },
];

describe("settings search", () => {
  it("matches localized labels, descriptions, and field keywords", () => {
    expect(filterSettingsSearchEntries(entries, "供应商")).toEqual([
      entries[0],
    ]);
    expect(filterSettingsSearchEntries(entries, "WebDAV")).toEqual([
      entries[1],
    ]);
    expect(filterSettingsSearchEntries(entries, "恢复码")).toEqual([
      entries[1],
    ]);
  });

  it("normalizes full-width text and returns no results for blank input", () => {
    expect(filterSettingsSearchEntries(entries, "ＡＰＩ")).toEqual([
      entries[0],
    ]);
    expect(filterSettingsSearchEntries(entries, "   ")).toEqual([]);
  });
});
