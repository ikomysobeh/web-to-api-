# Build Error: Unused Variables in TypeScript

## What happened

The Docker build failed at the `npm run build` step with **TypeScript error TS6133**.

```
src/components/admin/UsersPage.tsx(2,10): error TS6133: 'ChevronLeft' is declared but its value is never read.
src/components/admin/UsersPage.tsx(2,23): error TS6133: 'ChevronRight' is declared but its value is never read.
src/components/admin/UsersPage.tsx(9,16): error TS6133: 'setPage' is declared but its value is never read.
src/components/admin/UsersPage.tsx(15,18): error TS6133: 'lastPage' is declared but its value is never read.
src/components/admin/UsersPage.tsx(15,28): error TS6133: 'currentPage' is declared but its value is never read.
```

## Why TypeScript TS6133 is a build-breaking error

TypeScript has a setting called `noUnusedLocals` (and `noUnusedParameters`).
When this is `true` in `tsconfig.json`, **any variable or import that is declared but never used causes a compile error** — not just a warning.

In this project `tsconfig.json` has:
```json
"noUnusedLocals": true
```

This means:
- On your local machine, your editor may show an underline (warning style)
- But `tsc -b` (the build command) treats it as a **hard error** and exits with code 2
- Docker's `RUN npm run build` fails and the whole image build stops

## What was wrong in the file

| Line | Problem | Reason |
|------|---------|--------|
| `import { ChevronLeft, ChevronRight, ... }` | Both icons imported | Pagination buttons were planned but the `<` `>` UI was never added to the JSX |
| `const [page, setPage] = useState(1)` | `setPage` imported | The page state was set up for pagination but there are no "next/prev" buttons calling `setPage` yet |
| `const { total, lastPage, currentPage }` | `lastPage` and `currentPage` destructured | Same reason — variables ready for a pagination UI that doesn't exist yet |

## The fix

1. Removed `ChevronLeft` and `ChevronRight` from the import line
2. Changed `const [page, setPage]` → `const [page]` (keep `page` since it is passed to `loadUsers`)
3. Changed `const { total, lastPage, currentPage }` → `const { total }` (only `total` is used in the header text)

## How to avoid this in the future

When you plan a feature but don't build the full UI yet:

**Option A — Prefix with underscore** (tells TypeScript "I know, I'll use this later"):
```typescript
const [page, _setPage] = useState(1);
const { total, lastPage: _lastPage, currentPage: _currentPage } = usersPagination;
```

**Option B — Just don't import/destructure until you need it.**
Add the variable the moment you write the JSX that uses it, not before.

Option B is cleaner. Option A is useful if you are mid-feature and don't want to lose track of what you planned.

## Rule of thumb

> **"Import it when you use it, not when you plan to use it."**

The build in Docker is stricter than your local editor because `tsc` runs in full check mode.
Always run `npm run build` locally before pushing if you are unsure.
