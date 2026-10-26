# Supplements — schedules, doses and reminders

Part of Food (`/#/recipes`, Today tab). Rules: `.claude/rules/food.md` (its supplement part). Migration `160_supplement_schedules.sql` (owner go 16.10.2026, Food point 9).

## What it does

A supplement taken on a schedule — creatine every morning, omega-3 at 08:00 and 20:00, vitamin D on Mondays — is a **schedule**; each of its times on each of its days is a **dose**. Food · Today's Supplement card lists the viewed day's doses:

```
💊 Supplement                              234 kcal  [Schedule] [+ Log]
✓ Protein shake 1 portion   07:00 · taken 07:12 · 120 kcal          ⋯
○ Kreatin 5 g               08:00 · due 2 h ago        [Take] [Skip] ⋯
◷ Omega-3 2 capsules        20:00 · in 9 h                          ⋯
  Whey protein isolate  30 g …        (the slot's other diary lines)
[Take all due (2)]
⚠ Refill Kreatin 25 g left · ≈ 5 days
⏸ Iron paused · Resume
Not on this day: Vitamin D3
```

- **Take** writes the dose's diary line (decision 11: a taken dose always has one) — the schedule's library food, recipe or own line, in the `supplement` slot, eaten, linked to the dose — and says "Kreatin 5 g taken · Undo". Another day's open dose is taken at its own time that day. **Taken at…** opens the dose sheet with a time picker.
- **Skip** records a skip for that dose ("Kreatin skipped · Undo"); **Snooze 1 h** holds the reminders for an hour; both live in the ⋯ menu too (Skip only there on a narrow card). ⋯ also has Edit schedule and Pause; a taken dose has **Not taken**, which is the diary's own delete (asks, then Undo).
- **Take all due** takes every due dose at once.
- The slot's other lines (an extra scoop logged by hand, a planned line) show under the doses, rendered like every meal card's rows. A dose's own line shows only on its dose.
- A dose is **taken** while its eaten diary line exists, **skipped** when skipped, **missed** on a past day with neither, **upcoming** before its time, **due** from its minute until midnight. Doses are not tasks (decision 12): nothing here touches `tasks` or Google.
- **Times changed after a dose** (Kreatin moved from 08:00 to 07:30 after it was taken): a line or skip at a dose's own time is that dose's; one at a time the schedule no longer has goes to that day's doses that have neither, in time order (08:00's line → 07:30). So today stays taken and no reminder comes, and the past days' history keeps its taken and skipped doses. A line left over (more lines than open doses) belongs to no dose and shows as an ordinary diary line in the slot. A snooze and the reminder bookkeeping stay with their exact time (`resolveDay` / 160's `supplement_doses`).
- A dose's label uses the diary's words: "2 capsules", "0.5 tablet" (one or less stays one), and a recipe's own portion word (157's `serving_label`: "3 pieces", "2 glasses"; "portion" without one).

**The schedule popup** (`supplement-schedule`, through `useEntityModal`; `ModalShell compact`, a bottom sheet on the phone):

```
Kreatin                                                 ×
Your food Kreatin · 0 kcal / 100 g · 1 scoop      Unlink
Dose    [5] [g ▾] = 1 scoop
Times   [08:00 ×] [+ time]
Repeat  [Every day ▾] (the planner's own field)
Starts  [16.10.2026]   Ends [Never ▾] (on a date · after N days)
Remind  [Until taken ▾] every [1 h ▾] until [22:00]
+ Calories  + Notes  + Stock  + Pause
Last 28 days: 26 taken · 1 skipped · 1 missed
[Delete]                                  [Cancel] [Save]
```

