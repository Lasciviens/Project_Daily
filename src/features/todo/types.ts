export type TaskDomain    = 'personal' | 'work' | 'media'
export type TaskSection   = 'inbox' | 'today' | 'tomorrow' | 'this_week' | 'backlog'
export type TaskStatus    = 'open' | 'in_progress' | 'waiting' | 'done' | 'cancelled'
export type TaskPriority  = 'low' | 'medium' | 'high'
export type TaskSourceType = 'manual' | 'movie' | 'tv_series' | 'media' | 'calendar' | 'ai' | 'training_session' | 'project_item'

export interface Task {
  id:                       string
  user_id:                  string
  title:                    string
  description:              string | null
  domain:                   TaskDomain
  section:                  TaskSection
  status:                   TaskStatus
  priority:                 TaskPriority
  /** Opening edge of a window; due_date stays the sole deadline (migration 069). */
  start_date:               string | null
  due_date:                 string | null
  due_time:                 string | null
  waiting_for:              string | null
  is_focused:               boolean
  source_type:              TaskSourceType
  source_id:                string | null
  sort_order:               number
  google_task_id:           string | null
  google_calendar_event_id: string | null
  created_at:               string
  updated_at:               string

  // ── Google Tasks full-surface fields (migration 071) ──────────────────────
  /** Local subtask relationship — mirrors Google's `parent`, but Google's field is output-only (set via tasks.move), so this is the source of truth for our own writes; Google's echo is applied by apply_google_task_snapshot. */
  parent_task_id:           string | null
  /** Which Google Tasks list this task belongs to. NULL until tasklist sync runs (migration is additive — no backfill). */
  google_tasklist_id:       string | null
  /** Completion timestamp — Google's `completed` field had no local home before this migration. */
  completed_at:             string | null
  /** Google's own opaque lexicographic sibling-ordering string — never parsed/computed locally, only stored and echoed back on move(). */
  google_position:          string | null
  /** For future conditional-write (If-Match) use — NOT relied on for conflict detection today; Tasks-API-specific enforcement of If-Match is unverified against a live account (see CLAUDE.md). */
  google_etag:              string | null
  /** Google's own last-modified timestamp — the clock the conflict rule compares against google_local_edit_at. */
  google_updated_at:        string | null
  /** Deep link into the Google Tasks web UI ("Open in Google Tasks ↗"). */
  google_web_view_link:     string | null
  /** Read-only Google-populated links (e.g. a Gmail-to-Task attachment) — display only, never written by us. */
  google_links:             unknown[] | null
  /** Was completed when the Google list was last cleared (tasks.clear) — display metadata ONLY, never touches status (see migration 071 comment). */
  google_hidden:            boolean
  /** Real Google-side tombstone — true soft-cancels the local row (status='cancelled'), never a hard delete. */
  google_deleted:           boolean
  /** Bumped only by a real local edit to a Google-synced field — NOT the same clock as updated_at. */
  google_local_edit_at:     string | null
  /** ONE canonical flag for "should this task sync to Google Tasks" — true once the app opts a task in (replaces the old inline skipGoogleTasks check); false covers both a plain local-only task and one deliberately excluded because it's linked to a Google Calendar event instead. Never two opposite-sense booleans. */
  google_sync_enabled:      boolean
}

export interface CreateTaskInput {
  title:       string
  description?: string | null
  domain?:     TaskDomain
  section?:    TaskSection
  priority?:   TaskPriority
  start_date?: string | null
  due_date?:   string | null
  due_time?:   string | null
  source_type?: TaskSourceType
  source_id?:   string | null
  parent_task_id?:     string | null
  google_tasklist_id?:  string | null
  /** See Task.google_sync_enabled. Callers pass true when this task should sync to Google (token connected, not calendar-linked) — omit/false for a calendar-linked task or when Google isn't connected. */
  google_sync_enabled?: boolean
}

export interface UpdateTaskInput {
  title?:                    string
  description?:              string | null
  domain?:                   TaskDomain
  section?:                  TaskSection
  status?:                   TaskStatus
  priority?:                 TaskPriority
  start_date?:               string | null
  due_date?:                 string | null
  due_time?:                 string | null
  waiting_for?:              string | null
  is_focused?:               boolean
  google_task_id?:           string | null
  google_calendar_event_id?: string | null
  parent_task_id?:           string | null
  google_tasklist_id?:       string | null
  completed_at?:             string | null
}
