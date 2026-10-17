// ─────────────────────────────────────────────────────────────────────────────
//  THE dose rules of a supplement schedule (migration 160) — which doses a day
//  has, what state each is in, which reminders are due, the last 28 days and
//  the stock. Pure and import-free but for recurrence.ts (sucrase verify:
//  scripts/verify-supplement-doses.cjs). The server's copy is 160's SQL
//  (supplement_schedule_on, supplement_doses, supplement_doses_due);
//  scripts/verify-db-supplement-schedules.mjs compares the two on the same
//  rows — change them together.
//
//  A dose is a (schedule, day, time). Its state:
//    taken    its eaten diary line exists (food_log_entries.supplement_schedule_id
//             + dose_time) — a taken dose always has one (decision 11)
//    skipped  skipped (supplement_dose_state.skipped_at) and not taken
//    missed   a past day, neither
//    upcoming later today, or a later day
//    due      today and its time has come (snoozed or not)
//  Doses are not tasks (decision 12). Times are the home clock's (Europe/Oslo
//  on the server, the device's in the app — the owner's are the same).
// ─────────────────────────────────────────────────────────────────────────────

import { addDaysIso, isIsoDay, occursOn, occurrencesBetween, type RepeatRule } from '../daily/recurrence'
import { plural } from '../recipes/foodAmount'

export type RemindMode = 'off' | 'once' | 'until_taken'
export type DoseStatus = 'taken' | 'skipped' | 'due' | 'upcoming' | 'missed'

/** A supplement_schedules row (times as PostgREST sends them: 'HH:MM:SS'). */
export interface SupplementSchedule extends RepeatRule {
  id:                    string
  title:                 string
  library_ingredient_id: string | null
  recipe_id:             string | null
  dose_amount:           number
  dose_unit:             string
  calories:              number
  protein_g:             number
  carbs_g:               number
  fat_g:                 number
  times:                 string[]
  effective_from:        string
  except_dates:          string[]
  ends_on:               string | null
  remind:                RemindMode
  remind_every_min:      number
  remind_until:          string
  paused_from:           string | null
  paused_until:          string | null
  notes:                 string | null
  stock_amount:          number | null
  stock_set_at:          string | null
  refill_days:           number
  created_at:            string
  updated_at:            string
  /** A recipe's portion word (recipes.serving_label, 157), read with the
   *  schedule — "piece" makes a dose "3 pieces". Not a column of its own. */
  portion_label?:        string | null
}

/** A taken dose: its eaten diary line. */
export interface TakenDose {
  id:                     string
  supplement_schedule_id: string
  date:                   string
  dose_time:              string
  created_at:             string
  calories?:              number | null
}

/** A supplement_dose_state row. */
export interface DoseState {
  schedule_id:      string
  dose_date:        string
  dose_time:        string
  skipped_at:       string | null
  snoozed_until:    string | null
  last_reminded_at: string | null
  reminders_sent:   number
}

export interface DoseFacts {
  taken:  readonly TakenDose[]
  states: readonly DoseState[]
}

/** The home clock: today, minutes since midnight, and the instant (ms). */
export interface LocalNow {
  date:    string
  minutes: number
  ms:      number
}

export interface Dose {
  /** `${scheduleId}|${date}|${HH:MM}` — one dose. */
  key:            string
  scheduleId:     string
  title:          string
  /** "5 g", "2 capsules", "1 portion". */
  label:          string
  date:           string
  /** 'HH:MM'. */
  time:           string
  status:         DoseStatus
  entryId:        string | null
  takenAt:        string | null
  snoozedUntil:   string | null
  lastRemindedAt: string | null
  remindersSent:  number
}

/** 'HH:MM' of a PostgREST time ('08:00:00') or a typed one ('8:00'). */
export function hhmm(t: string): string {
  const [h = '0', m = '0'] = String(t).split(':')
  return `${h.padStart(2, '0')}:${m.padStart(2, '0').slice(0, 2)}`
}

/** Minutes since midnight of a time. */
export function minutesOf(t: string): number {
  const [h, m] = hhmm(t).split(':').map(Number)
  return h * 60 + m
}

/** The home clock at an instant, read from the device's own time zone. */
export function localNow(ms: number): LocalNow {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, minutes: d.getHours() * 60 + d.getMinutes(), ms }
}

