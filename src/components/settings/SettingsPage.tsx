"use client";
import dynamic from "next/dynamic";
import React, { useState } from "react";
import {
  X,
  Search,
  Server,
  Globe,
  Mic,
  Settings,
  Cpu,
  FolderSearch,
  ShieldCheck,
  Brain,
  Cloud,
  Info,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import ProviderSettings from "./ProviderSettings";
import SearchSettings from "./SearchSettings";
import RAGSettings from "./RAGSettings";
import VoiceSettings from "./VoiceSettings";
import SystemSettings from "./SystemSettings";
import DefaultModelSettings from "./DefaultModelSettings";
import DeploymentHealth from "./DeploymentHealth";
import MemorySettings from "./MemorySettings";
import AboutSettings from "./AboutSettings";
import type { SettingsTabId } from "@/lib/chat/panelUrlState";

const SyncSettings = dynamic(() => import("./SyncSettings"), {
  ssr: false,
});

const SETTINGS_TABS: Array<{
  id: SettingsTabId;
  labelKey: string;
  Icon: LucideIcon;
}> = [
  { id: "providers", labelKey: "tabProviders", Icon: Server },
  { id: "defaults", labelKey: "tabDefaults", Icon: Cpu },
  { id: "search", labelKey: "tabSearch", Icon: Globe },
  { id: "rag", labelKey: "tabRag", Icon: FolderSearch },
  { id: "voice", labelKey: "tabVoice", Icon: Mic },
  { id: "memory", labelKey: "tabMemory", Icon: Brain },
  { id: "sync", labelKey: "tabSync", Icon: Cloud },
  { id: "health", labelKey: "tabHealth", Icon: ShieldCheck },
  { id: "system", labelKey: "tabSystem", Icon: Settings },
  { id: "about", labelKey: "tabAbout", Icon: Info },
];

export interface SettingsSearchEntry {
  id: SettingsTabId;
  label: string;
  description: string;
  keywords: string;
}

export function filterSettingsSearchEntries(
  entries: SettingsSearchEntry[],
  query: string,
): SettingsSearchEntry[] {
  const normalizedQuery = query.normalize("NFKC").trim().toLocaleLowerCase();
  if (!normalizedQuery) return [];

  return entries
    .filter((entry) =>
      `${entry.label} ${entry.description} ${entry.keywords}`
        .normalize("NFKC")
        .toLocaleLowerCase()
        .includes(normalizedQuery),
    )
    .slice(0, 6);
}

const renderTabContent = (activeTab: SettingsTabId, focusMemoryId?: string) => {
  switch (activeTab) {
    case "providers":
      return <ProviderSettings />;
    case "defaults":
      return <DefaultModelSettings />;
    case "search":
      return <SearchSettings />;
    case "rag":
      return <RAGSettings />;
    case "voice":
      return <VoiceSettings />;
    case "memory":
      return <MemorySettings focusMemoryId={focusMemoryId} />;
    case "sync":
      return <SyncSettings />;
    case "health":
      return <DeploymentHealth />;
    case "system":
      return <SystemSettings />;
    case "about":
      return <AboutSettings />;
  }
};

interface SettingsPageProps {
  onClose?: () => void;
  activeTab?: SettingsTabId;
  onTabChange?: (tab: SettingsTabId) => void;
  focusMemoryId?: string;
}

const SettingsPage: React.FC<SettingsPageProps> = ({
  onClose,
  activeTab,
  onTabChange,
  focusMemoryId,
}) => {
  const t = useTranslations("SettingsPage");
  const [localActiveTab, setLocalActiveTab] =
    useState<SettingsTabId>("providers");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSearchIndex, setActiveSearchIndex] = useState(0);
  const [highlightedTab, setHighlightedTab] = useState<SettingsTabId | null>(
    null,
  );
  const resolvedActiveTab = activeTab ?? localActiveTab;
  const searchEntries = SETTINGS_TABS.map(({ id, labelKey }) => ({
    id,
    label: t(labelKey),
    description: t(`searchDescription_${id}`),
    keywords: t(`searchKeywords_${id}`),
  }));
  const searchResults = filterSettingsSearchEntries(searchEntries, searchQuery);
  const activeSearchResult =
    searchResults[Math.min(activeSearchIndex, searchResults.length - 1)];

  const setResolvedActiveTab = (tab: SettingsTabId) => {
    if (activeTab === undefined) {
      setLocalActiveTab(tab);
    }
    onTabChange?.(tab);
  };

  const focusTab = (tabId: SettingsTabId) => {
    requestAnimationFrame(() => {
      document.getElementById(`settings-tab-${tabId}`)?.focus();
    });
  };

  const openSearchResult = (tabId: SettingsTabId) => {
    setResolvedActiveTab(tabId);
    setSearchQuery("");
    setHighlightedTab(tabId);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const panel = document.getElementById(`settings-panel-${tabId}`);
        panel
          ?.querySelector<HTMLElement>(
            'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])',
          )
          ?.focus({ preventScroll: true });
      });
    });
    window.setTimeout(
      () =>
        setHighlightedTab((current) => (current === tabId ? null : current)),
      1400,
    );
  };

  const handleTabKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    tabId: SettingsTabId,
  ) => {
    const currentIndex = SETTINGS_TABS.findIndex((tab) => tab.id === tabId);
    if (currentIndex < 0) return;

    const lastIndex = SETTINGS_TABS.length - 1;
    const nextIndexByKey: Partial<Record<string, number>> = {
      ArrowDown: currentIndex === lastIndex ? 0 : currentIndex + 1,
      ArrowRight: currentIndex === lastIndex ? 0 : currentIndex + 1,
      ArrowUp: currentIndex === 0 ? lastIndex : currentIndex - 1,
      ArrowLeft: currentIndex === 0 ? lastIndex : currentIndex - 1,
      Home: 0,
      End: lastIndex,
    };

    const nextIndex = nextIndexByKey[event.key];
    if (nextIndex === undefined) return;

    event.preventDefault();
    const nextTab = SETTINGS_TABS[nextIndex];
    if (!nextTab) return;

    setResolvedActiveTab(nextTab.id);
    focusTab(nextTab.id);
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background animate-in fade-in duration-300">
      <div className="sticky top-0 z-10 flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border/80 bg-background/85 px-4 py-3 backdrop-blur-md md:flex-nowrap md:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground ring-1 ring-border"
            aria-hidden="true"
          >
            <Settings size={18} />
          </div>
          <div className="min-w-0">
            <h1
              id="settings-title"
              className="truncate text-base font-semibold text-foreground"
            >
              {t("title")}
            </h1>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {t("sections")}
            </p>
          </div>
        </div>
        <div className="relative order-3 w-full md:order-none md:ml-auto md:max-w-sm">
          <Search
            size={16}
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => {
              setSearchQuery(event.target.value);
              setActiveSearchIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setSearchQuery("");
                return;
              }
              if (searchResults.length === 0) return;
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveSearchIndex(
                  (current) => (current + 1) % searchResults.length,
                );
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveSearchIndex(
                  (current) =>
                    (current - 1 + searchResults.length) % searchResults.length,
                );
              } else if (event.key === "Enter" && activeSearchResult) {
                event.preventDefault();
                openSearchResult(activeSearchResult.id);
              }
            }}
            placeholder={t("searchPlaceholder")}
            aria-label={t("searchLabel")}
            aria-controls="settings-search-results"
            aria-expanded={searchResults.length > 0}
            aria-activedescendant={
              searchQuery.trim() && activeSearchResult
                ? `settings-search-option-${activeSearchResult.id}`
                : undefined
            }
            role="combobox"
            className="h-9 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm text-foreground outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground focus:border-brand/50 focus:ring-2 focus:ring-brand/15"
          />
          {searchQuery.trim() ? (
            <div
              id="settings-search-results"
              role="listbox"
              aria-label={t("searchResults")}
              className="absolute inset-x-0 top-[calc(100%+0.4rem)] z-30 max-h-72 overflow-y-auto rounded-xl border border-border bg-popover p-1.5 shadow-xl"
            >
              {searchResults.length > 0 ? (
                searchResults.map((entry) => (
                  <button
                    key={entry.id}
                    id={`settings-search-option-${entry.id}`}
                    type="button"
                    role="option"
                    aria-selected={entry.id === activeSearchResult?.id}
                    onMouseEnter={() =>
                      setActiveSearchIndex(
                        searchResults.findIndex(
                          (result) => result.id === entry.id,
                        ),
                      )
                    }
                    onClick={() => openSearchResult(entry.id)}
                    className={`block w-full rounded-lg px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      entry.id === activeSearchResult?.id
                        ? "bg-muted"
                        : "hover:bg-muted"
                    }`}
                  >
                    <span className="block text-sm font-medium text-foreground">
                      {entry.label}
                    </span>
                    <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                      {entry.description}
                    </span>
                  </button>
                ))
              ) : (
                <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                  {t("searchEmpty")}
                </p>
              )}
            </div>
          ) : null}
        </div>
        {onClose && (
          <button
            type="button"
            aria-label={t("close")}
            onClick={onClose}
            className="shrink-0 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X size={20} aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="flex w-full shrink-0 flex-row overflow-x-auto border-b border-border bg-background/80 md:w-60 md:flex-col md:overflow-y-auto md:scrollbar-gutter-both md:border-b-0 md:border-r">
          <div
            role="tablist"
            aria-label={t("sections")}
            className="flex w-full flex-row gap-1 p-2 md:flex-col"
          >
            {SETTINGS_TABS.map(({ id, labelKey, Icon }) => {
              const isSelected = resolvedActiveTab === id;

              return (
                <button
                  key={id}
                  id={`settings-tab-${id}`}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  aria-controls={`settings-panel-${id}`}
                  tabIndex={isSelected ? 0 : -1}
                  onClick={() => setResolvedActiveTab(id)}
                  onKeyDown={(event) => handleTabKeyDown(event, id)}
                  className={`flex min-h-10 items-center gap-2.5 whitespace-nowrap rounded-lg border-l-2 px-3 py-2 text-sm font-medium transition-[color,background-color,border-color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    isSelected
                      ? "border-brand bg-muted text-foreground"
                      : "border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                  }`}
                >
                  <Icon size={16} aria-hidden="true" />
                  <span>{t(labelKey)}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-muted/20 dark:bg-transparent">
          <div className="flex-1 overflow-y-auto custom-scrollbar">
            <div
              id={`settings-panel-${resolvedActiveTab}`}
              role="tabpanel"
              aria-labelledby={`settings-tab-${resolvedActiveTab}`}
              className={`mx-auto w-full max-w-5xl px-3 py-5 md:px-6 md:py-6 rounded-xl transition-[box-shadow] ${
                highlightedTab === resolvedActiveTab
                  ? "ring-2 ring-brand/25 ring-offset-2 ring-offset-background"
                  : ""
              }`}
            >
              {renderTabContent(resolvedActiveTab, focusMemoryId)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
