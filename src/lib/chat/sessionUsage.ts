import type { Message } from "@/types";
import { estimateTextTokens } from "@/lib/utils/messageTokens";

export interface SessionUsageSummary {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  currentContextTokens: number;
  estimated: boolean;
}

const getRecordedUsage = (
  message: Message,
): {
  prompt: number;
  completion: number;
  total: number;
} | null => {
  if (message.usageMetadata) {
    return {
      prompt: message.usageMetadata.promptTokenCount,
      completion: message.usageMetadata.candidatesTokenCount,
      total: message.usageMetadata.totalTokenCount,
    };
  }
  if (message.usage) {
    return {
      prompt: message.usage.prompt_tokens,
      completion: message.usage.completion_tokens,
      total: message.usage.total_tokens,
    };
  }
  return null;
};

export function summarizeSessionUsage(
  messages: Message[],
): SessionUsageSummary {
  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;
  let currentContextTokens = 0;
  let hasRecordedUsage = false;

  for (const message of messages) {
    const usage = getRecordedUsage(message);
    if (message.role === "model" && usage) {
      hasRecordedUsage = true;
      promptTokens += usage.prompt;
      completionTokens += usage.completion;
      totalTokens += usage.total;
      currentContextTokens = usage.total;
    }
  }

  if (hasRecordedUsage) {
    return {
      promptTokens,
      completionTokens,
      totalTokens,
      currentContextTokens,
      estimated: false,
    };
  }

  const estimatedPrompt = messages
    .filter((message) => message.role === "user")
    .reduce((total, message) => total + estimateTextTokens(message.content), 0);
  const estimatedCompletion = messages
    .filter((message) => message.role === "model")
    .reduce((total, message) => total + estimateTextTokens(message.content), 0);
  const estimatedTotal = estimatedPrompt + estimatedCompletion;

  return {
    promptTokens: estimatedPrompt,
    completionTokens: estimatedCompletion,
    totalTokens: estimatedTotal,
    currentContextTokens: estimatedTotal,
    estimated: true,
  };
}

export function getContextUsagePercent(
  usedTokens: number,
  contextWindow?: number,
): number | null {
  if (!contextWindow || contextWindow <= 0) return null;
  return Math.min(100, Math.max(0, (usedTokens / contextWindow) * 100));
}
