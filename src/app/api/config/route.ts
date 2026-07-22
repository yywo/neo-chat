import { createApiSuccessResponse } from "@/lib/api/responses";
import {
  fetchServerDefaultProviderModels,
  getPublicServerConfig,
} from "@/lib/defaultConfig/server";
import { isOpenAIProviderType } from "@/lib/providers/providerTypes";

export async function GET() {
  const config = getPublicServerConfig();

  if (
    config.modelProvider.available &&
    isOpenAIProviderType(config.modelProvider.type)
  ) {
    const models = await fetchServerDefaultProviderModels();
    if (models.length > 0) {
      return createApiSuccessResponse({
        ...config,
        modelProvider: {
          ...config.modelProvider,
          models,
        },
      });
    }
  }

  return createApiSuccessResponse(config);
}
