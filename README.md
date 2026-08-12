# Umo Editor Engine

> A privately-deployable **real-time collaborative rich-text editor engine**, delivered as a Docker image. Embed it in any business system via **iframe** and interact through **same-origin direct calls** or **cross-domain postMessage**. Comparable in form factor to a self-hosted OnlyOffice Document Server.

[中文文档](./README.zh-CN.md) | **English**

---

## ✨ Highlights

- **Real-time co-editing** — Conflict-free merges powered by [Yjs](https://yjs.dev/) CRDT, with per-collaborator cursors and server-side persistence (SQLite WAL). No content lost on refresh or restart.
- **Built-in comments** — Select text → "Comment" from the bubble menu → manage in the side panel. Comment anchors sync automatically via Yjs; live updates over SSE. No business backend required.
- **Tech-stack agnostic** — Embed via iframe in any frontend (Vue / React / plain HTML) backed by any server (Java / Python / Go / Node). No Vue ecosystem dependency forced on your stack.
- **Dual interaction modes** — Same-origin direct calls (`window.__UMO_EDITOR__`) for maximum power (sync calls, function return values, even the raw Tiptap instance); cross-domain `postMessage` for universal async request/response.
- **High-fidelity export** — Exports route through the already-rendered DOM (charts, formulas, video included) → `convert-server` produces `.docx`. What you see is what you get. Two paths: toolbar one-click download, or `postMessage export` that POSTs the file to your backend callback.
- **Zero-config file upload** — Images and attachments are embedded as base64 Data URLs inside the Yjs document. No external object storage (OSS / S3 / MinIO) needed; files sync with the document in real time.
- **Private deployment** — All data stays on your servers. JWT + API Key two-layer auth; `UMO_API_KEY` never reaches the browser.

---

## 🏗 Architecture

The engine container exposes a single port `9999`. Frontend assets live under `/oes/embed/`; APIs and WebSocket under `/oes/*`:

```
┌─────────────────────────────────────────────────────────────┐
│ Your business system                                         │
│  Business frontend              Business backend             │
│  ┌───────────┐                  ┌──────────────┐            │
│  │ Page with  │ ──REST──→       │ Holds         │            │
│  │ <iframe>   │                 │ UMO_API_KEY   │            │
│  └─────┬─────┘                  └──────┬───────┘            │
│        │ iframe src                    │ GET /oes/api/token │
│        │ /oes/embed?doc=&token=        │ (x-api-key header) │
│        ▼                               ▼                    │
└────────┼───────────────────────────────┼────────────────────┘
         │ HTTP/WS                        │
         ▼                               ▼
┌─────────────────────────────────────────────────────────────┐
│ Umo Editor Engine image (self-hosted, :9999)                 │
│  nginx                                                       │
│   ├─ /oes/embed        → editor landing page (iframe entry)  │
│   ├─ /oes/embed/*      → editor static assets                │
│   ├─ /oes/collab (WS)  → collab-server (:4000) Yjs sync      │
│   ├─ /oes/api/token    → collab-server JWT issuance          │
│   ├─ /oes/api/convert/ → convert-server (:4002) HTML→docx    │
│   └─ /oes/api/documents|comments/* → collab-server comments  │
└─────────────────────────────────────────────────────────────┘
```

| Component | Port | Responsibility |
| --- | --- | --- |
| **nginx** (in-container `:9999`) | 9999 | Unified entry, reverse-proxies `/oes/embed`, `/oes/collab`, `/oes/api/*` |
| **collab-server** (`:4000`) | 4000 | Yjs collaboration server (Hocuspocus), real-time sync, SQLite persistence, comments API (REST + SSE) |
| **convert-server** (`:4002`) | 4002 | HTML → docx conversion (for export) |

> The repo also ships a **demo thin-client container** (`umo-editor-demo`, `:9998`) that simulates a business system (login / document list / editor page) so you can experience the full loop with one `docker compose up`.

---

## 🚀 Quick Start

### Option 1: Full stack via docker compose (recommended)

Starts both the engine and the demo thin-client:

```bash
docker compose -f docker/docker-compose.yml up -d --build
```

| Container | Port | Purpose |
| --- | --- | --- |
| `umo-editor-engine` | `9999` | The editor engine (iframe target) |
| `umo-editor-demo` | `9998` | Demo thin-client (login / doc list / editor) |

- Demo entry: `http://localhost:9998/oes/demo/` — log in and try co-editing.
- Engine entry: `http://localhost:9999/oes/embed?doc=<docId>&token=<jwt>`

### Option 2: Engine only

If your business system is ready and you don't need the demo:

```bash
docker run -d \
  --name umo-editor \
  -p 9999:9999 \
  -e JWT_SECRET='<strong-random-secret-for-signing-JWT>' \
  -e UMO_API_KEY='<strong-random-secret-for-token-endpoint>' \
  -e JWT_EXPIRES_IN=24h \
  -v umo-collab-data:/app/collab-server/data \
  --restart unless-stopped \
  crpi-h7gzaxnskayufpzy.cn-hongkong.personal.cr.aliyuncs.com/1049/oes-engine:latest
```

### Verify it's running

```bash
curl http://localhost:9999/oes/api/health
# { "ok": true, "service": "umo-collab-server" }
```

---

## 🔌 Integration in Four Steps

```
1. Deploy the engine image (Docker)
       ↓
2. Auth handoff (your backend signs JWTs)
       ↓
3. Embed via iframe (build the /oes/embed URL)
       ↓
4. Interact (same-origin direct call OR postMessage)
```

Minimal iframe embed:

```html
<iframe
  src="http://localhost:9999/oes/embed?doc=doc-123&token=<jwt>"
  width="100%" height="800"
></iframe>
```

---

## 🧩 Core Capabilities

| Area | What you get |
| --- | --- |
| **Co-editing** | Real-time sync, collaborator cursors, offline reconnect & merge, server-side persistence |
| **Comments** | Built-in (on by default), mark-anchored, Yjs-synced, SSE push, full CRUD, REST-readable, toggleable via `comments: { enabled: false }` |
| **Content ops** | `getHTML` / `getJSON` / `getText` / `setContent` / `insertContent` / `getImage` / bookmarks … |
| **Export** | Toolbar one-click Word download (zero config), or `postMessage export` → docx POSTed to your backend callback |
| **File upload** | base64 Data URL into the Yjs doc — no object storage required |
| **Permissions** | `mode=view` / `setReadOnly(bool)` enforced server-side; JWT `role` claim (`editor` / `commenter` / `viewer`); commenter can comment (mark written by server), viewer is read-only |
| **Bookmarks** | `setBookmark` / `focusBookmark` / `getAllBookmarks` / `deleteBookmark` |
| **Editor UI** | Ribbon toolbar, page/web layout, zh-CN / en-US, print, fullscreen, theme & skin, templates & @mentions via `config` message |

---

## 🔐 Security Model

Two-layer auth keeps secrets off the client:

- **`UMO_API_KEY`** — Held by your backend. Used to call `/oes/api/token` to mint JWTs. **Never expose to the browser.** Empty value = dev no-auth mode (local dev only; **must** be set in production).
- **JWT** — Short-lived token (default `24h`) placed in the iframe URL. Carries username, document id, and role (`editor` / `commenter` / `viewer`), signed by your backend via the engine.

```bash
# Generate strong secrets
openssl rand -hex 32
```

---

## 📦 Repository Layout

```
online-edit-sync/
├── docker/          # Dockerfile, docker-compose.yml, nginx/supervisor configs
├── collab-server/   # Yjs collaboration server (Hocuspocus) + comments API
├── convert-server/  # HTML → docx conversion service
├── embed/           # The /oes/embed editor frontend (iframe target)
├── demo/            # Thin-client demo: login / doc list / editor page
├── deploy/          # Deployment helpers
├── docs/            # Full documentation (Chinese)
└── src/             # @umoteam/editor component library source
```

---

## 📚 Documentation

Full documentation lives under [`docs/`](./docs) (in Chinese). Key entry points:

- [Overview](./docs/get-started/overview.md) — What it is, architecture, core capabilities
- [Installation](./docs/get-started/installation.md) — Docker startup, env vars, persistence
- [Authentication](./docs/get-started/authentication.md) — JWT issuance, roles, permissions
- [iframe Embedding](./docs/get-started/embedding.md) — URL params, `config` protocol, token expiry
- [Features](./docs/get-started/features.md) — Co-editing, comments, export, upload, bookmarks
- [Same-origin API](./docs/api-reference/same-origin-api.md) — `window.__UMO_EDITOR__` methods
- [postMessage Protocol](./docs/api-reference/postmessage-protocol.md) — Cross-domain message contract
- [Server API](./docs/api-reference/server-api.md) — `/oes/api/token`, `/oes/api/convert`, `/oes/collab`, comments
- [Export & Callback](./docs/api-reference/export.md) — Toolbar download vs. push-to-backend (plan B3)
- [nginx Reverse Proxy](./docs/api-reference/nginx-reverse-proxy.md) — Single-domain subpath template

### Samples

- [Minimal cross-domain integration](./docs/samples/minimal-cross-domain.md) — postMessage only, no reverse proxy
- [Full same-origin integration](./docs/samples/full-same-origin.md) — nginx reverse proxy + same-origin direct call
- [Demo thin-client project](./docs/samples/demo-project.md) — Walkthrough of the runnable `demo/` directory

---

## 🆚 Comparison

| Dimension | Umo Editor Engine | OnlyOffice DS | Component library (npm) |
| --- | --- | --- | --- |
| Deployment | Docker, self-hosted | Docker, self-hosted | npm install |
| Integration | iframe | iframe | Vue component |
| Business stack | Any | Any | Vue 3 required |
| Deep customization | Medium (direct call exposes Tiptap) | Low | High (fully open) |
| Collaboration runtime | Engine-managed | Engine-managed | Self-maintained |

---

## 📄 License

[MIT](./LICENSE)
