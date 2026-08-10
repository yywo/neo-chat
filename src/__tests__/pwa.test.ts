import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GET as getServiceWorker } from "@/app/sw.js/route";
import {
  normalizeDeploymentId,
  resolveDeploymentId,
} from "@/lib/pwa/deploymentId";
import {
  disableNeoChatPwa,
  getLoadedShellAssetUrls,
  registerNeoChatPwa,
} from "@/lib/pwa/lifecycle";
import {
  isCacheableShellAsset,
  isNeoChatPwaCache,
  shouldEnablePwa,
} from "@/lib/pwa/policy";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("PWA deployment policy", () => {
  it("only enables offline support for production local deployments", () => {
    expect(shouldEnablePwa("local", "production")).toBe(true);
    expect(shouldEnablePwa("local", "development")).toBe(false);
    expect(shouldEnablePwa("hosted", "production")).toBe(false);
  });

  it("uses a stable safe deployment id with a per-build fallback", () => {
    expect(normalizeDeploymentId(" release/2026.07.25 ")).toBe(
      "release-2026.07.25",
    );
    expect(
      resolveDeploymentId({ GITHUB_SHA: "abc123" }, "fallback-build"),
    ).toBe("abc123");
    expect(resolveDeploymentId({}, "fallback-build")).toBe("fallback-build");
  });

  it("only accepts same-origin versioned shell assets", () => {
    const origin = "https://chat.example.com";

    expect(
      isCacheableShellAsset(
        new URL("https://chat.example.com/_next/static/app.js"),
        origin,
      ),
    ).toBe(true);
    expect(
      isCacheableShellAsset(
        new URL("https://chat.example.com/_next/image?url=user-file"),
        origin,
      ),
    ).toBe(false);
    expect(
      isCacheableShellAsset(
        new URL("https://cdn.example.com/_next/static/app.js"),
        origin,
      ),
    ).toBe(false);
  });

  it("filters browser resource entries before sending them to the worker", () => {
    const entries = [
      { name: "https://chat.example.com/_next/static/app.js" },
      { name: "https://chat.example.com/api/config" },
      { name: "https://example.org/external.js" },
      { name: "not a url" },
    ] as PerformanceEntry[];

    expect(
      getLoadedShellAssetUrls(entries, "https://chat.example.com"),
    ).toEqual(["https://chat.example.com/_next/static/app.js"]);
  });

  it("unregisters its worker and removes only Neo Chat PWA caches", async () => {
    const unregister = vi.fn().mockResolvedValue(true);
    const unrelatedUnregister = vi.fn().mockResolvedValue(true);
    const deleteCache = vi.fn().mockResolvedValue(true);
    const serviceWorker = {
      getRegistrations: vi.fn().mockResolvedValue([
        {
          active: { scriptURL: "https://chat.example.com/sw.js" },
          unregister,
        },
        {
          active: { scriptURL: "https://chat.example.com/other-sw.js" },
          unregister: unrelatedUnregister,
        },
      ]),
    } as unknown as ServiceWorkerContainer;
    const cacheStorage = {
      keys: vi
        .fn()
        .mockResolvedValue(["neo-chat-pwa-shell-v2", "unrelated-cache"]),
      delete: deleteCache,
    } as unknown as CacheStorage;

    await disableNeoChatPwa({ cacheStorage, serviceWorker });

    expect(unregister).toHaveBeenCalledOnce();
    expect(unrelatedUnregister).not.toHaveBeenCalled();
    expect(deleteCache).toHaveBeenCalledWith("neo-chat-pwa-shell-v2");
    expect(deleteCache).not.toHaveBeenCalledWith("unrelated-cache");
    expect(isNeoChatPwaCache("neo-chat-pwa-static-v3")).toBe(true);
  });

  it("bypasses the HTTP cache when registering and primes loaded assets", async () => {
    const postMessage = vi.fn();
    const registration = {} as ServiceWorkerRegistration;
    const register = vi.fn().mockResolvedValue(registration);
    const serviceWorker = {
      register,
      ready: Promise.resolve({
        active: { postMessage },
      }),
    } as unknown as ServiceWorkerContainer;

    vi.stubGlobal("performance", {
      getEntriesByType: vi
        .fn()
        .mockReturnValue([
          { name: "https://chat.example.com/_next/static/app.js" },
        ]),
    });
    vi.stubGlobal("window", {
      location: { origin: "https://chat.example.com" },
    });

    await expect(registerNeoChatPwa(serviceWorker)).resolves.toBe(registration);
    expect(register).toHaveBeenCalledWith("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    });
    expect(postMessage).toHaveBeenCalledWith({
      type: "CACHE_SHELL_ASSETS",
      urls: ["https://chat.example.com/_next/static/app.js"],
    });
  });

  it("serves a no-store worker bootstrap tied to the deployment id", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEPLOYMENT_ID", "release-abc123");

    const response = getServiceWorker();
    const worker = await response.text();

    expect(response.headers.get("Cache-Control")).toBe(
      "no-cache, no-store, must-revalidate",
    );
    expect(response.headers.get("Service-Worker-Allowed")).toBe("/");
    expect(worker).toContain(
      'self.__NEO_CHAT_DEPLOYMENT_ID__ = "release-abc123"',
    );
    expect(worker).toContain(
      'importScripts("/sw-runtime.js?dpl=release-abc123")',
    );
  });
});

