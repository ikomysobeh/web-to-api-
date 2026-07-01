# Embed Widget — How to Test It (Local)

**Date:** 2026-06-30
What was built: the embeddable chat widget from
[EMBED_WIDGET_BUILD_PLAN.md](EMBED_WIDGET_BUILD_PLAN.md). This guide tests it end-to-end
on your local machine.

---

## 0. What you'll prove works
1. Admin can create a widget and copy a snippet.
2. The widget loads inside an iframe on a separate test page.
3. The login token is handed to the widget (no manual login inside the iframe).
4. "Connect Gemini" drives the extension.
5. Chatting streams a reply — even for a user **not** assigned to that agent.

---

## 1. Start everything locally

```bash
# in the project root
docker compose up -d --build
```

This rebuilds the bridge (creates the new `embed_configs` table automatically), the
frontend, and webai. Confirm:

```bash
docker exec webai-postgres psql -U webai_user -d webai_bridge -c "\dt embed_configs"
docker logs webai-bridge --tail 5      # should show startup, no errors
```

Open the app at **http://127.0.0.1:3000** and sign in as an **admin**.

> The frontend build-time URLs must point local. In your `.env`:
> `VITE_API_URL=http://127.0.0.1:8000`, `VITE_AUTH_URL=https://authtesting.lcportal.cloud`.
> `VITE_WIDGET_URL` is optional locally — it defaults to the page's own origin
> (`http://127.0.0.1:3000`).

---

## 2. Load the extension (for the Gemini step)

1. `chrome://extensions/` → **Developer mode** ON.
2. **Load unpacked** → select
   `C:\New folder (2)\lumina-extension (7)\lumina-extension\dist`.
3. Confirm `BACKEND_URL` in the extension is local (`http://127.0.0.1:8000`) — we set this
   earlier. If you rebuilt, click the 🔄 reload icon on the card.

> The extension's content script now runs in **all frames** (`all_frames: true`) and sets
> an "installed" marker, so the widget inside the iframe can detect it.

---

## 3. Create a widget (admin)

1. In the app sidebar (admin) you'll see a new **Embed** item → open `/admin/embed`.
2. Click **Create widget**:
   - **Agent**: pick any active agent (ideally one with documents).
   - Title, greeting, color, position, theme — anything.
   - **Allowed domains**: leave **blank** for local testing (blank = any origin allowed).
3. Save. The widget appears in the list — click it.
4. On the right you'll see:
   - the **snippet** (with a Copy button), and
   - a **live preview** iframe. Because you're the admin, the page hands your token to the
     preview automatically, so the chat should load (it may say "Connect Gemini" first).

✅ **Checkpoint:** the preview shows the widget header + greeting. If it says "Connect
Gemini", that's expected — do step 5.

---

## 4. Test the widget on a SEPARATE page (the real scenario)

The point of the feature is embedding on *another* site. Simulate that with a tiny local
HTML file.

1. Copy the snippet from `/admin/embed`. It looks like:
   ```html
   <script src="http://127.0.0.1:3000/embed.js" data-embed="emb_xxxx" data-token-key="auth_token" async></script>
   ```
2. Get a valid token: on the app tab, press **F12 → Console**, run
   `localStorage.getItem('auth_token')` and copy the string.
3. Create a file `test-host.html` anywhere with this content (paste your token + snippet):
   ```html
   <!doctype html>
   <html>
     <body>
       <h1>Fake customer dashboard</h1>
       <script>window.LuminaEmbed = { token: "PASTE_YOUR_TOKEN_HERE" };</script>
       <!-- PASTE THE SNIPPET FROM /admin/embed BELOW -->
       <script src="http://127.0.0.1:3000/embed.js" data-embed="emb_xxxx" data-token-key="auth_token" async></script>
     </body>
   </html>
   ```
   > We set `window.LuminaEmbed.token` directly here because a random local HTML file
   > won't have your app's `auth_token` in its own localStorage. On a real dashboard that
   > shares your auth, `embed.js` would read `auth_token` by itself.
