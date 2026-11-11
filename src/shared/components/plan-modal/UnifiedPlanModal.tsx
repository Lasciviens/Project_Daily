// ═════════════════════════════════════════════════════════════════════════════
//  UnifiedPlanModal — the item screen ("New Item" / "Edit Item"): the one place
//  an item is added and edited.
//
//  ┌─ RULES (read before editing) ─────────────────────────────────────────────┐
//  │ 1. ONE CHROME. Rendered inside ModalShell (THEME.md §8) — stacking, Back,   │
//  │    Esc and the phone sheet come from there. Never hand-roll a Dialog here.  │
//  │ 2. CONFIG-DRIVEN. Callers shape the sheet from THEIR file via `config`,      │
//  │    `defaults`, `source`, `onSaved`. A per-caller variation is a hide key or │
//  │    a default, never a fork of this folder.                                   │
//  │ 3. SINGLE SOURCE OF TRUTH. All mutable state lives in `form` (planForm.ts).  │
//  │ 4. ONE FORM, ONE SAVE. ItemForm.tsx is the only form (title, the Time     │
//  │    group, Calendar, notes, planning); every save is ONE useSaveItem call   │
//  │    (the items contract, migration 155) and every delete one useSheetDelete │
//  │    run. No table-by-table writes here. An edit saves by itself            │
//  │    (useItemAutosave): one save at a time, never a second slot.            │
//  │ 5. NO TABS, NO MODES TO PICK. A task, its slot and its repeat are parts of  │
//  │    one item. `mode` only says what a NEW item starts with; an edit reads    │
//  │    its rows (sheetRules.itemFromRows).                                       │
//  │ 6. LOG EVERY LOGIC CHANGE in the CHANGELOG below (date · what · why).        │
//  └─────────────────────────────────────────────────────────────────────────────┘
//
//  CHANGELOG
//  2026-11-11 · v24 · Step 3, one screen for everything: the screen can sit
//                    inside another popup (itemScreenEmbed: no chrome, its
//                    save line heads the body, the host closes it through the
//                    handle) — the training session popup's Edit tab (owner's
//                    answer 2). `defaults.typed`: a quick add's text, read by
//                    the title as typed text (Work's ✎, the search bar's
//                    "Open in New Item…"). `config.openRow` opens it at a row.
//                    Planning gains Waiting for and Parent on a task's edit,
//                    each saved by its own one action (TaskRows.tsx), never
//                    through this screen's save. Games' two copies open it
//                    through useEntityModal.
//  2026-11-11 · v23.1 · The cleanup after steps 1 and 2 (the PRs' "To do later"):
//                    the red dot reads the queue's own answer for the item's
//                    row (the row is sent when an edit opens, named, and the
//                    server says what it did — appleDot; the row's 2-minute
//                    guess only when another send was running). A saved weekly
//                    repeat can end after midnight (endOnWheel). The time rows
//                    of a Google Task carry the app's mark (`clock`). The Date
//                    row names the section the save keeps (an undated edit
//                    keeps its own). An all-day item gets a compact band, not
//                    the timeline. The Repeat panel no longer repeats its
//                    summary. config.heading gone.
//                    A new item's title takes the focus on touch screens too.
//                    "Undo changes" under the heading after a save puts back
//                    everything since the edit opened, as one save. Back, a
//                    failed save, Stay: the history entry goes back, so a
//                    second Back closes the screen. A problem (a link being
//                    typed) is said once the typing pauses or the field is
//                    left. The All-day switch drops an alert within the day;
//                    an all-day item opens its alerts as the choice they are.
//  2026-11-11 · v23 · The item screen, step 2: the rows of Apple's extra fields
//                    (migration 193; v21.11 built their data side), only on an
//                    item with a slot or a repeat (itemScreenRules.screenParts,
//                    the Location row's rule): Travel Time under Location;
//                    Alert, Second Alert and Show As in Options; URL in Details
//                    (CalendarFieldRows.tsx); End Repeat under Repeat (Never, On
//                    a day, After N times, with the next dates and the last —
//                    EndRepeatRows.tsx). Each a real choice through
//                    withCalendarField, saved like the rest (Add, or by itself),
//                    each with its mark (alerts and Show As: the item's
//                    calendar; the link and travel time: Apple's only; End
//                    Repeat: where the repeat goes). A link that isn't https
//                    (urlProblem) or an End Repeat that can't be
//                    (repeatEndIssue) stops Add and the autosave and says why
//                    under its row and in the heading. The URL row opens only
//                    an eventUrl-checked https link, after showing its address
//                    (the host first), in a new tab without opener or referrer.
//                    Apple's mark: its mask url() is quoted (a build's data URI
//                    has ' in it, and the mark drew as a square).
//  2026-11-10 · v22 · The item screen, step 1 (docs/features/item-screen-plan.md;
//                    owner, 10.11.2026: the plan and its five answers). Drawn as
//                    iOS Calendar's event screen: grouped rows under Location,
//                    Time, Options, Details and Planning; labels left,
//                    values right, fixed widths. The data and its rules are as
//                    before (sheetRules, planForm, quick add, the Google target,
//                    the Apple send, zones, places, the section, today's date):
//                    (a) Starts / Ends each have a day and a time (pills of one
//                    width; a wheel or a month opens in the list). The item is
//                    still a day, a start and a length: Ends is start + length,
//                    an end picked there becomes the length — the next day too,
//                    at most 24 hours (080); before the start or longer it is
//                    held struck through and nothing saves. The start's day or
//                    time keeps the length, so the end moves with it.
//                    (b) The day's timeline: the day's other things (Daily's own
//                    reads, buildDaySchedule) and this item — drag it, drag its
//                    ends; the day strip under it scrolls it.
//                    (c) All-day = no time (planForm.withAllDaySwitch: an item on
//                    a calendar stays there all day, as withAllDay did).
//                    (d) The Calendar row replaces the Google chip: the same
//                    choices and words, Apple's or Google's mark, a red dot when
//                    Apple hasn't taken it two minutes after its last change.
//                    (e) The heading is "New Item" / "Edit Item" wherever it opens
//                    (config.heading is ignored). A new item has Add; an edit
//                    saves by itself ("Saving…", "Saved" under the heading) and
//                    sends what is left when it closes. Each save after the first
//                    names the slot the first one made, so no second slot.
//                    A change that takes the slot away (no day, no time) and a
//                    new list's name being typed wait for the screen to close
//                    (heldChange); a failed save before closing asks "Close
//                    without saving your last change?".
//                    (f) A mark on every row for where its field goes, behind
//                    Settings → Calendar → "Show where each field goes".
//  2026-11-10 · v21.11 · The data side of Apple's extra fields (migration 193;
//                    the one item screen, step 2 — no screen yet): the form
//                    holds alerts, showAs, url, travelMinutes and repeatEnd,
//                    seeded from the rows (itemFromRows) and sent like the
//                    place — a new item's, an edit's only when the sheet knew
//                    it or the owner changed it (calendarTouched,
//                    withCalendarField); the link through cleanItemUrl, End
//                    Repeat only with a repeat's rule (calendarFieldsProblem).
//  2026-11-03 · v21.10 · The save's result line names the calendar the chip
//                    names: "· sending to Apple Calendar" for an item whose
//                    area shows in Apple Calendar (it said "on Google
//                    Calendar"; owner: "the task did not come over to apple
//                    calendar"). useSaveItem takes `calendarApp`, so it is
//                    called after useItemCalendarApp.
//  2026-11-03 · v21.9 · A place on an item (migration 186, owner: "Can we use
//                    that [EnTur] as location finding?"): PlaceFact on the
//                    facts line for an item with a time, a repeat or all day —
//                    EnTur's search, the saved Home/Work places, or typed text.
//                    The form carries `place`; an edit sends it only when the
//                    sheet knew it (the rows had the column) or the owner
//                    changed it, so no other save path wipes a place.
//  2026-11-02 · v21.8 · Time zones from the phone (migration 183, owner: "Time
//                    zones should be based on location"): the sheet saves the
//                    zone its times are on (`timeZone`) — a new item's is the
//                    phone's (or the caller's: a match's kick-off is Oslo's), a
//                    saved one's its own — so what it shows is what is stored.
//                    The zone chip (ZoneChip) shows when that isn't the phone's
//                    clock, or while the phone is away from Oslo's, and offers
//                    the item's zone, this phone's and Oslo's. A repeat's series
//                    is pushed in its own zone (calendarSeries.planTimeZone), no
//                    longer the device's.
//  2026-10-31 · v21.7 · The task's own labels (migration 180, owner: "an option
//                    to add other labels"): "+ Label" on the facts line, the
//                    owner's labels offered as they type, sent as `labels` with
//                    the one save (a repeat's rule has none); an older database
//                    answers without them and the save says so. The Google list
//                    is a value with a menu of the Google lists and "New list…"
//                    (owner: "+Google List … did nothing") instead of "+ Google
//                    list" opening a text field.
//  2026-10-31 · v21.6 · The chip's Apple/Google comes from the server's own
//                    area rule with its inputs (category, domain, the slot's and
//                    task's origin, project, Hevy routine) — a project's task
//                    with category Other is Work, not Personal; worked out once
//                    here and handed to ItemForm.
//  2026-10-30 · v21.5 · Apple Calendar per area (calendar plan 2b-2): an item
//                    whose area is on Apple in Settings → Calendar says
//                    "Apple Calendar · busy" on its chip (Both: "Google Tasks +
//                    Apple Calendar", no "Shows twice" — two apps; none: "Only
//                    in this app"). Its save makes no Google Calendar event: the
//                    server writes the Apple one (settleItemApple); Google areas
//                    read exactly as before.
//  2026-10-28 · v21.4 · "Edit session…" moving a training session 7 or more
//                    days after its first day said only "Saved · <new day>",
//                    while the database (167) had skipped it in its own week
//                    and moved that week's session there. The sheet now says
//                    what Move says (`pastWeekMoveLine`, through
//                    useSaveItem's `describe`) and Google follows as for Move
//                    (`carryPastWeekMoveToCalendar`): the skipped day of a
//                    repeat comes off the calendar, a day moved in gets its
//                    own event. Only for a session's task (`config.session`,
//                    set by PlanEntityModals); never for "All days".
//  2026-10-20 · v21.3 · "All day" in the time chip's picker (owner, 16.10.2026:
//                    "there are no options to mark as all day on website"):
//                    no time, no length, on Google Calendar (Both stays Both —
//                    planForm.withAllDay); the chip then reads "All day".
//                    Offered only while Google Calendar is connected here. The
//                    length's Minutes field keeps what is typed, so "120" can be
//                    cleared and "300" typed (it snapped back to 120).
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

