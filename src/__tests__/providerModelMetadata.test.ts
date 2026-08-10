import { describe, expect, it } from "vitest";
import { resolveEffectiveChatRequestConfig } from "@/lib/chat/effectiveChatConfig";
import {
  getProviderModelMetadataKey,
  resolveProviderModelMetadata,
} from "@/lib/utils/model";
import type { ModelMetadata } from "@/types";

const fetchedMetadata: Record<string, ModelMetadata> = {
  shared: {
    id: "shared",
    name: "Fetched Shared",
    tool_call: false,
  },
};

describe("provider-scoped model metadata", () => {
  it("prefers provider-qualified custom metadata and retains legacy fallback", () => {
    const customModelMetadata: Record<string, ModelMetadata> = {
      shared: {
        id: "shared",
        name: "Legacy Shared",
        reasoning: true,
      },
      [getProviderModelMetadataKey("provider-a", "shared")]: {
        id: "shared",
        name: "Provider A Shared",
        tool_call: true,
      },
      [getProviderModelMetadataKey("provider-b", "shared")]: {
        id: "shared",
        name: "Provider B Shared",
        tool_call: false,
      },
    };

    expect(
      resolveProviderModelMetadata({
        providerId: "provider-a",
        modelName: "shared",
        modelMetadata: fetchedMetadata,
        customModelMetadata,
      })?.name,
    ).toBe("Provider A Shared");
    expect(
      resolveProviderModelMetadata({
        providerId: "provider-b",
        modelName: "shared",
        modelMetadata: fetchedMetadata,
        customModelMetadata,
      })?.name,
    ).toBe("Provider B Shared");
    expect(
      resolveProviderModelMetadata({
        providerId: "provider-c",
        modelName: "shared",
        modelMetadata: fetchedMetadata,
        customModelMetadata,
      })?.name,
    ).toBe("Legacy Shared");
  });

  it("derives request capabilities independently for same-name models", () => {
    const customModelMetadata: Record<string, ModelMetadata> = {
      "provider-a:shared": {
        id: "shared",
        name: "Provider A Shared",
        tool_call: true,
      },
      "provider-b:shared": {
        id: "shared",
        name: "Provider B Shared",
        tool_call: false,
      },
    };
    const chatConfig = {
      useSearch: false,
      useReasoning: false,
      useAgentMode: true,
      reasoningMode: "off" as const,
      temperature: 0.7,
    };

    const providerA = resolveEffectiveChatRequestConfig({
      chatConfig,
      selectedModel: "provider-a:shared",
      modelMetadata: fetchedMetadata,
      customModelMetadata,
    });
    const providerB = resolveEffectiveChatRequestConfig({
      chatConfig,
      selectedModel: "provider-b:shared",
      modelMetadata: fetchedMetadata,
      customModelMetadata,
    });

    expect(providerA.useAgentMode).toBe(true);
    expect(providerB.useAgentMode).toBe(false);
  });
});
