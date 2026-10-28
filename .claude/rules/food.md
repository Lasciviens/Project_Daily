---
paths:
  - "src/features/recipes/**"
  - "src/features/supplements/**"
  - "src/features/daily/**/*Water*"
  - "src/features/daily/**/*Nutrition*"
  - "src/features/daily/hooks/useDayTargets.ts"
  - "src/features/daily/hooks/useQuickMeals.ts"
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
- Today's "Last 7 / 14 / 28 days": every figure comes from the picked window (a fixed-window number made the switch look broken), and a half-logged day uses the goal report's `halfLoggedCutoff`, so Food and Health leave out the same days.
- A quick guess is an ordinary one-off diary line; "your recent guesses" are derived from past one-off lines — never a table of their own.
- Quick guess presets are the owner's rows (`quick_guess_items`, 152): a tap copies one into a one-off line, never a link, so editing a preset never rewrites the diary. `DEFAULT_GUESSES` and 152's seed change together (`verify-quick-guess` compares them).
- A preset's options (159) are asked before logging, and the log is still ONE one-off line titled with the picks ("Pizza (chicken) ×1½"). The table's CHECK `quick_guess_options_ok()` and the editor's `optionsProblem` change together (`verify-quick-guess` reads 159's limits); options read from the database or the AI go through `parseGuessOptions`.
- An AI guess is review-first: "Describe it" (`describeGuess`) and "Suggest options" (`suggestGuessOptions`) only fill a form, marked AI estimate / AI suggestion — the owner's own tap logs or saves, never the AI.
- A guessed diary line ("≈") is derived — a one-off line with kcal (`isGuessLine`) — never a stored flag.
- Carb and fat goals are the owner's own (`day_targets.carbs_g` / `fat_g`, 153, per phase in `day_target_profiles`) or, when empty, worked out by `cutDecision.dayMacroTargets` — never by a screen. Going over a worked-out one is neutral; only a goal the owner set is judged.
- `useDayTargets` uses `placeholderData`, never `initialData` (which skipped the real fetch).
- What a diary line is made of comes from one module (`foodIngredients.ts`): for a macro total only a from-ingredients recipe splits into its foods (scaled so they add up to the line); a typed-macro recipe stays one line. Ingredient usage counts the foods of every recipe, but never a row with neither a library link nor a weight (salt to taste). Today's total peeks and Insights' Most used ingredients both read it. A peek lists a food only when it is at least 0.1 g and 2 % of the total (the largest always); the rest folds into "+N smaller" — trace rows from split recipes read as unrelated foods.
- The day's totals sum each eaten line's exact values and round once (`eatenTotals`), so a Nutrition figure is its peek's exact total rounded.
- The logger and the recipe builder share one search and basket (`FoodSearchField`, `NewFoodForm`, `foodLogKit` rows, `foodBasket.ts`) — change it there, never fork a second copy.
- A popup that prefills from props during render starts its seed closed (`{ open: false }`): entity modals mount already open, and a seed equal to the props skipped the prefill (Edit recipe opened empty).
- Supplement schedules (160, `docs/features/supplements.md`): a dose is taken while its eaten diary line exists (`supplement_schedule_id` + `dose_time`) — never a stored flag; a line or skip at a time the schedule no longer has goes to that day's open doses in time order (`resolveDay`), so changing times never un-takes a day. Take is `supplement_take` (web and phone), one line per dose. Doses are not tasks and never reach Google.
- The dose rules exist twice on purpose: `supplements/supplementDoses.ts` and 160's SQL (`supplement_schedule_on`, `supplement_doses`, `supplement_doses_due`) — change them together (`verify-db-supplement-schedules` compares them). A schedule repeats through 146's columns and `recurrence.ts`, never a rule of its own.
- A supplement's stock left is derived (count − dose × doses taken since the count), never stored.
- An amount is typed in one control, `AmountField` over the pure `foodAmount.ts` (a food's g / ml and preset; a recipe's portion word, % of batch, g raw, g cooked): what is stored stays grams / ml or servings — a unit is only how it is typed and read. Never a second amount picker.
- Leftovers are derived, never stored: a batch's servings − the servings of that recipe eaten since `batch_started_at` (157), on its day or later (`batchState`); a batch ends when eaten up or after `BATCH_DAYS`. A batch starts only through `start_recipe_batch` (the server's now()) — never a time from the device, whose clock can run ahead of `created_at`.
- A taken supplement dose's diary line (`supplement_schedule_id`) never moves day or slot (Edit entry hides Meal / Day / In for it) and is never copied by Same as yesterday; it never joins a dish ("In" leaves it out), and a dish's move, Edit meal and Copy to leave it where it is (28.10.2026).
- A dish is the rows sharing `meal_group_id`; its name is `meal_group_title` on every row (158's trigger keeps them agreeing). Rows are grouped into dishes only by `foodDish.groupDishes` (a group of one is a plain row; a name never carries an amount). A dish lives in one meal of one day: moving one of its rows elsewhere takes it out of the dish.
- Every move, copy, ungroup and rename of a dish, "Move out of meal" and Edit entry's Save say what they did with Undo (`useMealGroups`, `useSaveFoodEntry`); a one-tap log keeps the logger open and says so with Undo (`useLogWithUndo`).
- Planning is the logger's plan mode (`FoodLogModal` `plan`, `usePlanWithUndo`): a planned row is the logged row's shape as `status: 'planned'` (`mealPlanRows.plannedRow`) — a food or recipe stores no totals (live, `plannedKcal`), a one-off line keeps what was typed. Never a second food picker for planning.
- Food's colours mean one thing: over the calorie target is danger, over the protein target success; a macro's colour only on that macro (a count bar is neutral). Grams are written "42 g" (a space) and an empty cell "–".