/** A dose amount as people write it: 5, 2.5, 0.25 (two decimals at most). */
export function formatAmount(n: number): string {
  return String(Math.round(Number(n) * 100) / 100)
}

/** Units counted in pieces: "1 capsule", "2 capsules" (160's supplement_dose_label has the same list). */
export const COUNT_UNITS = ['capsule', 'tablet', 'softgel', 'scoop', 'drop', 'piece', 'sachet'] as const

/** "5 g", "2 capsules", "0.5 capsule", "3 pieces" — 160's supplement_dose_label.
 *  A recipe's dose counts its portion word (157's serving_label, else
 *  "portion"); a count unit and a portion word are plural above one, the
 *  diary's own rule (foodAmount.plural). */
export function doseLabel(amount: number, unit: string, portionLabel?: string | null): string {
  if (unit === 'serving') return `${formatAmount(amount)} ${plural(portionLabel?.trim() || 'portion', Number(amount))}`
  if ((COUNT_UNITS as readonly string[]).includes(unit)) return `${formatAmount(amount)} ${plural(unit, Number(amount))}`
  return `${formatAmount(amount)} ${unit}`
}

/** Paused on that day (from paused_from, until paused_until or until resumed). */
export function pausedOn(s: Pick<SupplementSchedule, 'paused_from' | 'paused_until'>, day: string): boolean {
  return !!s.paused_from && day >= s.paused_from && (!s.paused_until || day <= s.paused_until)
}

/** Paused today or later, still (a pause that ended is history only). */
export function isPaused(s: Pick<SupplementSchedule, 'paused_from' | 'paused_until'>, today: string): boolean {
  return !!s.paused_from && (!s.paused_until || today <= s.paused_until)
}

/** Resume: a pause that started before today ends yesterday (its days stay
 *  paused in the history, not missed); one that starts today or later goes. */
export function resumePause(s: Pick<SupplementSchedule, 'paused_from'>, today: string): { from: string | null; until: string | null } {
  return s.paused_from && s.paused_from < today ? { from: s.paused_from, until: addDaysIso(today, -1) } : { from: null, until: null }
}

/** Does the schedule have doses on `day`? Its repeat rule (recurrence.occursOn),
 *  not after ends_on, not while paused — 160's supplement_schedule_on. */
export function scheduleOn(s: SupplementSchedule, day: string): boolean {
  if (!isIsoDay(day)) return false
  if (s.ends_on && day > s.ends_on) return false
  if (pausedOn(s, day)) return false
  return occursOn(s, day)
}

const keyOf = (scheduleId: string, date: string, time: string) => `${scheduleId}|${date}|${hhmm(time)}`
const dayOf = (scheduleId: string, date: string) => `${scheduleId}|${date}`

/** A schedule's day as it was recorded: the first taken line of each time
 *  (the oldest wins) and each time's skip. */
interface RecordedDay { lines: Map<string, TakenDose>; skips: Map<string, DoseState> }

function recordedDays(facts: DoseFacts): Map<string, RecordedDay> {
  const out = new Map<string, RecordedDay>()
  const day = (sid: string, date: string) => {
    const k = dayOf(sid, date)
    let d = out.get(k)
    if (!d) out.set(k, (d = { lines: new Map(), skips: new Map() }))
    return d
  }
  const sorted = [...facts.taken].sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1))
  for (const t of sorted) {
    const d = day(t.supplement_schedule_id, t.date)
    if (!d.lines.has(hhmm(t.dose_time))) d.lines.set(hhmm(t.dose_time), t)
  }
  for (const s of facts.states) if (s.skipped_at) day(s.schedule_id, s.dose_date).skips.set(hhmm(s.dose_time), s)
  return out
}

/** Which taken line or skip each of a day's doses has. A line or skip at a
 *  dose's own time is that dose's. One at a time the schedule no longer has
 *  (its times changed after it was taken or skipped) goes to the day's doses
 *  that have neither, in time order — so moving 08:00 to 07:30 after taking
 *  it keeps today taken and the past days' history. Left over: no dose (the
 *  line stays an ordinary diary line). 160's supplement_doses does the same. */
