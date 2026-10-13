---
paths:
  - "src/features/recipes/**"
  - "src/features/daily/**/*Water*"
  - "src/features/daily/**/*Nutrition*"
  - "src/features/health/goal/**"
  - "supabase/functions/food-search/**"
---
# Food rules

Background: `docs/features/food.md`.

- Totals are derived, never frozen: an eaten row equals what its source adds up to now (library item per 100 g × grams, recipe per serving × servings), past days included. Migration 106's triggers enforce it for every writer; custom rows and manual recipes keep their typed values.
- Planned rows are never added to the eaten total (the ring sums `eaten` only).
- Water is its own table (`water_log_entries`), never a food slot, never in the calorie ring.
- A non-weight unit ("2 pcs") contributes nothing per-100 g; every reader applies the same weight-unit gate. `foodUnits.ts` and migration 123's `food_unit_grams()` change together.
- Macro sanity (`macroSanity.ts`) only warns — never auto-corrects declared values.
- Pre-migration fallback: on `42703`/`PGRST204` retry once without the new column.
- Invalidate the real query keys (`qk`), not a guessed prefix — the day card once showed stale totals that way.
- AI recipe extraction (`parseRecipeText`, `parseRecipeFromUrl`, `estimateRecipeMacros`) is editor-only, never called from the chat panel; a recipe shared in chat is never a shop item.
- All goal coaching comes from one decision module (`health/goal/cutDecision.ts`) — Food, Health and the goal editor show its answer, never their own.
- `useDayTargets` uses `placeholderData`, never `initialData` (which skipped the real fetch).
