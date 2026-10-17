import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'
import type { DoseFacts, DoseState, RemindMode, SupplementSchedule, TakenDose } from '../supplementDoses'
import type { RepeatKind, RepeatUnit } from '../../daily/recurrence'

// Supplement schedules (migration 160): supplement_schedules, the dose states
// (supplement_dose_state) and the taken doses — their diary lines
// (food_log_entries.supplement_schedule_id + dose_time). The website can meet
// a database without 160 (a failed migration, a revert): a READ answers
// empty, so the card shows only the slot's diary lines; a WRITE throws an
// error naming the migration. The guards can go once 160 has run everywhere.

export const NOT_MIGRATED_160 = "Supplement schedules can't be saved yet — migration 160 (supplement_schedules) has not been applied."

function isMissingTable(e: unknown): boolean {
  const x = e as { code?: string; message?: string }
  return x?.code === '42P01' || x?.code === 'PGRST205' || /Could not find the table/i.test(x?.message ?? '')
}
function isMissingColumn(e: unknown): boolean {
  const x = e as { code?: string; message?: string }
  return (x?.code === '42703' || x?.code === 'PGRST204') && /supplement_schedule_id|dose_time/i.test(x?.message ?? '')
}
function isMissingFunction(e: unknown): boolean {
  const x = e as { code?: string; message?: string }
  return x?.code === 'PGRST202' || x?.code === '42883' || /Could not find the function/i.test(x?.message ?? '')
}
const notMigrated = (e: unknown) => isMissingTable(e) || isMissingColumn(e) || isMissingFunction(e)
function writeError(e: unknown): Error {
  return notMigrated(e) ? new Error(NOT_MIGRATED_160) : (e as Error)
}

const num = (v: unknown, d = 0) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : d)
const numOrNull = (v: unknown) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
const strOrNull = (v: unknown) => (typeof v === 'string' && v !== '' ? v : null)
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
const REMIND: readonly RemindMode[] = ['off', 'once', 'until_taken']

// A row as the database answers it; numerics and arrays are checked here, where they enter.
function toSchedule(r: Record<string, unknown>): SupplementSchedule {
  return {
    id: String(r.id),
    title: String(r.title ?? ''),
    library_ingredient_id: strOrNull(r.library_ingredient_id),
    recipe_id: strOrNull(r.recipe_id),
    dose_amount: num(r.dose_amount, 1),
    dose_unit: String(r.dose_unit ?? 'g'),
    calories: num(r.calories), protein_g: num(r.protein_g), carbs_g: num(r.carbs_g), fat_g: num(r.fat_g),
    times: strings(r.times),
    days_of_week: Array.isArray(r.days_of_week) ? (r.days_of_week as unknown[]).map(Number).filter(Number.isInteger) : [],
    repeat_kind: (strOrNull(r.repeat_kind) as RepeatKind | null) ?? 'weekly',
    repeat_interval: numOrNull(r.repeat_interval),
    repeat_unit: strOrNull(r.repeat_unit) as RepeatUnit | null,
    repeat_dates: Array.isArray(r.repeat_dates) ? strings(r.repeat_dates) : null,
    effective_from: String(r.effective_from ?? ''),
    except_dates: strings(r.except_dates),
    ends_on: strOrNull(r.ends_on),
    remind: REMIND.includes(r.remind as RemindMode) ? (r.remind as RemindMode) : 'until_taken',
    remind_every_min: num(r.remind_every_min, 60),
    remind_until: String(r.remind_until ?? '22:00'),
    paused_from: strOrNull(r.paused_from),
    paused_until: strOrNull(r.paused_until),
    notes: strOrNull(r.notes),
    stock_amount: numOrNull(r.stock_amount),
    stock_set_at: strOrNull(r.stock_set_at),
    refill_days: num(r.refill_days, 7),
    created_at: String(r.created_at ?? ''),
    updated_at: String(r.updated_at ?? ''),
    // The linked recipe's portion word (157), when the read carried it.
    ...(r.recipe !== undefined ? { portion_label: strOrNull((r.recipe as { serving_label?: unknown } | null)?.serving_label) } : {}),
  }
}

