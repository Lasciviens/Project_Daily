---
paths:
  - "src/features/training/**"
  - "supabase/functions/hevy-*/**"
  - "supabase/functions/strava-*/**"
---
# Training rules

Background: `docs/features/training.md`.

- One source per concept: bodyweight `useBodyweightSeries`, next session `useNextTrainingSession`/`pickNextTrainingSession`, sessions per week `sessionsThisWeek`, est. 1RM `est1RM`, one coach context (`training/coach/`). Never a second formula for the same number.
- The progress engine (`progress-engine/`) is pure, versioned (`ALGORITHM_VERSION`) and runs once per page (`TrainingProgressProvider`). RPE is shown but never gates a decision.
- The coach snapshot line formats are a contract with `PT_SYSTEM_PROMPT` (`coach/coachFormat.ts`): change them together.
- A planned session's status comes only from `plan/sessionState.ts`; `training_skips` is written only by the two training APIs (`verify-training-session`).
- The database completes a planned session when its workout syncs (141): edge functions never close or delete training tasks.
- A session is never planned twice on one day without asking (`plan/planTwins.ts`); "Plan it" goes through `openPlanRoutine`.
- The current program is explicit (`current_program_routines`), never inferred from recency.
- Hevy payloads match the OpenAPI schema exactly: omit `rep_range` instead of sending null; no `folder_id` on PUT; omit empty body-measurement fields and merge with the stored day before writing (a partial save once wiped a day).
- A free-text limitation resolves through `muscleMap.resolveMovementPattern`; a `monitor` limitation never paints a muscle.
- The body map uses the fixed `BODY_MAP_COLORS` palette (it sits on a dark stage), not theme tokens.
- An exercise GIF override is keyed by `exercise_template_id`, never by title.
- Exercise pictures: Hevy's `thumbnail_url` first, the GIF as fallback and animated demo — one chooser, `chooseExerciseMedia` (owner, 14.10.2026).
- Every Hevy endpoint, field and trap is in `docs/integrations/hevy.md`: a Hevy change adds a dated entry to its Log. Hevy's create enums live in `hevyEnums.ts`, mirrored in `hevy-api` (`verify-hevy-api`).
- Personal records stay off every screen (owner's call); the engine may still use them as evidence.
