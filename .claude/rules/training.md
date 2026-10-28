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
- A skip with a task covers only that session; a routine-week skip (no task) covers a weekly day with no task only before today (`skipForPlan`). A skip whose week is over (`weekIsOver`) offers Move, never Undo skip — the hourly job would skip it again.
- The database completes a planned session when its workout syncs (141): edge functions never close or delete training tasks.
- A training plan's day is a task on its day (156, no block): every training action splits it the 142 way first (`ensurePlanTask` → `item_occurrence`, the same task, keeping the view's routine) so the block-reading views see it; its routine is matched the app's way in SQL too (`repeat_day_routine` mirrors `matchRoutineToPlan` — change them together); a day closed as missed (`closed_reason 'missed'`) is read as a past open plan (`taskMissed`), never a skip — every view passes it (`calendarSessions.planTaskOf`); a weekly day is read with its day's task (`buildPlansByDate`'s `dayTasks`).
- A moved session is moved (166): a training task whose day changes is checked again in the database (`trg_training_task_recheck` → `training_task_recheck`: a workout that no longer fits is unlinked — the session it closed is to do again, a hand tick stays done; a workout of its OWN routine on its new day completes it; a missed day moved to today or later is to do; a repeat's day moved without its slot is split) — never a client-side relink.
- A workout represents itself (167): it completes only its own routine's session — a stand-in only where a routine is missing (the workout's or the session's), in the database and in the calendar's pairing. A session's week is its first day (`tasks.first_plan_date`, never moved) and the next six: a workout counts only inside it; skipped then done inside it → done; skipped and moved to today or later inside it → to do; moved 7+ days after its first day → skipped there and that week's session of the same plan moves instead (`training_move_past_week`); not done by its week's end → skipped on its first day ("Not done within 7 days", `training_weeks_close` in the hourly job). Never a second implementation in the browser — the Move popup only says it (`movesPastWeek`).
- A session is never planned twice on one day without asking (`plan/planTwins.ts`); "Plan it" goes through `openPlanRoutine`.
- The current program is explicit (`current_program_routines`), never inferred from recency.
- Hevy payloads match the OpenAPI schema exactly: omit `rep_range` instead of sending null; no `folder_id` on PUT; omit empty body-measurement fields and merge with the stored day before writing (a partial save once wiped a day).
- A free-text limitation resolves through `muscleMap.resolveMovementPattern`; a `monitor` limitation never paints a muscle.
- The body map uses the fixed `BODY_MAP_COLORS` palette (it sits on a dark stage), not theme tokens.
- An exercise GIF override is keyed by `exercise_template_id`, never by title.
- Exercise pictures: thumbnails show Hevy's `thumbnail_url` first, the GIF as fallback — one chooser, `chooseExerciseMedia` (owner, 14.10.2026). The exercise popup puts the GIF big on top and Hevy's still small below ("Picture from Hevy"); no GIF → Hevy's still on top. Reduce Motion: no autoplay — Hevy's still (or only the caption) on top with "Play animation", not repeated below. One chooser, `chooseExercisePopupPictures` (owner, 25.10.2026).
- Every Hevy endpoint, field and trap is in `docs/integrations/hevy.md`: a Hevy change adds a dated entry to its Log. Hevy's create enums live in `hevyEnums.ts`, mirrored in `hevy-api` (`verify-hevy-api`).
- Personal records stay off every screen (owner's call); the engine may still use them as evidence.
