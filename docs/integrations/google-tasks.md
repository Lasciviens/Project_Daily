# Google Tasks

Checked: 13.10.2026 against Google's reference (developers.google.com/workspace/tasks/reference/rest — the `tasks` and `tasklists` resources and their methods). No live sample: there are no credentials in a development session.

How the sync works in the app (outbox, cron, background run, Sync now): `docs/features/planning-calendar.md` → Google Tasks sync.

## How we authenticate

- One Google sign-in for Calendar and Tasks: `GOOGLE_SCOPES` in `src/features/calendar/googleScopes.ts` asks for `https://www.googleapis.com/auth/tasks` (read and write) next to the two Calendar scopes. Google's consent screen lets the person untick Tasks: every Tasks call then answers 403 `insufficientPermissions` / `ACCESS_TOKEN_SCOPE_INSUFFICIENT`, which the app shows as "Google Tasks access was not granted: reconnect Google … and allow Tasks".
- `calendar-oauth` stores the refresh token in `user_calendar_tokens` (service role only). The browser gets short-lived access tokens from `calendar-token` (`ensureValidCalendarToken()` refreshes one that is past its hour); `google-tasks-sync` refreshes its own.
- The cron calls `google-tasks-sync` with `x-sync-secret` = `GOOGLE_TASKS_SYNC_SECRET` (Vault for the cron job, Edge Function secret for the function) and acts as `HEVY_USER_ID`; the app calls it with the user's JWT (`isAppUser` owner check).
- The Google Cloud project behind `GOOGLE_CLIENT_ID` must have the **Google Tasks API** turned on (403 `accessNotConfigured` / `SERVICE_DISABLED` otherwise) and its consent screen published to **Production** (in Testing a refresh token dies after 7 days: `invalid_grant`).

## Endpoints we call

Base `https://www.googleapis.com/tasks/v1`, token in the `Authorization` header.

| Endpoint | Called by | When | Limits |
|---|---|---|---|
| `GET /users/@me/lists` (`maxResults=100`, `pageToken`) | `google-tasks-sync` | every run | 2,000 lists per user; page max 1,000 |
| `GET /users/@me/lists/@default` | `google-tasks-sync` | every run (which list is the default — the resource has no flag) | |
| `POST /users/@me/lists`, `PATCH /users/@me/lists/{id}`, `DELETE /users/@me/lists/{id}` | browser (`googleTaskListsApi.ts`) | Lists sheet; a new list name typed in the plan editor | title ≤ 1,024 chars |
| `GET /lists/{list}/tasks` (`showCompleted`, `showHidden`, `showDeleted` = true, `maxResults=100`, `pageToken`, `updatedMin` when incremental) | `google-tasks-sync` | every run; full once a day / Sync now / a new list | 20,000 non-hidden tasks per list, 100,000 per user; page max 100 |
| `GET /lists/{list}/tasks/{id}` | both outbox drains | before a move (skip a move already done) | |
| `POST /lists/{list}/tasks` (`parent`) | both outbox drains | a task created or reopened here | |
| `PATCH /lists/{list}/tasks/{id}` | both outbox drains | title, notes, due; status done/reopened | |
| `POST /lists/{list}/tasks/{id}/move` (`parent`, `destinationTasklist`) | both outbox drains | parent or list changed here | 2,000 subtasks per task; recurring tasks can't change list |
| `DELETE /lists/{list}/tasks/{id}` | both outbox drains | deleted, cancelled or opted out here | |

The outbox is drained by the browser right after a save (`googleTasksOutbox.ts`) and by the cron (`google-tasks-sync`); the pull (Google → app) runs only in `google-tasks-sync`.

## Fields we read and write

