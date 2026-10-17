// ─────────────────────────────────────────────────────────────────────────────
//  The supplement schedule popup's form ⇄ a supplement_schedules row
//  (migration 160). Pure (scripts/verify-supplement-doses.cjs). The Repeat
//  part is the planner's own (planModal.config: RepeatFormFields,
//  repeatRowFromForm, recurrenceProblem), so a schedule repeats exactly the
//  ways a plan does and recurrence.ts reads both.
// ─────────────────────────────────────────────────────────────────────────────

import {
  recurrenceProblem, repeatFormFromRow, repeatRowFromForm, repeatStart, type RepeatFormFields,
} from '../../shared/components/plan-modal/planModal.config'
import { addDaysIso, dayNumber, isIsoDay, weekdayOfIso } from '../daily/recurrence'
import { COUNT_UNITS, hhmm, type RemindMode, type SupplementSchedule } from './supplementDoses'
import type { SupplementScheduleInput } from './api/supplementsApi'

export type ScheduleSource =
  | { kind: 'custom' }
  | { kind: 'food'; id: string }
  | { kind: 'recipe'; id: string }

export type EndsMode = 'never' | 'date' | 'days'

export interface ScheduleForm {
  title:       string
  source:      ScheduleSource
  amount:      string
  unit:        string
  /** A custom line's values per dose. */
  calories:    string
  protein:     string
  carbs:       string
  fat:         string
  /** 'HH:MM', sorted. */
  times:       string[]
  repeat:      RepeatFormFields
  /** The first day (effective_from). */
  start:       string
  ends:        EndsMode
  endDate:     string
  endDays:     string
  remind:      RemindMode
  every:       number
  /** 'HH:MM'. */
  until:       string
  /** null = the row is closed (the "+ Notes" chip waits). */
  notes:       string | null
  /** null = no stock kept. */
  stock:       string | null
  refillDays:  string
  pausedFrom:  string | null
  pausedUntil: string | null
}

/** A custom line's units (a food is grams / ml, a recipe its portions). */
export const CUSTOM_UNITS: readonly string[] = ['g', 'mg', 'µg', 'ml', 'IU', ...COUNT_UNITS]
/** How often "until taken" reminds. */
export const REMIND_EVERY: readonly number[] = [15, 30, 60, 90, 120, 180]

const DEFAULT_REPEAT: RepeatFormFields = {
  recurrence: 'daily', weeklyDays: [0, 1, 2, 3, 4, 5, 6], monthWeekday: null, customKind: 'every', repeatEvery: '2', repeatUnit: 'day', repeatDates: [],
}

const str = (n: number | null | undefined) => (n == null || !Number.isFinite(n) || n === 0 ? '' : String(n))

/** A new schedule's form (one dose at 08:00, every day from today, reminders every hour until 22:00 — decision 10). */
export function newScheduleForm(today: string, title = ''): ScheduleForm {
  return {
    title, source: { kind: 'custom' }, amount: '1', unit: 'g', calories: '', protein: '', carbs: '', fat: '',
    // Every day; Weekly would start from today's weekday.
    times: ['08:00'], repeat: { ...DEFAULT_REPEAT, weeklyDays: [weekdayOfIso(today)] }, start: today,
    ends: 'never', endDate: '', endDays: '',
    remind: 'until_taken', every: 60, until: '22:00',
    notes: null, stock: null, refillDays: '7', pausedFrom: null, pausedUntil: null,
  }
}

/** A saved schedule as the form. */
export function scheduleToForm(s: SupplementSchedule): ScheduleForm {
  const repeat: RepeatFormFields = {
    ...DEFAULT_REPEAT,
    ...repeatFormFromRow({
      days_of_week: [...s.days_of_week], repeat_kind: s.repeat_kind, repeat_interval: s.repeat_interval,
      repeat_unit: s.repeat_unit, repeat_dates: s.repeat_dates ? [...s.repeat_dates] : null,
    }),
  }
  return {
    title: s.title,
    source: s.library_ingredient_id ? { kind: 'food', id: s.library_ingredient_id } : s.recipe_id ? { kind: 'recipe', id: s.recipe_id } : { kind: 'custom' },
    amount: String(s.dose_amount), unit: s.dose_unit,
    calories: str(s.calories), protein: str(s.protein_g), carbs: str(s.carbs_g), fat: str(s.fat_g),
    times: [...new Set(s.times.map(hhmm))].sort(),
    repeat,
    start: s.effective_from,
    ends: s.ends_on ? 'date' : 'never', endDate: s.ends_on ?? '', endDays: '',
    remind: s.remind, every: s.remind_every_min, until: hhmm(s.remind_until),
    notes: s.notes, stock: s.stock_amount == null ? null : String(s.stock_amount), refillDays: String(s.refill_days),
    pausedFrom: s.paused_from, pausedUntil: s.paused_until,
  }
}

const amountOf = (v: string) => Number(String(v).replace(',', '.'))
const macro = (v: string) => (v.trim() === '' ? 0 : amountOf(v))