// A schedule with its recipe's portion word (recipes.serving_label, 157).
// Before 157 the embed fails (42703): the read and the write's answer run
// again without it, and a recipe's dose says "portion". The fallback can go
// once 157 has run everywhere.
const COLUMNS = '*, recipe:recipes(serving_label)'
function isMissingPortion(e: unknown): boolean {
  const x = e as { code?: string; message?: string }
  return (x?.code === '42703' || x?.code === 'PGRST204' || x?.code === 'PGRST200') && /serving_label/i.test(x?.message ?? '')
}
async function withPortion<R extends { error: unknown }>(run: (columns: string) => PromiseLike<R>): Promise<R> {
  const first = await run(COLUMNS)
  return first.error && isMissingPortion(first.error) ? run('*') : first
}

/** The account's schedules, oldest first; [] before migration 160. */
export async function fetchSupplementSchedules(): Promise<SupplementSchedule[]> {
  const { data, error } = await withPortion(cols => supabase.from('supplement_schedules').select(cols).order('created_at', { ascending: true }))
  if (error) {
    if (isMissingTable(error)) return []
    throw error
  }
  return ((data ?? []) as unknown as Record<string, unknown>[]).map(toSchedule)
}

/** One schedule by id (the popup's source of truth), or null. */
export async function fetchSupplementSchedule(id: string): Promise<SupplementSchedule | null> {
  const { data, error } = await withPortion(cols => supabase.from('supplement_schedules').select(cols).eq('id', id).maybeSingle())
  if (error) {
    if (isMissingTable(error)) return null
    throw error
  }
  return data ? toSchedule(data as unknown as Record<string, unknown>) : null
}

/** What a save writes (supplement_schedules' own columns). */
export interface SupplementScheduleInput {
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
  days_of_week:          number[]
  repeat_kind:           RepeatKind
  repeat_interval:       number | null
  repeat_unit:           RepeatUnit | null
  repeat_dates:          string[] | null
  effective_from:        string
  ends_on:               string | null
  remind:                RemindMode
  remind_every_min:      number
  remind_until:          string
  paused_from:           string | null
  paused_until:          string | null
  notes:                 string | null
  stock_amount:          number | null
  refill_days:           number
}

/** Creates a schedule, or saves one (`id`); answers the stored row. */
export async function saveSupplementSchedule(input: SupplementScheduleInput, id?: string): Promise<SupplementSchedule> {
  const user = await requireUser()
  // A failed answer rolls the write back too, so the retry writes once.
  const { data, error } = await withPortion(cols => (id
    ? supabase.from('supplement_schedules').update(input).eq('id', id).eq('user_id', user.id).select(cols).single()
    : supabase.from('supplement_schedules').insert({ ...input, user_id: user.id }).select(cols).single()))
  if (error) throw writeError(error)
  return toSchedule(data as unknown as Record<string, unknown>)
}

/** Pause from a day (until a day, or until resumed: null), or resume (both null). */
export async function setSupplementPause(id: string, pausedFrom: string | null, pausedUntil: string | null): Promise<SupplementSchedule> {
  const user = await requireUser()
  const { data, error } = await withPortion(cols => supabase.from('supplement_schedules')
    .update({ paused_from: pausedFrom, paused_until: pausedUntil })
    .eq('id', id).eq('user_id', user.id).select(cols).single())
  if (error) throw writeError(error)
  return toSchedule(data as unknown as Record<string, unknown>)
}

