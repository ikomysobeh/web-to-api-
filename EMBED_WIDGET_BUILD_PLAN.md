# Embeddable Chat Widget — Build Plan (matched to our code)

**Date:** 2026-06-30
**Status:** Design only — no code written yet
**Companion file:** [EMBED_WIDGET_EXPLAINED.md](EMBED_WIDGET_EXPLAINED.md) (plain-language explanation)

> **Auth note (read first):** everywhere the older draft said "JWT", we use our
> **Sanctum token from pizzasys** — the same `auth_token` already saved at login and
> verified by the bridge's `get_current_user` (Mode 1 / pizzasys token-verify). There is
> **no separate JWT** and no new auth to add. The widget reuses the exact auth flow we
> already finished.

---

## 1. Goal

A copy-paste **chat bubble** other websites embed with one `<script>` line. Clicking it
opens a popup chat (an iframe of our app) powered by `webai-bridge`. An admin creates each
widget on a new `/admin/embed` page, picks an agent + appearance, and copies the snippet.

Two realities shape the design:
- **Shared auth, different origins.** The host site's Sanctum token is valid for our
  backend, but a cross-origin iframe **can't read** the host's `localStorage`. So
  `embed.js` (which runs first-party on the host) **hands** the token to the iframe via
  `postMessage`.
- **Only the extension can read Gemini cookies.** The widget's "Connect Gemini" button
  **drives our existing extension**; if it's not installed, the widget says "install it".

**Confirmed decisions:**
1. **Embed-granted chat** — a new `POST /api/embeds/{embed_key}/chat` authorizes via the
   embed key, so the visitor does **not** need a `user_agents` assignment.
2. **Stateless** — each popup is a fresh in-memory chat; no new conversation tables.
3. **Flexible token source** — `embed.js` reads `window.LuminaEmbed.token`, else
   `localStorage[data-token-key]` (default `auth_token`).

---

## 2. Backend — `webai-bridge`

### 2.1 New table — `database.py`, inside `init_db()`
Add after the `agents` table block (~`database.py:144`), same style as our other tables:
```sql
CREATE TABLE IF NOT EXISTS embed_configs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    embed_key       TEXT UNIQUE NOT NULL,               -- "emb_..." generated in code
    agent_id        UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    created_by      INTEGER REFERENCES users(id),
    allowed_domains TEXT[] NOT NULL DEFAULT '{}',        -- which host sites may use it
    config          JSONB DEFAULT '{}',                  -- title, greeting, accentColor, position, theme
    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW()
);
```
Auto-created on next bridge start — no manual migration (same as our `agent_suggestions`).

### 2.2 New schemas — `schemas/embeds.py` (mirror `schemas/agents.py`)
```python
class EmbedCreate(BaseModel):
    agent_id: str
    allowed_domains: list[str] = []
    config: dict = {}

class EmbedUpdate(BaseModel):
    allowed_domains: list[str] | None = None
    config: dict | None = None
    is_active: bool | None = None

class EmbedResponse(BaseModel):
    id: str
    embed_key: str
    agent_id: str
    agent_name: str
    allowed_domains: list[str]
    config: dict
    is_active: bool
    created_at: datetime
    updated_at: datetime

class EmbedChatMessage(BaseModel):
    message: str            # model + agent come from the embed, not the client
```

### 2.3 New service — `services/embed_service.py` (mirror `suggestion_service.py`)
Keeps `main.py` thin. Responsibilities:
- `generate_embed_key() -> str` → `"emb_" + secrets.token_urlsafe(9)`
- `create_embed / list_embeds / get_embed / update_embed / soft_delete_embed`
- `get_embed_by_key(embed_key) -> dict | None`
- `origin_allowed(embed, origin_header) -> bool` → host of `Origin` ∈ `allowed_domains`
  (empty list = allow none in production; decide a sensible default).

### 2.4 Admin CRUD — `main.py` (mirror `/admin/agents`, ~`main.py:1178-1268`)
All guarded by `Depends(require_admin)`; `created_by = user["user_id"]`.

| Method & path | Purpose |
|---|---|
| `GET /admin/embeds` | list (join `agents.name` → `agent_name`); optional `?agent_id=` |
| `POST /admin/embeds` | create, returns `EmbedResponse` (with new `embed_key`) |
| `GET /admin/embeds/{id}` | fetch one |
| `PUT /admin/embeds/{id}` | dynamic `UPDATE ... SET` (copy the agents update pattern) |
| `DELETE /admin/embeds/{id}` | soft delete (`is_active=false`) |