- **What**: the name is the content; typing searches your foods and recipes (supplements first) — picking one links it, so a dose logs that food (grams; its preset, "1 scoop = 30 g", is a chip) or recipe (portions) with its own values. Unlinked, it is your own line, with optional calories and macros per dose. Units of your own: g, mg, µg, ml, IU, capsule, tablet, softgel, scoop, drop, piece, sachet ("2 capsules").
- **Repeat** is the planner's `RecurrenceField` over the same repeat columns as a repeating plan (`schedule_blocks`, 146), so a schedule repeats every way a plan does and `recurrence.ts`'s `occursOn` / `repeatSummary` read it unchanged.
- **Ends**: never, on a date, or after N days (saved as the date; a loading phase — 20 g a day for a week, then 5 g — is two schedules).
- **Remind** (decision 10): until taken — every 60 minutes until 22:00 by default, both editable —, once (at the dose's time) or no reminder. When notifications are off on this device the popup says how to turn them on.
- **Stock**: how much is left (in the dose's unit) and how many days before it runs out to warn; what is left is **derived** — the count minus the dose × doses taken since the count — never stored.
- **Pause**: from a day until a day or until resumed; paused days have no doses and no reminders. Resume (the card's or the popup's) ends the pause.
- **Delete** asks, deletes (the dose states go with it; taken doses stay in the diary as plain lines) and offers Undo, which also links them again.

**The dose sheet** (`supplement-dose`): Taken now · Taken earlier at [HH:MM] · Skip today · Snooze 1 h — or, opened for a day, every open dose with Take / Skip / Snooze and Take all.

## Reminders (iPhone)

The iOS limits are in `docs/iphone-web-integration.md`; what they mean here:

- A reminder is a **Web Push**: it reaches only the **installed app** (home screen) with **notifications turned on** on that device, iOS 16.4 or later. A Safari tab gets none.
- Nothing runs on the phone while the app is closed, so the **server** reminds: pg_cron `lascis-supplement-reminders` runs every 15 minutes and calls `push-send` (`{ trigger: 'supplements' }`, the `x-cron-secret` read from Vault, like the morning brief) **only when a reminder is due**. A reminder can therefore be up to ~15 minutes late, and delivery itself is best-effort.
- Every push shows a notification (iOS allows no silent push). One notification per run: "💊 Kreatin 5 g not taken yet (08:00)", or "💊 2 supplements not taken yet" listing them; a newer one replaces the last (same tag, `supplement-reminder`), so hourly reminders don't pile up, and carries `renotify: true` (passed on by `public/push-sw.js`) so the replacement sounds and shows again instead of swapping in silently. **Needs an iPhone check:** WebKit's support for `renotify` is unconfirmed — if an hourly reminder arrives silently on the iPhone, give each reminder its own tag (dose and hour) in `supplementReminder.ts` and its `push-send` copy.
- **No buttons inside an iOS web notification**: the tap opens `#/recipes?dose=…&day=…&at=…`, and the Food page (`useDoseLink` in `RecipesPage`) switches to Today on the dose's day and opens the dose sheet (Taken now · Taken at… · Skip today · Snooze 1 h), whichever tab was open.
- Which reminders are due (`supplement_doses_due`): a due dose of a schedule that reminds, from the dose's time until `remind_until` (at least the quarter hour after the dose's own time, so a dose after the window still gets one), not snoozed, and — until taken — again every `remind_every_min` (5 minutes' grace for the 15-minute job), once more as soon as a snooze ends; `once` never again. `push-send` takes them through `supplement_reminders_claim`, which stamps each dose (`last_reminded_at`, `reminders_sent`) under an advisory lock, so two overlapping runs never send one twice.
- The morning push (07:00 UTC) adds today's open doses ("💊 Kreatin 08:00, Omega-3 20:00").

## The phone's log_supplement

The NFC Shortcut "Log Creatine" (`phone-gateway` `log_supplement`) now takes **today's open dose** of the schedule it names (`schedule_id`), or of the schedule its title names best among those with a dose still open today — the earliest due one, else the next one today — through `supplement_take`, so the dose reads Taken and its reminders stop. A schedule answers to its own name, its linked food's name and its linked recipe's name, read as words (lower case, letters and digits; `supplement_log_rank`):

- the title starts with the whole name — "Kreatin 5 g" ↔ "Kreatin" (best);
- or the title's name part (its words before the first word that starts with a digit) begins the name — "Kreatin 5 g" ↔ "Kreatin monohydrat, Bodylab"; more shared words win ("Omega-3 2 capsules" is Omega-3 fish oil's, not Omega-6's);
- "Vitamin D3" is not "Vitamin D", "Whey shake" is not "Whey protein isolate", and two schedules named equally well ("Vitamin" with Vitamin C and Vitamin D) are nobody's.

Linking a food or a recipe in the schedule popup starts its name as the product's name up to the first comma ("Kreatin monohydrat"); shorten it freely — the link stays. No such dose (nothing matches, all taken, a `date` other than today, or before 160): the plain line, as before. The answer adds `dose: "08:00"` when a dose was taken.

## How it is built

- **Tables** (160): `supplement_schedules` (what, dose, `times time[]`, 146's repeat columns + `effective_from` / `except_dates`, `ends_on`, reminders, pause, notes, stock; trg_audit, so Developer → Activity can undo a save) and `supplement_dose_state` (skip, snooze, reminder bookkeeping; no trg_audit — the job writes it every 15 minutes). `food_log_entries.supplement_schedule_id` (ON DELETE SET NULL) + `dose_time` mark a line as a dose, one eaten line per dose (a unique index). Triggers keep a state row and a diary line on their schedule's account, and times on whole minutes. Owner lock and row level security on both; `ai-proxy`'s `DB_CATALOG` lists both (rw).
- **One repeat rule in SQL**: 160 moved 156's rule into `repeat_rule_occurs_on(kind, days, interval, unit, dates, start, except, day)`; `repeat_occurs_on` (plans) calls it, and so does `supplement_schedule_on`. `verify-db-repeat-days` applies 160's rule section and still compares it with `recurrence.ts` day by day.
- **Dose rules, twice on purpose**: the app's `src/features/supplements/supplementDoses.ts` (statuses, reminders due, history, stock, the dose line's words) and 160's SQL (`supplement_schedule_on`, `supplement_doses`, `supplement_doses_due`). `verify-db-supplement-schedules` compares them on the same rows: a schedule's days over two years for every repeat kind, every dose's status at several instants, the due reminders every 5 minutes over two days (one the clock change). Change the two together.
- **Writes**: a Take is `supplement_take(schedule, date, time, taken_at?, user?)` — the one write of "taken" for the web (signed in) and the phone (service role); a second Take returns the first line. Skip / snooze are upserts of the dose's state row. Hooks: `useSupplements.ts` (`useTakeDoses`, `useSkipDose`, `useSnoozeDose`, `usePauseSupplement`, `useSaveSupplementSchedule`, `useDeleteSupplementSchedule` — every one reports, the takes and skips with Undo). Query keys: `qk.supplements`; the `nutrition` invalidation group includes them (a dose is a diary line).
- **The push text and link** are `supplementReminder.ts`, copied verbatim into `push-send` between `<supplement-reminders>` markers (`verify-supplement-doses` compares them); `parseDoseLink` reads the link back (`useDoseLink`).
- **The card** (`SupplementDosesCard`) takes `date`, the slot's `meals`, `renderRows` (the page's own row renderer) and `renderHeader` (the meal cards' own header — totals in the rows' columns, + Log — given the card's Schedule button to show beside the title; since 26.10.2026, so Supplement reads like every other slot) — Food · Today mounts it in place of the supplement slot.
- Before 160 (a failed migration, a revert): reads answer empty (the card shows only the slot's diary lines), writes throw "migration 160 (supplement_schedules) has not been applied". The guards can go once 160 has run everywhere.

## Open

- Home's **Next up** and the **daily brief** (`briefRules.ts`) have no extension point for doses yet. To wire: (1) `BriefInput` gets `supplements: { due: { title: string; time: string }[] } | null`, filled in `useDailyBrief` from `useSupplementDoses(today).doses` (status `due`), and `briefRules` adds one line ("💊 Kreatin 5 g is due (08:00)" / "2 supplements are due") linking to `/recipes`, with `verify-daily-brief` cases; (2) `NextUpItem.kind` gains `'supplement'`, `useTodayOverview` merges today's `due` / `upcoming` doses (`startHour = minutesOf(time) / 60`) into `upcoming`, and `HomeHero`'s `openItem` opens `{ kind: 'supplement-dose', date, scheduleId, time }` for that kind. The morning **push** already lists today's open doses (push-send).
