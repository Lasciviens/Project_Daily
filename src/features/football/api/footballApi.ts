// The owner's football rows (migration 163): what is followed and the matches
// put in the day. Before 163 reads render empty and writes say which
// migration is missing (remove the fallbacks once 163 has been live a while).
import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'
import { itemPayload, saveAnswerOf, type SaveItemAnswer, type SaveItemContext } from '../../items/itemApi'
import type { ItemInput } from '../../items/itemTypes'
import type { FbMatch } from '../footballModel'
import type { FootballFollow, FootballPlan, NewFollowInput } from '../types'

type PgError = { code?: string; message?: string } | null | undefined

const isMissing = (e: PgError) =>
  e?.code === '42P01' || e?.code === 'PGRST205' || e?.code === 'PGRST202' || /could not find the (table|function)/i.test(e?.message ?? '')
export const MISSING_163 = 'Football needs migration 163 — it runs with the next deploy.'
const fail = (e: NonNullable<PgError>) => (isMissing(e) ? new Error(MISSING_163) : e)

// ─── Follows ─────────────────────────────────────────────────────────────────

export async function fetchFollows(): Promise<FootballFollow[]> {
  const { data, error } = await supabase.from('football_follows').select('*').order('sort_order').order('created_at')
  if (error) {
    if (isMissing(error)) return []
    throw error
  }
  return (data ?? []) as FootballFollow[]
}

export async function createFollow(input: NewFollowInput, sortOrder: number): Promise<FootballFollow> {
  const user = await requireUser()
  const { data, error } = await supabase.from('football_follows')
    .insert({ ...input, user_id: user.id, sort_order: sortOrder }).select().single()
  if (error) {
    if (error.code === '23505') throw new Error(`You already follow ${input.name}`)
    throw fail(error)
  }
  return data as FootballFollow
}

export async function setSubscribed(id: string, subscribed: boolean): Promise<FootballFollow> {
  const user = await requireUser()
  const { data, error } = await supabase.from('football_follows')
    .update({ subscribed }).eq('id', id).eq('user_id', user.id).select().single()
  if (error) throw fail(error)
  return data as FootballFollow
}

// ─── Matches in the day ──────────────────────────────────────────────────────

export async function fetchPlans(): Promise<FootballPlan[]> {
  const { data, error } = await supabase.from('football_plans').select('*').order('kickoff_at')
  if (error) {
    if (isMissing(error)) return []
    throw error
  }
  return (data ?? []) as FootballPlan[]
}

/** The record of a match planned through the Add sheet ("Plan it"): its new task takes the match. */
export async function recordPlan(match: FbMatch, taskId: string): Promise<FootballPlan> {
  const user = await requireUser()
  const { data, error } = await supabase.from('football_plans')
    .upsert({
      user_id: user.id, event_id: match.id, league: match.league?.slug ?? '', task_id: taskId,
      kickoff_at: match.kickoff, time_valid: match.timeValid, origin: 'manual',
    }, { onConflict: 'user_id,event_id' })
    .select().single()
  if (error) throw fail(error)
  return data as FootballPlan
}

export interface PlanAnswer extends SaveItemAnswer { planned: boolean; reason: string | null }

/**
 * The subscription's door (163's app_football_plan): the item saved through
 * app_save_item and its record, in one transaction. Without `input.taskId` it
 * adds the match (never a second time, never one whose item was deleted);
 * with it, it moves the plan's own task. Null when it changed nothing.
 */
export async function planMatch(match: FbMatch, origin: 'subscription' | 'manual', input: ItemInput, ctx: SaveItemContext): Promise<PlanAnswer | null> {
  const { data, error } = await supabase.rpc('app_football_plan', {
    p_plan: { eventId: match.id, league: match.league?.slug ?? null, kickoffAt: match.kickoff, timeValid: match.timeValid, origin },
    p_item: itemPayload(input, ctx),
  })
  if (error) throw fail(error)
  const raw = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  if (raw.planned !== true) return null
  return { ...saveAnswerOf(raw), planned: true, reason: null }
}