4. Serve it (don't open with `file://` — use a tiny server so it has a real origin):
   ```bash
   # from the folder containing test-host.html
   npx serve -l 4321
   # then open http://localhost:4321/test-host.html
   ```

✅ **Checkpoint:** a 💬 bubble appears bottom-right. Click it → the chat opens inside the
page. (Network tab: `GET /api/embeds/emb_xxxx` returns **200**.)

---

## 5. Connect Gemini through the widget

1. In the open widget, if it shows the amber **"Connect Gemini"** bar, click it.
2. The extension opens a Gemini tab → sign into Google → it captures cookies, closes the
   tab, and POSTs to `/api/cookies`.
3. The amber bar disappears (the widget re-checks `/api/cookies/status`).

✅ **Checkpoint:** `POST /api/cookies` 200, and the bar flips to connected. If the
extension is NOT installed, the bar instead says **"Install the extension"** — that's the
correct fallback.

---

## 6. Chat

Type a question and send.

✅ **Checkpoint:** the reply streams in word by word
(`POST /api/embeds/emb_xxxx/chat` is a streaming response). If the agent had documents,
the answer should use them.

**Important test:** log in (in the app) as a user who is **NOT assigned** to that agent,
grab *their* token, and repeat steps 4–6. Chat should **still work** — that proves the
"embed-granted" access (the embed key is the permission, not a per-user assignment).

---

## 7. Security checks (optional but recommended)

- **Origin lock:** edit the widget, set **Allowed domains** to `example.com` only. Reload
  `test-host.html` → `GET /api/embeds/{key}` should now return **403** (your test origin
  isn't allowed). Set it back to blank to re-allow.
- **Inactive widget:** deactivate it in `/admin/embed` → the widget returns **404**.

---

## 8. Quick API smoke test (no browser)

With an admin token (`$ADMIN`) and a normal user token (`$USER`):

```bash
# create a widget
curl -s -X POST http://127.0.0.1:8000/admin/embeds \
  -H "Authorization: Bearer $ADMIN" -H "Content-Type: application/json" \
  -d '{"agent_id":"<AGENT_UUID>","allowed_domains":[],"config":{"title":"Test"}}'

# bootstrap as a normal user (use the embed_key from above)
curl -s http://127.0.0.1:8000/api/embeds/emb_xxxx \
  -H "Authorization: Bearer $USER" -H "Origin: http://localhost:4321"

# chat (streams)
curl -N -X POST http://127.0.0.1:8000/api/embeds/emb_xxxx/chat \
  -H "Authorization: Bearer $USER" -H "Content-Type: application/json" \
  -H "Origin: http://localhost:4321" \
  -d '{"message":"hello"}'
```

---

## 9. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Bubble doesn't appear | `embed.js` URL wrong, or `data-embed` missing. Check the page console. |
| Widget says "Please sign in" forever | No token reached it. Ensure `window.LuminaEmbed.token` is set (step 4) or the host has `auth_token` in localStorage. |
| `GET /api/embeds/{key}` → 403 | Request Origin not in `allowed_domains`. Blank the domains for testing. |
| `GET /api/embeds/{key}` → 404 | Widget inactive or wrong key. |
| Chat error "Connect your Gemini account first" | That user has no Gemini cookies — do step 5 with that user. |
| "Connect Gemini" does nothing | Extension not loaded, or not reloaded after build. Reload it; confirm `document.documentElement.dataset.luminaExt === "1"` in the widget iframe console. |
| Preview blank in `/admin/embed` | Check the browser console; ensure the frontend was rebuilt after these changes. |

---

## 10. Before deploying to production (don't skip)

1. **Extension** `BACKEND_URL` → `https://backend.ai.lcportal.cloud`, rebuild + re-zip.
2. **Backend** `.env` `CORS_ORIGINS` → add the AI app origin **and every host dashboard**
   origin that will embed the widget.
3. **Frontend** `.env` `VITE_WIDGET_URL` → `https://ai.lcportal.cloud` (so snippets point
   to the right place).
4. **nginx** (`web2api-ui/nginx.conf`) → add for `/widget`:
   `add_header Content-Security-Policy "frame-ancestors 'self' https://dashboard-a.com https://dashboard-b.com";`
   and make sure there's no `X-Frame-Options: DENY`. *(This nginx change is the one piece
   not yet done in code — add it when you know the real dashboard origins.)*
5. Set each widget's **Allowed domains** to the real dashboard hosts (don't leave blank in
   production).

---

## Files involved (for reference)

**Backend** — `database.py` (table), `schemas/embeds.py`, `services/embed_service.py`,
`main.py` (admin CRUD + `/api/embeds/{key}` + `/api/embeds/{key}/chat`).
**Frontend** — `services/api.ts`, `types/chat.ts`, `stores/embedStore.ts`,
`components/admin/EmbedPage.tsx`, `components/admin/EmbedFormModal.tsx`,
`pages/WidgetPage.tsx`, `components/widget/WidgetChat.tsx`, `public/embed.js`,
`App.tsx` (routes), `AdminSidebar.tsx` (nav), `pages/LoginPage.tsx` (popup mode).
**Extension** — `src/content/receiver.ts`, `public/manifest.json` (`all_frames: true`).
