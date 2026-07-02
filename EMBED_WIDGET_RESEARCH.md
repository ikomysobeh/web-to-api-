# Embeddable AI Chat Widget — Research & Implementation Plan

> **Feature.** Add an **Iframe / Embed Code Generator** to the AI project's Admin
> Dashboard. An admin picks an agent, configures appearance, and copies a snippet.
> Pasting that snippet into the **external dashboard** renders a floating bubble
> that opens a **popup AI chat**.

> ## Workflow (the agreed design)
> 1. **AI project — Admin Dashboard** → `/admin/embed` → pick agent, configure, **copy snippet**.
> 2. Go to the **external dashboard**, **paste the embed code** → it renders a
>    floating 💬 bubble that opens a **popup AI chat**.
> 3. The popup **takes the JWT from the dashboard's auth** (the token is the **same**
>    — there is one shared auth system).
> 4. The popup has a **"Connect Gemini" button** that connects cookies
>    **automatically via the extension's one‑click flow** — or, if the extension
>    isn't installed, prompts the user to **download the extension**.

> ## Two facts that shape everything (read before coding)
> - **Shared token, but separate origins.** One auth system ⇒ the dashboard's JWT
>   is valid for the AI backend. But the dashboard and the AI app are **different
>   origins**, and a third‑party iframe **cannot read another origin's
>   `localStorage`** (browser *storage partitioning*). So the token must be **handed**
>   from the dashboard to the widget — done by `embed.js`, which runs **first‑party
>   on the dashboard** and can read the dashboard's storage, then `postMessage`s the
>   token into the iframe.
> - **Only an extension can read Gemini cookies.** Gemini's session cookies
>   (`__Secure-1PSID`, `__Secure-1PSIDTS`) are **httpOnly + cross‑origin** — a normal
>   web page (the popup) **cannot** read them by JavaScript. The extension's
>   `background.js` already reads them via the `chrome.cookies` API. So "connect
>   automatically" means **the button drives the extension**; there is no
>   extension‑free automatic path. Without the extension, the only option is to
>   install it.

> **This document is research/spec only. No code is changed.**

---

## 1. End‑to‑end picture

```
┌─────────────────────────────────────────────────────────────────────┐
│ AI PROJECT — Admin Dashboard (web2api-ui)                             │
│   /admin/embed → pick agent, configure, copy snippet (no token in it) │
└─────────────────────────────────────────────────────────────────────┘
                              │ paste snippet
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ EXTERNAL DASHBOARD  (host page; user already logged in here)          │
│   <script src=".../embed.js" data-embed="emb_xxx"></script>          │
│   embed.js (first-party) reads dashboard's auth token                 │
│   → injects 💬 bubble → opens <iframe> popup → postMessage(token)      │
└─────────────────────────────────────────────────────────────────────┘
        │ postMessage: { token }                ▲ iframe (AI-app origin)
        ▼                                       │
┌─────────────────────────────────────────────────────────────────────┐
│ WIDGET POPUP (AI project — /widget?embed=emb_xxx)                     │
│   • receives token → GET /api/embeds/{key} (agent + appearance)       │
│   • "Connect Gemini" button:                                          │
│       installed?  → trigger extension one-click flow (auto cookies)   │
│       not installed? → show "Download the extension"                  │
│   • chat via existing /api/chat (Bearer = handed token, agent_id)     │
└─────────────────────────────────────────────────────────────────────┘
        │ lumina:connect-gemini {token}         │ POST /api/chat (SSE)
        ▼                                       ▼
┌──────────────────────────┐      ┌────────────────────────────────────┐
│ EXTENSION                │      │ BACKEND (webai-bridge :8000)         │
│ receiver.ts (in iframe)  │      │ existing auth + agent + SSE chat     │
│  → background runConnect │─────▶│ POST /api/cookies (token)            │
│  → opens Gemini, reads   │      │ optional: embed-config CRUD          │
│    cookies, POSTs them    │      └────────────────────────────────────┘
└──────────────────────────┘
```

Deliverables:

| # | Layer | Deliverable |
|---|-------|-------------|
| A | Frontend (admin) | `/admin/embed` generator page |
| B | Frontend (widget) | `/widget` chrome‑less chat + "Connect Gemini" button |
| C | Frontend (loader) | static `embed.js` — reads dashboard token, mounts bubble/iframe, hands token to widget |
| D | Extension | run inside the iframe (`all_frames`), expose a page‑triggerable connect handshake + an "installed" marker; point `BACKEND_URL` at prod |
| E | Backend | **No new auth/chat endpoint.** Optional embed‑config CRUD. |