### 2.5 Public bootstrap — `GET /api/embeds/{embed_key}`  (`Depends(get_current_user)`)
Validates embed is active **and** request `Origin` host ∈ `allowed_domains` (else 403).
Returns appearance + agent **without instructions**:
```json
{ "agent": {"name":"...","description":"...","model":"..."}, "config": { } }
```

### 2.6 Embed chat — `POST /api/embeds/{embed_key}/chat`  (`Depends(get_current_user)`)
The **embed-granted** path. Same internals as `/api/chat` (`main.py:501-605`) but the
permission check changes:
1. `get_embed_by_key(embed_key)`; 403 if inactive or `Origin` not allowed.
2. Read `agent_id` + `model` from the embed; fetch `agents.instructions` **directly**
   (no `user_agents` join — the embed *is* the grant).
3. Build system prompt = instructions + vector context (`search_chunks`, same as chat).
4. Use **this Sanctum user's** Gemini client: check `has_cookies(user["user_id"])`
   (`services/cookie_service.py:90`); if none → return a clear "connect Gemini" error.
5. Stream `StreamingResponse(..., media_type="text/event-stream", headers={"X-Accel-Buffering":"no", ...})` — identical SSE shape to `/api/chat`.

> **Refactor to avoid drift:** pull the shared "build agent prompt + stream from WebAI"
> logic out of `/api/chat` into a helper (e.g. in a service), and call it from both
> `/api/chat` and the embed chat. Otherwise the two copies will diverge over time.

### 2.7 CORS / env — `main.py:84-103`
No code change. Add the production AI-app/widget origin and each host-dashboard origin to
the existing **`CORS_ORIGINS`** env var (comma-separated). Cookie endpoints
(`/api/cookies`, `/api/cookies/status`) are reused unchanged.

---

## 3. Frontend — `web2api-ui`

### 3.1 API helpers — `src/services/api.ts` (after the Admin — Agents block)
Use the existing `authHeaders(token)` + `BASE` pattern:
- `listEmbeds / createEmbed / getEmbed / updateEmbed / deleteEmbed` → `/admin/embeds*`
- `getEmbedBootstrap(token, key)` → `GET /api/embeds/{key}`
- `embedChatStream(token, key, message)` → `POST /api/embeds/{key}/chat`, returns the
  streaming `Response`. Reuse the SSE reader from
  `src/stores/conversationStore.ts:294-328` (parse `data:` lines → `choices[0].delta.content` / `content`).

### 3.2 Types — `src/types/chat.ts`
Add `EmbedConfig`, `EmbedCreate`, `EmbedUpdate` (mirror the `Agent*` types + our
`Suggestion` addition).

### 3.3 Embed store — `src/stores/embedStore.ts` (mirror `adminStore.ts`)
`getToken()` helper, state `embeds[]`, `isLoading`, `isSaving`, and actions
`loadEmbeds / createEmbed / updateEmbed / deleteEmbed` calling the api helpers.

### 3.4 Admin page — `src/components/admin/EmbedPage.tsx` + `EmbedFormModal.tsx`
Mirror `AgentsPage.tsx` + `AgentFormModal.tsx` (header band, table, modal,
`ConfirmDialog`). Form fields: agent `Select` (from `useAdminStore().agents`), title,
greeting, accent color, position, theme, allowed-domain chips.
- **Right panel:** live preview — mount `/widget?embed=<key>` in a small bordered
  `<iframe>` — plus the **snippet** with a Copy button (`navigator.clipboard.writeText`).
- Snippet built from `embed_key` + `VITE_WIDGET_URL` (new env var, default
  `window.location.origin`):
  ```html
  <script src="<widget>/embed.js" data-embed="emb_xxx" data-token-key="auth_token" async></script>
  ```

### 3.5 Routing + nav — `src/App.tsx`
Our current routes (confirmed in `App.tsx`):
- Add under the `/admin` block (after line 60):
  ```tsx
  <Route path="embed" element={<EmbedPage />} />
  ```
- Add a **top-level public** route, **outside** `ProtectedRoute`/`AdminRoute`
  (next to `/login`):
  ```tsx
  <Route path="/widget" element={<WidgetPage />} />
  ```
- Add an "Embed" nav link in the admin shell (`src/app/AdminShell.tsx` / its sidebar),
  icon `CodeSquare` from `lucide-react`.

### 3.6 Widget page — `src/pages/WidgetPage.tsx` + `src/components/widget/WidgetChat.tsx`
Chrome-less (no sidebar/menus). Build a **slim** chat (don't reuse the full
`ChatMessages`/`ChatInput`, which need app-level props). Flow:
1. Read `?embed=` from URL; `postMessage({type:"ready"})` to `window.parent`.
2. Listen for `{type:"lumina-auth", token}` — **validate `event.origin`** — hold the
   token in state. If none arrives → "Sign in" fallback (popup to `/login?embed=1`).
