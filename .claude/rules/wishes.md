---
paths:
  - "src/features/wishes/**"
  - "src/shared/components/windowChips.tsx"
---
# Wishes rules

Background: `docs/features/wishes.md`.

- A wish has its own table (`wish_items`) — never a task or a shop row.
- A reminder period is never a deadline and never a visibility rule: nothing is late, nothing auto-closes. "Passed" is grey, never red.
- `promoted_task_id` is set only when a save produced a real task id.
- No generated `is_open` column (`CURRENT_DATE` is not immutable). End of February comes from `endOfMonth`, never a fixed `02-28`.
- `period_label` is stored with its season emoji; anything that adds its own emoji strips the first one.
- Resurfacing only adds (the link at the top of Daily's day list, the once-per-season push); it never filters a task query.
