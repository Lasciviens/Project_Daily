// ═════════════════════════════════════════════════════════════════════════════
//  UnifiedPlanModal — the Add sheet: the one place an item is added and edited.
//
//  ┌─ RULES (read before editing) ─────────────────────────────────────────────┐
//  │ 1. ONE CHROME. Rendered inside ModalShell (THEME.md §8) — stacking, Back,   │
//  │    Esc and the phone sheet come from there. Never hand-roll a Dialog here.  │
//  │ 2. CONFIG-DRIVEN. Callers shape the sheet from THEIR file via `config`,      │
//  │    `defaults`, `source`, `onSaved`. A per-caller variation is a hide key or │
//  │    a default, never a fork of this folder.                                   │
//  │ 3. SINGLE SOURCE OF TRUTH. All mutable state lives in `form` (planForm.ts).  │
//  │ 4. ONE FORM, ONE SAVE. ItemForm.tsx is the only form (title, date, time,    │
//  │    length, repeat, Google, + rows); every save is ONE useSaveItem call      │
//  │    (the items contract, migration 155) and every delete one useSheetDelete │
//  │    run. No table-by-table writes here.                                       │
//  │ 5. NO TABS, NO MODES TO PICK. A task, its slot and its repeat are parts of  │
//  │    one item. `mode` only says what a NEW item starts with; an edit reads    │
//  │    its rows (sheetRules.itemFromRows).                                       │
//  │ 6. LOG EVERY LOGIC CHANGE in the CHANGELOG below (date · what · why).        │
//  └─────────────────────────────────────────────────────────────────────────────┘
//
//  CHANGELOG
//  2026-10-15 · v21.1 · A repeat's day opened from its task (Home's list, the
//                    Tasks tab) opens as that day of its repeat with This day
//                    picked (`startScope`, PlanEntityModals.useRepeatDayOf) —
//                    as a plain task, a Repeat added there made a second
//                    repeat (156 review). "Only <day>" deletes the day's task
//                    when it has one (ticked, skipped, missed: useDeleteItem),
//                    with its own Undo.
//  2026-10-16 · v21.2 · The category is back on the facts line (it was dropped
//                    in v19): a timed or repeating item shows it as a value
//                    menu (`CategoryFact`); a training session hides it
//                    (`hideScheduleFields: ['category']`).
//  2026-10-15 · v21 · A repeat's day is a real task on its day (migration 156,
//                    owner: "a repeated task should be created on its day"):
//                    the Google chip offers "Google Tasks · one per day" and
//                    Both for a repeat (itemRules.googleTargetProblem,
//                    sheetRules.googleChoices); a day's task saved from here is
//                    that day of its repeat ("This day"). Ticking a day no
//                    longer splits it off the series; skip and move still do.
//  2026-10-15 · v20.1 · Look only (owner: "more polite, not big and clunky"):
//                    ModalShell's compact chrome, This day | All days in the
//                    header, Cancel quiet beside a content-sized Save, the
//                    skeleton follows the lighter form. No logic changed.
//  2026-10-15 · v20 · The data layer behind v19 (migration 155):
//                    (a) useSaveItem is real: one RPC (app_save_item, one
//                    transaction, one Activity Undo), then the Google side in
//                    the background (calendar/api/itemCalendar.ts). Moving an
//                    item between Google Tasks and Calendar makes the new
//                    copy first, confirms it, and only then removes the old
//                    one; an 'unknown' answer removes nothing.
//                    (b) The deadline is the task's due_date/due_time and the
//                    item's own day and time live on its slot (sheetRules'
//                    reading, now itemRules.itemFromRows — the ONE copy; a
//                    due TIME other than the slot's is a deadline too). An
//                    item with a day and a deadline always has a slot; a
//                    training session never gets a deadline (142).
//                    (c) The sheet's extras are saved: category and colour,
//                    the window's start, the slot's own source (a TV episode
//                    with its numbers).
//                    (d) Delete is useDeleteItem (useSheetDelete adapts the
//                    call): "Only 15.10.2026" takes the day out of the
//                    repeat (app_repeat_day 'remove'), no longer a skipped
//                    day; its Undo puts it back. A day that is its own item
//                    goes like an item (the day stays out of the repeat).
//  2026-10-15 · v19 · One item (owner, 15.10.2026: "one thing to add, the same
//                    sheet edits"; migration 155, the items contract):
//                    (a) The Task / Schedule / Recurring editors are one form
//                    (ItemForm.tsx): a title, then chips — the date (with
//                    Today / Tomorrow / No date; "Starts" for a repeat),
//                    "+ Time", "+ Blocks time" (shows only once there is a
//                    time: a time without a length doesn't block), "+ Repeat"
//                    (the planner's repeat line; a repeat may have no time),
//                    the Google chip, and "+ Notes / + Priority / + Deadline /
//                    + Area / + Google list" behind taps. TaskTab, ScheduleTab
//                    and RecurringTab are gone, and with them "Add to
//                    schedule", "Also add to Tasks" and the Section pills —
//                    the section follows the date (no date → Inbox, today →
//                    Today, another day → Backlog: sheetRules.sectionForItem).
//                    A new item's date defaults to today (the caller's day),
//                    so it still lands in Today (the section.eq.today readers).
//                    (b) Google: the chip shows the actual target, never
//                    "Auto": a time or a repeat → Google Calendar (busy with
//                    a length, free without, all day with no time), no time →
//                    Google Tasks; Tasks and Calendar only when picked, with
//                    "Shows twice in Google Calendar"; Google Tasks is
//                    disabled for a repeat ("Google Tasks can't repeat"). A
//                    saved row from before 155 opens with where it is now
//                    (its Calendar event / Google Task); one that sits where
//                    the default puts it keeps following the default. No
//                    Google connection on this device: no chip; a new item
//                    saves 'none', an edit keeps what it had.
//                    (c) Every save is one useSaveItem call (one RPC, one
//                    Activity Undo) that reports its result; the sheet no
//                    longer writes tasks, blocks, plans, Calendar links or
//                    the Google Tasks dedupe itself (v8–v17's ordering rules
//                    move into the data layer with the save). The Google
//                    Tasks list name still resolves here, through
//                    ensureValidCalendarToken (v15 f).
//                    (d) The four useEntityModal kinds (task, time-block,
//                    schedule-block, plan-block) open this same sheet;
//                    PlanEntityModals loads the item's rows by id — a task
//                    with its slot (no more hydrate-after-open: a failed read
//                    shows Try again instead of a toast and a stuck Save), a
//                    block with its task, a repeat — and a training session
//                    keeps its own delete and hides the deadline (its day is
//                    the session's, 142).
//                    (e) A repeating item opened on one of its days
//                    (`occurrenceDate`) offers This day | All days; This day
//                    saves scope 'day' (that day becomes a one-off, the 142
//                    path). Delete asks "Only 15.10.2026" or "Every day it
//                    repeats"; both go through the delete flow with Undo.
//                    (f) Quick add in the title (features/items/quickAdd.ts):
//                    "Gym 17:30 1h every Mon Wed Fri" fills the chips as it
//                    is typed, a "Read as" line says what was read and "Keep
//                    text" puts the words back; a bare number is never read.
//                    New items only — an edit's title is the saved one.
//                    (g) Kept from before: a saved one-off doesn't turn into
//                    a repeat here, nor a saved repeat into a one-off;
//                    editing a repeat keeps its start unless the choice
//                    counts from it (editedRepeatStart); an incomplete repeat
//                    can't be saved (recurrenceProblem); a training session
//                    planned twice on a day asks first (planTwins).
//  2026-10-14 · v18 · No "(legacy)" section pill at all (owner's re-check of
//                    v15 (d)):
//                    (a) TaskTab no longer adds a pill for a retired section.
//                    An old row in Tomorrow / This week opens with Backlog
//                    picked (taskRules.liveSection in buildInitialForm) and
//                    Save writes Backlog; its date keeps it on its day.
//                    (b) No writer can produce one: the form, PlanDefaults,
//                    sectionForDate / sectionForDay and the task create and
//                    update inputs take LiveTaskSection (inbox | today |
//                    backlog), so TypeScript refuses a caller passing
//                    'tomorrow'; the assistant's db_insert / db_update refuse
//                    it too (ai-proxy aiWriteProblem, its catalogue says
//                    backlog). Daily's Add task already sent Backlog since v15
//                    (checked in a build); the pill still showed on every row
//                    holding a retired section, and the assistant could still
//                    write one.
//                    (c) Priority's pills are small (PillGroup size="sm":
//                    SegmentedControl's text-meta, px-2.5, same height) so Low
//                    / Medium / High stay on one line in the half-width column
//                    — High wrapped at 874×402 and 1795×939.
//  2026-10-13 · v17 · Review fixes on v16 (repeating plans on Google):
//                    (a) The series keeps a zone of its own
//                    (schedule_blocks.google_calendar_time_zone, 147): a save
//                    from this editor sets it from the device (Europe/Oslo
//                    when none); every background push reuses it, so opening
//                    the app abroad never re-zones a plan.
//                    (b) The link is written only while the plan has no
//                    series or this one, and cleared only while it still
//                    names this one (a second tab or a stale clear never wins).
//                    (c) A day of a plan turned into a slot (142) is carried to
//                    Google in the background after the task and its link —
//                    Done / Move / Skip no longer wait for Google; the slot's
//                    own event is made only once Google took the EXDATE, else
//                    the plan goes on a per-device retry list (said once,
//                    retried on the next app open, cleared on sign-out). A
//                    skipped day comes off Google; Undo skip puts it back.
//                    A failed relink after Undo is retried the same way (no
//                    "open it and save" note any more).
//                    (d) ScheduleTab renders the checkbox block only with a
//                    row in it (a repeat with Google not connected left an
//                    empty 16px gap on the phone).
//  2026-10-13 · v16 ·Repeating plans on Google Calendar (migration 147) +
//                    four review fixes on v15:
//                    (a) "Add to Google Calendar" now shows for a repeat too —
//                    on create (Schedule tab with a repeat picked) and in the
//                    repeating-plan editor ("Added to Google Calendar" once
//                    linked). A plan becomes ONE repeating event in 'primary'
//                    (calendar/calendarSeries.ts: RRULE for weekly / every N
//                    days / weeks; an RDATE list for monthly / every N months
//                    / picked dates, the monthly kinds a year ahead and pushed
//                    again when the app opens with < 90 days left;
//                    except_dates → EXDATE). The save hooks
//                    (useCreate/UpdateScheduleBlock, `gcal`) add it, bring it
//                    up to date on every save, or remove it when unticked —
//                    the typed 'linked' / 'not_linked' / 'unknown' status,
//                    deterministic event ids (blockEventId on the plan's id),
//                    and a Calendar failure never undoes the local save. With
//                    no Google connection (`gcal` undefined) the link is left
//                    as it is. The form seeds gcal from the plan's own
//                    google_calendar_event_id (an untouched save never
//                    removes it). Delete removes the series (outbox safety
//                    net, 147's trigger); Undo makes a new one. A day turned
//                    into a one-off plan (142) gets an EXDATE and its own event
//                    (trainingPlanApi.ensurePlanTask → carryOccurrenceToCalendar).
//                    (b) Editing a saved plan shows "Starts" when the choice
//                    counts from it (Monthly, every N days / weeks / months):
//                    a weekly plan saved 05.03 turned Monthly used to anchor on
//                    the 5th with no way to pick the 13th. A change of what it
//                    counts from moves Starts to today (back to the saved start
//                    when the choice returns to it, or to one without an
//                    anchor — withStartForRepeatChange), and the save writes
//                    effective_from from it (editedRepeatStart); any other
//                    choice keeps the saved start as before.
//                    (c) The summary + "Next …" line shows only for Monthly
//                    and Custom — for Every day / Weekdays / Weekly it only
//                    repeated the select and circles (an extra phone line).
//                    (d) Custom → Dates is capped at 366 picks (146's CHECK) in
//                    recurrenceProblem with a plain message, instead of a raw
//                    constraint error on save.
//                    (e) Outside this folder, the same review: a plan may be
//                    monthly / every N / picked dates now, so "weekly plan"
//                    became "repeating plan" (Daily's and Training's delete:
//                    "Repeating plan deleted"; Training's "Change / Delete
//                    repeating plan"), a workout's plan note reads the plan's
//                    own repeat ("Planned every 2 weeks on Tue and Thu,
//                    16:45", repeatSummary), and the coach / Program tab count
//                    an every-N-weeks plan's days as 1/N of a training day
//                    a week (recurrence.weeklyDaysPerWeek).
//  2026-10-13 · v15 · More ways to repeat (migration 146) + owner's requests:
//                    (a) Repeat is ONE line at every width — a select with No
//                    repeat · Every day · Weekdays · Weekly · Monthly · Custom
//                    — plus the M–S day circles (Monday first; stored 0=Sun
//                    numbering unchanged; full day name on hover). Every day /
//                    Weekdays light their circles; a tap turns the choice into
//                    the set it now is (toggleRepeatDay). Picking Weekly with
//                    no set of its own starts from the plan's weekday.
//                    Monthly = the chosen weekday nearest the start's date, or
//                    that date; Custom = every N days / weeks / months, or
//                    picked dates (DateCalendar). A one-line summary and the
//                    next three days come from recurrence.ts — the same rule
//                    every projection uses. Validation is recurrenceProblem
//                    (hasValidRecurrenceSelection still guards weekly).
//                    (b) Saves write schedule_blocks' repeat columns
//                    (repeatRowFromForm: "every 1 week" is stored as weekly,
//                    "every 1 month" as monthly). A new repeat starts on the
//                    planner's date (effective_from = form.date, labelled
//                    "Starts"), no longer always today; picked dates start at
//                    the earliest pick if that is earlier. Editing keeps the
//                    saved start (only an earlier picked date moves it).
//                    Before 146 is applied a weekly-style save still works
//                    and the new kinds fail with "migration 146 not applied"
//                    (scheduleApi).
//                    (c) The date stepper lost its Today / Tomorrow chips.
//                    (d) sectionForDate (the "Also add to Tasks" task and
//                    Training's planned task) and Daily's day section
//                    (taskRules.sectionForDay) no longer write the retired
//                    Tomorrow / This week: any day but today files under
//                    Backlog, so "(legacy)" shows only on an old row.
//                    (e) Deleting a repeating plan says "Repeating plan
//                    deleted" (it may not be weekly any more).
//                    (f) The Google Task list field resolves/creates its list
//                    with ensureValidCalendarToken() instead of the stored
//                    token as is — an expired token used to fail with 401
//                    when a new list name was typed; no valid connection now
//                    says so in the same "Couldn't set up …" toast.
//  2026-10-13 · v14 · One delete flow + faster saves (migration 144):
//                    Delete goes through the shared delete hooks' run(): it
//                    asks, deletes with one call that returns what went with
//                    the row, and says "Task deleted · Undo" (Undo puts back
//                    the same rows — slot, skip, links — and makes the Calendar
//                    event again). Save is no longer "Saving…" while the
//                    question is open. Unscheduling deletes the slot in the
//                    database first, then its Calendar event (best effort; the
//                    calendar outbox, 135, removes it if Google isn't reached)
//                    — before, a missing Google connection blocked removing
//                    the slot at all. The task/block hooks this editor calls
//                    take { report: false }: the editor says "Saved" once.
//  2026-09-26 · v13 · Theme + shared popup system (THEME.md §8–§10):
//                    Chrome moved onto ModalShell — the hand-rolled Dialog,
//                    backdrop and the module-level zCursor/useTopZIndex are
//                    gone (ModalShell's depth context stacks nested popups),
//                    Back now closes it, dismiss is blocked while saving.
//                    No supabase import any more: the linked block is read
//                    through the schedule hook layer's linkedTimeBlockQuery
//                    (qk.schedule.byTask, staleTime 0 — same ref-guarded
//                    once-per-open hydration; a failed read now toasts and
//                    keeps Save disabled instead of guessing "none"), the calendar
//                    link's fresh event-id read through scheduleApi's
//                    fetchTimeBlockCalendarEventId. Every write now goes
//                    through a useMutationWithFeedback hook (create/update/
//                    delete block, update/delete recurring, task hooks), so
//                    every failure is toasted + logged exactly once by the
//                    hook; handleSave only stops the flow and shows the
//                    'Saving…'/'Saved' copy via withProgress. The Google Tasks
//                    sync warning moved into useCreateTask. Deletes confirm
//                    through entityModal.confirm (no native confirm()).
//                    New `loading`/`loadError` props let PlanEntityModals
//                    show the same shell while a row loads by id.
//  2026-08-22 · v12 · Fourth post-review pass (one correctness fix):
//                    updateTimeBlock's remote calendar-event PATCH swallowed
//                    ALL failures (including 404 — the remote event deleted
//                    directly in Google Calendar), so a caller checking the
//                    block's OWN google_calendar_event_id column right after
//                    still saw "confirmed linked" — a live scenario where
//                    editing a calendar-linked task would then dedupe-delete
//                    its Google Task (needsGoogleTaskDedupe), leaving NEITHER
//                    Google representation. updateTimeBlock now returns a
//                    real calendarStatus ('linked'/'not_linked'/'unknown'):
//                    a confirmed 404 clears the stale local id and reports
//                    'not_linked' (safe to recreate); any OTHER failure
//                    (network, rate limit, …) reports 'unknown' WITHOUT
//                    touching the local id — the event is presumably still
//                    fine, we just couldn't confirm it, and this must never
//                    be the reason a task's Google Task gets deleted.
//                    syncTaskSchedule and saveSchedule's timeBlock branch
//                    both now trust this call's own confirmed outcome
//                    instead of the pre-call block snapshot.
//  2026-08-22 · v11 · Third post-review pass (correctness fixes only):
//                    (a) shouldSkipPendingCreate's opt-out guard (google_
//                    sync_enabled=false) is now ABSOLUTE — force_recreate
//                    (migration 078's Reopen fix) bypasses ONLY the "already
//                    has an id" guard, never the opt-out one. Previously
//                    both guards shared the same `!forceRecreate` condition,
//                    so a force_recreate row bypassed opt-out too — a real
//                    sequence (Reopen enqueues a force_recreate 'create',
//                    then before it drains the task opts out via a
//                    calendar-linked schedule) could still put an unwanted
//                    Google Task back.
//                    (b) The CREATE-side mirror of v10(a)'s edit-path
//                    ordering fix: saveTask's plain create, saveSchedule's
//                    timeBlock+"Also add to Tasks" branch, and saveSchedule's
//                    plain create+"Also add to Tasks" branch all pass
//                    skipGoogleTasks=willBeCalendarEvent to useCreateTask
//                    SPECULATIVELY, before the calendar link is attempted —
//                    if that link then fails, the task had NEITHER Google
//                    representation. All three now call the new
//                    reenableGoogleTasksIfCalendarFailed after the real,
//                    confirmed outcome is known, re-enabling google_sync_
//                    enabled (pushing the task to Google Tasks as a
//                    fallback) exactly when the bet didn't pay off.
//  2026-08-22 · v10 · Second post-review pass (correctness fixes only):
//                    (a) linkCalendarEvent/syncTaskSchedule now return
//                    whether the block ended up ACTUALLY calendar-linked.
//                    saveTask's edit branch no longer decides the Google
//                    Task dedupe (google_sync_enabled: false) before that
//                    outcome is known — deciding first meant useUpdateTask's
//                    synchronous outbox drain could delete the real Google
//                    Task moments before a failed calendar link, leaving
//                    the task with NEITHER Google representation. The
//                    dedupe is now a SEPARATE mutation, applied only after
//                    confirmation. needsGoogleTaskDedupe dropped its
//                    googleTaskId parameter (a pending, undrained 'create'
//                    has google_sync_enabled=true with google_task_id still
//                    NULL — requiring an id meant that pending create was
//                    never cancelled); shouldSkipPendingCreate (a new
//                    import-free pure module, googleTasksOutboxRules.ts) is
//                    the matching fix on the drain side, in both
//                    processCreate implementations.
//                    (b) blockSourceTypeForTask no longer maps task
//                    'tv_series' -> block 'tv_episode' — a context-free
//                    fallback can't back up episode-specificity it has no
//                    season/episode numbers for. ai-proxy's planMedia now
//                    stamps season_number/episode_number when the AI was
//                    given a specific episode (mirrors EpisodesPanel's own
//                    rule), so cleanup_block_on_episode_watched can match
//                    an AI-planned episode block at all.
//                    (c) saveSchedule's "Also add to Tasks" branch gained a
//                    shouldCreateLinkedTask defensive guard: never create a
//                    second task when the `timeBlock` passed in already has
//                    one (should be structurally unreachable, but this is
//                    what stops a caller bug from doing it silently) — the
//                    exact TrainingCalendar bug this pass found and fixed
//                    (it opened a task-linked plan block via `timeBlock`
//                    instead of `task`, so buildInitialForm seeded
//                    alsoCreateTask=true with no idea a task already
//                    existed, and Save minted a duplicate).
//  2026-08-22 · v9 · Post-review fixes on top of v8 (real runtime gaps, not
//                    architecture changes):
//                    (a) A standalone timeBlock's `gcal` wasn't seeded from
//                    its own google_calendar_event_id (planForm.ts) — saving
//                    an already-calendar-linked block unchanged silently
//                    unlinked its real Google Calendar event.
//                    (b) "One task = one Google entry" only held on CREATE.
//                    Editing an ALREADY Google-synced task into a
//                    calendar-linked schedule, and checking "Also add to
//                    Tasks" on an already-calendar-linked standalone block,
//                    both skipped the skipGoogleTasks dedupe — now fixed on
//                    both save paths.
//                    (c) When no `source` prop is passed (common — most
//                    editors don't have one), a NEW block/task created for
//                    an EXISTING task/timeBlock now falls back to that
//                    entity's own source_type/source_id (mapped through
//                    blockSourceTypeForTask/taskSourceTypeForBlock) instead
//                    of silently going source-less.
//                    (d) Save is now blocked (button disabled + a guard in
//                    handleSave) while a Task's linked block is still being
//                    fetched (linkedBlock === undefined) — saving mid-fetch
//                    used to make syncTaskSchedule think no block existed
//                    yet and CREATE a second one, instantly violating the
//                    at-most-one-per-task DB constraint.
//  2026-08-22 · v8 · Tasks/Schedule model fix (migration 077) — replaces the
//                    Task/Schedule TAB switcher entirely with explicit `mode`.
//                    Root causes fixed together:
//                    (a) time_blocks.source_type/source_id used to do two
//                    jobs — "linked to a Task" AND "which real entity this
//                    was planned from" — and creating a task+schedule
//                    together silently overwrote the real source with
//                    {source_type:'task', source_id:<task id>}, discarding
//                    it. time_blocks.task_id is now the ONLY "linked to a
//                    Task" representation (a real FK, ON DELETE CASCADE);
//                    source_type/source_id are passed through UNCHANGED
//                    alongside task_id now, never replaced.
//                    (b) tasks.due_date/due_time and time_blocks.date/
//                    start_time were kept bidirectionally equal by DB
//                    triggers (043/047) — "the deadline" and "when I'll
//                    actually do it" are different facts and are now fully
//                    independent; those triggers are dropped, not disabled.
//                    (c) Deleting/unscheduling a block no longer soft-
//                    cancels its Task (the old block_delete_cascades_task
//                    rule, retired) — Task survives, only the time slot
//                    goes. The one remaining cross-table effect is
//                    one-directional: Task hard-delete removes its linked
//                    block (the task_id FK), and a Task title edit mirrors
//                    onto its linked block's title (a DB trigger, so it
//                    fires from every write door — browser, AI, Google
//                    Tasks pull — not just this modal).
//                    (d) Recurring schedule_blocks gained a real edit path
//                    (RecurringTab + updateScheduleBlock) — there was no
//                    update API for them at all before this.
//                    The Task editor's "Add to schedule" section seeds from
//                    a task's linked block via a ref-guarded one-time async
//                    effect (never overwrites a user's own in-progress edit
//                    — see hydrateLinkedBlock below). Google Calendar's
//                    create/update/unlink lifecycle now also fires on
//                    title/duration changes, not just date/time (see
//                    scheduleApi.ts's updateTimeBlock).
//  2026-07-31 · v6 · Task windows + two save-path fixes.
//                    (a) `startDate` joins PlanForm/PlanDefaults/TaskField and is
//                    written to tasks.start_date on BOTH save paths — a task can
//                    now say "do it between A and B", where due_date stays the
//                    SOLE deadline (nothing else in the app learns a new concept).
//                    The Task tab renders it as a window control (TaskWindowField,
//                    season chips reusing shared/components/windowChips' math), not
//                    a second bare date box. This could not live in `taskExtra`:
//                    that prop is React.ReactNode with no access to form/patch or
//                    the save payload. Pre-migration-safe — tasksApi retries the
//                    write without start_date on 42703/PGRST204, and create omits
//                    the key entirely when unset.
//                    (b) The create path dropped the Notes textarea silently
//                    (CreateTaskInput had no `description` until now) — a task
//                    created with notes saved them nowhere while edit persisted
//                    them. Now passed on create too.
//                    (c) TaskTab's SECTIONS lost 'tomorrow' and 'this_week': they
//                    have no home of their own in the UI, so choosing one only
//                    made the task float like Backlog under a date-shaped name.
//                    The TaskSection TYPE and planForm's 'today' default are
//                    UNCHANGED — four server-side predicates filter on
//                    section.eq.today (phone-gateway ×2, push-send, ai-proxy) and
//                    legacy rows still hold both retired values.
//  2026-07-04 · v5 · New `timeBlock` prop: Schedule-tab edit mode for a plain
//                    time_block with no linked task (e.g. a planned training
//                    session). saveSchedule updates that row in place instead
//                    of creating a new one; Delete removes it. Lets callers
//                    like NextSessionBanner/TrainingCalendar make ANY planned
//                    session clickable+editable, not just task-linked ones.
//  2026-06-30 · v4 · Task tab redesign: grouped layout (Section+Priority side
//                    by side, "When" divider above Due Date/Time, Notes moved
//                    after), 24h Time24Field for Due Time, explicit "+ Set a
//                    time" / clear affordance instead of always showing a time
//                    value — makes the auto-schedule trigger (date AND time
//                    both set) visible to the user instead of implicit.
//  2026-06-30 · v1 · Created. Merges legacy PlanModal + AddTimeBlockModal +
//                    AddTaskModal into one config-driven modal. Recurrence is now
//                    functional (one-off time block vs recurring schedule block).
//  2026-06-30 · v3 · Task↔schedule consistency: a personal task earns an auto
//                    schedule block ONLY when it has BOTH a due date and a due
//                    time (kills the 17:00 pile-up). Edit/create now sync the
//                    linked block (update/create/delete via syncTaskBlock);
//                    delete is handled in deleteTask. due_time is persisted on
//                    create so the round-trip is stable.
//  2026-06-30 · v2 · Media feedback: default start time = next half-hour slot
//                    (planForm/nextPlanTime); 24h-only time field (Time24Field,
//                    no AM/PM). Cross-table consistency: when "also create task"
//                    is on, task is created FIRST and the time block links to it
//                    (source_type='task') — fixes time_blocks_source_type_check
//                    violation from passing 'media'. Callers now pass a VALID
//                    time_blocks source_type for the no-task path.
//                    [Superseded by v8 — a linked block's table link is task_id
//                    now, never source_type='task'.]
// ═══════════════════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertCircle, Trash2 } from 'lucide-react'
import { toast, useCalendarStore } from '../../../app/store'
import { fetchTimeBlocks, fetchScheduleBlocks } from '../../../features/daily/api/scheduleApi'
import { findPlanTwin, planTwinMessage } from '../../../features/training/plan/planTwins'
import { qk } from '../../query'
import { useGoogleTaskLists } from '../../../features/todo/hooks/useGoogleTaskLists'
import { resolveOrCreateGoogleTaskListId } from '../../../features/todo/api/googleTasksSync'
import { ensureValidCalendarToken } from '../../../features/calendar/api/calendarTokenSync'
import { useSaveItem } from '../../../features/items/useItems'
import { useSheetDelete } from '../../../features/items/useSheetDelete'
import { parseQuickAdd, type QuickAddResult } from '../../../features/items/quickAdd'
import { effectiveGoogleTarget, hasGoogleTasks, itemFromRows, storedGoogleTarget } from '../../../features/items/sheetRules'
import type { ItemInput, SavedItem } from '../../../features/items/itemTypes'
import { ModalShell } from '../../modals/ModalShell'
import { entityModal } from '../../modals/useEntityModal'
import { Button, SegmentedControl, Skeleton } from '../../ui'
import { todayStr } from '../../utils/dateUtils'
import { ItemForm } from './ItemForm'
import { RepeatDeleteChoice } from './RepeatDeleteChoice'
import {
  applyQuickAdd, buildInitialForm, inputFromForm, keepQuickText, repeatOfForm, shapeOf, switchScope,
  type PlanForm, type QuickBase, type SheetItemInput,
} from './planForm'
import { nextPlanTime, recurrenceProblem, repeatAnchorOfRow } from './planModal.config'
import type { PlanResult, UnifiedPlanModalProps } from './planModal.types'

