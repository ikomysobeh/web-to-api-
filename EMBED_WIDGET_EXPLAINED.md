# Embeddable Chat Widget — Explained Simply

**Purpose of this file:** the `iframe.md` your manager shared is a *technical build plan*.
This file explains the same thing in **plain words** so you understand WHAT he wants and
WHY, before you read the technical steps.

---

## 1. What does he want, in one sentence?

> A small **"chat bubble"** that you can paste into **any other website** with one line of
> code — and when a visitor clicks it, a chat window opens that talks to **our AI (Lumina)**.

You have seen this before on many websites: a round button in the bottom-right corner
(💬). You click it, a little chat box opens. Live-support tools like Intercom, Tawk.to,
and Zendesk all work this way. Your manager wants **our own version**, powered by our
existing AI backend.

---

## 2. The real-world picture

```
   ANOTHER COMPANY'S WEBSITE (a "dashboard")
   ┌─────────────────────────────────────────────┐
   │  Their normal page content...                │
   │                                               │
   │                                               │
   │                                  ┌─────────┐  │
   │                                  │  chat   │  │  ← our chat window
   │                                  │  window │  │     (opens on click)
   │                                  └─────────┘  │
   │                                       💬      │  ← our floating bubble
   └─────────────────────────────────────────────┘
```

They add **one line** of code to their site:
```html
<script src=".../embed.js" data-embed="emb_xxx" async></script>
```
That one line draws the bubble and loads our chat. Nothing else changes on their site.

---

## 3. The journey, step by step

### A. The admin (you) sets it up — once
1. Open a new admin page: **`/admin/embed`**.
2. Pick which **agent** answers (e.g. the "HR Assistant").
3. Choose the look: title, greeting text, color, position.
4. The system gives you a **code snippet** (one line). You copy it.

### B. The other website pastes the snippet — once
They paste that one line into their dashboard. Now the 💬 bubble appears on their site.

### C. A visitor uses it — every time
1. Visitor clicks the 💬 bubble.
2. A chat window opens (this is our app, shown *inside* their page).
3. Visitor types a question → our AI answers, streaming the reply word by word.

That's the whole feature. Everything in `iframe.md` exists to make these three steps
work **safely**.

---

## 4. The two hard problems (and why they exist)

Your manager wrote *"two facts drive the design."* Here is what those two facts mean.

### Problem 1 — "How does the chat know WHO the visitor is?"

Our AI backend needs to know the user is logged in. A logged-in user has a **token**
(think of it as a temporary ID card — the technical name is **JWT**).

