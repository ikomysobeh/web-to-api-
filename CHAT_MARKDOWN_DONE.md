# Chat Formatting Fix (Part B) — Done & Explained

**Date:** 2026-07-01
**Status:** ✅ Built and passing. Frontend only — no backend change.

## The problem this solves
The AI sometimes replied with raw code-like tags — `<Sequence>`, `<Step>`,
`{/* comments */}` — that showed as ugly text instead of a clean layout. And the old chat
renderer only understood **bold**, `code`, and code blocks — not headings, lists, or
quotes. So many answers looked wrong or inconsistent.

## What was built

### 1. A proper Markdown renderer
We replaced the small hand-written formatter with the standard **`react-markdown`** library
(plus **`remark-gfm`** for tables, strikethrough, etc.). The chat now correctly renders:
- `# / ## / ###` headings
- `- ` and `1. ` lists (bulleted & numbered)
- `> ` blockquotes
- tables, links, **bold**, *italic*, `inline code`, and ```code blocks```

### 2. A cleanup step (safety net) for weird tags
Before rendering, every answer passes through `cleanMdxTags()`:
- **Removes** `{/* ... */}` comments.
- **Converts** `<Step title="A" subtitle="B">body</Step>` → a bold titled block
  (`**A** — _B_` then the body).
- **Removes** wrapper/component tags like `<Sequence>` (any `<CapitalizedTag>`).
- **Leaves real code blocks untouched** — the cleanup runs only *outside* ```code fences```,
  so genuine code samples (even ones containing tags) are never altered.

So even if the AI uses those components again, the user sees tidy text — never raw tags.

## Files changed / added
| File | Change |
|---|---|
| `web2api-ui/src/lib/markdown.ts` | **New** — `cleanMdxTags()` sanitizer (strips comments/tags, converts `<Step>`, skips code fences). |
| `web2api-ui/src/components/chat/MarkdownMessage.tsx` | **New** — renders Markdown via `react-markdown` + `remark-gfm`, with styled headings/lists/quotes/code/tables. Text color **inherits**, so it works on the dark chat and the light widget. |
| `web2api-ui/src/components/chat/ChatMessages.tsx` | Removed the old hand-written `InlineText`/`MessageContent`; now uses `<MarkdownMessage>`. |
| `web2api-ui/src/components/widget/WidgetChat.tsx` | Assistant messages now render with `<MarkdownMessage>` too (so the embed widget formats correctly as well). |
| `package.json` | Added `react-markdown` and `remark-gfm`. |

## How it behaves now

**Before:**
```
<Sequence>
<Step subtitle="Safety First" title="Put on proper PPE">
Wash your hands and put on PPE...
</Step>
</Sequence>
```

**After:**
> **Put on proper PPE** — *Safety First*
> Wash your hands and put on PPE...

…and normal answers (headings, numbered steps, bullet points, tables) all render cleanly
and **look the same every time**.

## Note about Part A (still recommended)
Part B makes the display bulletproof, but it's still best to also do **Part A**: tell the
agent, in its **Instructions**, to reply in plain Markdown and avoid `<Sequence>/<Step>`
components. That keeps answers clean at the source. Suggested wording to paste into the
agent's Instructions:

> "Reply in normal Markdown only — use headings, **bold**, and numbered/bulleted lists. Do
> NOT use JSX/MDX or custom components such as `<Sequence>` or `<Step>`, and do not include
> `{/* comments */}`."

## How to test
1. Rebuild/reload the frontend (`docker compose up -d --build frontend`, hard-refresh).
2. Ask the agent the cleaning-steps question again → it should render as a clean list with
   bold titles, no `<Step>`/`<Sequence>`/comment text.
3. Try a question that returns a table or numbered list → renders properly.
4. Open the embed widget and ask something → same clean formatting.

## Minor note
The JS bundle grew (~50 KB gzip) because of the Markdown library — a harmless build
warning about chunk size. If you ever want it smaller we can lazy-load it, but it's fine.
