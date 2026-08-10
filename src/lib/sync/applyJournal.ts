import {
  APP_RESTORE_WRITE_LOCK_KEY,
  acquireAppRestoreWriteGate,
  releaseAppRestoreWriteGate,
  runWithExclusiveAppDataLock,
  type AppRestoreDbEntry,
} from "@/lib/data/appRestoreJournal";
import { appDb, STORAGE_KEYS } from "@/store/storage/storageConfig";
import { deleteFromOPFS, resolveOPFSBlob, writeBlobToOPFS } from "@/utils/opfs";
import { syncDb } from "./storage";

export const SYNC_APPLY_JOURNAL_KEY = "sync-apply-journal";
export const SYNC_APPLY_SNAPSHOT_KEY = "sync-apply-snapshot";

export type SyncApplyPhase = "prepared" | "applying" | "applied";

export interface SyncApplyJournal {
  version: 1;
  transactionId: string;
  phase: SyncApplyPhase;
  createdAt: string;
}

export interface SyncApplyFileSnapshot {
  url: string;
  exists: boolean;
  bytes?: Uint8Array;
  mimeType?: string;
}

export interface SyncApplySnapshot {
  version: 1;
  transactionId: string;
  dbEntries: AppRestoreDbEntry[];
  coreSettings: AppRestoreDbEntry;
  files: SyncApplyFileSnapshot[];
}

export interface SyncApplyKeyValueDb {
  getItem(key: string): Promise<unknown | null>;
  setItem(key: string, value: unknown): Promise<unknown>;
  removeItem(key: string): Promise<void>;
}

export interface SyncApplyLocalStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SyncApplyJournalOptions {
  journalDb: SyncApplyKeyValueDb;
  appDataDb: SyncApplyKeyValueDb;
  localStorageRef: SyncApplyLocalStorage;
  readFile: (
    url: string,
  ) => Promise<{ bytes: Uint8Array; mimeType: string } | null>;
  writeFile: (
    url: string,
    bytes: Uint8Array,
    mimeType?: string,
  ) => Promise<void>;
  deleteFile: (url: string) => Promise<void>;
}

export function createSyncApplyRecoveryBarrier(
  recover: () => Promise<unknown>,
): () => Promise<void> {
  let recovery: Promise<void> | undefined;
  return () => {
    recovery ||= recover().then(() => undefined);
    return recovery;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isDbEntry(value: unknown): value is AppRestoreDbEntry {
  return (
    isRecord(value) &&
    typeof value.key === "string" &&
    typeof value.exists === "boolean"
  );
}

function isFileSnapshot(value: unknown): value is SyncApplyFileSnapshot {
  return (
    isRecord(value) &&
    typeof value.url === "string" &&
    typeof value.exists === "boolean" &&
    (!value.exists || value.bytes instanceof Uint8Array)
  );
}

function parseJournal(value: unknown): SyncApplyJournal | null {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.transactionId !== "string" ||
    typeof value.createdAt !== "string" ||
    (value.phase !== "prepared" &&
      value.phase !== "applying" &&
      value.phase !== "applied")
  ) {
    return null;
  }
  return value as unknown as SyncApplyJournal;
}

function parseSnapshot(
  value: unknown,
  transactionId: string,
): SyncApplySnapshot | null {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    value.transactionId !== transactionId ||
    !Array.isArray(value.dbEntries) ||
    !value.dbEntries.every(isDbEntry) ||
    !isDbEntry(value.coreSettings) ||
    !Array.isArray(value.files) ||
    !value.files.every(isFileSnapshot)
  ) {
    return null;
  }
  return value as unknown as SyncApplySnapshot;
}

async function restoreDbEntry(
  db: SyncApplyKeyValueDb,
  entry: AppRestoreDbEntry,
): Promise<void> {
  if (entry.exists) await db.setItem(entry.key, entry.value);
  else await db.removeItem(entry.key);
}

