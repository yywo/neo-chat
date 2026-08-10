import { describe, expect, it } from "vitest";
import {
  SYNC_APPLY_JOURNAL_KEY,
  SYNC_APPLY_SNAPSHOT_KEY,
  createSyncApplyRecoveryBarrier,
  createSyncApplyTransaction,
  ensureInterruptedSyncApplyRecovery,
  setSyncApplyPhase,
  type SyncApplyJournalOptions,
  type SyncApplyKeyValueDb,
  type SyncApplyLocalStorage,
} from "@/lib/sync/applyJournal";
import { APP_RESTORE_WRITE_LOCK_KEY } from "@/lib/data/appRestoreJournal";
import { STORAGE_KEYS } from "@/store/storage/storageConfig";

class MemoryDb implements SyncApplyKeyValueDb {
  readonly values = new Map<string, unknown>();
  failOnSetKey?: string;
  beforeSet?: (key: string) => void;

  async getItem(key: string): Promise<unknown | null> {
    return this.values.has(key) ? structuredClone(this.values.get(key)) : null;
  }

  async setItem(key: string, value: unknown): Promise<unknown> {
    this.beforeSet?.(key);
    if (key === this.failOnSetKey) throw new Error(`Failed to write ${key}`);
    this.values.set(key, structuredClone(value));
    return value;
  }

  async removeItem(key: string): Promise<void> {
    this.values.delete(key);
  }
}

class MemoryLocalStorage implements SyncApplyLocalStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

interface MemoryFile {
  bytes: Uint8Array;
  mimeType: string;
}

function createHarness() {
  const journalDb = new MemoryDb();
  const appDataDb = new MemoryDb();
  const localStorageRef = new MemoryLocalStorage();
  const files = new Map<string, MemoryFile>();
  const options: SyncApplyJournalOptions = {
    journalDb,
    appDataDb,
    localStorageRef,
    readFile: async (url) => {
      const file = files.get(url);
      return file
        ? { bytes: file.bytes.slice(), mimeType: file.mimeType }
        : null;
    },
    writeFile: async (url, bytes, mimeType) => {
      files.set(url, {
        bytes: bytes.slice(),
        mimeType: mimeType || "application/octet-stream",
      });
    },
    deleteFile: async (url) => {
      files.delete(url);
    },
  };
  return { journalDb, appDataDb, localStorageRef, files, options };
}

describe("sync apply recovery journal", () => {
  it("rolls back partially materialized database, settings, and OPFS writes", async () => {
    const harness = createHarness();
    await harness.appDataDb.setItem("settings", "old-settings");
    harness.localStorageRef.setItem(
      STORAGE_KEYS.CORE_SETTINGS,
      "old-core-settings",
    );
    harness.files.set("opfs://existing", {
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "image/png",
    });

    const journal = await createSyncApplyTransaction(harness.options, {
      managedDbKeys: ["settings", "session_messages_new"],
      fileUrls: ["opfs://existing", "opfs://new"],
    });
    await setSyncApplyPhase(harness.options, journal, "applying");

    await harness.appDataDb.setItem("settings", "new-settings");
    await harness.appDataDb.setItem("session_messages_new", "partial-tree");
    harness.localStorageRef.setItem(
      STORAGE_KEYS.CORE_SETTINGS,
      "new-core-settings",
    );
    harness.files.set("opfs://existing", {
      bytes: new Uint8Array([9]),
      mimeType: "application/octet-stream",
    });
    harness.files.set("opfs://new", {
      bytes: new Uint8Array([8]),
      mimeType: "application/octet-stream",
    });

    // A new options object backed by the same stores models a browser restart.
    expect(
      await ensureInterruptedSyncApplyRecovery(harness.options, true),
    ).toBe("rolled-back");
    expect(await harness.appDataDb.getItem("settings")).toBe("old-settings");
    expect(await harness.appDataDb.getItem("session_messages_new")).toBeNull();
    expect(harness.localStorageRef.getItem(STORAGE_KEYS.CORE_SETTINGS)).toBe(
      "old-core-settings",
    );
    expect([...harness.files.get("opfs://existing")!.bytes]).toEqual([1, 2, 3]);
    expect(harness.files.get("opfs://existing")!.mimeType).toBe("image/png");
    expect(harness.files.has("opfs://new")).toBe(false);
    expect(await harness.journalDb.getItem(SYNC_APPLY_JOURNAL_KEY)).toBeNull();
    expect(await harness.journalDb.getItem(SYNC_APPLY_SNAPSHOT_KEY)).toBeNull();
  });

  it("commits a validated applied phase instead of rolling it back", async () => {
    const harness = createHarness();
    await harness.appDataDb.setItem("settings", "old-settings");
    const journal = await createSyncApplyTransaction(harness.options, {
      managedDbKeys: ["settings"],
      fileUrls: [],
    });
    await setSyncApplyPhase(harness.options, journal, "applying");
    await harness.appDataDb.setItem("settings", "validated-settings");
    await setSyncApplyPhase(harness.options, journal, "applied");

    expect(
      await ensureInterruptedSyncApplyRecovery(harness.options, true),
    ).toBe("committed");
    expect(await harness.appDataDb.getItem("settings")).toBe(
      "validated-settings",
    );
    expect(await harness.journalDb.getItem(SYNC_APPLY_JOURNAL_KEY)).toBeNull();
    expect(await harness.journalDb.getItem(SYNC_APPLY_SNAPSHOT_KEY)).toBeNull();
  });

  it("finishes crash recovery before a reloaded store can hydrate", async () => {
    const harness = createHarness();
    await harness.appDataDb.setItem("settings", "stable-settings");
    const journal = await createSyncApplyTransaction(harness.options, {
      managedDbKeys: ["settings"],
      fileUrls: [],
    });
    await setSyncApplyPhase(harness.options, journal, "applying");
    await harness.appDataDb.setItem("settings", "partial-settings");

    const prepareReload = createSyncApplyRecoveryBarrier(() =>
      ensureInterruptedSyncApplyRecovery(harness.options, true),
    );
    const hydratedValue = await prepareReload().then(() =>
      harness.appDataDb.getItem("settings"),
    );

    expect(hydratedValue).toBe("stable-settings");
    expect(await prepareReload()).toBeUndefined();
  });

  it("publishes the write gate before the journal and cleans a publish failure", async () => {
    const harness = createHarness();
    harness.journalDb.failOnSetKey = SYNC_APPLY_JOURNAL_KEY;
    let protectedAtJournalPublish = false;
    harness.journalDb.beforeSet = (key) => {
      if (key !== SYNC_APPLY_JOURNAL_KEY) return;
      protectedAtJournalPublish = Boolean(
        harness.journalDb.values.has(SYNC_APPLY_SNAPSHOT_KEY) &&
        harness.localStorageRef
          .getItem(APP_RESTORE_WRITE_LOCK_KEY)
          ?.startsWith("sync-"),
      );
    };

    await expect(
      createSyncApplyTransaction(harness.options, {
        managedDbKeys: ["settings"],
        fileUrls: [],
      }),
    ).rejects.toThrow(`Failed to write ${SYNC_APPLY_JOURNAL_KEY}`);
    expect(protectedAtJournalPublish).toBe(true);
    expect(
      harness.localStorageRef.getItem(APP_RESTORE_WRITE_LOCK_KEY),
    ).toBeNull();
    expect(await harness.journalDb.getItem(SYNC_APPLY_SNAPSHOT_KEY)).toBeNull();
  });
});
