// Reads for linked plans (210/211): a thing's open plan (the reverse chip, and "plan it again" opening it), and the
// thing a task plans (the item screen's Linked chip). New reads of their own — they never filter an existing task
// query (NEVER_HIDES). A database without 210 has no link columns: the reads answer "none" (42703 / PGRST204).
import { supabase } from '../../integrations/supabase/client'
import { LINK_KINDS, type TaskLink } from './linkKinds'
import type { ItemLinkKind } from './itemTypes'
import type { EffectTarget, TickEffect } from './tickMessage'

interface PgError { code?: string; message?: string }
const isBefore210 = (e: PgError | null | undefined) => !!e && (e.code === '42703' || e.code === 'PGRST204' || e.code === 'PGRST200')

/** A thing's open plan: the task, its title (a shop thing's plans differ — return, complain, handover) and its day
 *  (its slot's date, else its due day; null when undated). */
export interface OpenPlan { taskId: string; title: string; day: string | null }

/** The open plan of this thing (the nearest one for a routine, which may have one a week; for a show, of one
 *  episode when `episode` is given). Null when it has none. */
export async function fetchOpenPlan(kind: ItemLinkKind, id: string, episode?: { season: number; episode: number }): Promise<OpenPlan | null> {
  let q = supabase.from('tasks')
    .select('id, title, due_date, created_at, time_blocks(date)')
    .eq(LINK_KINDS[kind].column, id)
    .not('status', 'in', '(done,cancelled)')
  if (episode) q = q.eq('link_season', episode.season).eq('link_episode', episode.episode)
  const { data, error } = await q
    .order('due_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) {
    if (isBefore210(error)) return null
    throw error
  }
  const row = (data ?? [])[0] as { id: string; title: string; due_date: string | null; time_blocks?: { date: string | null }[] | null } | undefined
  if (!row) return null
  const slot = (row.time_blocks ?? []).map(b => b.date).filter((d): d is string => !!d).sort()[0] ?? null
  return { taskId: row.id, title: row.title, day: slot ?? row.due_date ?? null }
}

/** Where the Linked chip takes the owner: a popup of the thing, or a page. */
export type ThingTarget =
  | { kind: 'media'; tmdbId: number; mediaType: 'movie' | 'tv' }
  | { kind: 'shop-item'; id: string }
  | { kind: 'wish'; id: string }
  | { kind: 'football-match'; eventId: string; league: string }
  | { kind: 'book'; id: string }
  | { kind: 'game'; id: string }
  | { kind: 'route'; path: string }

export interface LinkedThing { title: string | null; target: ThingTarget | null }

const one = async <T,>(q: PromiseLike<{ data: unknown; error: PgError | null }>): Promise<T | null> => {
  const { data, error } = await q
  if (error) throw error
  return (data ?? null) as T | null
}

/** The thing a task's link names: its title and where it opens. Null target: it is gone (or not readable). */
export async function fetchLinkedThing(link: TaskLink): Promise<LinkedThing> {
  switch (link.kind) {
    case 'movie': {
      const r = await one<{ movie: { tmdb_id: number; title: string } | null }>(
        supabase.from('user_movie_entries').select('movie:movies(tmdb_id, title)').eq('id', link.id).maybeSingle())
      return r?.movie ? { title: r.movie.title, target: { kind: 'media', tmdbId: r.movie.tmdb_id, mediaType: 'movie' } } : { title: null, target: null }
    }
    case 'tv': {
      const r = await one<{ tv_series: { tmdb_id: number; title: string } | null }>(
        supabase.from('user_tv_entries').select('tv_series:tv_series(tmdb_id, title)').eq('id', link.id).maybeSingle())
      return r?.tv_series ? { title: r.tv_series.title, target: { kind: 'media', tmdbId: r.tv_series.tmdb_id, mediaType: 'tv' } } : { title: null, target: null }
    }
    case 'shop_item': {
      const r = await one<{ title: string }>(supabase.from('shop_items').select('title').eq('id', link.id).maybeSingle())
      return r ? { title: r.title, target: { kind: 'shop-item', id: link.id } } : { title: null, target: null }
    }
    case 'wish': {
      const r = await one<{ title: string }>(supabase.from('wish_items').select('title').eq('id', link.id).maybeSingle())
      return r ? { title: r.title, target: { kind: 'wish', id: link.id } } : { title: null, target: null }
    }
    case 'football': {
      const r = await one<{ event_id: string; league: string }>(supabase.from('football_plans').select('event_id, league').eq('id', link.id).maybeSingle())
      return r ? { title: null, target: { kind: 'football-match', eventId: r.event_id, league: r.league } } : { title: null, target: null }
    }
    case 'game': {
      const r = await one<{ title: string }>(supabase.from('games').select('title').eq('id', link.id).maybeSingle())
      return r ? { title: r.title, target: { kind: 'game', id: link.id } } : { title: null, target: null }
    }
    case 'book': {
      const r = await one<{ title: string }>(supabase.from('books').select('title').eq('id', link.id).maybeSingle())
      return r ? { title: r.title, target: { kind: 'book', id: link.id } } : { title: null, target: null }
    }
    case 'training': {
      const r = await one<{ title: string }>(supabase.from('hevy_routines').select('title').eq('id', link.id).maybeSingle())
      return r ? { title: r.title, target: { kind: 'route', path: '/training' } } : { title: null, target: null }
    }
  }
}

// ── What a tick did (211's ledger) ──────────────────────────────────────────

/** The effects a task's tick has in the ledger (the browser reads it; only the database writes it). None on a
 *  database before 211 (no table). */
export async function fetchTickEffects(taskId: string): Promise<TickEffect[]> {
  const { data, error } = await supabase.from('task_link_effects').select('effect, target_id, before').eq('task_id', taskId)
  if (error) {
    if (['42P01', 'PGRST205', 'PGRST202'].includes(error.code ?? '')) return []
    throw error
  }
  return ((data ?? []) as TickEffect[]).filter(e => e.effect === 'shop_bought' || e.effect === 'wish_done' || e.effect === 'phase_done')
}

/** The thing an effect touched, as it is now: its title and status. */
export async function fetchEffectTarget(e: TickEffect): Promise<EffectTarget> {
  const table = e.effect === 'shop_bought' ? 'shop_items' : e.effect === 'wish_done' ? 'wish_items' : 'project_phases'
  const name = e.effect === 'phase_done' ? 'name' : 'title'
  const { data, error } = await supabase.from(table).select(`${name}, status`).eq('id', e.target_id).maybeSingle()
  if (error) throw error
  const row = (data ?? null) as Record<string, string | null> | null
  return { title: row?.[name] ?? null, status: row?.status ?? null }
}