const SCOPES: { value: 'day' | 'all'; label: string }[] = [{ value: 'day', label: 'This day' }, { value: 'all', label: 'All days' }]

/** What a caller's onSaved hears: which parts the item has, and what was made. */
function resultOf(input: SheetItemInput, saved: SavedItem, item: ItemInput | null): PlanResult {
  return {
    mode: input.repeat ? 'recurring' : input.time ? 'schedule' : 'task',
    taskId: saved.taskId ?? undefined,
    timeBlockCreated: !item?.blockId && !!saved.blockId,
    recurringCreated: !item?.scheduleBlockId && !!saved.scheduleBlockId,
  }
}

export function UnifiedPlanModal({
  open, onClose, mode = 'task', config, defaults, source, task, timeBlock, scheduleBlock, occurrenceDate, startScope,
  onSaved, loading = false, loadError, onDeleteOverride,
}: UnifiedPlanModalProps) {
  const editMode = !!task || !!timeBlock || !!scheduleBlock
  const today = todayStr()
  const qc = useQueryClient()
  const googleConnected = !!useCalendarStore(s => s.accessToken)
  const save = useSaveItem()
  const del = useSheetDelete()
  const { data: googleTaskLists = [] } = useGoogleTaskLists()

  // The saved rows as one item (null for a new one).
  const item = useMemo(
    () => (task || timeBlock || scheduleBlock ? itemFromRows(task, timeBlock, scheduleBlock) : null),
    [task, timeBlock, scheduleBlock],
  )
  const seedForm = () => {
    const seeded = buildInitialForm({
      mode, defaults, source, item,
      storedGoogle: storedGoogleTarget(task, timeBlock, scheduleBlock),
      category: timeBlock?.category ?? scheduleBlock?.category ?? null,
      startDate: task?.start_date ?? null,
      occurrenceDate, today, nextTime: nextPlanTime(),
    })
    return startScope === 'day' ? switchScope(seeded, 'day') : seeded
  }

  const [form, setForm] = useState<PlanForm>(seedForm)
  // The title field's text; with quick add it can say more than form.title.
  const [typed, setTyped] = useState(form.title)
  const [parse, setParse] = useState<QuickAddResult | null>(null)
  const [quickBase, setQuickBase] = useState<QuickBase>({})
  const [keepText, setKeepText] = useState(false)
  const [saving, setSaving] = useState(false)
  const [askScope, setAskScope] = useState(false)

  // Re-seed whenever the sheet (re)opens or its rows change — adjusted during
  // render (not in an effect) so a stale form never paints.
  const [seed, setSeed] = useState(() => ({ open, task, timeBlock, scheduleBlock }))
  if (seed.open !== open || seed.task !== task || seed.timeBlock !== timeBlock || seed.scheduleBlock !== scheduleBlock) {
    setSeed({ open, task, timeBlock, scheduleBlock })
    if (open) {
      const f = seedForm()
      setForm(f)
      setTyped(f.title)
      setParse(null)
      setQuickBase({})
      setKeepText(false)
    }
  }

  // The list name is seeded from the domain (a guess) — correct it to the
  // task's REAL list once the lists load, once per open (a later refetch
  // never overwrites what was typed).
  const [listSeed, setListSeed] = useState<object | null>(null)
  if (open && task?.google_tasklist_id && listSeed !== seed) {
    const list = googleTaskLists.find(l => l.id === task.google_tasklist_id)
    if (list) {
      setListSeed(seed)
      setForm(f => ({ ...f, googleListTitle: list.title }))
    }
  }

  const patch = (p: Partial<PlanForm>) => setForm(f => ({ ...f, ...p }))
  const target = effectiveGoogleTarget(shapeOf(form), form.googlePick)

  // Quick add reads a NEW item's title as it is typed; "Keep text" stops it
  // until the field is cleared.
  function onTitle(text: string) {
    setTyped(text)
    const reading = !editMode && !keepText
    if (!text.trim()) setKeepText(false)
    const next = reading ? parseQuickAdd(text, today) : null
    if (!reading && !parse) { patch({ title: text }); return }
    const applied = applyQuickAdd(form, quickBase, parse, next, today)
    setForm({ ...applied.form, title: next ? next.title : text })
    setQuickBase(applied.base)
    setParse(next)
  }
  function onKeepText() {
    setForm(keepQuickText(form, quickBase, typed))
    setQuickBase({})
    setParse(null)
    setKeepText(true)
  }

  // A token that is still valid (refreshed when it has expired), never the
  // stored one as is — typing a new list name after an hour used to fail with 401.
  async function resolveGoogleList(): Promise<string | null | undefined> {
    if (!googleConnected || !form.googleListTitle.trim()) return undefined
    try {
      const token = await ensureValidCalendarToken()
      if (!token) throw new Error('the Google connection needs signing in again (Settings → Subscriptions)')
      return await resolveOrCreateGoogleTaskListId(token, form.googleListTitle)
    } catch (err) {
      toast.error(`Couldn't set up "${form.googleListTitle.trim()}" on Google: ${(err as Error).message}`)
      return undefined
    }
  }

  // An incomplete repeat (a weekly one with no day, an N out of range, no
  // picked date) can't be saved.
  const repeatIssue = repeatOfForm(form) ? recurrenceProblem(form) : null

  // A training session planned on a day that already has it (the repeating
  // template, or the same routine planned once already) asks first — the
  // second copy used to save silently and every page then showed the session
  // twice (planTwins.ts). Moving a plan within its own day never asks.
  async function confirmNoTwin(): Promise<boolean> {
    const oneOff = form.category === 'training' && !!form.date && !!form.time && !repeatOfForm(form)
    if (!oneOff || !form.date) return true
    const existing = timeBlock ?? null
    if (existing && existing.date === form.date) return true
    const date = form.date
    try {
      const [blocks, templates] = await Promise.all([
        qc.fetchQuery({ queryKey: qk.schedule.day(date), queryFn: () => fetchTimeBlocks(date), staleTime: 30_000 }),
        qc.fetchQuery({ queryKey: qk.schedule.templates(), queryFn: fetchScheduleBlocks, staleTime: 30_000 }),
      ])
      const routineId = source?.sourceType === 'training_session' ? source.sourceId ?? null
        : existing?.source_type === 'training_session' ? existing.source_id ?? null : null
      const twin = findPlanTwin({
        date, title: form.title.trim(), routineId, excludeBlockId: existing?.id ?? null,
        blocks, templates: templates.filter(t => t.category === 'training'),
      })
      if (!twin) return true
      return await entityModal.confirm({
        title: 'Plan this session twice?',
        message: `${planTwinMessage(twin)} Keep the one you have, or add a second session that day anyway.`,
        confirmLabel: 'Add anyway',
        cancelLabel: 'Keep one',
      })
    } catch {
      // The check is a guard, not a gate: a failed read never blocks saving.
      return true
    }
  }

  // useSaveItem toasts and logs its own failure and says the result
  // ("Added · 15.10.2026 17:30–18:30 · on Google Calendar"); a throw here
  // only stops the flow.
  async function handleSave() {
    if (!form.title.trim()) { toast.error('Title is required'); return }
    if (repeatIssue) { toast.error(repeatIssue); return }
    if (!(await confirmNoTwin())) return
    setSaving(true)
    try {
      const googleTaskListId = hasGoogleTasks(target) ? await resolveGoogleList() : undefined
      const input = inputFromForm(form, {
        item, occurrenceDate, googleConnected, googleTaskListId, source, color: defaults?.color, today,
      })
      // The extras (category, colour, window, the slot's own source) ride along
      // until the contract names them (contract changes, BRIEF).
      const saved = await save.mutateAsync(input as ItemInput)
      onSaved?.(resultOf(input, saved, item))
      onClose()
    } catch {
      // The hook already said why.
    } finally {
      setSaving(false)
    }
  }

  const ref = { taskId: task?.id, blockId: timeBlock?.id, scheduleBlockId: scheduleBlock?.id }
  const shownTitle = form.title.trim() || task?.title || timeBlock?.title || scheduleBlock?.title || ''

  async function handleDelete() {
    if (onDeleteOverride) {
      if (await onDeleteOverride()) onClose()
      return
    }
    if (scheduleBlock && occurrenceDate) { setAskScope(true); return }
    const result = await del.run(ref, scheduleBlock ? 'all' : 'item', { title: `Delete “${shownTitle}”?` })
    if (result === 'deleted' || result === 'gone') onClose()
  }

  async function deleteRepeat(scope: 'day' | 'all') {
    setAskScope(false)
    const result = await del.run(ref, scope, { title: `Delete “${shownTitle}”?`, ask: false, occurrenceDate })
    if (result === 'deleted' || result === 'gone') onClose()
  }

  const working = saving || del.busy
  // A row still loading by id (or failed to) is an edit, not a create.
  const blocked = loading || !!loadError
  const heading = config?.heading ?? (editMode || blocked ? 'Edit' : 'Add')

  const footer = (
    // One row on every width: Delete (an icon on a phone) on the left, a quiet
    // Cancel and the one primary on the right — content-sized, never full width.
    <div className="flex items-center gap-1.5">
      {editMode && !blocked && (
        <Button
          variant="ghost" size="sm" icon={<Trash2 />} onClick={() => { void handleDelete() }} disabled={working}
          aria-label="Delete" className="-ml-2 shrink-0 text-danger hover:text-danger max-sm:px-2.5"
        >
          <span className="max-sm:sr-only">Delete</span>
        </Button>
      )}
      <Button variant="ghost" size="sm" onClick={onClose} disabled={working} className="ml-auto">Cancel</Button>
      {!loadError && (
        <Button
          variant="primary" size="sm" onClick={() => { void handleSave() }} loading={saving}
          disabled={blocked || !form.title.trim() || !!repeatIssue}
          className="min-w-[5.5rem]"
        >{blocked ? 'Loading…' : saving ? 'Saving…' : editMode ? 'Save' : 'Add'}</Button>
      )}
    </div>
  )

  // A repeating item opened on one of its days: which one the edit is for.
  const scopeSwitch = scheduleBlock && occurrenceDate && !blocked
    ? <SegmentedControl size="xs" options={SCOPES} value={form.scope} onChange={s => setForm(f => switchScope(f, s))} />
    : undefined

  return (
    <ModalShell
      open={open} onClose={onClose} title={heading} headerActions={scopeSwitch} footer={footer}
      size="md" compact dismissible={!working}
    >
      {loadError ? (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <AlertCircle className="h-6 w-6 text-danger" aria-hidden />
          <p className="text-body text-fg-2">{loadError.message}</p>
          {loadError.onRetry && <Button size="sm" onClick={loadError.onRetry}>Try again</Button>}
        </div>
      ) : loading ? (
        <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading">
          <Skeleton className="h-7 w-3/4" rounded="rounded-control" />
          <div className="flex gap-1.5">
            <Skeleton className="h-8 w-32" rounded="rounded-full" />
            <Skeleton className="h-8 w-24" rounded="rounded-full" />
            <Skeleton className="h-8 w-40" rounded="rounded-full" />
          </div>
          <Skeleton className="h-8 w-56" rounded="rounded-full" />
        </div>
      ) : (
        <ItemForm
          form={form} patch={patch} config={config}
          typed={typed} onTitle={onTitle} parse={parse} onKeepText={onKeepText}
          creating={!editMode} today={today} nextTime={nextPlanTime()} googleConnected={googleConnected}
          occurrenceDate={scheduleBlock ? occurrenceDate : null}
          savedKind={editMode ? (scheduleBlock ? 'repeat' : 'one-off') : undefined}
          savedRepeat={scheduleBlock ? { start: scheduleBlock.effective_from ?? today, anchor: repeatAnchorOfRow(scheduleBlock) } : undefined}
          exceptDates={scheduleBlock?.except_dates}
        />
      )}
      {scheduleBlock && occurrenceDate && (
        <RepeatDeleteChoice
          open={askScope} title={shownTitle} date={occurrenceDate}
          onPick={scope => { void deleteRepeat(scope) }} onClose={() => setAskScope(false)}
        />
      )}
    </ModalShell>
  )
}
