# Local offline PWA

Neo Chat registers its Service Worker only in production when
`DEPLOYMENT_MODE=local`. Development and hosted deployments proactively
unregister `/sw.js` and delete cache names owned by Neo Chat. This prevents
stale development chunks and prevents a deployment from accidentally retaining
offline history behavior after it moves from local to hosted mode.

Every production build receives a deployment ID. `/sw.js` embeds that ID and
loads `/sw-runtime.js` with a matching version query. The same ID is also passed
to Next.js deployment-version protection and used in the PWA cache names. A new
release therefore changes the Worker bytes and cache namespace even when the
Worker runtime logic itself did not change. Set `NEXT_DEPLOYMENT_ID` at build
time when multiple separately built replicas must share one rollout identity;
otherwise Neo Chat generates a unique build fallback.

On the first online load, the app caches its navigation shell, manifest, icons,
and the same-origin `/_next/static/` resources used by that build. A subsequent
offline navigation can hydrate the normal client application and read the
browser's existing IndexedDB and OPFS data. If shell preparation was incomplete,
a small localized fallback asks the user to reconnect once.

Offline mode is deliberately read-only. Session navigation, local global
search, knowledge-file reading, and backup export remain available. Message
sending and mutation, model generation, MCP, synchronization, web search,
external RAG, voice providers, and reindexing stay disabled until the browser
is online.

The Service Worker never caches:

- `/api/*` or event-stream requests;
- external origins;
- `/_next/image` responses;
- file, media, or upload routes;
- IndexedDB or OPFS content.

Navigation uses network-first behavior. Versioned static assets use
cache-first behavior, and old Neo Chat cache versions are removed during
activation. The app checks for a new Worker at startup, after reconnecting,
whenever a tab becomes visible, and every 30 minutes during a long visible
session. Worker update checks bypass the HTTP cache. When a new worker is ready,
the app shows an explicit reload action instead of replacing a running
conversation without consent. Accepting the update activates the waiting Worker
and reloads every tab already controlled by the previous Worker. Both Worker
scripts use `no-store` response headers, including the Cloudflare Static Assets
override in `public/_headers`.

Clearing browser site data removes both the offline shell and all local app
data. The deployment access password is a server gate, not an operating-system
device lock; protect the browser profile and device account when retaining
sensitive offline history.