describe("service worker cache boundary", () => {
  it("keeps APIs, event streams, external URLs, and user files network-only", () => {
    const worker = readFileSync(
      resolve(process.cwd(), "public/sw-runtime.js"),
      "utf8",
    );

    expect(worker).toContain("self.__NEO_CHAT_DEPLOYMENT_ID__");
    expect(worker).toContain("url.origin !== self.location.origin");
    expect(worker).toContain('url.pathname.startsWith("/api/")');
    expect(worker).toContain('accept.includes("text/event-stream")');
    expect(worker).toContain('url.pathname.startsWith("/_next/image")');
    expect(worker).toContain('url.pathname.startsWith("/files/")');
  });

  it("checks for updates during long sessions and reloads controlled tabs", () => {
    const lifecycle = readFileSync(
      resolve(process.cwd(), "src/components/pwa/PwaLifecycle.tsx"),
      "utf8",
    );
    const nextConfig = readFileSync(
      resolve(process.cwd(), "next.config.ts"),
      "utf8",
    );

    expect(lifecycle).toContain("PWA_UPDATE_INTERVAL_MS");
    expect(lifecycle).toContain("registration.update()");
    expect(lifecycle).toContain('"visibilitychange"');
    expect(lifecycle).toContain('"controllerchange"');
    expect(lifecycle).toContain("hadControllerAtMount");
    expect(nextConfig).toContain("deploymentId,");
    expect(nextConfig).toContain("NEXT_PUBLIC_DEPLOYMENT_ID: deploymentId");
  });

  it("overrides the Cloudflare static-asset cache header for the worker runtime", () => {
    const cloudflareHeaders = readFileSync(
      resolve(process.cwd(), "public/_headers"),
      "utf8",
    );

    expect(cloudflareHeaders).toContain("/sw-runtime.js");
    expect(cloudflareHeaders).toContain(
      "Cache-Control: no-cache, no-store, must-revalidate",
    );
  });

  it("keeps offline history navigation read-only without exposing tool decisions", () => {
    const shell = readFileSync(
      resolve(process.cwd(), "src/components/app/ChatAppShell.tsx"),
      "utf8",
    );
    const message = readFileSync(
      resolve(process.cwd(), "src/components/chat/MessageItem.tsx"),
      "utf8",
    );
    const knowledge = readFileSync(
      resolve(process.cwd(), "src/components/knowledge/KnowledgeBase.tsx"),
      "utf8",
    );

    expect(shell).toContain("actionsDisabled={isActiveSessionLoading}");
    expect(shell).toContain("mutationsDisabled={");
    expect(shell).toContain("toolActionsDisabled={");
    expect(shell).toContain("!isOnline");
    expect(message).toContain("mutationActionsDisabled");
    expect(message).toContain("confirmationActionsDisabled");
    expect(message).toContain(
      "confirmationActionsDisabled\n                        ? undefined\n                        : onToolConfirmationDecision",
    );
    expect(knowledge).toContain("readOnly={!isOnline}");
    expect(knowledge).toContain('t("offlineReadOnly")');
  });

  it("ships installable 512px and maskable icons", () => {
    const manifest = readFileSync(
      resolve(process.cwd(), "src/app/manifest.ts"),
      "utf8",
    );

    expect(manifest).toContain('src: "/icon-512.png"');
    expect(manifest).toContain('src: "/icon-maskable-512.png"');
    expect(manifest).toContain('purpose: "maskable"');
  });
});
