import { getTaskModel, useSettingsStore } from "@/store/core/settingsStore";
import type { ModelMetadata } from "@/types";
import {
  parseModelString,
  resolveProviderModelMetadata,
  supportsTextOutput,
} from "@/lib/utils/model";

export function resolveModelMetadata(
  modelName: string,
  providerId?: string,
): ModelMetadata | undefined {
  const { modelMetadata, customModelMetadata } = useSettingsStore.getState();
  return resolveProviderModelMetadata({
    providerId,
    modelName,
    modelMetadata,
    customModelMetadata,
  });
}

function resolveModelStringMetadata(model: string): ModelMetadata | undefined {
  const { providerId, modelName } = parseModelString(model);
  return resolveModelMetadata(modelName, providerId);
}

export function resolveTextGenerationModel({
  selectedModel,
  selectedModelMetadata,
  providers,
}: {
  selectedModel: string;
  selectedModelMetadata?: ModelMetadata;
  providers: Array<{
    id: string;
    enabled?: boolean;
    models?: string[];
  }>;
}): string | undefined {
  if (supportsTextOutput(selectedModelMetadata)) return selectedModel;

  const taskModel = getTaskModel("promptOptimization").trim();
  if (taskModel && supportsTextOutput(resolveModelStringMetadata(taskModel))) {
    return taskModel;
  }

  const fallback = providers
    .filter((provider) => provider.enabled)
    .flatMap((provider) =>
      (provider.models || []).map((modelName) => ({
        id: `${provider.id}:${modelName}`,
        metadata: resolveModelMetadata(modelName, provider.id),
      })),
    )
    .find((candidate) => supportsTextOutput(candidate.metadata));

  return fallback?.id;
}