function toTaken(r: Record<string, unknown>): TakenDose {
  return {
    id: String(r.id),
    supplement_schedule_id: String(r.supplement_schedule_id),
    date: String(r.date),
    dose_time: String(r.dose_time),
    created_at: String(r.created_at),
    calories: numOrNull(r.calories),
  }
}
function toState(r: Record<string, unknown>): DoseState {
  return {
    schedule_id: String(r.schedule_id),
    dose_date: String(r.dose_date),
    dose_time: String(r.dose_time),
    skipped_at: strOrNull(r.skipped_at),
    snoozed_until: strOrNull(r.snoozed_until),
    last_reminded_at: strOrNull(r.last_reminded_at),
    reminders_sent: num(r.reminders_sent),
  }
}

const PAGE = 1000

/** Taken doses (their eaten lines) and dose states from `from` to `to` — empty before 160. */
export async function fetchDoseFacts(from: string, to: string): Promise<DoseFacts> {
  const taken: TakenDose[] = []
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase.from('food_log_entries')
      .select('id, supplement_schedule_id, date, dose_time, created_at, calories')
      .not('supplement_schedule_id', 'is', null)
      .eq('status', 'eaten')
      .gte('date', from).lte('date', to)
      .order('created_at', { ascending: true }).order('id', { ascending: true })
      .range(offset, offset + PAGE - 1)
    if (error) {
      if (notMigrated(error)) return { taken: [], states: [] }
      throw error
    }
    taken.push(...((data ?? []) as Record<string, unknown>[]).filter(r => r.dose_time != null).map(toTaken))
    if ((data?.length ?? 0) < PAGE) break
  }
  const { data, error } = await supabase.from('supplement_dose_state')
    .select('schedule_id, dose_date, dose_time, skipped_at, snoozed_until, last_reminded_at, reminders_sent')
    .gte('dose_date', from).lte('dose_date', to)
    .range(0, PAGE - 1)
  if (error) {
    if (isMissingTable(error)) return { taken, states: [] }
    throw error
  }
  return { taken, states: ((data ?? []) as Record<string, unknown>[]).map(toState) }
}

/** Doses of a schedule taken since its stock was counted (created at or after `since`). */
export async function countTakenSince(scheduleId: string, since: string): Promise<number> {
  const { count, error } = await supabase.from('food_log_entries')
    .select('id', { count: 'exact', head: true })
    .eq('supplement_schedule_id', scheduleId)
    .eq('status', 'eaten')
    .gte('created_at', since)
  if (error) {
    if (notMigrated(error)) return 0
    throw error
  }
  return count ?? 0
}

export interface DoseRef { scheduleId: string; date: string; time: string }

/** "Taken": the dose's diary line (supplement_take — the one write of it, 160).
 *  `takenAt` (ISO) for a dose taken earlier than now. Answers the line's id. */
export async function takeDose(dose: DoseRef, takenAt?: string | null): Promise<{ entryId: string; already: boolean }> {
  const { data, error } = await supabase.rpc('supplement_take', {
    p_schedule: dose.scheduleId, p_date: dose.date, p_time: dose.time, p_taken_at: takenAt ?? null,
  })
  if (error) throw writeError(error)
  const r = (data ?? {}) as { entry_id?: string; already?: boolean }
  if (!r.entry_id) throw new Error('The dose was not saved — try again')
  return { entryId: String(r.entry_id), already: !!r.already }
}

/** Undo of a Take: its diary lines go again (only lines a Take just wrote). */
export async function removeTakenLines(entryIds: readonly string[]): Promise<void> {
  if (entryIds.length === 0) return
  const user = await requireUser()
  const { error } = await supabase.from('food_log_entries').delete().in('id', [...entryIds]).eq('user_id', user.id)
  if (error) throw error
}

/** A dose's own state: skipped / snoozed (null clears it). */
export async function setDoseState(dose: DoseRef, patch: { skipped_at?: string | null; snoozed_until?: string | null }): Promise<void> {
  const user = await requireUser()
  const { error } = await supabase.from('supplement_dose_state').upsert(
    { user_id: user.id, schedule_id: dose.scheduleId, dose_date: dose.date, dose_time: dose.time, ...patch },
    { onConflict: 'schedule_id,dose_date,dose_time' },
  )
  if (error) throw writeError(error)
}
