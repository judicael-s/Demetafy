---
paths:
  - src/ui/**
---

# UI branding

### Primary CTAs use `.btn-brand` (full Instagram gradient), not `bg-accent`
- **Why:** brand identity is the IG gradient (decided 2026-05-22); `bg-accent` is now flat violet, reserved for non-button accents.
- **How:** when adding a prominent `rounded-lg` action button, apply `.btn-brand` + `text-accent-ink`. Small inline chips/progress/tabs/chat bubbles stay flat `bg-accent`.

### Keep the brand gradient in sync across its two homes
- **Why:** CSS gradients and SVG paint servers can't be shared, so the gradient is duplicated.
- **How:** if you retune stops, edit BOTH `--ig-gradient` in `app.css` AND the `<linearGradient>` in `Logo.tsx`.

### Flat accent is violet (`--color-accent`: `#962fbf` dark / `#7d2aa0` light) — never flat Instagram pink
- **Why:** pink was replaced 2026-05-22; reintroducing it breaks the palette.
- **How:** all `bg-accent`/`text-accent`/`border-accent`/focus-ring uses resolve through this one token in `app.css`.
