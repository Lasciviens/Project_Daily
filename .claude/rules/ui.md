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
  - W5 Secondary detail lives in a hover/tap peek (`HoverPeek`, never a hover-only tooltip).
  - W6 At 402 / 1469 / 2450 px: no horizontal overflow; check with `scripts/audit-page-width.mjs`.
  - W7 PageBoard: one main track (≤ 56rem) + 0–3 side tracks of 24rem; steps on the page's own width at 60 / 100 / 128 rem; positions never depend on content; cards that must line up across tracks go in `rows` (a row's cards share top and bottom — column stacks line up only by luck).
- A page header with sections (tabs) keeps one size and the same lines in every section: `sectionsWidthRem` (the widest board), never the open section's own width; text that changes with the section or day goes in a `PageHeader steady` with a one-line subtitle — the tabs never move on a switch (owner, 31.10.2026). Not for a view switch that changes the board itself (Work's Board / List).
- The bar never reshapes, moves or resizes on a tab switch (owner, 03.11.2026): a control only some sections have goes in a `SteadySlot` (or under the bar), never `{tab === 'x' && …}` in the header; no width or label follows the open section (THEME §6.3). `verify-page-board` lists every page with a header switch.
- A layout that lowers main can start its wider steps `early` — as soon as its tracks fit — instead of leaving a side track's room empty until the page's next step (Training's Program; THEME §6.3).
- Nothing moves when data lands (owner, 07.11.2026; THEME §5): reserve only what every outcome shows — the owner's data decides how much room a part takes, and a skeleton taller than its content moves the page as much as a shorter one; after a visit, a part keeps the room it took last time (`KeepRoom`, `useRememberedFlag` / `useRememberedCount` in `useLayoutMemory`, cleared at sign-out); each part shows as its own reads land, never waiting for another part's (one order across reads — the day's list, a project card — waits for its own); a failed read is one compact line; a lazy tab's fallback is `SkeletonTab`; a label that changes on a switch has one width. Never hide content or add a delay to cover a shift. Check: `scripts/audit-cls.mjs --data seed,light,empty` on the harness (never worse than before; `--revisit` ≤ 0.1), `verify-layout-shift`.
- The font: Inter's Latin file is preloaded and `Inter Fallback` (Arial sized to Inter) stands in until it arrives, only for the characters Inter's files draw (THEME §3).
- Toasts: success, error, warning, info, loading and undo (THEME §10); a plain toast with the same text replaces the one on screen; toasts with Undo never merge.
- Compact first: check every UI change in the phone layout (402×874, and sideways 874×402) and look at it: keep it compact and use the space it has — no extra lines, nothing overlapping or squashed, nothing wrapping onto a line it doesn't need. No minimum button size. Hover-only actions get a touch fallback.
- No density setting (tried and rejected).
