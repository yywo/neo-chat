import {
  isCacheableShellAsset,
  isNeoChatPwaCache,
  PWA_SCRIPT_URL,
} from "./policy";

interface PwaBrowserApis {
  cacheStorage?: CacheStorage;
  serviceWorker?: ServiceWorkerContainer;
}

export async function disableNeoChatPwa({
  cacheStorage,
  serviceWorker,
}: PwaBrowserApis): Promise<void> {
  if (serviceWorker) {
    const registrations = await serviceWorker.getRegistrations();
    await Promise.all(
      registrations
        .filter((registration) => {
          const worker =
            registration.active ??
            registration.waiting ??
            registration.installing;
          return worker?.scriptURL.endsWith(PWA_SCRIPT_URL);
        })
        .map((registration) => registration.unregister()),
    );
  }

  if (cacheStorage) {
    const cacheNames = await cacheStorage.keys();
    await Promise.all(
      cacheNames
        .filter(isNeoChatPwaCache)
        .map((cacheName) => cacheStorage.delete(cacheName)),
    );
  }
}

export function getLoadedShellAssetUrls(
  entries: readonly PerformanceEntry[],
  origin: string,
): string[] {
  const urls = new Set<string>();

  for (const entry of entries) {
    try {
      const url = new URL(entry.name, origin);
      if (isCacheableShellAsset(url, origin)) urls.add(url.href);
    } catch {
      // Ignore malformed browser performance entries.
    }
  }

  return [...urls];
}

export async function registerNeoChatPwa(
  serviceWorker: ServiceWorkerContainer,
): Promise<ServiceWorkerRegistration> {
  const registration = await serviceWorker.register(PWA_SCRIPT_URL, {
    scope: "/",
    updateViaCache: "none",
  });
  const readyRegistration = await serviceWorker.ready;
  const loadedAssets = getLoadedShellAssetUrls(
    performance.getEntriesByType("resource"),
    window.location.origin,
  );

  readyRegistration.active?.postMessage({
    type: "CACHE_SHELL_ASSETS",
    urls: loadedAssets,
  });

  return registration;
}