The catch: the chat window runs **inside** the other website using an **iframe** (a "page
inside a page"). For security, browsers **forbid** an iframe from one company reading the
saved login of another company. This is called *storage partitioning* — it's a safety
rule, not a bug.

**Solution:** the small `embed.js` script (which DOES run as part of the host site) grabs
the token and **hands it** to the chat window through a safe browser channel called
`postMessage`. The iframe never "steals" it — it is **given** it.

```
host site  ──(reads token)──►  embed.js  ──(postMessage, safely)──►  chat iframe
```

### Problem 2 — "How does it connect to Gemini?"

Our AI uses a Google Gemini account. Gemini's login lives in special browser cookies
(`__Secure-1PSID`, etc.) that **websites are not allowed to read** — only a **browser
extension** can. We already built that extension; its `background.js` reads the cookies
and sends them to our backend.

**Solution:** the chat widget's **"Connect Gemini"** button does not try to read cookies
itself (impossible). Instead it **triggers our existing extension** to do it. If the
visitor doesn't have the extension installed, the widget shows a **"Download the
extension"** message.

> Your manager's note: *"Connect automatically without the extension is impossible."*
> That is correct and unavoidable — the browser blocks it on purpose.

---

## 5. What actually gets built (the 3 parts)

The plan touches our three projects. Here is each one in plain words.

### Part 1 — Backend (`webai-bridge`) — "the brain"
- A new **table** `embed_configs` = remembers each widget: which agent, which colors,
  which websites are allowed to use it.
- A new **secret key** per widget, like `emb_ab12cd34` — this identifies the widget.
- New **endpoints** (web addresses the widget calls):
  - create / list / edit / delete widgets (admin only)
  - one to **load** a widget's settings
  - one to **chat** — this is special: it lets the visitor chat **because they have a
    valid embed key**, even if they were never personally assigned to that agent.
    (Your manager calls this *"embed-granted"* — the widget *is* the permission.)

### Part 2 — Frontend (`web2api-ui`) — "what people see"
- A new **admin page** to create widgets and **copy the snippet** (with a live preview).
- A new **widget page** = the stripped-down chat that shows inside the iframe (no
  sidebar, no menus — just the chat).
- A new small file **`embed.js`** = the one-line loader that draws the bubble and the
  iframe on the host website, and hands over the token.

### Part 3 — Extension (`lumina-extension`) — "the Gemini key reader"
- Add a tiny marker so the widget can tell **"is the extension installed?"**
- Listen for the widget's *"please connect Gemini"* request and run the existing flow.
- The core cookie-reading code **does not change** — it already works.

---

## 6. The full flow on one diagram

```
                         (1) admin creates widget, copies snippet
   ADMIN ───────────────────────────────────────────────► /admin/embed page
                                                                  │
                                                            gives  │  emb_xxx + <script> line
                                                                  ▼
   DASHBOARD (other site) ── pastes the one-line snippet ──► shows 💬 bubble
        │
        │ (2) visitor clicks bubble
        ▼
   embed.js  ── opens iframe ──►  WIDGET CHAT (our app, inside their page)
        │                               │
        │ (3) hands token via postMessage
        └──────────────────────────────►│
                                         │ (4) loads widget settings  → GET /api/embeds/{key}
                                         │ (5) needs Gemini? ─► asks EXTENSION to connect
                                         │ (6) visitor sends message  → POST /api/embeds/{key}/chat
                                         ▼
                                   webai-bridge  ──►  Gemini  ──►  answer streams back
```

---

## 7. Glossary — the scary words made simple

| Word in the plan | What it really means |
|---|---|
| **iframe** | A web page shown *inside* another web page (a box). |
| **embed / embed.js** | The one-line code + small script that draws our bubble on someone else's site. |
| **embed key** (`emb_...`) | A secret ID for one widget. Identifies it and grants chat access. |
| **JWT / token** | The logged-in user's temporary ID card. Proves who they are. |
| **origin** | A website's address (e.g. `https://ai.lcportal.cloud`). The browser uses it to decide what is "same" vs "different" site. |
| **storage partitioning** | Browser safety rule: an iframe can't read another site's saved login. |
| **postMessage** | The safe, official way for two pages/iframes to pass data to each other. |
| **SSE / streaming** | The reply arrives **word by word** instead of all at once (what we already do in chat). |
| **Shadow DOM** | A way to keep our bubble's styling separate so it doesn't clash with the host site's CSS. |
| **CORS / `CORS_ORIGINS`** | Backend setting that says "these websites are allowed to call me." |
| **frame-ancestors (CSP)** | A rule that says "only these websites are allowed to put my page in an iframe." Stops strangers embedding us. |
| **allowed_domains** | Per-widget list of which websites may use that widget. |
| **embed-granted** | Permission to chat comes from holding a valid embed key — no per-user agent assignment needed. |
| **bootstrap** | The first call the widget makes to "load its settings" (title, color, agent). |

---

## 8. Why this is safe (so you can explain it back)

- The widget can only be used on **websites you list** (`allowed_domains` + `frame-ancestors`).
  A random site can't embed it.
- The visitor's login token is **handed over safely**, never stolen, and only to **our**
  origin (never `"*"`).
- The chat endpoint checks the **embed key** and the **request origin** on every message.
- Gemini cookies are still only ever read by the **extension** — the same trusted path we
  already use. Nothing new is exposed.

---

## 9. The short version to tell your manager

> "I understand it now. We're building a copy-paste chat bubble for other websites.
> The admin creates a widget, picks an agent, and copies one line of code. When a
> visitor clicks the bubble, our chat opens in an iframe. The host page's `embed.js`
> hands the login token to the iframe (because the browser won't let the iframe read it
> directly). The chat works through a new embed-key endpoint, and the 'Connect Gemini'
> button drives our existing extension. We restrict which websites can use each widget."

If you can say that paragraph, you understand the whole plan.

---

## 10. What to decide before building (questions for the manager)

1. **Which external dashboards** will embed this? We need their exact web addresses for
   `allowed_domains`, backend `CORS_ORIGINS`, and the iframe `frame-ancestors` rule.
2. **Login experience:** if a visitor is NOT already logged in on the host site, what
   should happen — show a "Sign in" popup, or assume they always have a token?
3. **Extension distribution:** will users install it from the Chrome Web Store, or do we
   give them a `.zip`? This decides what the "Download the extension" button links to.
4. **One agent per widget, or selectable?** The plan is one agent per widget — confirm
   that's enough.
