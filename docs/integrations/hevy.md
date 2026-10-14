# Hevy

Checked: 14.10.2026 against the published OpenAPI (https://api.hevyapp.com/docs/, the spec inside its
`swagger-ui-init.js`, version "0.0.1", 22 operations). **No live sample was read for the fields added on
14.10.2026**: a development session has no Hevy key, so `thumbnail_url`, user info, the workout count,
exercise history, the custom-exercise and folder writes are coded to the spec's types and checked where they
enter (the shared Hevy block's `clean…` helpers, hevy-api's `cleanHistoryEntry` / `cleanFolder`). The older
calls were live-tested when they were built (the body-measurement PUT, the workout and routine payloads —
`docs/features/training.md`).

Our log of Hevy's public API: every endpoint, what we send and read, and what bit us. How the features work:
`docs/features/training.md`; the payload rules: `.claude/rules/training.md`. The spec's own warning: the API is
"only available to Hevy Pro users" and "we make no guarantees that we won't completely change the structure or
abandon the project entirely".

## How we authenticate

- **API key** in the `api-key` request header (the spec's header parameter, typed `uuid`) — never in a URL,
  never logged (`scripts/verify-hevy-api.cjs` checks all four functions). The key is made at
  https://hevy.com/settings?developer (Hevy Pro only) and stored as the Edge Function secret **`HEVY_API_KEY`**
  (`docs/backend/environment.md`); `hevy-api`, `hevy-initial-sync`, `hevy-incremental-sync` and `hevy-sync`
  read it with `Deno.env.get('HEVY_API_KEY')` and fail closed without it.
- **Webhook** (not in the OpenAPI; set up in Hevy's developer settings): Hevy calls `hevy-sync` with
  `Authorization: Bearer <HEVY_WEBHOOK_SECRET>` and `{ "workoutId": "…" }`. `hevy-sync` is in
  `supabase/config.toml` with JWT verification off.
- **Who may call**: one Hevy account sits behind one key, so the browser-called functions (`hevy-api`,
  `hevy-initial-sync`, `hevy-incremental-sync`) check the caller with `auth.getUser` and then accept only
  **`HEVY_USER_ID`** (stricter than `isAppUser`; `verify-owner-lock` lists them as own-owner-check functions).
  `hevy-sync` writes as `HEVY_USER_ID`. The assistant's `create_hevy_routine` / `update_hevy_routine` forward to
  `hevy-api` with the owner's JWT (the update only after the Confirm card).

## Endpoints we call

20 of the 22 operations are called (one only through an action no screen uses yet); the two single-item GETs
that would add nothing are listed at the end.

| Endpoint | Called by | When | Limits |
|---|---|---|---|
| `GET /v1/workouts` (`page`, `pageSize`) | `hevy-initial-sync` `syncWorkouts`; `hevy-api` `sync_missing_workouts` | Import all; the Hevy card's **Fetch missing workouts** | pageSize ≤ 10 |
| `POST /v1/workouts` | `hevy-api` `create_workout` | Log a workout here (`LogHevyWorkoutModal`) | answers 201 `{ workout: [Workout] }` |
| `GET /v1/workouts/count` | `refreshHevyAccount` (shared block) in both syncs and `sync_missing_workouts` | after every Sync / Import all / missing pass | |
| `GET /v1/workouts/events` (`page`, `pageSize`, `since`) | `hevy-incremental-sync` | Sync | pageSize ≤ 10; newest first |
| `GET /v1/workouts/{workoutId}` | `hevy-sync` | each webhook call | |
| `PUT /v1/workouts/{workoutId}` | `hevy-api` `update_workout` | the action exists; no screen calls it today (workouts are edited in the Hevy app) | replaces the workout |
| `GET /v1/user/info` | `refreshHevyAccount` | after every Sync / Import all / missing pass | 404 "User not found" |
| `GET /v1/routines` (`page`, `pageSize`) | `hevy-initial-sync` `syncRoutines`; `hevy-incremental-sync` `refreshRoutines` (prunes routines Hevy no longer lists, only after a complete listing) | Import all; Sync | pageSize ≤ 10 |
| `POST /v1/routines` | `hevy-api` `create_routine` (also the assistant's `create_hevy_routine`) | New routine | 403 "Routine limit exceeded" |
| `PUT /v1/routines/{routineId}` | `hevy-api` `update_routine` (also the assistant's `update_hevy_routine`) | Edit routine | replaces the routine; no `folder_id` |
| `GET /v1/exercise_templates` (`page`, `pageSize`) | `syncAllExerciseTemplates` (shared block) in both syncs | Import all; **every Sync since 14.10.2026** (new custom exercises, pictures) | pageSize ≤ 100 |
| `POST /v1/exercise_templates` | `hevy-api` `create_exercise_template` | Training → Library → Exercises → **New exercise** | 403 `exceeds-custom-exercise-limit` |
| `GET /v1/exercise_templates/{exerciseTemplateId}` | `ensureExerciseTemplates` (shared block): `hevy-sync`, both syncs, `hevy-api` after a workout save and the missing pass; `create_exercise_template`'s read-back | a workout names a template not stored here; after creating one | 404 = skipped |
| `GET /v1/routine_folders` (`page`, `pageSize`) | `syncAllRoutineFolders` (shared block) in both syncs | Import all; Sync | pageSize ≤ 10, **every page** (since 14.10.2026) |
| `POST /v1/routine_folders` | `hevy-api` `create_routine_folder` | Training → Library → Routines → **New folder** | new folder goes to index 0 |
| `GET /v1/routine_folders/{folderId}` | `create_routine_folder`'s read-back | after creating one | |
| `GET /v1/exercise_history/{exerciseTemplateId}` (`start_date`) | `hevy-api` `exercise_history` | the exercise popup's **History from Hevy**, when opened (3 months / 1 year / All) | `start_date`/`end_date` optional, ISO date-time |
| `GET /v1/body_measurements` (`page`, `pageSize`) | `hevy-initial-sync`; `hevy-incremental-sync` `refreshBodyMeasurements` | Import all; Sync | pageSize ≤ 10; 404 "Page not found" |
| `POST /v1/body_measurements` | `hevy-api` `upsert_body_measurement` | only when the PUT answers 404 (no entry for that date) | 409 when the date exists; 201 empty body |
| `PUT /v1/body_measurements/{date}` | `hevy-api` `upsert_body_measurement` | saving a measurement (Health → Body) | overwrites every field; 200 empty body |

Not called, deliberately:

- `GET /v1/routines/{routineId}` — create and update already answer the routine (`{ routine }`), and Sync
  re-reads the whole list (which it needs anyway: routines have no event feed).
- `GET /v1/body_measurements/{date}` — the save merges with the stored day here, which every Sync refreshes
  from the full list; a second live read of one day hasn't been needed.

## Fields we read and write

| Field | Shape (spec) | Where it goes |
|---|---|---|
| Workout `id`, `title`, `routine_id`, `description`, `start_time`, `end_time`, `updated_at`, `created_at` | strings (`routine_id`, `description` nullable) | `hevy_workouts` (`updated_at` → `hevy_updated_at`, `created_at` → `hevy_created_at`) |
| Workout `exercises[]`: `index`, `title`, `notes`, `exercise_template_id`, `superset_id` | `superset_id` number \| null | `hevy_workout_exercises` (`supersets_id`; an older `supersets_id` key is still read) |
| Workout set: `index`, `type`, `weight_kg`, `reps`, `distance_meters`, `duration_seconds`, `rpe`, `custom_metric` | numbers \| null; `type` warmup / normal / failure / dropset | `hevy_sets` |
| Workout write (POST/PUT `{ workout }`): `title`, `description`, `start_time`, `end_time`, `is_private`, `exercises[{exercise_template_id, superset_id, notes, sets[{type, weight_kg, reps, distance_meters, duration_seconds, custom_metric, rpe}]}]` | rpe one of 6 … 10 in halves | `hevy-api` `sanitizeWorkoutBody` (a whitelist; anything else is a 400) |
| Event `type`, `workout` / `id` | `updated` embeds the full workout, `deleted` carries `id` | upsert / delete in `hevy_workouts` |
| Routine `id`, `title`, `folder_id`, `updated_at`, `created_at`, `notes` | `folder_id` number \| null; `notes` is not in the spec's Routine response — read when present, else NULL | `hevy_routines` |
| Routine exercise `index`, `title`, `rest_seconds`, `notes`, `exercise_template_id`, `superset_id`; set `index`, `type`, `weight_kg`, `reps`, `rep_range{start,end}`, `distance_meters`, `duration_seconds`, `custom_metric` | `rep_range` object | `hevy_routine_exercises`, `hevy_routine_sets` (`rep_range_start/end`) |
| Routine write (POST/PUT `{ routine }`): `title`, `folder_id` (POST only), `notes`, `exercises[{exercise_template_id, superset_id, rest_seconds, notes, sets[{type, weight_kg, reps, rep_range, distance_meters, duration_seconds, custom_metric}]}]` | | `routineForm.formToPayload`, `hevy-api` |
| ExerciseTemplate `id`, `title`, `type`, `primary_muscle_group`, `secondary_muscle_groups`, `is_custom` | strings, array of strings, boolean | `hevy_exercise_templates`, `hevy_exercise_template_muscles` |
| ExerciseTemplate **`thumbnail_url`** | string \| null ("URL of the exercise's thumbnail image, or null if the exercise has none") | `hevy_exercise_templates.thumbnail_url` (154): only an `http(s)` URL without spaces, ≤ 2,048 characters, else NULL (the column's CHECK says the same); shown first by `ExerciseThumb` |
| Create exercise (POST `{ exercise }`): `title`, `exercise_type`, `equipment_category`, `muscle_group`, `other_muscles` | enums `CustomExerciseType` (8), `EquipmentCategory` (9), `MuscleGroup` (20) | from the New exercise form (`hevyEnums.ts`; `hevy-api` checks the same lists) |
| Create exercise answer `id` | integer in the spec's example | read back with `GET /v1/exercise_templates/{id}` (as text) |
| RoutineFolder `id`, `title` | number, string | `hevy_routine_folders` |
| Create folder (POST `{ routine_folder: { title } }`) | | from the New folder form |
| UserInfo (`{ data: UserInfo }`) `username`, `weight_unit`, `distance_unit`, `is_pro` | `kg`\|`lbs`, `kilometers`\|`miles`, boolean | `hevy_account` (154); the Hevy card on Settings → Subscriptions ("@lasci · Hevy Pro · kg · km") |
| `workout_count` | integer | `hevy_account.hevy_workout_count` + `count_checked_at` |
| ExerciseHistoryEntry `workout_id`, `workout_title`, `workout_start_time`, `workout_end_time`, `exercise_template_id`, `weight_kg`, `reps`, `distance_meters`, `duration_seconds`, `rpe`, `custom_metric`, `set_type` | numbers nullable; `set_type` string | shown only (never stored): grouped by workout, date `DD.MM.YYYY`, each set with its type |
| BodyMeasurement `date`, `weight_kg`, `lean_mass_kg`, `fat_percent`, `neck_cm`, `shoulder_cm`, `chest_cm`, `left/right_bicep_cm`, `left/right_forearm_cm` | numbers \| null | `hevy_body_measurements` |
| BodyMeasurement circumferences — see the trap below | | `abdomen_cm`, `waist_cm`, `hips_cm`, `left/right_thigh_cm`, `left/right_calf_cm` |
| Paging `page_count` | integer | when to stop |

## Fields we deliberately don't use

- UserInfo `id`, `name`, `url`: the card shows the username; Hevy's own user id is not our user id, and
  nothing links to the public profile.
- ExerciseTemplate `equipment`: nothing filters by it; the demo-GIF matcher reads the equipment from the
  title's parentheses ("Bench Press (Barbell)"). It is sent on create (`equipment_category`).
- RoutineFolder `index`, `updated_at`, `created_at`: folders are listed by title here.
- DeletedWorkout `deleted_at`: the delete is applied when seen.
- ExerciseHistoryEntry `workout_end_time` is passed on but not shown; `exercise_template_id` is only used to
  drop an entry for another exercise.
- Paging `page` (an echo of the request).

## Traps

- **Page sizes.** `pageSize` is at most 10 everywhere except `exercise_templates` (100); more is a 400
  ("Invalid page size"). Every list is read page by page until `page_count` (`hevyListAll` in the shared block
  for templates and folders).
- **Routine folders were read as one page.** An old comment said the endpoint takes no `pageSize`; the spec
  pages it at 10, so an account with more than 10 folders never got the rest. Both syncs now read every page
  (14.10.2026).
- **Past the last page** `GET /v1/body_measurements` documents a 404 ("Page not found"); `hevyListAll` treats a
  404 after page 1 as the end of the list. A list in another shape stops the read and counts as incomplete —
  routines are only pruned after a complete listing.
- **The events `since` cursor.** `GET /v1/workouts/events?since=` lists updates and deletes since that moment,
  **newest first**. Two fixes on 14.10.2026: (1) a workout edited twice between syncs kept its *oldest*
  version (every event overwrote the previous one, and the oldest came last) — now the newest wins; (2) the
  cursor was stamped "now" after all the work, so an edit made in Hevy while a sync ran fell between the read
  and the stamp and was never read — now the cursor is the moment the read began (Import all: the moment the
  import began). Re-reading a few events next time is harmless: every upsert is idempotent.
- **PUT overwrites every field.** `PUT /v1/body_measurements/{date}`: "All fields are overwritten; omitted
  fields are set to null" — the save merges with the stored day first (a partial save once wiped a day).
  `PUT /v1/routines/{id}` replaces the whole exercise list; `PUT /v1/workouts/{id}` the whole workout.
- **409 on POST body_measurements** for a date that already has an entry: the save PUTs first and POSTs only
  when the PUT answers 404.
- **Null fields are a 400** on the body-measurement PUT ("Expected number, received null", live-verified):
  empty fields are omitted, never sent as null.
- **Empty bodies.** The body-measurement PUT (200, live-verified) and POST (201, the spec: "The response body is
  empty") answer nothing; `hevyRequest` parses tolerantly (empty or non-JSON → null).
- **Wrapped and bare shapes.** `POST /v1/workouts` answers `{ workout: [Workout] }` (a one-element array);
  `GET`/`PUT /v1/workouts/{id}` the Workout bare; routines `{ routine }`; `GET /v1/user/info` `{ data }`; an
  exercise template, a routine folder and a body measurement by id bare; history `{ exercise_history }`; the
  count `{ workout_count }`. `unwrapEntity` (hevy-api) accepts direct, `{ key: … }` and `{ key: [ … ] }`; the
  shared block's readers accept the bare and the wrapped form too.
- **Strict payloads** (each a real 400): `rep_range: null` ("must be of type object") — omit it; `folder_id` on
  a routine PUT ("not allowed"); `index`/`title`/`routine_id` in a workout or routine body.
- **The create enum is not the stored one.** POST `exercise_type` takes `bodyweight_assisted_reps`, while the
  library's templates say `bodyweight_assisted`, `bodyweight_weighted`, `floors_duration`, `steps_duration`
  (the spec's `ExerciseTemplate.type` is a free string). The form offers exactly the spec's 8.
- **A number for a text id.** `POST /v1/exercise_templates` answers `{ id }` with an integer in the spec's
  example, while template ids are text elsewhere ("D04AC939", a UUID). It is turned into text and read back by
  id; when that read fails, the exercise comes with the next Sync (the toast says so).
- **Custom exercises made in the Hevy app** used to reach the app only with Import all: a workout naming one
  showed an unknown exercise. The library is now re-read on every Sync, and a workout naming a template not
  stored here fetches it by id (the webhook too).
- **Body-measurement names — open question.** The spec's `BodyMeasurement` and `PutBodyMeasurement` name seven
  circumferences **without** `_cm` (`abdomen`, `waist`, `hips`, `left_thigh`, `right_thigh`, `left_calf`,
  `right_calf`), while the code reads and writes `abdomen_cm` … `right_calf_cm`. Not changed: the earlier live
  check covered the weight, not these seven. One live sample (`GET /v1/body_measurements`) settles it.
- **No delete anywhere.** The API cannot delete a workout, routine, folder, custom exercise or body measurement.
  Delete in the Hevy app: routines disappear here on the next Sync (pruned); workouts through the events feed;
  folders and custom exercises are not pruned.
- **Limits**: 403 on POST routines (routine limit) and POST exercise templates (custom exercise limit). No rate
  limit is documented; the spec asks for no requests at exactly xx:00 from hourly or daily jobs (ours are manual
  or the webhook).
- **The count check** compares `workout_count` with the workouts stored here that Hevy created up to the check
  (`hevy_created_at ≤ count_checked_at`), so a workout the webhook brought in afterwards is no mismatch.
  "Fetch missing workouts" reads every page of `GET /v1/workouts` and stores only what's missing; it deletes
  nothing and counts the stored workouts Hevy no longer lists.
- `superset_id` is the spec's name; an older `supersets_id` is still read. Routine responses carry no `rpe`
  (stored NULL) and, in the spec, no `notes`.
- Exercise history entries have no set index: sets are shown in the order Hevy sends them. Dates are sent in the
  spec's own format, whole seconds (`2024-01-01T00:00:00Z`).

## Log

### 14.10.2026 — the whole public API (migration 154)

- This page, checked against the published OpenAPI (22 operations). No live sample of the new fields.
- `GET /v1/user/info` and `GET /v1/workouts/count` after every Sync / Import all → `hevy_account`; the Hevy card
  shows "@username · Hevy Pro · kg · km" and, when the counts differ, "Hevy has N workouts, the app has M"
  with **Fetch missing workouts** (`hevy-api` `sync_missing_workouts`, every page of `GET /v1/workouts`).
- `thumbnail_url` stored on `hevy_exercise_templates`; exercise pictures show Hevy's first, the
  ExerciseGymGifsDB GIF stays the fallback and the animated demo in the new exercise popup.
- Sync re-reads the exercise library (100 per page); a workout naming a template not stored here fetches it
  with `GET /v1/exercise_templates/{id}` (webhook, both syncs, hevy-api).
- `GET /v1/exercise_history/{id}` → **History from Hevy** in the exercise popup.
- `POST /v1/exercise_templates` (+ read-back) → Exercises → New exercise; `POST /v1/routine_folders`
  (+ `GET /v1/routine_folders/{id}`) → Routines → New folder.
- Fixed: routine folders read past page 1; the events feed keeps a workout's newest edit; the events cursor is
  the moment reading began.

### 27.09.2026 — payloads checked

- Workout and routine write payloads checked against the published OpenAPI: `sanitizeWorkoutBody`'s whitelist,
  no `rep_range: null`, no `folder_id` on a routine PUT; no routine DELETE exists (a routine deleted in the Hevy
  app leaves on Sync).
