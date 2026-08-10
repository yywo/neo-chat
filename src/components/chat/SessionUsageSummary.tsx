"use client";

import React from "react";
import { Gauge } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import Tooltip from "@/components/ui/Tooltip";
import {
  getContextUsagePercent,
  summarizeSessionUsage,
} from "@/lib/chat/sessionUsage";
import type { Message } from "@/types";

interface SessionUsageSummaryProps {
  messages: Message[];
  contextWindow?: number;
}

const SessionUsageSummary = ({
  messages,
  contextWindow,
}: SessionUsageSummaryProps) => {
  const t = useTranslations("ChatApp");
  const locale = useLocale();
  const usage = React.useMemo(
    () => summarizeSessionUsage(messages),
    [messages],
  );
  const percent = getContextUsagePercent(
    usage.currentContextTokens,
    contextWindow,
  );
  const formatNumber = React.useMemo(
    () => new Intl.NumberFormat(locale, { notation: "compact" }),
    [locale],
  );

  if (messages.length === 0) return null;

  return (
    <DropdownMenu>
      <Tooltip content={t("sessionUsage")} position="bottom">
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t("sessionUsageAria", {
              count: usage.totalTokens,
            })}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <Gauge size={15} aria-hidden="true" />
            <span className="hidden font-mono sm:inline">
              {formatNumber.format(usage.totalTokens)}
            </span>
          </button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>{t("sessionUsage")}</DropdownMenuLabel>
        <div className="space-y-2 px-2 pb-2 text-xs">
          <div className="flex justify-between gap-3">
            <span className="text-muted-foreground">
              {t("sessionTotalTokens")}
            </span>
            <span className="font-mono">
              {usage.totalTokens.toLocaleString(locale)}
              {usage.estimated ? ` ${t("estimated")}` : ""}
            </span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-muted-foreground">{t("promptTokens")}</span>
            <span className="font-mono">
              {usage.promptTokens.toLocaleString(locale)}
            </span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-muted-foreground">
              {t("completionTokens")}
            </span>
            <span className="font-mono">
              {usage.completionTokens.toLocaleString(locale)}
            </span>
          </div>
        </div>
        <DropdownMenuSeparator />
        <div className="space-y-2 px-2 py-2 text-xs">
          <div className="flex justify-between gap-3">
            <span className="text-muted-foreground">
              {t("currentContextBudget")}
            </span>
            <span className="font-mono">
              {contextWindow
                ? `${usage.currentContextTokens.toLocaleString(
                    locale,
                  )} / ${contextWindow.toLocaleString(locale)}`
                : t("contextWindowUnknown")}
            </span>
          </div>
          {percent !== null ? (
            <div
              role="progressbar"
              aria-label={t("currentContextBudget")}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(percent)}
              className="h-1.5 overflow-hidden rounded-full bg-muted"
            >
              <div
                className={`h-full rounded-full ${
                  percent >= 85
                    ? "bg-red-500"
                    : percent >= 65
                      ? "bg-amber-500"
                      : "bg-emerald-500"
                }`}
                style={{ width: `${percent}%` }}
              />
            </div>
          ) : null}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default SessionUsageSummary;