3. `getEmbedBootstrap(token, key)` → render title/greeting/agent; `getCookiesStatus(token)`.
4. **Connect Gemini** button (if not connected):
   `window.dispatchEvent(new CustomEvent("lumina:connect-gemini",{detail:{token}}))`;
   listen for `"lumina:gemini-status"` for progress; on done re-poll `getCookiesStatus`.
   If `document.documentElement.dataset.luminaExt !== "1"` → show "Download the extension".
5. Send → `embedChatStream(token, key, message)` → stream chunks into the message list.

### 3.7 Loader — `public/embed.js` (served as `/embed.js`)
Vanilla JS, idempotent, style-isolated (**Shadow DOM**). Responsibilities:
- From `document.currentScript` read `data-embed`, `data-token-key` (default
  `auth_token`), optional `data-position`. Resolve
  `token = window.LuminaEmbed?.token ?? localStorage.getItem(tokenKey)`.
- Inject the floating bubble; on click mount
  `<iframe src="<base>/widget?embed=<key>">` (sandbox
  `allow-scripts allow-forms allow-popups allow-same-origin`).
- On iframe `{type:"ready"}` → `iframe.contentWindow.postMessage({type:"lumina-auth", token}, base)`
  — **target the AI-app origin, never `"*"`**.
- Handle `resize`/`close` messages (validate `event.origin === base`).

### 3.8 Login popup mode — `src/pages/LoginPage.tsx` (fallback only)
After a successful login, if `?embed=1` and `window.opener`:
`window.opener.postMessage({type:"lumina-auth", token, email}, WIDGET_ORIGIN); window.close()`.

### 3.9 Framing header — `web2api-ui/nginx.conf`
For `/widget`, add
`add_header Content-Security-Policy "frame-ancestors 'self' <dashboard-origins>";`
and ensure **no** `X-Frame-Options: DENY`. The SPA fallback already serves `/widget` →
`index.html`.

---

## 4. Extension — `lumina-extension`

### 4.1 `src/content/receiver.ts` (rebuilds to `dist/content.js`)
Keep `GET_AUTH_TOKEN` + `LUMINA_COOKIES`. Add at module load:
- `document.documentElement.dataset.luminaExt = "1"` (installed marker the widget checks).
- Listen for `lumina:connect-gemini` → open `chrome.runtime.connect({name:"connect-gemini"})`,
  forward each `port.onMessage` as `window.dispatchEvent(new CustomEvent("lumina:gemini-status",{detail:msg}))`,
  then `port.postMessage({type:"CONNECT_GEMINI", token: e.detail.token})`.
> `background.js runConnectFlow(token, report)` needs **no change** — it already opens
> Gemini, reads cookies, and POSTs to the backend.

