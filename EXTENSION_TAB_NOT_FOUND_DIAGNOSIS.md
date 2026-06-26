# Diagnosis: "No Lumina AI tab found. Open it first."

**Date:** 2026-06-24
**Status:** Root cause identified. No code changed yet (analysis only, as requested).

---

## 1. Symptom

When clicking **Capture & Send** in the Lumina AI Chrome extension popup, you get:

> ⚠️ No Lumina AI tab found. Open it first.

…even though you **do** have the app open at `http://localhost:3000/chat`.

Meanwhile, the **front-end developer** says it works on **his** laptop — and his copy does **not** have the new changes you made to the project.

---

## 2. Root Cause (short version)

The extension popup looks for your Lumina tab on **port 5173**, but you are running the app on **port 3000**.

- **You** run the frontend via **Docker** → served by nginx on **`http://localhost:3000`**.
- **The front-end developer** runs it with **`npm run dev`** (Vite dev server) → which defaults to **`http://localhost:5173`**.
- The extension popup has the Lumina URL **hardcoded to `http://localhost:5173`**.

So on his machine the ports match → it works. On yours they don't match → "No Lumina AI tab found."

**This is NOT caused by your new project changes.** It is a port mismatch between how you run the app (Docker, 3000) and how the extension was built (looking for 5173).

---

## 3. Evidence

### 3.1 The extension popup only searches port 5173

`lumina-extension/src/App.tsx` line 7:

```ts
// Change to your production URL when deploying
const LUMINA_URL = 'http://localhost:5173'
```

And the function that finds the tab (`App.tsx` lines 27–36):