async function restoreSnapshot(
  options: SyncApplyJournalOptions,
  snapshot: SyncApplySnapshot,
): Promise<void> {
  await Promise.all(
    snapshot.dbEntries.map((entry) => restoreDbEntry(options.appDataDb, entry)),
  );
  if (snapshot.coreSettings.exists) {
    options.localStorageRef.setItem(
      snapshot.coreSettings.key,
      String(snapshot.coreSettings.value),
    );
  } else {
    options.localStorageRef.removeItem(snapshot.coreSettings.key);
  }
  await Promise.all(
    snapshot.files.map((file) =>
      file.exists && file.bytes
        ? options.writeFile(file.url, file.bytes, file.mimeType)
        : options.deleteFile(file.url),
    ),
  );
}

export async function createSyncApplyTransaction(
  options: SyncApplyJournalOptions,
  input: { managedDbKeys: string[]; fileUrls: string[] },
): Promise<SyncApplyJournal> {
  const transactionId = `sync-${
    globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`
  }`;
  const existingKeys = new Set(input.managedDbKeys);
  const dbEntries = await Promise.all(
    [...existingKeys].map(async (key): Promise<AppRestoreDbEntry> => {
      const value = await options.appDataDb.getItem(key);
      return value === null
        ? { key, exists: false }
        : { key, exists: true, value };
    }),
  );
  const coreValue = options.localStorageRef.getItem(STORAGE_KEYS.CORE_SETTINGS);
  const files = await Promise.all(
    [...new Set(input.fileUrls)].map(
      async (url): Promise<SyncApplyFileSnapshot> => {
        const file = await options.readFile(url);
        return file
          ? {
              url,
              exists: true,
              bytes: file.bytes,
              mimeType: file.mimeType,
            }
          : { url, exists: false };
      },
    ),
  );
  const snapshot: SyncApplySnapshot = {
    version: 1,
    transactionId,
    dbEntries,
    coreSettings: {
      key: STORAGE_KEYS.CORE_SETTINGS,
      exists: coreValue !== null,
      ...(coreValue !== null ? { value: coreValue } : {}),
    },
    files,
  };
  const journal: SyncApplyJournal = {
    version: 1,
    transactionId,
    phase: "prepared",
    createdAt: new Date().toISOString(),
  };

  // The rollback data is durable before the journal makes the transaction
  // visible. A snapshot left without a journal is only an orphan and is safe
  // to discard on the next recovery pass.
  await options.journalDb.setItem(SYNC_APPLY_SNAPSHOT_KEY, snapshot);
  // Publish the cross-context gate before the transaction journal. If the
  // browser closes in between, recovery treats the snapshot and sync-owned
  // gate as orphans. Publishing the journal first would leave a window where
  // another already-hydrated tab could write data that rollback later erases.
  acquireAppRestoreWriteGate(options.localStorageRef, transactionId);
  try {
    await options.journalDb.setItem(SYNC_APPLY_JOURNAL_KEY, journal);
  } catch (error) {
    const cleanup = await Promise.allSettled([
      options.journalDb.removeItem(SYNC_APPLY_JOURNAL_KEY),
      options.journalDb.removeItem(SYNC_APPLY_SNAPSHOT_KEY),
    ]);
    if (cleanup.every((result) => result.status === "fulfilled")) {
      releaseAppRestoreWriteGate(options.localStorageRef, transactionId);
    }
    throw error;
  }
  return journal;
}

export async function setSyncApplyPhase(
  options: SyncApplyJournalOptions,
  journal: SyncApplyJournal,
  phase: SyncApplyPhase,
): Promise<SyncApplyJournal> {
  const next = { ...journal, phase };
  await options.journalDb.setItem(SYNC_APPLY_JOURNAL_KEY, next);
  return next;
}

export async function commitSyncApplyTransaction(
  options: SyncApplyJournalOptions,
  journal: SyncApplyJournal,
): Promise<void> {
  const current = parseJournal(
    await options.journalDb.getItem(SYNC_APPLY_JOURNAL_KEY),
  );
  if (
    !current ||
    current.transactionId !== journal.transactionId ||
    current.phase !== "applied"
  ) {
    throw new Error("Sync apply commit journal is missing or invalid.");
  }
  // Removing the journal is the commit point. An orphaned snapshot is safely
  // removed by the next recovery pass. A stale sync-owned write gate is also
  // released there if the browser closes between these operations.
  await options.journalDb.removeItem(SYNC_APPLY_JOURNAL_KEY);
  releaseAppRestoreWriteGate(options.localStorageRef, journal.transactionId);
  await options.journalDb.removeItem(SYNC_APPLY_SNAPSHOT_KEY);
}

async function recoverSyncApplyTransactionUnlocked(
  options: SyncApplyJournalOptions,
): Promise<"none" | "rolled-back" | "committed"> {
  const rawJournal = await options.journalDb.getItem(SYNC_APPLY_JOURNAL_KEY);
  if (rawJournal === null) {
    const staleGate = options.localStorageRef.getItem(
      APP_RESTORE_WRITE_LOCK_KEY,
    );
    if (staleGate?.startsWith("sync-")) {
      releaseAppRestoreWriteGate(options.localStorageRef, staleGate);
    }
    await options.journalDb.removeItem(SYNC_APPLY_SNAPSHOT_KEY);
    return "none";
  }
  const journal = parseJournal(rawJournal);
  if (!journal) {
    throw new Error("Sync recovery is blocked because its journal is invalid.");
  }
  const snapshot = parseSnapshot(
    await options.journalDb.getItem(SYNC_APPLY_SNAPSHOT_KEY),
    journal.transactionId,
  );
  if (!snapshot) {
    throw new Error(
      "Sync recovery is blocked because its rollback snapshot is missing or invalid.",
    );
  }

  if (journal.phase === "applied") {
    await options.journalDb.removeItem(SYNC_APPLY_JOURNAL_KEY);
    releaseAppRestoreWriteGate(options.localStorageRef, journal.transactionId);
    await options.journalDb.removeItem(SYNC_APPLY_SNAPSHOT_KEY);
    return "committed";
  }

  await restoreSnapshot(options, snapshot);
  await options.journalDb.removeItem(SYNC_APPLY_JOURNAL_KEY);
  releaseAppRestoreWriteGate(options.localStorageRef, journal.transactionId);
  await options.journalDb.removeItem(SYNC_APPLY_SNAPSHOT_KEY);
  return "rolled-back";
}

export async function ensureInterruptedSyncApplyRecovery(
  options: SyncApplyJournalOptions,
  exclusiveLockHeld = false,
): Promise<"none" | "rolled-back" | "committed"> {
  return exclusiveLockHeld
    ? recoverSyncApplyTransactionUnlocked(options)
    : runWithExclusiveAppDataLock(() =>
        recoverSyncApplyTransactionUnlocked(options),
      );
}

export function createBrowserSyncApplyJournalOptions(): SyncApplyJournalOptions {
  if (typeof window === "undefined") {
    throw new Error("Browser sync recovery is unavailable on the server.");
  }
  return {
    journalDb: syncDb,
    appDataDb: appDb,
    localStorageRef: window.localStorage,
    readFile: async (url) => {
      const blob = await resolveOPFSBlob(url);
      return blob
        ? {
            bytes: new Uint8Array(await blob.arrayBuffer()),
            mimeType: blob.type,
          }
        : null;
    },
    writeFile: (url, bytes, mimeType) => {
      const copiedBytes = new Uint8Array(bytes.byteLength);
      copiedBytes.set(bytes);
      return writeBlobToOPFS(
        url,
        mimeType
          ? new Blob([copiedBytes.buffer], { type: mimeType })
          : copiedBytes,
      );
    },
    deleteFile: deleteFromOPFS,
  };
}

export async function ensureInterruptedBrowserSyncApplyRecovery(): Promise<
  "none" | "rolled-back" | "committed"
> {
  if (typeof window === "undefined") return "none";
  return ensureInterruptedSyncApplyRecovery(
    createBrowserSyncApplyJournalOptions(),
  );
}

export const prepareBrowserSyncApplyRecovery = createSyncApplyRecoveryBarrier(
  ensureInterruptedBrowserSyncApplyRecovery,
);