| Field | Shape (Google's reference) | Where it goes |
|---|---|---|
| `id` | string | `tasks.google_task_id` (unique per user) |
| `title` | string ≤ 1,024 | `tasks.title` both ways; a task without one is imported with `''` |
| `notes` | string ≤ 8,192 | `tasks.description` both ways |
| `status` | `needsAction` \| `completed` | `done` ↔ `completed`; open/in progress/waiting all ↔ `needsAction`; `cancelled` = deleted on Google |
| `due` | RFC 3339; "only date information is recorded; the time portion … is discarded" | `tasks.due_date`: read the date part, write `YYYY-MM-DDT00:00:00.000Z` (`googleTasksRules.ts`). `due_time` never reaches Google |
| `completed` | RFC 3339, omitted while open | `tasks.completed_at` for a task completed on Google; a task already done here keeps its own time (145) |
| `deleted` | boolean | `tasks.google_deleted`; true cancels the task here; false again (restored on Google) reopens it (145) |
| `hidden` | boolean, read-only (completed when the list was cleared, or completed in Google's own apps) | `tasks.google_hidden`; never changes status; a hidden task we never saw is not imported |
| `parent` | string, read-only (set with `move`) | `tasks.parent_task_id` (resolved through the linked-id map) |
| `position` | string, read-only | `tasks.google_position` (stored, not used for order) |
| `links[]` | `{ type, description, link }`, read-only | `tasks.google_links` (145); shown as "Open email" / "Open link" on the task row |
| `webViewLink` | string, read-only | `tasks.google_web_view_link`; "Open in Google Tasks" on the task row |
| `updated` | RFC 3339, read-only | `tasks.google_updated_at` |
| `etag` | string | `tasks.google_etag` (stored, not sent) |
| TaskList `id`, `title`, `etag`, `updated` | | `google_task_lists` |

## Feature comparison (13.10.2026)

| Feature | Google | Us | Gap |
|---|---|---|---|
| Lists: list, create, rename, delete | yes | yes (Lists sheet, plan editor) | — |
| Several lists with one name | yes | yes since 145 (076's unique index refused them and broke the pull) | the pickers show both with the same name |
| Tasks: create, edit title/notes/due, complete, reopen, delete | yes | yes, through the outbox | — |
| Due date | date only | date only | a task's time (`due_time`) stays in the app |
| Subtasks (`parent`, `move`) | one level, 2,000 per task | yes | — |
| Manual order (`position`, `previous` on insert/move) | yes | stored, not used | **order isn't mirrored** — the app sorts by its own `sort_order`; a new task lands first among its siblings on Google |
| Move between lists (`destinationTasklist`) | yes (not for recurring tasks) | yes ("Move to list…") | a recurring Google task can't move: its outbox row keeps failing |
| Completed / hidden / deleted in reads | `showCompleted`/`showHidden`/`showDeleted` | all three | — |
| Incremental reads (`updatedMin`) | yes | yes, plus a full read once a day | — |
| Clear completed (`tasks.clear`) | yes | no | small; not asked for |
| Links (`links[]`, Gmail) | read-only | shown since 145 | — |
| Open in Google Tasks (`webViewLink`) | read-only | yes | — |
| Assigned tasks (Docs / Chat, `showAssigned`, `assignmentInfo`) | read-only-ish: no notes, can't be parents, deleting one deletes it in Docs/Chat | **not read** | importing them needs a read-only marker in `tasks` so the app never edits, nests or deletes them — owner decision |
| Repeating tasks | made in Google's apps; the API has no recurrence field | read as single tasks | the app can't create or see the repeat rule |
| Conditional writes (`etag` / If-Match) | ETags exist | not used | a Google-side edit between our read and our PATCH is overwritten (local edit wins while an outbox row waits) |
| Push notifications / webhooks | none (polling only) | cron every 20 min + app open/resume | — |
| Scope `tasks.readonly` | yes | no (we write) | — |

## Fields we deliberately don't use

- `selfLink`, `kind`: nothing to do with them.
- `assignmentInfo` and `showAssigned`: see the table — writing to an assigned task can fail (no notes allowed) or delete it in Docs/Chat, so they stay out until the app can hold them read-only.
- `completed` on writes: Google stamps it when a task is marked completed; sending our own time was not checked against a live account.
- `dueMin`/`dueMax`/`completedMin`/`completedMax`: the pull mirrors everything; filtering would hide changes.

## Traps

- `due` is a date in a timestamp's clothes. Converting it to a local time read the day before west of UTC; writing "local noon" became the next day east of UTC+12.
- Tasks completed in Google's own apps come back only with `showHidden=true`.
- Google allows duplicate list names — the mirror must too (076 → 145).
- `parent` and `position` are read-only on insert/patch: only `insert`'s query parameters and `move` set them.
- A deleted task stays readable as a tombstone (`deleted: true`) for a while; re-reading it must not change a task that is already cancelled.
- Error bodies: `{ error: { code, message, errors: [{ reason }], details: [{ reason }] } }` — classify by status and reason (`googleTasksFailureKind`), never by the message text.
- `tasks.insert` takes no client id: a create whose answer is lost can't be retried safely — the outbox checkpoints the created task in its own row (079).