```ts
async function sendToLumina(psid: string, psidts: string): Promise<void> {
  ...
  const tabs = await chrome.tabs.query({ url: `${LUMINA_URL}/*` })   // queries http://localhost:5173/*
  const tabId = tabs[0]?.id
  if (tabId == null) throw new Error('No Lumina AI tab found. Open it first.')  // <-- your error
  await chrome.tabs.sendMessage(tabId, { type: 'LUMINA_COOKIES', psid, psidts })
}
```

This is confirmed in the **compiled build** that Chrome actually loads —
`lumina-extension/dist/assets/popup-nc7JNk9j.js` still contains the string `localhost:5173`
right next to the `No Lumina AI tab` message. So even the built extension you loaded is hardwired to 5173.

### 3.2 You serve the app on port 3000

- `docker-compose.yml` (line 118–119) maps the frontend:
  ```yaml
  ports:
    - "3000:3000"
  ```
- `web2api-ui/Dockerfile` line 34: `EXPOSE 3000`, served by nginx.
- You confirmed you open `http://localhost:3000/chat`.

### 3.3 The manifest was *partially* updated, but the popup code was not

`lumina-extension/dist/manifest.json` (the loaded build) was updated to include port 3000 for the **content script** injection:

```json
"host_permissions": [
  "https://gemini.google.com/*",
  "http://localhost:5173/*",
  "http://localhost:3000/*",
  "http://127.0.0.1:3000/*"
],
"content_scripts": [
  {
    "matches": [
      "http://localhost:5173/*",
      "http://localhost:3000/*",
      "http://127.0.0.1:3000/*"
    ],
    "js": ["content.js"]
  }
]
```

So the **content script** (`content.js`) *will* inject into your `localhost:3000` page correctly.
**BUT** the popup's `LUMINA_URL` (which decides *which tab to send the cookies to*) was left at `5173`.

> Result: the half of the change that injects the receiver into port 3000 was done,
> but the half that tells the popup to *target* port 3000 was **not** done.
> The popup never finds the 3000 tab, so it errors out before it ever sends the message.

### 3.4 The two halves of the protocol (so it's clear what talks to what)

```
[Popup App.tsx]
   1. GET_GEMINI_COOKIES  -> background.js  (reads Gemini __Secure-1PSID / __Secure-1PSIDTS)
   2. finds Lumina tab via chrome.tabs.query({url: LUMINA_URL + '/*'})   <-- HARDCODED 5173, FAILS HERE
   3. chrome.tabs.sendMessage(tabId, LUMINA_COOKIES)
        |
        v
[content.js / receiver.ts]  (injected on 5173 + 3000 per manifest)
   4. window.dispatchEvent(CustomEvent 'lumina:gemini-cookies', {psid, psidts})
        |
        v
[web2api-ui  useExtensionCookies.ts -> CookieSetupModal.tsx]
   5. window.addEventListener('lumina:gemini-cookies') -> saveCookies() -> POST /api/cookies
```

The failure happens at **step 2**. Steps 3–5 are never reached on your machine.

### 3.5 Frontend side is compatible (not the problem)

`web2api-ui/src/hooks/useExtensionCookies.ts` listens for the exact event the extension dispatches:

```ts
window.addEventListener('lumina:gemini-cookies', handler)
```

The event name matches the content script's `dispatchEvent('lumina:gemini-cookies', ...)`.
So once the popup actually targets the right port, the frontend will receive the cookies fine.

---

## 4. Why it "works on his laptop" but not yours

| | Front-end dev (works) | You (fails) |
|---|---|---|
| How app is run | `npm run dev` (Vite) | Docker + nginx |
| App URL / port | `http://localhost:5173` | `http://localhost:3000` |
| Extension `LUMINA_URL` | `http://localhost:5173` | `http://localhost:3000` ← needs this, but is 5173 |
| Popup finds tab? | ✅ Yes (ports match) | ❌ No (5173 ≠ 3000) |

His copy not having your new project changes is a **red herring** — the deciding factor is the **port he serves the frontend on**, which happens to match the extension's hardcoded URL.

---

## 5. Fix Options (NOTHING changed yet — pick one before we edit)

### Option A — Point the extension at port 3000 (recommended for your Docker setup)
Edit `lumina-extension/src/App.tsx` line 7:
```ts
const LUMINA_URL = 'http://localhost:3000'
```
Then rebuild and reload:
```bash
cd lumina-extension
npm run build         # regenerates dist/
```
Then in Chrome: `chrome://extensions` → reload the extension.

- ✅ Works for your Docker (3000) setup.
- ⚠️ Would then break for the dev on 5173 (the reverse problem).

### Option B — Support BOTH ports (best for a shared team)
Change the popup to query both URLs instead of one hardcoded string, e.g.:
```ts
const LUMINA_URLS = ['http://localhost:3000', 'http://localhost:5173', 'http://127.0.0.1:3000']
const tabs = await chrome.tabs.query({ url: LUMINA_URLS.map((u) => `${u}/*`) })
```
(`chrome.tabs.query` accepts an array of URL patterns.)
The manifest already injects the content script on all three, so this aligns both halves.

- ✅ Works for you AND the dev with one shared build. Recommended.

### Option C — Run your frontend on 5173 to match the existing extension
Run the app on 5173 (dev server or remap the Docker port to `5173:3000`).

- ✅ No extension change.
- ⚠️ Changes your run setup; less clean than fixing the extension.

---

## 6. Important note about the build (`dist/`)

The extension folder ships a **pre-built `dist/`** that Chrome loads directly.
There are signs `dist/` was rebuilt at least once (the popup bundle is now `popup-nc7JNk9j.js`,
and the manifest gained the 3000 entries) **while `src/App.tsx` still says 5173**.

So whichever fix we choose, we must **`npm run build` and reload the extension**, otherwise
Chrome keeps running the old `dist/` bundle and nothing changes.

---

## 7. Recommendation

Go with **Option B** (support both ports). It fixes your machine, keeps the front-end
developer working, and matches what the manifest already does (it already lists all three
origins for the content script). Then rebuild `dist/` and reload the extension.

Let me know which option you want and I'll make the change.