---

## 2. Auth — hand the dashboard's token to the widget

### 2.1 Why a handoff (not a storage read)
The widget iframe is `ai-app.com`; the dashboard is e.g. `dash.example.com`. A
third‑party iframe gets a **partitioned** storage jar and **cannot read** either
the dashboard's or the first‑party AI‑app's `localStorage`. But `embed.js` is a
script that runs **first‑party on the dashboard page**, so it *can* read the
dashboard's stored token and pass it into the iframe via `postMessage`. Because
the auth system is shared, that token authenticates against the AI backend.

```
Dashboard page (first-party)            Widget iframe (ai-app, partitioned)
────────────────────────────            ───────────────────────────────────
embed.js reads dashboard token
  (configurable storage key)
iframe "ready" message  ◀───────────────  on load: postMessage({type:"ready"})
postMessage({type:"lumina-auth", token}) ─▶ receive (validate origin!) → hold in memory
                                            GET /api/embeds/{key}, then chat
```

### 2.2 Where embed.js gets the token (make it configurable)
The dashboard is a separate project, so don't hard‑assume a key. Support, in order:
1. **Explicit** — the dashboard sets `window.LuminaEmbed = { token: "<jwt>" }` (or a
   `getToken()` function) before loading `embed.js`. Most reliable.