### 4.2 `public/manifest.json`
- `content_scripts`: add the **widget origin** to `matches` **and set `"all_frames": true`**
  (so the content script also runs **inside the iframe** — this is the #1 gotcha).
- `host_permissions`: add the widget origin.
- `content_security_policy.extension_pages`: keep the prod backend in `connect-src`.

### 4.3 `public/background.js`
- `BACKEND_URL` → the production API (`https://backend.ai.lcportal.cloud`) for release
  builds. (We currently have it on `http://127.0.0.1:8000` for local testing.)

### 4.4 Build
`npm run build` regenerates `dist/` from `public/` (Vite copies `public/` automatically —
our current setup already does this, so no manual `dist/manifest.json` copy needed).
Re-zip for distribution.

---

## 5. Files to add / change (summary)

### Backend — `webai-bridge`
| File | Change |
|---|---|
| `database.py` | **Add** `embed_configs` table in `init_db()` |
| `schemas/embeds.py` | **New** — Embed schemas |
| `services/embed_service.py` | **New** — key gen, CRUD, origin check |
| `main.py` | **Add** 5 admin routes + bootstrap + embed-chat; **refactor** shared chat helper |

### Frontend — `web2api-ui`
| File | Change |
|---|---|
| `src/services/api.ts` | **Add** embed + bootstrap + embed-chat helpers |
| `src/types/chat.ts` | **Add** `EmbedConfig`, `EmbedCreate`, `EmbedUpdate` |
| `src/stores/embedStore.ts` | **New** — embed admin store |
| `src/components/admin/EmbedPage.tsx` | **New** — list/create UI + snippet + preview |
| `src/components/admin/EmbedFormModal.tsx` | **New** — create/edit form |
| `src/pages/WidgetPage.tsx` | **New** — chrome-less widget host |
| `src/components/widget/WidgetChat.tsx` | **New** — slim chat |
| `public/embed.js` | **New** — the one-line loader (bubble + iframe + token handoff) |
| `src/App.tsx` | **Add** `/admin/embed` route + public `/widget` route |
| `src/app/AdminShell.tsx` (+ sidebar) | **Add** "Embed" nav item |
| `src/pages/LoginPage.tsx` | **Add** `?embed=1` popup postMessage path |
| `nginx.conf` | **Add** `frame-ancestors` CSP for `/widget` |

### Extension — `lumina-extension`
| File | Change |
|---|---|
| `src/content/receiver.ts` | **Add** installed marker + `lumina:connect-gemini` bridge |
| `public/manifest.json` | **Add** widget origin to matches/host_permissions; `all_frames:true` |
| `public/background.js` | `BACKEND_URL` → prod for release |

### Env / config (no code)
| Where | Set |
|---|---|
| backend `.env` `CORS_ORIGINS` | AI-app/widget origin + each host-dashboard origin |
| frontend `.env` `VITE_WIDGET_URL` | public widget base URL |
| `nginx.conf` `frame-ancestors` | dashboard origins allowed to embed |

---

## 6. End-to-end flow

```
ADMIN ─ /admin/embed ─ create ─► POST /admin/embeds ─► emb_xxx + snippet
                                                          │
HOST DASHBOARD ── paste one <script> line ──► 💬 bubble (embed.js, Shadow DOM)
   │ click
   ▼
embed.js ── mount iframe ──► /widget?embed=emb_xxx  (our slim chat)
   │  postMessage {lumina-auth, SANCTUM token}  (origin-checked)
   ▼
WIDGET ── GET /api/embeds/{key}  (bootstrap: title, agent, config)
       ── needs Gemini? ─► CustomEvent ─► EXTENSION ─► reads cookies ─► POST /api/cookies
       ── send message  ─► POST /api/embeds/{key}/chat ─► webai-bridge ─► Gemini ─► SSE reply
```

---

## 7. Security checklist (why it's safe)
- Each widget is locked to listed **`allowed_domains`** (backend 403) **and** nginx
  `frame-ancestors` (browser blocks framing elsewhere).
- The Sanctum token is **handed** to the iframe (never read cross-origin), and only ever
  posted to **our** origin — never `"*"`. Both sides validate `event.origin`.
- Every embed-chat request re-checks embed key + active + Origin.
- Gemini cookies stay on the **extension** path we already trust — nothing new exposed.

---

## 8. Suggested build order (phased, each testable)
1. **Backend CRUD + bootstrap** — table, service, admin routes, `GET /api/embeds/{key}`.
   Test with curl (admin token creates, user token bootstraps, bad Origin → 403).
2. **Embed chat endpoint** — refactor shared chat helper, add `POST .../chat`. Test SSE.
3. **Admin page** — `EmbedPage` + modal + snippet/preview.
4. **Widget page** — slim chat reading `?embed=`, token via postMessage, bootstrap + send.
5. **embed.js loader** — bubble, iframe, token handoff; test on a small static host page.
6. **Extension bridge** — installed marker + connect-gemini event; test Connect button.
7. **nginx `frame-ancestors` + env** — lock to real origins; full end-to-end test.

---

## 9. Verification (end-to-end)
1. `init_db()` creates `embed_configs`; `POST /admin/embeds` (admin) → `embed_key`;
   `GET /api/embeds/{key}` (user token + allowed Origin) → config; disallowed Origin → 403.
2. `/admin/embed` → create embed → snippet appears, preview iframe loads.
3. Load unpacked extension → on the widget page `document.documentElement.dataset.luminaExt === "1"`.
4. Static test page on an allowed origin with the snippet (set `window.LuminaEmbed = { token:"<sanctum>" }`)
   → bubble shows, popup opens, `GET /api/embeds/{key}` 200.
5. Connect Gemini → extension captures cookies → `POST /api/cookies` 200 →
   `GET /api/cookies/status` connected. Extension absent → "Download extension" card.
6. Send a message → `POST /api/embeds/{key}/chat` streams SSE; a user **not** assigned to
   the agent can still chat (embed-granted).
7. `/widget` loads inside the iframe on an allowed origin; refused from a non-listed one.

---

## 10. Decide before building (questions for the manager)
1. **Which host dashboards** will embed this? Exact origins are needed for `CORS_ORIGINS`,
   `frame-ancestors`, and `allowed_domains`.
2. **Not-logged-in visitor:** show a "Sign in" popup (`/login?embed=1`), or assume the
   host always provides a token?
3. **Extension delivery:** Chrome Web Store link or a `.zip`? (sets the "Download" button).
4. **One agent per widget** (current plan) — enough, or selectable at runtime?
5. **Empty `allowed_domains`** — should that mean "allow none" (safe default) or "allow all"?
```