/** The last day it has doses (ends_on) for the chosen end. */
export function endsOn(f: Pick<ScheduleForm, 'ends' | 'endDate' | 'endDays' | 'start'>): string | null {
  if (f.ends === 'date') return isIsoDay(f.endDate) ? f.endDate : null
  if (f.ends === 'days') {
    const n = Math.floor(amountOf(f.endDays))
    return Number.isFinite(n) && n >= 1 && isIsoDay(f.start) ? addDaysIso(f.start, n - 1) : null
  }
  return null
}

/** Days from the start to the end, both counted ("after N days"). */
export function daysBetween(start: string, end: string): number {
  return dayNumber(end) - dayNumber(start) + 1
}

/** Why the form can't be saved yet, or null when it can. */
export function scheduleProblem(f: ScheduleForm): string | null {
  if (!f.title.trim()) return 'Name what you take.'
  if (f.title.trim().length > 80) return 'Keep the name to 80 characters.'
  const amount = amountOf(f.amount)
  if (!Number.isFinite(amount) || amount <= 0 || amount > 10000) return 'Give the dose (more than 0).'
  if (!f.unit.trim()) return 'Pick the dose\'s unit.'
  if (f.source.kind === 'custom') {
    for (const [label, v, max] of [['Calories', f.calories, 5000], ['Protein', f.protein, 500], ['Carbs', f.carbs, 1000], ['Fat', f.fat, 500]] as const) {
      const n = macro(v)
      if (!Number.isFinite(n) || n < 0 || n > max) return `${label}: 0 to ${max}.`
    }
  }
  if (f.times.length === 0) return 'Add a time of day.'
  if (f.times.length > 12) return 'At most 12 times a day.'
  const repeat = recurrenceProblem(f.repeat)
  if (repeat) return repeat
  if (!isIsoDay(f.start)) return 'Pick the first day.'
  if (f.ends === 'date' && (!isIsoDay(f.endDate) || f.endDate < f.start)) return 'The last day is on or after the first.'
  if (f.ends === 'days' && endsOn(f) == null) return 'Give how many days (1 or more).'
  if (!REMIND_EVERY.includes(f.every)) return 'Pick how often it reminds.'
  if (f.stock != null) {
    const n = amountOf(f.stock)
    if (f.stock.trim() === '' || !Number.isFinite(n) || n < 0 || n > 1_000_000) return 'Give the stock (0 or more), or remove it.'
    const days = Math.floor(amountOf(f.refillDays))
    if (!Number.isFinite(days) || days < 0 || days > 90) return 'Warn 0 to 90 days before it runs out.'
  }
  if (f.pausedFrom != null && !isIsoDay(f.pausedFrom)) return 'Pick the day the pause starts.'
  if (f.pausedUntil && (!f.pausedFrom || f.pausedUntil < f.pausedFrom)) return 'The pause ends on or after it starts.'
  return null
}

/** The row a save writes. Call only for a form scheduleProblem accepts. */
export function scheduleRowFromForm(f: ScheduleForm): SupplementScheduleInput {
  const repeat = repeatRowFromForm(f.repeat)
  const start = repeatStart(repeat, f.start)
  const custom = f.source.kind === 'custom'
  return {
    title: f.title.trim(),
    library_ingredient_id: f.source.kind === 'food' ? f.source.id : null,
    recipe_id: f.source.kind === 'recipe' ? f.source.id : null,
    dose_amount: amountOf(f.amount),
    dose_unit: f.source.kind === 'recipe' ? 'serving' : f.unit.trim(),
    calories: custom ? macro(f.calories) : 0,
    protein_g: custom ? macro(f.protein) : 0,
    carbs_g: custom ? macro(f.carbs) : 0,
    fat_g: custom ? macro(f.fat) : 0,
    times: [...new Set(f.times.map(hhmm))].sort(),
    days_of_week: repeat.days_of_week,
    repeat_kind: repeat.repeat_kind,
    repeat_interval: repeat.repeat_interval,
    repeat_unit: repeat.repeat_unit,
    repeat_dates: repeat.repeat_dates,
    effective_from: start,
    ends_on: endsOn({ ...f, start }),
    remind: f.remind,
    remind_every_min: f.every,
    remind_until: f.until,
    paused_from: f.pausedFrom,
    paused_until: f.pausedFrom ? f.pausedUntil : null,
    notes: f.notes?.trim() ? f.notes.trim() : null,
    stock_amount: f.stock == null ? null : amountOf(f.stock),
    refill_days: f.stock == null ? 7 : Math.floor(amountOf(f.refillDays)),
  }
}

/** The next time to offer after the ones set ("+ time"): 08:00, then 12 hours on, else an hour after the last. */
export function nextTime(times: readonly string[]): string {
  if (times.length === 0) return '08:00'
  const last = [...times].sort().pop()!
  const [h, m] = last.split(':').map(Number)
  const next = h + 12 <= 23 ? h + 12 : Math.min(23, h + 1)
  const candidate = `${String(next).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  return times.includes(candidate) ? `${String(Math.min(23, next + 1)).padStart(2, '0')}:00` : candidate
}
