# AI Answer Shows Raw Tags (`<Sequence>`, `<Step>`) — Why & Fix (simple)

**Date:** 2026-07-01
**Status:** Explanation + plan. Confirm, then I build.

## What you're seeing
Sometimes the AI answer shows **raw code-like tags** instead of a nice layout:
```
<Sequence>
{/* Reason: ... */}
<Step subtitle="Safety First" title="Put on proper PPE">
...
</Step>
</Sequence>
```
Other times the same kind of answer looks fine. It's **inconsistent**.

## Why this happens (the key point)

There are **two separate things**:

1. **What the AI writes.** The AI is sometimes writing its answer using **special
   component tags** — `<Sequence>`, `<Step>`, and `{/* comments */}`. These are a
   programmer format (MDX/JSX), **not** normal text.

2. **What the chat can display.** Our chat window only understands **simple formatting** —
   bold, `code`, and code blocks. It does **not** understand `<Sequence>`/`<Step>`. So it
   just prints them **as raw text**, exactly as written.

```
AI writes  <Step title="...">   ──►   chat doesn't know this tag   ──►   shows it as text
AI writes  plain markdown        ──►   chat understands             ──►   looks correct
```

**Why inconsistent?** The AI decides on its own each time. Sometimes it uses the fancy
tags (looks broken), sometimes plain text (looks fine). Nothing forces it to be consistent.

So there are **two levers** to fix it — the AI side and the display side.

---

## The fix — 2 parts (do both for best result)

### Part A — Tell the AI to stop using those tags (the real source, easy)
The agent's **instructions** are what make it use `<Sequence>/<Step>`. We update the
agent's instructions to say, in plain terms:

> "Reply in **normal Markdown only** — use headings, **bold**, numbered lists, and
> bullet points. **Do NOT** use JSX/MDX or custom components like `<Sequence>` or
> `<Step>`, and do not write `{/* comments */}`."

- **Where:** Admin → open the agent → **Edit** → Instructions field. (No code needed.)
- **Effect:** the AI writes clean Markdown every time → consistent, readable answers.
- This is the **main fix** and you can do it yourself right now.

### Part B — Make the chat display robust (safety net, code)
Even after Part A, the AI might occasionally slip. So we make the chat window **handle it
gracefully** instead of dumping raw tags:

- **Upgrade the message renderer** to a proper Markdown renderer so it correctly shows
  headings (`##`), lists (`*`, `1.`), blockquotes (`>`), etc. — not just bold/code.
- **Clean unknown tags before displaying:** strip `{/* ... */}` comments and turn
  `<Step title="A" subtitle="B">…</Step>` into a normal titled list item, and drop
  wrappers like `<Sequence>`. So even if the AI uses them, the user sees tidy text, never
  raw code.

- **Where (code):** `web2api-ui/src/components/chat/ChatMessages.tsx` — the
  `MessageContent` part that currently only handles bold/code.

---

## Recommendation
- **Do Part A first** (edit the agent instructions) — it's free, instant, and fixes the
  cause. Test a few questions.
- **Then Part B** so the app is bulletproof for any agent/answer in the future.

## Files
| File | Change | Part |
|---|---|---|
| Agent **instructions** (via admin UI) | Add "plain Markdown only, no JSX/components" rule. | A |
| `web2api-ui/src/components/chat/ChatMessages.tsx` | Proper Markdown rendering + strip/convert unknown tags & comments. | B |
| (maybe) `package.json` | Add a small Markdown library (e.g. `react-markdown`) for Part B. | B |

---

## What you'll see after the fix
- The cleaning-steps answer shows as a clean numbered list with bold titles — no
  `<Step>` / `<Sequence>` / `{/* */}` anywhere.
- It looks the **same every time**, not random.

---

## Confirm before I build
1. **Part A**: do you want me to write the exact instruction wording for you to paste into
   the agent, or should I also check if there's a global/default instruction to change?
2. **Part B**: OK to add a small Markdown library (`react-markdown`) for proper rendering?
   Or keep it dependency-free and just clean/convert the tags with our own code?
