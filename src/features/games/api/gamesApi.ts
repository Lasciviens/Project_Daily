import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'
import type {
  Game, GamePlatform, GameStats, QueueGame,
  CreateGameInput, GamePatch, GamePlatformInput,
} from '../types'

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Pre-migration-safe (this app's standing convention — see wishesApi.ts): a
// missing-table READ degrades to an empty/default result instead of
// crashing the whole page, a missing-table WRITE throws a named error naming
// the migration explicitly rather than failing with an opaque Postgres
// message. Genuinely load-bearing here, unlike most other tables this
// pattern covers — Games used to read a fully-populated separate project,
// so until migration 089 is applied AND the RP5 data is imported, every one
// of these reads would otherwise 42P01 the entire page.
const NOT_MIGRATED = 'Games database not set up yet (migration 089 not applied)'
function isMissingTable(e: unknown): boolean {
  const x = e as { code?: string; message?: string } | null
  return x?.code === '42P01' || x?.code === 'PGRST205' || /Could not find the table/i.test(x?.message ?? '')
}

// games + game_platforms are joined CLIENT-SIDE (this app's own established
// pattern — see hevyApi.ts's own workouts/exercises/sets join — rather than a
// SQL view. At this scale (a few hundred games, a few hundred platform rows)
// two plain selects cost nothing meaningful, and every future tweak to the
// shape is a normal code change instead of a hand-applied DROP/CREATE VIEW
// migration).
function attachPlatforms(games: Omit<Game, 'platforms'>[], platforms: GamePlatform[]): Game[] {
  const byGame = new Map<string, GamePlatform[]>()
  for (const p of platforms) {
    const arr = byGame.get(p.game_id) ?? []
    arr.push(p)
    byGame.set(p.game_id, arr)
  }
  return games.map(g => ({
    ...g,
    platforms: (byGame.get(g.id) ?? []).sort((a, b) => Number(b.is_primary_variant) - Number(a.is_primary_variant)),
  }))
}

async function fetchAllPlatformsFor(gameIds: string[]): Promise<GamePlatform[]> {
  if (gameIds.length === 0) return []
  const { data, error } = await supabase.from('game_platforms').select('*').in('game_id', gameIds)
  if (error) { if (isMissingTable(error)) return []; throw error }
  return data ?? []
}

const EMPTY_STATS: GameStats = {
  total: 0, playing: 0, completed: 0, wishlist: 0, backlog: 0, dropped: 0,
  iconic: 0, coop: 0, needsReview: 0, avgRating: null, bySystem: [],
}

// ─── Reads ───────────────────────────────────────────────────────────────────

export async function fetchAllGames(): Promise<Game[]> {
  const { data: games, error } = await supabase.from('games').select('*').order('title', { ascending: true })
  if (error) { if (isMissingTable(error)) return []; throw error }
  const rows = games ?? []
  const platforms = await fetchAllPlatformsFor(rows.map(g => g.id))
  return attachPlatforms(rows, platforms)
}

export async function fetchGameDetail(id: string): Promise<Game> {
  const { data: game, error } = await supabase.from('games').select('*').eq('id', id).single()
  if (error) throw isMissingTable(error) ? new Error(NOT_MIGRATED) : error
  const { data: platforms, error: pErr } = await supabase.from('game_platforms').select('*').eq('game_id', id)
  if (pErr) throw isMissingTable(pErr) ? new Error(NOT_MIGRATED) : pErr
  return attachPlatforms([game], platforms ?? [])[0]
}

export async function fetchGameStats(): Promise<GameStats> {
  const [{ data: games, error }, { data: platforms, error: pErr }] = await Promise.all([
    supabase.from('games').select('play_status, is_iconic, is_coop, needs_review, rating'),
    supabase.from('game_platforms').select('system'),
  ])
  if (error) { if (isMissingTable(error)) return EMPTY_STATS; throw error }
  if (pErr && !isMissingTable(pErr)) throw pErr
  const rows = games ?? []
  const rated = rows.filter(r => r.rating != null)
  const bySystemMap = new Map<string, number>()
  for (const p of platforms ?? []) bySystemMap.set(p.system, (bySystemMap.get(p.system) ?? 0) + 1)
  return {
    total:       rows.length,
    playing:     rows.filter(r => r.play_status === 'playing').length,
    completed:   rows.filter(r => r.play_status === 'completed').length,
    wishlist:    rows.filter(r => r.play_status === 'wishlist').length,
    backlog:     rows.filter(r => r.play_status === 'backlog').length,
    dropped:     rows.filter(r => r.play_status === 'dropped').length,
    iconic:      rows.filter(r => r.is_iconic).length,
    coop:        rows.filter(r => r.is_coop).length,
    needsReview: rows.filter(r => r.needs_review).length,
    avgRating:   rated.length ? Math.round((rated.reduce((s, r) => s + Number(r.rating), 0) / rated.length) * 10) / 10 : null,
    bySystem:    [...bySystemMap.entries()].map(([system, count]) => ({ system, count })).sort((a, b) => b.count - a.count),
  }
}

// Games flagged needs_review OR missing metadata a real library entry should
// have — the lightweight replacement for RP5's 18-rule audit-score view (see
// migration 089's header note: that view was one-time cataloguing QA, not an
// ongoing personal-use feature, so it isn't ported — this is a plain filter
// over already-fetched data instead of a permanent SQL view).
export async function fetchGamesNeedingReview(): Promise<Game[]> {
  const all = await fetchAllGames()
  return all.filter(g =>
    g.needs_review
    || !g.primary_cover_url
    || !g.genres?.length
    || !g.release_year
    || g.platforms.length === 0
    || !g.platforms.some(p => p.is_primary_variant)
  )
}

export async function fetchPlayQueue(): Promise<QueueGame[]> {
  const { data: games, error } = await supabase
    .from('games').select('*').not('play_order', 'is', null).order('play_order', { ascending: true })
  if (error) { if (isMissingTable(error)) return []; throw error }
  const rows = games ?? []
  const platforms = await fetchAllPlatformsFor(rows.map(g => g.id))
  return attachPlatforms(rows, platforms) as QueueGame[]
}

// ─── Writes — games ──────────────────────────────────────────────────────────

export async function createGame(input: CreateGameInput): Promise<Game> {
  const user = await requireUser()
  const { system, emulator, ...gameFields } = input
  const { data: game, error } = await supabase
    .from('games')
    .insert({
      user_id:           user.id,
      title:             gameFields.title,
      release_year:      gameFields.release_year ?? null,
      publisher:         gameFields.publisher ?? null,
      developer:         gameFields.developer ?? null,
      description:       gameFields.description ?? null,
      genres:            gameFields.genres ?? null,
      series_name:       gameFields.series_name ?? null,
      play_status:       gameFields.play_status ?? 'backlog',
      primary_cover_url: gameFields.primary_cover_url ?? null,
      external_source:   'manual',
    })
    .select()
    .single()
  if (error) throw isMissingTable(error) ? new Error(NOT_MIGRATED) : error

  let platforms: GamePlatform[] = []
  if (system) {
    const { data: platform, error: pErr } = await supabase
      .from('game_platforms')
      .insert({ user_id: user.id, game_id: game.id, system, emulator: emulator ?? null, is_primary_variant: true, external_source: 'manual' })
      .select()
      .single()
    if (pErr) throw isMissingTable(pErr) ? new Error(NOT_MIGRATED) : pErr
    platforms = [platform]
  }
  return { ...game, platforms }
}

export async function updateGame(id: string, patch: GamePatch): Promise<void> {
  const { error } = await supabase.from('games').update(patch).eq('id', id)
  if (error) throw isMissingTable(error) ? new Error(NOT_MIGRATED) : error
}

export async function deleteGame(id: string): Promise<void> {
  const { error } = await supabase.from('games').delete().eq('id', id)
  if (error) throw isMissingTable(error) ? new Error(NOT_MIGRATED) : error
}

// Add game to end of queue (assigns next sequential play_order).
export async function addToQueue(id: string): Promise<void> {
  const { data } = await supabase
    .from('games').select('play_order').not('play_order', 'is', null).order('play_order', { ascending: false }).limit(1)
  const maxOrder = (data?.[0]?.play_order as number | undefined) ?? 0
  const { error } = await supabase.from('games').update({ play_order: maxOrder + 1 }).eq('id', id)
  if (error) throw isMissingTable(error) ? new Error(NOT_MIGRATED) : error
}

export async function removeFromQueue(id: string): Promise<void> {
  const { error } = await supabase.from('games').update({ play_order: null }).eq('id', id)
  if (error) throw isMissingTable(error) ? new Error(NOT_MIGRATED) : error
}

export async function reorderQueue(updates: { id: string; play_order: number }[]): Promise<void> {
  const results = await Promise.all(updates.map(({ id, play_order }) => supabase.from('games').update({ play_order }).eq('id', id)))
  const failed = results.find(r => r.error)
  if (failed?.error) throw isMissingTable(failed.error) ? new Error(NOT_MIGRATED) : failed.error
}

// ─── Writes — game_platforms ─────────────────────────────────────────────────

export async function addPlatform(gameId: string, input: GamePlatformInput): Promise<GamePlatform> {
  const user = await requireUser()
  // A newly-added platform never silently steals primary status from an
  // existing one — set_primary_variant is the only path that flips it.
  const { data, error } = await supabase
    .from('game_platforms')
    .insert({ user_id: user.id, game_id: gameId, ...input, is_primary_variant: false, external_source: 'manual' })
    .select()
    .single()
  if (error) throw isMissingTable(error) ? new Error(NOT_MIGRATED) : error
  return data
}

export async function updatePlatform(id: string, patch: Partial<GamePlatformInput>): Promise<void> {
  const { error } = await supabase.from('game_platforms').update(patch).eq('id', id)
  if (error) throw isMissingTable(error) ? new Error(NOT_MIGRATED) : error
}

export async function deletePlatform(id: string): Promise<void> {
  const { error } = await supabase.from('game_platforms').delete().eq('id', id)
  if (error) throw isMissingTable(error) ? new Error(NOT_MIGRATED) : error
}

// Flips exactly one platform to primary and every sibling row for the same
// game to false FIRST — the partial unique index (migration 089) would
// otherwise reject a second `true` row mid-transition.
export async function setPrimaryVariant(gameId: string, platformId: string): Promise<void> {
  const { error: clearErr } = await supabase.from('game_platforms').update({ is_primary_variant: false }).eq('game_id', gameId)
  if (clearErr) throw isMissingTable(clearErr) ? new Error(NOT_MIGRATED) : clearErr
  const { error } = await supabase.from('game_platforms').update({ is_primary_variant: true }).eq('id', platformId)
  if (error) throw isMissingTable(error) ? new Error(NOT_MIGRATED) : error
}
