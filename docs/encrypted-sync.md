# End-to-end encrypted sync

Neo Chat 3.0 can merge a personal, local-first vault through a WebDAV server or
an S3-compatible bucket, including MinIO. Sync is opt-in and does not create a
Neo Chat account or a server-side plaintext index.

## Enable a vault

1. Open **Settings → Sync** and configure WebDAV or S3/MinIO credentials.
2. Test the connection.
3. Create a vault, save both the displayed recovery text and its QR equivalent,
   and confirm that the code is stored safely before activation.
4. On another device, configure its own backend credentials and import the same
   recovery code.

The recovery code contains the versioned root key and checksum. Neo Chat cannot
recover a lost code. Backend credentials, the root key, device identity, local
CRDT baselines, search caches, generated caches, and vector indexes remain local
and are excluded from version 3 ZIP exports.

## Data and encryption model

- Automerge documents are split by domain: the root index and settings, each
  session message tree, workspace, knowledge collection, memory, and Skill data.
- Each device writes its own encrypted snapshot. A sync captures local changes,
  downloads and merges all device snapshots, transactionally applies the merged
  state, and then uploads the current device snapshot.
- HKDF-SHA-256 derives separate metadata, file, and object-name keys from the
  256-bit root key. Objects use AES-256-GCM with random IVs and version/type AAD;
  HMAC-derived remote names do not expose local paths or entity names.
- OPFS files are content-addressed, encrypted in 4 MiB chunks, and restored
  before the merged metadata is committed. Vector indexes are rebuilt locally.
- A durable apply journal and shared write gate recover an interrupted local
  apply before persisted Zustand stores hydrate.

Message content is treated as immutable. Concurrent additions remain reachable
message-tree branches. Automerge resolves ordinary scalar values
deterministically; Settings → Sync lists concurrent candidates so a user choice
can be written as a new resolution.

## Remote proxy boundary

The browser encrypts vault content before sending it to `POST /api/sync/remote`.
Backend credentials are locally encrypted at rest, wrapped for a single proxy
request, decrypted only for that request, and never logged or persisted by the
route. The route supports only `test`, `list`, `head`, `get`, and `put` and keeps
the existing outbound URL, redirect, body-size, and timeout controls.

Use HTTPS for internet-hosted WebDAV and S3 services. Private and HTTP endpoints
are intended only for explicit user-configured self-hosted deployments.

## Scheduling and retention

Neo Chat syncs on startup, reconnect, window focus, five seconds after local
changes settle, and every five minutes while the tab is visible. **Sync now** is
always available. The Service Worker never performs background sync.

Remote objects are append-safe by design: Neo Chat does not automatically delete
orphaned chunks because a device may have been offline for a long time. If a
device or recovery code is lost, create a new vault to rotate both the root key
and remote namespace, migrate every remaining device, then remove the old vault
manually in WebDAV or S3.