export function resolveDay(times: readonly string[], rec: RecordedDay | undefined): Map<string, { line?: TakenDose; skip?: DoseState }> {
  const out = new Map<string, { line?: TakenDose; skip?: DoseState }>()
  const free: string[] = []
  for (const t of times) {
    const line = rec?.lines.get(t), skip = rec?.skips.get(t)
    if (line || skip) out.set(t, { line, skip: line ? undefined : skip })
    else free.push(t)
  }
  if (!rec) return out
  const own = new Set(times)
  const orphans = [...new Set([...rec.lines.keys(), ...rec.skips.keys()])].filter(t => !own.has(t)).sort()
  orphans.forEach((t, i) => {
    if (i >= free.length) return
    const line = rec.lines.get(t)
    out.set(free[i], line ? { line } : { skip: rec.skips.get(t) })
  })
  return out
}

function statusOf(date: string, time: string, taken: TakenDose | undefined, skip: DoseState | undefined, now: LocalNow): DoseStatus {
  if (taken) return 'taken'
  if (skip?.skipped_at) return 'skipped'
  if (date < now.date) return 'missed'
  if (date > now.date || minutesOf(time) > now.minutes) return 'upcoming'
  return 'due'
}

/** Every dose from `from` to `to` (both included), by day, time, title, id — 160's supplement_doses. */
export function dosesBetween(schedules: readonly SupplementSchedule[], from: string, to: string, facts: DoseFacts, now: LocalNow): Dose[] {
  if (!isIsoDay(from) || !isIsoDay(to) || to < from) return []
  const recorded = recordedDays(facts)
  // A snooze and the reminder bookkeeping belong to the exact time only.
  const states = new Map(facts.states.map(s => [keyOf(s.schedule_id, s.dose_date, s.dose_time), s]))
  const out: Dose[] = []
  for (let day = from; day <= to; day = addDaysIso(day, 1)) {
    for (const s of schedules) {
      if (!scheduleOn(s, day)) continue
      const times = [...new Set(s.times.map(hhmm))].sort()
      const resolved = resolveDay(times, recorded.get(dayOf(s.id, day)))
      for (const t of times) {
        const k = keyOf(s.id, day, t)
        const r = resolved.get(t)
        const st = states.get(k)
        out.push({
          key: k, scheduleId: s.id, title: s.title, label: doseLabel(s.dose_amount, s.dose_unit, s.portion_label), date: day, time: t,
          status: statusOf(day, t, r?.line, r?.skip, now),
          entryId: r?.line?.id ?? null, takenAt: r?.line?.created_at ?? null,
          snoozedUntil: st?.snoozed_until ?? null, lastRemindedAt: st?.last_reminded_at ?? null, remindersSent: st?.reminders_sent ?? 0,
        })
      }
    }
  }
  return out.sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1)
    : a.time !== b.time ? (a.time < b.time ? -1 : 1)
    : a.title !== b.title ? (a.title < b.title ? -1 : 1)
    : a.scheduleId < b.scheduleId ? -1 : 1))
}

/** One day's doses. */
export function dosesOn(schedules: readonly SupplementSchedule[], day: string, facts: DoseFacts, now: LocalNow): Dose[] {
  return dosesBetween(schedules, day, day, facts, now)
}

const ms = (iso: string | null) => (iso ? Date.parse(iso) : NaN)

/** Is this dose's push due now? — 160's supplement_doses_due for one dose:
 *  due today, the schedule reminds, inside its window (the dose's time until
 *  remind_until, at least the quarter hour after the dose's time), not
 *  snoozed, and not reminded too recently (once: never again; until taken:
 *  every remind_every_min with 5 minutes' grace; and once as a snooze ends). */
export function reminderDue(s: SupplementSchedule, d: Dose, now: LocalNow): boolean {
  if (d.status !== 'due' || s.remind === 'off') return false
  if (now.minutes >= Math.max(minutesOf(s.remind_until), minutesOf(d.time) + 15)) return false
  const snooze = ms(d.snoozedUntil)
  if (!Number.isNaN(snooze) && snooze > now.ms) return false
  const last = ms(d.lastRemindedAt)
  if (Number.isNaN(last)) return true
  if (!Number.isNaN(snooze) && last < snooze) return true
  return s.remind === 'until_taken' && now.ms >= last + (s.remind_every_min - 5) * 60_000
}

