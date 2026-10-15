// One item (migration 155) — the database calls. Every write is ONE RPC
// (one transaction → one entry in Developer → Activity); the Google
// Calendar calls that follow a save live in calendar/api/itemCalendar.ts.
// The website can meet a database without 155 (a failed migration, a
// revert): a missing RPC or table answers the named NOT_MIGRATED error, and
// the read-back state reads as "not set up yet". Remove the fallbacks once
// 155 has been live for a while.
import { supabase } from '../../integrations/supabase/client'
import type { CalendarReadbackState, ConvertPreview, ConvertResult, ItemInput } from './itemTypes'

export const ITEMS_NOT_MIGRATED = 'Saving items needs migration 155 — migration 155 not applied yet.'

interface PgError { code?: string; message?: string; details?: string; hint?: string }

const isMissingRpc = (e: PgError | null | undefined) =>
  !!e && (e.code === 'PGRST202' || e.code === '42883' || /could not find the function/i.test(e.message ?? ''))
const isMissingTable = (e: PgError | null | undefined) =>
  !!e && (e.code === '42P01' || e.code === 'PGRST205' || /could not find the table/i.test(e.message ?? ''))

/** The database's own refusals (155's IT0xx codes) read as what they say. */
function rpcError(e: PgError): Error {
  if (isMissingRpc(e)) return new Error(ITEMS_NOT_MIGRATED)
  if (/^IT\d{3}$/.test(e.code ?? '')) return new Error(e.message ?? 'The item could not be saved')
  return Object.assign(new Error(e.message ?? 'The item could not be saved'), { code: e.code, details: e.details })
}

/** app_save_item's answer (migration 155). */
export interface SaveItemAnswer {
  taskId: string | null
  blockId: string | null
  scheduleBlockId: string | null
  created: boolean
  /** The save edited one day of a repeat (that day is an item of its own now). */
  occurrence: boolean
  occurrenceDate: string | null
  /** A slot the item no longer needs that still has its Google event: the event goes first, then the slot. */
  blockToDrop: string | null
  /** A one-off turned into a repeat (its task went) / a repeat turned into a one-off (its rule went). */
  replacedTaskId: string | null
  replacedScheduleBlockId: string | null
  /** That replaced row's Google event (series), removed right after the save. */
  replacedEventId: string | null
  /** Google Tasks sync before and after the save (Tasks → Calendar keeps it on until Calendar is confirmed). */
  googleSyncWas: boolean
  googleSync: boolean
}

const str = (v: unknown) => (typeof v === 'string' && v ? v : null)

export function saveAnswerOf(raw: unknown): SaveItemAnswer {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    taskId: str(r.taskId), blockId: str(r.blockId), scheduleBlockId: str(r.scheduleBlockId),
    created: r.created === true, occurrence: r.occurrence === true, occurrenceDate: str(r.occurrenceDate),
    blockToDrop: str(r.blockToDrop), replacedTaskId: str(r.replacedTaskId), replacedScheduleBlockId: str(r.replacedScheduleBlockId),
    replacedEventId: str(r.replacedEventId), googleSyncWas: r.googleSyncWas === true, googleSync: r.googleSync === true,
  }
}

/** THE item save (app_save_item). `section`: itemRules.sectionForItem; `today`: the device's day. */
export async function saveItem(input: ItemInput, ctx: { section: string | null; today: string; googleConnected: boolean }): Promise<SaveItemAnswer> {
  const { data, error } = await supabase.rpc('app_save_item', {
    p_item: { ...input, section: ctx.section, today: ctx.today, googleConnected: ctx.googleConnected },
  })
  if (error) throw rpcError(error)
  return saveAnswerOf(data)
}

/** The presence slot an item no longer needs, once its event is gone (true = it went). */
export async function dropItemBlock(blockId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('app_item_drop_block', { p_block: blockId })
  if (error) throw rpcError(error)
  return data === true
}

/** app_repeat_day's answer. */
export interface RepeatDayAnswer {
  scheduleBlockId: string
  date: string
  action: string
  changed: boolean
  created: boolean
  taskId: string | null
  blockId: string | null
  previousStatus: string | null
  blockEventId: string | null
  seriesEventId: string | null
}

/** One day of a repeating item: done / skip / undo, or remove / restore ("only this day"). */
export async function repeatDay(scheduleBlockId: string, date: string, action: 'done' | 'skip' | 'undo' | 'remove' | 'restore', today: string): Promise<RepeatDayAnswer> {
  const { data, error } = await supabase.rpc('app_repeat_day', { p_plan: scheduleBlockId, p_date: date, p_action: action, p_today: today })
  if (error) throw rpcError(error)
  const r = (data ?? {}) as Record<string, unknown>
  return {
    scheduleBlockId, date, action, changed: r.changed === true, created: r.created === true,
    taskId: str(r.taskId), blockId: str(r.blockId), previousStatus: str(r.previousStatus),
    blockEventId: str(r.blockEventId), seriesEventId: str(r.seriesEventId),
  }
}

const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0)

export async function fetchConvertPreview(today: string): Promise<ConvertPreview> {
  const { data, error } = await supabase.rpc('app_convert_preview', { p_today: today })
  if (error) throw rpcError(error)
  const r = (data ?? {}) as Record<string, unknown>
  const examples = Array.isArray(r.examples) ? r.examples : []
  return {
    futureStandaloneBlocks: count(r.futureStandaloneBlocks),
    pastStandaloneBlocks: count(r.pastStandaloneBlocks),
    plans: count(r.plans),
    tasksWithSlots: count(r.tasksWithSlots),
    autoClearedEpisodes: count(r.autoClearedEpisodes),
    examples: examples.map(e => ({ title: String((e as Record<string, unknown>)?.title ?? ''), date: String((e as Record<string, unknown>)?.date ?? '') })),
  }
}

export async function convertOldItems(today: string): Promise<ConvertResult> {
  const { data, error } = await supabase.rpc('app_convert_apply', { p_today: today })
  if (error) throw rpcError(error)
  const r = (data ?? {}) as Record<string, unknown>
  return { converted: count(r.converted), conversionId: str(r.conversionId) }
}

export async function undoConversion(conversionId: string): Promise<{ undone: number; kept: number; already: boolean }> {
  const { data, error } = await supabase.rpc('app_convert_undo', { p_conversion: conversionId })
  if (error) throw rpcError(error)
  const r = (data ?? {}) as Record<string, unknown>
  return { undone: count(r.undone), kept: count(r.kept), already: r.already === true }
}

/** The Calendar read-back's last run (google-tasks-sync writes it; the browser reads only its outcome). */
export async function fetchCalendarReadbackState(): Promise<CalendarReadbackState> {
  const { data, error } = await supabase
    .from('google_calendar_sync_state')
    .select('last_run_at, last_clean_at, last_error, last_applied')
    .maybeSingle()
  if (error) {
    if (isMissingTable(error)) return { lastRunAt: null, lastCleanAt: null, lastError: null, lastApplied: 0, available: false }
    throw error
  }
  return {
    lastRunAt: data?.last_run_at ?? null,
    lastCleanAt: data?.last_clean_at ?? null,
    lastError: data?.last_error ?? null,
    lastApplied: data?.last_applied ?? 0,
    available: true,
  }
}
