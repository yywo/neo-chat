import localforage from "localforage";
import type { StateStorage } from "zustand/middleware";

export const syncDb = localforage.createInstance({
  name: "neo-chat-sync",
  storeName: "sync_data",
  description: "Encrypted sync configuration and CRDT baselines",
});

const DOCUMENT_PREFIX = "crdt:";
const CONFIGURATION_KEY = "neo-chat-sync-configuration";

export const getSyncStateStorage = (): StateStorage => {
  if (typeof window === "undefined") {
    return {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    };
  }
  return {
    getItem: (name) => syncDb.getItem<string>(name),
    setItem: (name, value) => syncDb.setItem(name, value),
    removeItem: (name) => syncDb.removeItem(name),
  };
};

export const SYNC_CONFIGURATION_STORAGE_KEY = CONFIGURATION_KEY;

export async function readLocalSyncDocument(
  logicalId: string,
): Promise<Uint8Array | null> {
  return syncDb.getItem<Uint8Array>(`${DOCUMENT_PREFIX}${logicalId}`);
}

export async function writeLocalSyncDocument(
  logicalId: string,
  bytes: Uint8Array,
): Promise<void> {
  await syncDb.setItem(`${DOCUMENT_PREFIX}${logicalId}`, bytes);
}

export async function clearLocalSyncDocuments(): Promise<void> {
  const keys = await syncDb.keys();
  await Promise.all(
    keys
      .filter((key) => key.startsWith(DOCUMENT_PREFIX))
      .map((key) => syncDb.removeItem(key)),
  );
}

export async function clearLocalSyncState(): Promise<void> {
  await syncDb.clear();
  if (typeof window !== "undefined") {
    window.localStorage.removeItem("neo-chat-sync-device-id");
  }
}