2. **Configurable storage key** — `data-token-key="auth_token"` attribute on the
   `<script>` tag; `embed.js` reads `localStorage[key]` (default `auth_token`,
   matching the AI app's `AuthContext`).
3. **Fallback** — if no token is found, the widget shows a **"Sign in" popup** to
   `ai-app.com/login?embed=1` (first‑party), which `postMessage`s a token back and
   closes. (Same shared auth, so this also works.)

### 2.3 Token handling in the widget
- Receive via `postMessage`; **validate `event.origin`** against the embed's
  `allowed_domains`. Keep it in memory (and optionally the iframe's partitioned
  `localStorage["lumina_embed_token"]` for reuse).
- Validate with the existing `GET /auth/me`; on 401 clear and re‑request from host
  / show the sign‑in popup.
- The snippet itself contains **no token** — it's read at runtime.

---

## 3. Gemini cookies — the "Connect Gemini" button

The extension **already implements** one‑click connect (`lumina-extension/public/background.js`):
`runConnectFlow(token, report)` opens Gemini, polls `chrome.cookies` for
`__Secure-1PSID`/`__Secure-1PSIDTS`, then **POSTs them to `/api/cookies` with the
JWT** itself. The widget just needs to **trigger** it and pass the token.

### 3.1 Flow when the extension IS installed (automatic)
```
Widget "Connect Gemini" click
   → window.dispatchEvent(new CustomEvent("lumina:connect-gemini",{detail:{token}}))
content script (receiver.ts, running in the iframe via all_frames)
   → chrome.runtime.connect({name:"connect-gemini"}) ; port.postMessage({type:"CONNECT_GEMINI", token})
background.js runConnectFlow(token)
   → opens Gemini tab, captures cookies, POST /api/cookies (Bearer token)
   → reports phases (opening/waiting/capturing/sending/done)
content script relays phases back → window event "lumina:gemini-status"
widget shows progress; on "done" → re-check GET /api/cookies/status → enable chat
```
This reuses the existing `CONNECT_GEMINI` / `runConnectFlow` machinery verbatim —
the only new bit is letting the **web page** trigger it (today only the extension's
own popup does).

### 3.2 Flow when the extension is NOT installed (fallback)
Detect via an "installed" marker (the content script sets
`document.documentElement.dataset.luminaExt = "1"` or dispatches
`lumina:extension-ready` on inject). If absent after a short timeout, the widget
shows a **"Download the Lumina extension"** card with the install link (Chrome Web
Store / unpacked `lumina-extension.zip`) and a **Retry** once installed.

> **Be explicit in the UI:** automatic cookie capture **requires** the extension —
> the popup cannot read Gemini's httpOnly cookies itself. The button automates the
> extension; the only alternative is to install it.

### 3.3 Already connected? Skip it
After auth, call `GET /api/cookies/status`. If the user connected Gemini earlier
(cookies are stored server‑side per user), it's already connected → hide the
button and chat immediately.

---

## 4. Extension changes

Today: content script (`src/content/receiver.ts`) handles `GET_AUTH_TOKEN` +
`LUMINA_COOKIES`; `background.js` handles `GET_GEMINI_COOKIES` + the
`connect-gemini` port; manifests match only the AI‑app origins, **top frame only**.

Required changes (apply to **both** `public/manifest.json` and `dist/manifest.json`,
and `receiver.ts` → rebuild `content.js`):

1. **`"all_frames": true`** on the content script + add the **widget origin** to
   `content_scripts.matches` and `host_permissions` — so the script runs **inside
   the iframe** (the #1 gotcha).
2. **Page‑triggerable connect** — in `receiver.ts`, add a listener:
   ```ts
   window.addEventListener("lumina:connect-gemini", (e) => {
     const token = (e as CustomEvent).detail?.token
     const port = chrome.runtime.connect({ name: "connect-gemini" })
     port.onMessage.addListener((msg) =>
       window.dispatchEvent(new CustomEvent("lumina:gemini-status", { detail: msg })))
     port.postMessage({ type: "CONNECT_GEMINI", token })
   })
   ```
   (`background.js` needs no change — it already runs `runConnectFlow`.)
3. **Installed marker** — on inject, `receiver.ts` sets
   `document.documentElement.dataset.luminaExt = "1"` (or dispatches
   `lumina:extension-ready`) so the widget can detect presence.
4. **`BACKEND_URL`** in `background.js` is hard‑coded to `http://127.0.0.1:8000` —
   change to the **production** API URL (or read from storage/config) before
   shipping, since cookies are POSTed straight from the background.
5. *(Optional, content‑script‑free alternative)* add
   `"externally_connectable": { "matches": ["https://your-ai-app.com/*"] }` and let
   the widget call `chrome.runtime.connect(EXT_ID, …)` directly. The content‑script
   bridge above is preferred (no need to expose the extension ID).

Manifest diff sketch:
```jsonc
"host_permissions": [ "https://gemini.google.com/*", "https://your-ai-app.com/*", /* …localhost… */ ],
"content_scripts": [{
  "matches": [ "https://your-ai-app.com/*", /* …localhost… */ ],
  "all_frames": true,
  "js": ["content.js"]
}]
```
The `lumina:gemini-cookies` legacy bridge + `useExtensionCookies` still work
unchanged for the non‑one‑click path.

---

## 5. Backend — what's needed

Auth, cookies, and chat are **reused as‑is**:
- **Auth:** dashboard token validated by existing `GET /auth/me`; sign‑in fallback
  uses existing `/api/v1/auth/login`. **No new endpoint.**
- **Cookies:** the extension background POSTs to existing `POST /api/cookies`;
  status via `GET /api/cookies/status`. **No new endpoint.**
- **Chat:** widget calls existing `POST /api/chat` `{ message, model, agent_id }`
  (SSE) with the handed token. **No new endpoint.**

### 5.1 Optional (recommended) — embed‑config CRUD
Central management (which agent, appearance, allowed domains, revoke). Follows the
existing `/admin/*` style.

```sql
CREATE TABLE embed_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    embed_key TEXT UNIQUE NOT NULL,            -- "emb_a1b2c3"
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    created_by INTEGER NOT NULL,
    allowed_domains TEXT[] NOT NULL DEFAULT '{}',
    config JSONB NOT NULL DEFAULT '{}',         -- title, greeting, accentColor, position, theme
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET`    | `/admin/embeds`           | admin JWT | List (`?agent_id=`) |
| `POST`   | `/admin/embeds`           | admin JWT | Create → returns `embed_key` |
| `GET`    | `/admin/embeds/{id}`      | admin JWT | Get one |
| `PUT`    | `/admin/embeds/{id}`      | admin JWT | Update config / domains / `is_active` |
| `DELETE` | `/admin/embeds/{id}`      | admin JWT | Revoke (soft‑delete) |
| `GET`    | `/api/embeds/{embed_key}` | widget JWT | **Bootstrap:** appearance + agent `name/description/model`; validate active + Origin ∈ `allowed_domains`; **never return `instructions`** |

**Minimal alternative (no DB):** encode `agent_id` + appearance in the snippet's
`data-*` attributes and skip §5.1; rely on `frame-ancestors` for domain control.

---

## 6. Frontend A — Admin "Embed" generator page
Wire like the existing admin pages (nested routes under `AdminShell` in
`src/App.tsx`):
- **Route** `<Route path="embed" element={<EmbedPage />} />`; **nav item** in
  `src/components/admin/AdminSidebar.tsx` (`<NavItem to="/admin/embed" icon={Code2} label="Embed" />`).
- **State** new `embedStore` (mirror `src/stores/adminStore.ts`) or extend it;
  **API helpers** `listEmbeds/createEmbed/getEmbed/updateEmbed/deleteEmbed` in
  `src/services/api.ts` (follow the `Admin — Agents` block).
- **Layout:** left config (agent `Select`, title/greeting `Input`, accent color,
  position/theme, allowed‑domain chips, Save) · right live preview (mount `/widget`
  in a small iframe) + snippet with **Copy**.

Snippet (built from `embed_key` + `VITE_WIDGET_URL`; **no token inside**):
```html
<!-- primary: floating bubble + popup -->
<script src="https://your-ai-app.com/embed.js"
        data-embed="emb_a1b2c3"
        data-token-key="auth_token" async></script>

<!-- alternative: inline iframe (dashboard must still provide the token) -->
<iframe src="https://your-ai-app.com/widget?embed=emb_a1b2c3"
        width="400" height="600" style="border:0;border-radius:16px;" title="AI Chat"></iframe>
```

---

## 7. Frontend B — the widget (`/widget`) + `embed.js`

### 7.1 `/widget` route (chrome‑less chat)
Top‑level route in `src/App.tsx`, **outside** `ProtectedRoute`/`AdminRoute`:
```tsx
<Route path="/widget" element={<WidgetPage />} />
```
`WidgetPage`:
1. Read `?embed=`; on mount `postMessage({type:"ready"})` to the parent.
2. Receive `{type:"lumina-auth", token}` (validate origin) → hold token. If none
   arrives, show the sign‑in popup fallback (§2.2).
3. `GET /api/embeds/{key}` → agent + appearance; `GET /api/cookies/status`.
4. **Connect Gemini button** (§3): dispatch `lumina:connect-gemini` {token},
   listen for `lumina:gemini-status`, re‑check status on `done`; if no
   `luminaExt` marker, show the **download extension** card.
5. Chat: reuse `ChatMessages` + `ChatInput` + `ai-elements/*`, call `POST /api/chat`
   `{message, model, agent_id}` with the token; SSE parsing identical to the app.

States: connecting (no token yet), Gemini not connected, extension missing, token
expired, embed inactive / origin rejected.

### 7.2 `embed.js` (static, `web2api-ui/public/embed.js`)
Vanilla JS, served by nginx. Responsibilities:
1. Read `data-embed`, `data-token-key`, optional `data-position` from
   `document.currentScript`; resolve the token (`window.LuminaEmbed.token` →
   `localStorage[tokenKey]`).
2. Inject the floating bubble; on click mount/show
   `<iframe src="<base>/widget?embed=<key>">` (rounded, shadowed, sandbox with
   `allow-scripts allow-forms allow-popups allow-same-origin`).
3. On the iframe's `{type:"ready"}` message, `postMessage({type:"lumina-auth", token}, base)`
   (target the AI‑app origin, never `"*"`).
4. Handle resize/close messages from the widget; validate `event.origin`.
5. Idempotent + style‑isolated (Shadow DOM or `all:initial`).
```js
(function () {
  var s = document.currentScript;
  var key = s.getAttribute("data-embed");
  var tokenKey = s.getAttribute("data-token-key") || "auth_token";
  var base = new URL(s.src).origin;
  var token = (window.LuminaEmbed && window.LuminaEmbed.token) || localStorage.getItem(tokenKey);
  // build bubble → iframe(base + "/widget?embed=" + key)
  // window.addEventListener("message", e => {
  //   if (e.origin !== base) return;
  //   if (e.data.type === "ready") iframe.contentWindow.postMessage({type:"lumina-auth", token}, base);
  //   if (e.data.type === "resize"/"close") { ... }
  // });
})();
```

---

## 8. Framing, CORS & streaming (gotchas)
1. **Frameability:** allow the dashboard to frame `/widget` via
   `Content-Security-Policy: frame-ancestors 'self' https://dash.example.com;`
   (ideally from `allowed_domains`). No `X-Frame-Options: DENY` on `/widget`.
   Check `web2api-ui/nginx.conf` + `Dockerfile`.
2. **CORS:** widget (AI‑app origin) → AI backend is same‑party; just add the prod
   AI‑app origin to backend CORS (`main.py:83‑98` / `CORS_ORIGINS`).
3. **Extension `BACKEND_URL`** must be the prod API (§4.4); CORS must allow the
   extension's POST (extension requests send `Origin: chrome-extension://…` — the
   current `/api/cookies` already works with the extension, keep that).
4. **postMessage origin validation** both directions (§2.3, §7.2).
5. **Iframe sandbox must allow popups** for the sign‑in fallback.
6. **SSE not buffered:** nginx `proxy_buffering off;` for the chat route.

---

## 9. Implementation checklist

**Extension (`lumina-extension`)**
- [ ] `"all_frames": true` + widget origin in `matches`/`host_permissions` (both manifests).
- [ ] `receiver.ts`: add `lumina:connect-gemini` → `connect-gemini` port bridge + `lumina:gemini-status` relay + `luminaExt` installed marker; rebuild `content.js`.
- [ ] `background.js`: set `BACKEND_URL` to prod.
- [ ] (Optional) `externally_connectable`. Re‑zip / redistribute.

**Backend (`webai-bridge`)** — optional but recommended
- [ ] `embed_configs` migration + `/admin/embeds[...]` CRUD (admin‑guarded).
- [ ] `GET /api/embeds/{embed_key}` bootstrap (Origin check, no `instructions`).
- [ ] `frame-ancestors` for `/widget`; add prod AI‑app origin to CORS.
- [ ] **No new auth/cookie/chat endpoint.**

**Frontend (`web2api-ui`)**
- [ ] `EmbedPage` + route + nav item; `embedStore` + API helpers; snippet + Copy + preview; `VITE_WIDGET_URL`.
- [ ] `/widget` route (outside guards) → `WidgetPage`: token via postMessage, Connect‑Gemini button (extension bridge + download fallback), reuse `ChatMessages`/`ChatInput` + `useExtensionCookies`.
- [ ] `public/embed.js` loader (token resolve + handoff + bubble/iframe + resize/close).
- [ ] *(Fallback only)* `LoginPage` `?embed=1` popup mode (postMessage token, close).

---

## 10. Open questions before coding
1. **Token source on the dashboard:** can the dashboard set `window.LuminaEmbed.token`
   explicitly (most robust), or must `embed.js` read a `localStorage` key — and if so,
   **which key** does the dashboard use?
2. **Sign‑in fallback** (popup to `/login?embed=1`) wanted, or assume the dashboard
   always has a token?
3. **Persisted threads** in the widget (reuse `conversations`) or stateless `/api/chat`?
4. **Embed config server‑side (§5.1) or encoded in the snippet (§5)?**
5. **Exact prod origins** (AI app/widget + dashboard) for CORS, `frame-ancestors`,
   the extension manifest, `BACKEND_URL`, and postMessage targets.
6. **Extension distribution:** Chrome Web Store listing vs. shipping
   `lumina-extension.zip` for manual install (affects the "download" link).

---

### File references (current code)
- Auth state + token (`localStorage["auth_token"]`) — `web2api-ui/src/context/AuthContext.tsx`
- Login API + `getMe` + `chatStream` — `web2api-ui/src/services/api.ts`
- Admin routing/guards — `web2api-ui/src/App.tsx`; nav — `src/components/admin/AdminSidebar.tsx`; admin state — `src/stores/adminStore.ts`
- Cookie bridge hook — `web2api-ui/src/hooks/useExtensionCookies.ts`; cookie modal — `src/components/modals/CookieSetupModal.tsx`
- Chat UI to reuse — `web2api-ui/src/components/chat/*`, `src/components/ai-elements/*`
- Static hosting — `web2api-ui/public/`, `web2api-ui/nginx.conf`, `Dockerfile`
- **Extension** — `lumina-extension/src/content/receiver.ts` (`GET_AUTH_TOKEN`, `LUMINA_COOKIES`), `lumina-extension/public/background.js` (`CONNECT_GEMINI` port, `runConnectFlow`, `BACKEND_URL`), `public/manifest.json` + `dist/manifest.json`
- Backend — `webai-bridge/main.py` (`:79` CORS, `:113` `ChatMessage`, `:369` `/api/cookies`, `:485` `/api/cookies/status`, `:501` `/api/chat`, `:1178+` `/admin/*`); schemas — `webai-bridge/schemas/agents.py`
```
