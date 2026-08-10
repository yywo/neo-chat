/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createSyncRemoteClient: vi.fn(),
  runEncryptedSync: vi.fn(),
}));

vi.mock("@/lib/sync/engine", () => ({
  recoveryCodeToStoredKey: vi.fn(),
  recoveryCodeToVaultId: vi.fn(),
  resetLocalSyncVault: vi.fn(),
  resolveStoredSyncConflict: vi.fn(),
  runEncryptedSync: mocks.runEncryptedSync,
}));
vi.mock("@/lib/sync/crypto", () => ({
  generateRecoveryCode: vi.fn(),
}));
vi.mock("@/lib/sync/deviceIdentity", () => ({
  getDefaultSyncDeviceName: () => "Test device",
  getSyncDeviceId: vi.fn(),
}));
vi.mock("@/lib/sync/remoteClient", () => ({
  createSyncRemoteClient: mocks.createSyncRemoteClient,
}));
vi.mock("@/lib/sync/storage", () => ({
  getSyncStateStorage: () => ({
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  }),
  SYNC_CONFIGURATION_STORAGE_KEY: "test-sync-configuration",
}));
vi.mock("@/lib/security/localSecrets", () => ({
  decryptLocalSecret: vi.fn(),
  encryptLocalSecret: vi.fn(),
  LOCAL_SECRET_CONTEXTS: {
    syncRemoteCredentials: "local:sync:remote-credentials",
    syncRootKey: "local:sync:root-key",
  },
}));

import { useSyncStore, type SyncStoreState } from "@/store/core/syncStore";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function configureEnabledStore(): void {
  useSyncStore.setState({
    enabled: true,
    status: "idle",
    provider: {
      kind: "webdav",
      baseUrl: "https://dav.example.com",
      rootPath: "neo-chat",
    },
    credentialSecret: {} as NonNullable<SyncStoreState["credentialSecret"]>,
    rootKeySecret: {} as NonNullable<SyncStoreState["rootKeySecret"]>,
    vaultId: "vault-1",
  });
}

describe("sync store operation guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSyncStore.setState(useSyncStore.getInitialState(), true);
    configureEnabledStore();
  });

  it("keeps disabled state and suppresses apply events from a late sync result", async () => {
    const pending = deferred<{
      changed: boolean;
      uploadedBytes: number;
      downloadedBytes: number;
      devices: [];
      conflicts: [];
    }>();
    mocks.runEncryptedSync.mockReturnValueOnce(pending.promise);
    const dispatchEvent = vi.spyOn(window, "dispatchEvent");

    const syncPromise = useSyncStore.getState().syncNow("manual");
    expect(useSyncStore.getState().status).toBe("syncing");

    useSyncStore.getState().disableSync();
    pending.resolve({
      changed: true,
      uploadedBytes: 10,
      downloadedBytes: 20,
      devices: [],
      conflicts: [],
    });
    await syncPromise;

    expect(useSyncStore.getState()).toMatchObject({
      enabled: false,
      status: "disabled",
      activeController: undefined,
      requiresReload: false,
    });
    expect(useSyncStore.getState().lastSyncAt).toBeUndefined();
    expect(dispatchEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "neo-chat-sync-applied" }),
    );
  });

  it("ignores a late connection-test result after sync is disabled", async () => {
    const pending = deferred<void>();
    const test = vi.fn(() => pending.promise);
    mocks.createSyncRemoteClient.mockResolvedValueOnce({ test });

    const testPromise = useSyncStore.getState().testConnection();
    expect(useSyncStore.getState().status).toBe("syncing");

    useSyncStore.getState().disableSync();
    pending.resolve();
    await testPromise;

    expect(test).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(useSyncStore.getState()).toMatchObject({
      enabled: false,
      status: "disabled",
      connectionController: undefined,
      error: undefined,
    });
  });

  it("does not surface an aborted late connection-test failure", async () => {
    const pending = deferred<void>();
    mocks.createSyncRemoteClient.mockResolvedValueOnce({
      test: vi.fn(() => pending.promise),
    });

    const testPromise = useSyncStore.getState().testConnection();
    useSyncStore.getState().disableSync();
    pending.reject(new Error("late connection failure"));

    await expect(testPromise).resolves.toBeUndefined();
    expect(useSyncStore.getState()).toMatchObject({
      status: "disabled",
      error: undefined,
    });
  });
});
