---
paths:
  - "src/ui/**"
---

# UI rendering

### Guard `rows[virtualIndex]` in virtualized lists — never assert non-null
- **Why:** a search/filter that shrinks the list leaves `getVirtualItems()` returning stale out-of-range indices for one tick → `rows[i]` is `undefined` → crash `cannot read properties of undefined (reading 'msg')`. Hit in `Thread.tsx` conversation search, 2026-06-14.
- **How:** when rendering `@tanstack/solid-virtual` items, wrap the row in `<Show when={rows()[i]}>` (drop the `!`); the virtualizer reclamps to a valid range next frame.
