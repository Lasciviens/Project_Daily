---
paths:
  - "src/**/*.tsx"
  - "src/shared/ui/**"
  - "tailwind.config.js"
---
# UI rules

The full guide is `docs/design/THEME.md` — read the section you need before a UI change, and extend it in the same change when something new comes up.

- Layout width (THEME §6.6):
  - W1 Anything placed by PageBoard sizes itself on its own width (`@container`), never the viewport's `sm:`/`lg:`.
  - W2 Collections flow into content-width columns: `repeat(auto-fill, minmax(MIN, MAX))`; one content row never wider than 40rem; items of different heights are dealt into column stacks, not a row grid.
  - W3 Controls are content-sized: text inputs ≤ `max-w-md`.
  - W4 Charts keep their aspect ratio and a role-based cap (`max-w-2xl` / `max-w-4xl`).
  - W5 Secondary detail lives in a hover/tap peek.
  - W6 At 402 / 1469 / 2450 px: no horizontal overflow; check with `scripts/audit-page-width.mjs`.
  - W7 PageBoard: one main track (≤ 56rem) + 0–3 side tracks of 24rem; steps on the page's own width at 60 / 100 / 128 rem; positions never depend on content; cards that must line up across tracks go in `rows` (a row's cards share top and bottom — column stacks line up only by luck).
- Toasts: success, error, warning, info, loading and undo (THEME §10); a plain toast with the same text replaces the one on screen; toasts with Undo never merge.
- Compact first: check every UI change in the phone layout (402×874, and sideways 874×402) and look at it: keep it compact and use the space it has — no extra lines, nothing overlapping or squashed, nothing wrapping onto a line it doesn't need. No minimum button size. Hover-only actions get a touch fallback.
- No density setting (tried and rejected).