import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertCircle } from 'lucide-react'
import { toast, useCalendarStore } from '../../../app/store'
import { useItemCalendarApp } from '../../../features/calendar/areas/useItemCalendarApp'
import { useCalendarPrefs } from '../../../features/calendar/areas/useCalendarPrefs'
import { useAppleItemSend } from '../../../features/calendar/areas/useAppleItemSend'
import type { DrainItemRef } from '../../../features/calendar/areas/appleSendRules'
import { useICloudStatus } from '../../../features/calendar/icloud/useICloud'
import { fetchTimeBlocks, fetchScheduleBlocks } from '../../../features/daily/api/scheduleApi'
import { useScheduleBlock, useTimeBlock } from '../../../features/daily/hooks/useSchedule'
import { findPlanTwin, planTwinMessage } from '../../../features/training/plan/planTwins'
import { movesPastWeek, pastWeekMoveLine, type PastWeekOutcome } from '../../../features/training/plan/sessionState'
import { carryPastWeekMoveToCalendar, fetchPastWeekOutcome } from '../../../features/training/api/trainingPlanApi'
import { qk } from '../../query'
import { useGoogleTaskLists } from '../../../features/todo/hooks/useGoogleTaskLists'
import { resolveOrCreateGoogleTaskListId } from '../../../features/todo/api/googleTasksSync'
import { ensureValidCalendarToken } from '../../../features/calendar/api/calendarTokenSync'
import { useSaveItem } from '../../../features/items/useItems'
import { useSheetDelete } from '../../../features/items/useSheetDelete'
import { parseQuickAdd, type QuickAddResult } from '../../../features/items/quickAdd'
import { effectiveGoogleTarget, hasGoogleCalendar, hasGoogleTasks, itemFromRows, storedGoogleTarget } from '../../../features/items/sheetRules'
import type { ItemInput, SavedItem } from '../../../features/items/itemTypes'
import { ModalShell } from '../../modals/ModalShell'
import { entityModal } from '../../modals/useEntityModal'
import { Button, SegmentedControl, Skeleton } from '../../ui'
import { todayStr } from '../../utils/dateUtils'
import { ItemForm } from './ItemForm'
import { RepeatDeleteChoice } from './RepeatDeleteChoice'
import { appleDot, END_PROBLEM_TEXT } from './itemScreenRules'
import { useItemAutosave, type AutosaveLine, type PersistResult } from './useItemAutosave'
import { ItemScreenEmbedContext } from './itemScreenEmbed'
import {
  applyQuickAdd, buildInitialForm, formContentKey, formValuesKey, inputFromForm, keepQuickText, repeatEndIssue, repeatOfForm, revertedForm,
  shapeOf, switchScope, urlProblem, type PlanForm, type QuickBase, type SheetItemInput,
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

/** The heading's second line on an edit: the save's state, in one line (fixed height, so nothing moves). */
function SaveLine({ line, onRetry, onUndo }: { line: AutosaveLine; onRetry: () => void; onUndo?: () => void }) {
  if (line.kind === 'saving') return <span aria-live="polite">Saving…</span>
  if (line.kind === 'saved') {
    return (
      <span aria-live="polite">
        Saved{onUndo && <> · <button type="button" onClick={onUndo} className="font-semibold text-accent-600 underline">Undo changes</button></>}
      </span>
    )
  }
  if (line.kind === 'held') return <span aria-live="polite">{line.reason}</span>
  if (line.kind === 'blocked') return <span data-tone="warn" className="tone-text" aria-live="polite">Not saved: {line.reason}</span>
  if (line.kind === 'failed') {
    return (
      <span data-tone="danger" className="tone-text" aria-live="polite">
        Not saved · <button type="button" onClick={onRetry} className="font-semibold underline">Try again</button>
      </span>
    )
  }
  return <span>Changes save by themselves</span>
}

export function UnifiedPlanModal({
  open, onClose, mode = 'task', config, defaults, source, task, timeBlock, scheduleBlock, occurrenceDate, startScope,
  onSaved, loading = false, loadError, onDeleteOverride,
}: UnifiedPlanModalProps) {
  const editMode = !!task || !!timeBlock || !!scheduleBlock
  // Inside another popup (itemScreenEmbed): no chrome of its own; the host closes it through the handle.
  const embedRef = useContext(ItemScreenEmbedContext)
  const today = todayStr()
  const qc = useQueryClient()
  const googleConnected = !!useCalendarStore(s => s.accessToken)
  const { prefs } = useCalendarPrefs()
  // A training session put 7 or more days after its first day (167): the
  // database skips it in its week and moves that week's session to the day.
  const session = config?.session
  const shownDay = timeBlock?.date ?? task?.due_date ?? occurrenceDate ?? null
  // The day as last saved here (an edit saves by itself): a later save that leaves the day alone moves nothing.
  const savedDay = useRef<string | null>(null)
  const outOfWeek = (input: ItemInput) => (session && input.scope !== 'all' && input.date && input.date !== (savedDay.current ?? shownDay)
    && movesPastWeek(session.firstDay, input.date) ? input.date : null)
  const del = useSheetDelete()
  const { data: googleTaskLists = [] } = useGoogleTaskLists()

  // The saved rows as one item (null for a new one).
  const item = useMemo(
    () => (task || timeBlock || scheduleBlock ? itemFromRows(task, timeBlock, scheduleBlock) : null),
    [task, timeBlock, scheduleBlock],
  )
  // What each save after the first names: the slot (and task) an earlier save of this edit made or kept.
  const liveIds = useRef<Pick<ItemInput, 'taskId' | 'blockId'> | null>(null)
  // …and the slot itself for what the screen draws (the timeline leaves it out of the day's other things).
  const [madeBlockId, setMadeBlockId] = useState<string | null>(null)
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
  // A new item opened from a quick add (`defaults.typed`, step 3): the title field starts with the text and reads it
  // as it reads what is typed — the rows it names filled, the Read as line under it.
  const seedAll = () => {
    const f = seedForm()
    const text = !item && defaults?.typed?.trim() ? defaults.typed.trim() : null
    if (!text) return { form: f, typed: f.title, parse: null, base: {} as QuickBase }
    const read = parseQuickAdd(text, today)
    const applied = applyQuickAdd(f, {}, null, read, today)
    return { form: { ...applied.form, title: read ? read.title : text }, typed: text, parse: read, base: applied.base }
  }

  const [first] = useState(seedAll)
  const [form, setForm] = useState<PlanForm>(first.form)
  // The form as the edit opened ("Undo changes" puts it back as one save).
  const [openedForm, setOpenedForm] = useState<PlanForm>(form)
  // Where it shows: Google needs its connection; an item whose area is on Apple Calendar (2b-2) doesn't — its choice
  // is shown and kept either way (Google Tasks still follows the real connection, in the database).
  // The server's own rule and inputs (icloudEvents.itemArea): the chip names the calendar the item really goes to.
  const calendarApp = useItemCalendarApp({
    category: form.category, domain: form.domain,
    source_type: timeBlock?.source_type ?? source?.sourceType ?? null,
    task_source_type: task?.source_type ?? source?.taskSourceType ?? null,
    project_id: task?.project_id ?? null, hevy_routine_id: task?.hevy_routine_id ?? null,
  })
  const appleArea = calendarApp === 'apple'
  const choiceShown = googleConnected || appleArea
  // Its result line names the calendar the chip names ("· sending to Apple Calendar" for an Apple area). An edit says
  // "Saved" under its heading instead ('' — the line says it), unless the database moved a training week (167).
  const save = useSaveItem({
    after: async (input, saved) => {
      const to = outOfWeek(input)
      if (!to || !session) return null
      carryPastWeekMoveToCalendar({ taskId: session.taskId, blockId: saved.blockId ?? timeBlock?.id ?? null }, to)
      return fetchPastWeekOutcome(session.taskId, to, { routineId: session.routineId, title: session.title })
    },
    describe: (input, outcome) => {
      const to = outOfWeek(input)
      return to && session ? pastWeekMoveLine(input.title.trim() || session.title, to, outcome as PastWeekOutcome | null) : editMode ? '' : undefined
    },
    calendarApp,
  })
  // The title field's text; with quick add it can say more than form.title.
  const [typed, setTyped] = useState(first.typed)
  const [parse, setParse] = useState<QuickAddResult | null>(first.parse)
  const [quickBase, setQuickBase] = useState<QuickBase>(first.base)
  const [keepText, setKeepText] = useState(false)
  const [saving, setSaving] = useState(false)
  const [askScope, setAskScope] = useState(false)

  const patch = (p: Partial<PlanForm>) => setForm(f => ({ ...f, ...p }))
  const target = effectiveGoogleTarget(shapeOf(form), form.googlePick)
  // An incomplete repeat (a weekly one with no day, an N out of range, no
  // picked date) can't be saved; nor an end before the start.
  const repeatIssue = repeatOfForm(form) ? recurrenceProblem(form) : null
  // The calendar fields (193): a link the app can't take, an End Repeat before the start. The database refuses the
  // same, so a link left as typed is said even after its row went with the slot (the close says why it wasn't saved).
  const urlIssue = urlProblem(form)
  const endIssue = repeatEndIssue(form, { item, today })
  const problemOf = (f: PlanForm) => (!f.title.trim() ? 'a title is needed'
    : (repeatOfForm(f) ? recurrenceProblem(f) : null)
      ?? (f.badEnd ? END_PROBLEM_TEXT[f.badEnd.problem] : null)
      ?? urlProblem(f) ?? repeatEndIssue(f, { item, today }))
  const problem = problemOf(form)
  // A row still loading by id (or failed to) is an edit, not a create.
  const blocked = loading || !!loadError
  const autosave = useItemAutosave({ enabled: open && editMode && !blocked, form, problem, persist })

  // Re-seed whenever the sheet (re)opens or its rows change — adjusted during
  // render (not in an effect) so a stale form never paints. The seeded form is
  // what an edit starts from: nothing saves until it changes.
  const [seed, setSeed] = useState(() => ({ open, task, timeBlock, scheduleBlock }))
  if (seed.open !== open || seed.task !== task || seed.timeBlock !== timeBlock || seed.scheduleBlock !== scheduleBlock) {
    setSeed({ open, task, timeBlock, scheduleBlock })
    if (open) {
      const s = seedAll()
      setForm(s.form)
      setOpenedForm(s.form)
      autosave.reset(formContentKey(s.form))
      setTyped(s.typed)
      setParse(s.parse)
      setQuickBase(s.base)
      setKeepText(false)
    }
  }

  // The list name is seeded from the domain (a guess) — correct it to the
  // task's REAL list once the lists load, once per open (a later refetch
  // never overwrites what was typed). Untouched, that is no change to save.
  const [listSeed, setListSeed] = useState<object | null>(null)
  if (open && task?.google_tasklist_id && listSeed !== seed) {
    const list = googleTaskLists.find(l => l.id === task.google_tasklist_id)
    if (list) {
      setListSeed(seed)
      const next = { ...form, googleListTitle: list.title }
      if (formContentKey(form) === autosave.savedKey) autosave.reset(formContentKey(next))
      setForm(next)
      if (openedForm.googleListTitle !== list.title) setOpenedForm({ ...openedForm, googleListTitle: list.title })
    }
  }

  // The Calendar row's red dot: the item belongs in Apple Calendar and its slot or plan still has no Apple copy.
  const liveBlock = useTimeBlock(editMode && appleArea ? item?.blockId : null)
  const livePlan = useScheduleBlock(editMode && appleArea && !item?.blockId ? item?.scheduleBlockId : null)
  const wantsApple = appleArea && hasGoogleCalendar(target) && (!!form.date || !!repeatOfForm(form))
  // …why, from the queue's own answer: the row is sent when the screen opens (and after each save that left it
  // without an Apple copy), and the server says what it did with it (itemScreenRules.appleDot).
  const liveRow = item?.blockId ? liveBlock.data : livePlan.data
  const appleRef: DrainItemRef | null = !editMode || !wantsApple || !liveRow || liveRow.icloud_area ? null
    : item?.blockId ? { entity: 'slot', id: item.blockId }
    : item?.scheduleBlockId ? { entity: 'plan', id: item.scheduleBlockId } : null
  const appleSend = useAppleItemSend(appleRef, liveRow?.updated_at)
  // Another send was running: the account's newest reason (Settings' Apple Calendar card) stands in.
  const icloud = useICloudStatus({ enabled: !!appleRef && !!appleSend.data?.busy })
  const refused = editMode
    ? appleDot({ wanted: wantsApple, row: liveRow, send: appleSend.data ?? null, notSent: icloud.data?.notSent, now: new Date() })
    : null

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
  // An edit saves often: a name already found is not looked up on Google again.
  const listIds = useRef(new Map<string, string | null>())
  async function resolveGoogleList(title: string): Promise<string | null | undefined> {
    const name = title.trim()
    if (!googleConnected || !name) return undefined
    if (listIds.current.has(name.toLowerCase())) return listIds.current.get(name.toLowerCase())
    try {
      const token = await ensureValidCalendarToken()
      if (!token) throw new Error('the Google connection needs signing in again (Settings → Subscriptions)')
      const id = await resolveOrCreateGoogleTaskListId(token, name)
      listIds.current.set(name.toLowerCase(), id)
      return id
    } catch (err) {
      toast.error(`Couldn't set up "${name}" on Google: ${(err as Error).message}`)
      return undefined
    }
  }

  // A training session planned on a day that already has it (the repeating
  // template, or the same routine planned once already) asks first — the
  // second copy used to save silently and every page then showed the session
  // twice (planTwins.ts). Moving a plan within its own day never asks.
  async function confirmNoTwin(f: PlanForm, savedOn: string | null): Promise<boolean> {
    const oneOff = f.category === 'training' && !!f.date && !!f.time && !repeatOfForm(f)
    if (!oneOff || !f.date) return true
    const existing = timeBlock ?? null
    if (existing && (savedOn ?? existing.date) === f.date) return true
    const date = f.date
    try {
      const [blocks, templates] = await Promise.all([
        qc.fetchQuery({ queryKey: qk.schedule.day(date), queryFn: () => fetchTimeBlocks(date), staleTime: 30_000 }),
        qc.fetchQuery({ queryKey: qk.schedule.templates(), queryFn: fetchScheduleBlocks, staleTime: 30_000 }),
      ])
      const routineId = source?.sourceType === 'training_session' ? source.sourceId ?? null
        : existing?.source_type === 'training_session' ? existing.source_id ?? null : null
      const twin = findPlanTwin({
        date, title: f.title.trim(), routineId, excludeBlockId: existing?.id ?? null,
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

  function inputOf(f: PlanForm, base: ItemInput | null, googleTaskListId: string | null | undefined): SheetItemInput {
    return inputFromForm(f, { item: base, occurrenceDate, googleConnected: choiceShown, googleTaskListId, source, color: defaults?.color, today })
  }

  // An edit's one save of the form as it is now (useItemAutosave runs one at a time). useSaveItem toasts and logs
  // its own failure; a throw here only says "Not saved".
  async function persist(f: PlanForm): Promise<PersistResult> {
    const lastDay = savedDay.current ?? shownDay
    if (!(await confirmNoTwin(f, lastDay))) {
      // "Keep one": the session stays on its day.
      setForm(cur => ({ ...cur, date: lastDay ?? cur.date }))
      return 'kept'
    }
    const base = item ? { ...item, ...liveIds.current } : null
    const fTarget = effectiveGoogleTarget(shapeOf(f), f.googlePick)
    const input = inputOf(f, base, hasGoogleTasks(fTarget) ? await resolveGoogleList(f.googleListTitle) : undefined)
    const saved = await save.mutateAsync(input as ItemInput)
    // A one-off's slot made (or dropped) by this save is the one the next save edits.
    if (input.scope === 'item') {
      liveIds.current = { taskId: saved.taskId ?? base?.taskId ?? null, blockId: saved.blockId ?? null }
      setMadeBlockId(saved.blockId ?? null)
    }
    savedDay.current = input.date
    onSaved?.(resultOf(input, saved, base))
    return 'saved'
  }

  // A new item: Add. useSaveItem says the result ("Added · 15.10.2026
  // 17:30–18:30 · on Google Calendar"); a throw here only stops the flow.
  async function handleSave() {
    if (!form.title.trim()) { toast.error('Title is required'); return }
    if (repeatIssue) { toast.error(repeatIssue); return }
    if (form.badEnd) { toast.error(END_PROBLEM_TEXT[form.badEnd.problem]); return }
    if (problem) { toast.error(problem); return }
    if (!(await confirmNoTwin(form, null))) return
    setSaving(true)
    try {
      const input = inputOf(form, item, hasGoogleTasks(target) ? await resolveGoogleList(form.googleListTitle) : undefined)
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

  // "Undo changes" (an edit, after a save): everything since it opened, put back as one save — sent at once, even a
  // slot taken away (asked for, not a stray tap). Not after a This day / All days switch: its saves went to two scopes.
  const canUndo = editMode && !blocked && autosave.savedOnce && form.scope === openedForm.scope
    && formValuesKey(form) !== formValuesKey(openedForm)
  function undoChanges() {
    const back = revertedForm(openedForm, form)
    setForm(back)
    setTyped(back.title)
    void autosave.saveNow(back, problemOf(back))
  }

  // Closing an edit sends what waits first; a failed save keeps the screen open (its line says so). Resolves false
  // when it stayed open ("Stay"): a Back's history entry then goes back, so the next Back closes it again.
  const closing = useRef<Promise<boolean> | null>(null)
  function requestClose(): Promise<boolean> {
    if (!editMode || blocked) { onClose(); return Promise.resolve(true) }
    closing.current ??= closeEdit().finally(() => { closing.current = null })
    return closing.current
  }
  async function closeEdit(): Promise<boolean> {
    const done = await autosave.flush()
    // A failed save never traps the screen: the owner decides (the save's own toast said why). Back comes here too.
    const leave = done.kind !== 'failed' || await entityModal.confirm({
      title: 'Close without saving your last change?',
      message: "It couldn't be saved. Close now, or stay and try again.",
      confirmLabel: 'Close without saving',
      cancelLabel: 'Stay',
    })
    if (!leave) return false
    if (done.kind === 'problem') toast.warning(`Your last change wasn't saved: ${done.reason}`)
    onClose()
    return true
  }

  const shownTitle = form.title.trim() || task?.title || timeBlock?.title || scheduleBlock?.title || ''

  // The item's rows as they are now (a slot an earlier save of this edit made included).
  const refNow = () => ({
    taskId: liveIds.current?.taskId ?? task?.id, blockId: liveIds.current ? liveIds.current.blockId : timeBlock?.id, scheduleBlockId: scheduleBlock?.id,
  })

  async function handleDelete() {
    // What waits is saved first: a save landing after the delete would bring the item back.
    if ((await autosave.flush()).kind === 'failed') return
    if (onDeleteOverride) {
      if (await onDeleteOverride()) onClose()
      return
    }
    if (scheduleBlock && occurrenceDate) { setAskScope(true); return }
    const result = await del.run(refNow(), scheduleBlock ? 'all' : 'item', { title: `Delete “${shownTitle}”?` })
    if (result === 'deleted' || result === 'gone') onClose()
  }

  async function deleteRepeat(scope: 'day' | 'all') {
    setAskScope(false)
    const result = await del.run(refNow(), scope, { title: `Delete “${shownTitle}”?`, ask: false, occurrenceDate })
    if (result === 'deleted' || result === 'gone') onClose()
  }

  const working = saving || del.busy
  useEffect(() => {
    if (!embedRef) return
    embedRef.current = { requestClose, flush: autosave.flush }
    return () => { embedRef.current = null }
  })
  // One heading wherever the screen opens (owner's point 11); a caller's own heading is no longer used.
  const heading = editMode || blocked ? 'Edit Item' : 'New Item'

  // A repeating item opened on one of its days: which one the edit is for. Switching it changes nothing by itself:
  // with nothing waiting, the switched form is what is saved (only a change after it saves, to that scope).
  function switchTo(scope: 'day' | 'all') {
    const next = switchScope(form, scope)
    if (formContentKey(form) === autosave.savedKey) autosave.reset(formContentKey(next))
    setForm(next)
  }

  const scopeSwitch = scheduleBlock && occurrenceDate && !blocked
    ? <SegmentedControl size="xs" options={SCOPES} value={form.scope} onChange={switchTo} />
    : undefined
  const headerActions = (
    <>
      {scopeSwitch}
      {!editMode && !blocked && (
        <Button variant="primary" size="sm" onClick={() => { void handleSave() }} loading={saving}
          disabled={!!problem} className="min-w-[4.5rem]">
          {saving ? 'Adding…' : 'Add'}
        </Button>
      )}
    </>
  )

  const saveLine = editMode && !blocked ? <SaveLine line={autosave.line} onRetry={autosave.retry} onUndo={canUndo ? undoChanges : undefined} /> : undefined
  const body = (
    <>
      {loadError ? (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <AlertCircle className="h-6 w-6 text-danger" aria-hidden />
          <p className="text-body text-fg-2">{loadError.message}</p>
          {loadError.onRetry && <Button size="sm" onClick={loadError.onRetry}>Try again</Button>}
        </div>
      ) : loading ? (
        <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading">
          <Skeleton className="h-12 w-full" rounded="rounded-row" />
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-3 w-12" rounded="rounded-full" />
            <Skeleton className="h-[264px] w-full" rounded="rounded-row" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-3 w-16" rounded="rounded-full" />
            <Skeleton className="h-11 w-full" rounded="rounded-row" />
          </div>
        </div>
      ) : (
        // A field left: a problem with what was typed (a link) may be said now, not only after the pause.
        <div className="contents" onBlur={autosave.settle}>
        <ItemForm
          form={form} patch={patch} config={config}
          typed={typed} onTitle={onTitle} parse={parse} onKeepText={onKeepText}
          creating={!editMode} today={today} nextTime={nextPlanTime()} googleConnected={choiceShown} calendarApp={calendarApp}
          keptTarget={item?.google}
          occurrenceDate={scheduleBlock ? occurrenceDate : null}
          savedKind={editMode ? (scheduleBlock ? 'repeat' : 'one-off') : undefined}
          savedZone={editMode && item && (item.blockId || item.scheduleBlockId) ? item.timeZone ?? null : defaults?.timeZone}
          savedRepeat={scheduleBlock ? { start: scheduleBlock.effective_from ?? today, anchor: repeatAnchorOfRow(scheduleBlock) } : undefined}
          exceptDates={scheduleBlock?.except_dates}
          showMarks={prefs.showMarks} appleNotes={prefs.notes === 'notes+link' || prefs.notes === 'notes'} refused={refused}
          own={{ blockId: madeBlockId ?? item?.blockId, scheduleBlockId: item?.scheduleBlockId }}
          onDelete={editMode ? () => { void handleDelete() } : undefined} deleting={working}
          urlIssue={urlIssue} endIssue={endIssue} savedSection={task?.section} taskId={scheduleBlock ? null : task?.id}
        />
        </div>
      )}
      {scheduleBlock && occurrenceDate && (
        <RepeatDeleteChoice
          open={askScope} title={shownTitle} date={occurrenceDate}
          onPick={scope => { void deleteRepeat(scope) }} onClose={() => setAskScope(false)}
        />
      )}
    </>
  )

  // Inside another popup (a training session's Edit tab): the save line and the header's controls head the body.
  if (embedRef) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex min-h-9 items-center justify-between gap-2 px-1">
          <p className="min-w-0 text-meta text-fg-muted">{saveLine ?? heading}</p>
          {headerActions}
        </div>
        {body}
      </div>
    )
  }
  return (
    <ModalShell
      open={open} onClose={requestClose} title={heading} headerActions={headerActions} subtitle={saveLine}
      size="md" compact grouped dismissible={!working} bodyClassName="px-3 pb-4 pt-1.5 sm:px-4"
    >
      {body}
    </ModalShell>
  )
}