/** Today's doses whose push is due now (one account). */
export function remindersDue(schedules: readonly SupplementSchedule[], facts: DoseFacts, now: LocalNow): Dose[] {
  const byId = new Map(schedules.map(s => [s.id, s]))
  return dosesOn(schedules, now.date, facts, now).filter(d => reminderDue(byId.get(d.scheduleId)!, d, now))
}

export interface DoseHistory { taken: number; skipped: number; missed: number }

/** "Last 28 days: 26 taken · 1 skipped · 1 missed" — today's doses count once
 *  taken or skipped (an open one today isn't missed yet). */
export function doseHistory(s: SupplementSchedule, facts: DoseFacts, now: LocalNow, days = 28): DoseHistory {
  const out: DoseHistory = { taken: 0, skipped: 0, missed: 0 }
  for (const d of dosesBetween([s], addDaysIso(now.date, -(days - 1)), now.date, facts, now)) {
    if (d.status === 'taken') out.taken++
    else if (d.status === 'skipped') out.skipped++
    else if (d.status === 'missed') out.missed++
  }
  return out
}

/** Doses a day on average over the next four weeks (paused or ended days count 0). */
export function dosesPerDay(s: SupplementSchedule, today: string): number {
  const days = occurrencesBetween(s, today, addDaysIso(today, 27)).filter(d => scheduleOn(s, d))
  return (days.length * new Set(s.times.map(hhmm)).size) / 28
}

export interface StockLeft {
  /** In the dose's unit (never below 0). */
  left:     number
  /** Whole days it lasts at the schedule's pace; null when no dose is ahead. */
  days:     number | null
  /** Time to buy more: nothing left, or within refill_days. */
  refill:   boolean
}

/** What is left of the stock: stock_amount − dose_amount × doses taken since it
 *  was counted (`takenSince`). Null when the schedule keeps no stock. */
export function stockLeft(s: SupplementSchedule, takenSince: number, today: string): StockLeft | null {
  if (s.stock_amount == null) return null
  const left = Math.max(0, s.stock_amount - s.dose_amount * takenSince)
  const perDay = dosesPerDay(s, today) * s.dose_amount
  const days = perDay > 0 ? Math.floor(left / perDay) : null
  return { left, days, refill: left <= 0 || (days != null && days <= s.refill_days) }
}

const clock = (ms: number) => {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
const span = (minutes: number) => (minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h`)

/** Where a dose stands, in words: "taken 08:12", "due 2 h ago", "due now",
 *  "snoozed until 10:12", "in 40 min", "skipped", "missed" ('' for a later day). */
export function doseWhen(d: Dose, now: LocalNow): string {
  switch (d.status) {
    case 'taken': return d.takenAt ? `taken ${clock(Date.parse(d.takenAt))}` : 'taken'
    case 'skipped': return 'skipped'
    case 'missed': return 'missed'
    case 'due': {
      const snooze = d.snoozedUntil ? Date.parse(d.snoozedUntil) : NaN
      if (!Number.isNaN(snooze) && snooze > now.ms) return `snoozed until ${clock(snooze)}`
      const ago = now.minutes - minutesOf(d.time)
      return ago <= 0 ? 'due now' : `due ${span(ago)} ago`
    }
    case 'upcoming': return d.date === now.date ? `in ${span(minutesOf(d.time) - now.minutes)}` : ''
  }
}

/** The doses that can be taken in one tap ("Take all due"): due, not taken. */
export function dueDoses(doses: readonly Dose[]): Dose[] {
  return doses.filter(d => d.status === 'due')
}

/** When a Take is stamped (ISO), or null for now: at `at` ('HH:MM') on the
 *  dose's day when given; a dose of another day at its own time that day. */
export function takenAtFor(d: Pick<Dose, 'date' | 'time'>, at: string | null | undefined, today: string): string | null {
  const t = at ?? (d.date === today ? null : d.time)
  if (!t) return null
  const [y, m, day] = d.date.split('-').map(Number)
  const [h, min] = hhmm(t).split(':').map(Number)
  return new Date(y, m - 1, day, h, min).toISOString()
}
