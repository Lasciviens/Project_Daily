import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'
import type {
  Game, GamePlatform, GameStats, QueueGame, PlayStatus,
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

// PostgREST caps a single response at 1000 rows and answers a request whose URL
// is too long with a plain 400. Both limits were invisible while this library
// was RP5-sized (~321 games) and both broke the moment the real ES-DE import
// landed 1225 — see the two helpers below. Neither is a Supabase quirk to work
// around cleverly; they are ordinary limits any client this size has to respect.
const PAGE_SIZE = 1000
// 200 uuids ≈ 7.4 KB of query string, comfortably inside every gateway limit;
// 1000 ≈ 37 KB, which is a measured 400 Bad Request.
const IN_CHUNK = 200

/**
 * Reads every row of a query, a page at a time, instead of silently keeping
 * whichever 1000 rows came back first.
 *
 * `hardCap` only exists so a server that never reports a short page cannot spin
 * forever; it is far above any real library size and hitting it is a bug, not a
 * limit to raise casually.
 */
async function fetchAllPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  hardCap = 50_000,
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; from < hardCap; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1)
    if (error) { if (isMissingTable(error)) return out; throw error }
    const rows = data ?? []
    out.push(...rows)
    if (rows.length < PAGE_SIZE) break
  }
  return out
}

/** Every platform row this user owns — RLS already scopes it, so no filter. */
async function fetchAllPlatformRows(): Promise<GamePlatform[]> {
  return fetchAllPages<GamePlatform>((from, to) =>
    supabase.from('game_platforms').select('*').range(from, to))
}

/**
 * Platform rows for a SUBSET of games. Chunked: a single `.in()` carrying every
 * id is what made the whole Library page render as "your library is empty" —
 * the request 400s, the error is not a missing-table error so it propagates,
 * and the page had no error state to show it in.
 */
async function fetchAllPlatformsFor(gameIds: string[]): Promise<GamePlatform[]> {
  if (gameIds.length === 0) return []
  const chunks: string[][] = []
  for (let i = 0; i < gameIds.length; i += IN_CHUNK) chunks.push(gameIds.slice(i, i + IN_CHUNK))
  const results = await Promise.all(chunks.map(async chunk => {
    const { data, error } = await supabase.from('game_platforms').select('*').in('game_id', chunk)
    if (error) { if (isMissingTable(error)) return []; throw error }
    return data ?? []
  }))
  return results.flat()
}

// (An explicit EMPTY_STATS constant used to live here for the pre-migration
// case. fetchAllPages already degrades a missing table to no rows, and the
// stats computed from no rows are that same all-zero result, so the constant
// was a second copy of one answer rather than a second behaviour.)

// ─── Reads ───────────────────────────────────────────────────────────────────

export async function fetchAllGames(): Promise<Game[]> {
  const rows = await fetchAllPages<Omit<Game, 'platforms'>>((from, to) =>
    supabase.from('games').select('*').order('title', { ascending: true }).range(from, to))
  // Every game is wanted here, so read the platform table whole rather than
  // asking for 1225 ids by name.
  return attachPlatforms(rows, await fetchAllPlatformRows())
}

export async function fetchGameDetail(id: string): Promise<Game> {
  const { data: game, error } = await supabase.from('games').select('*').eq('id', id).single()
  if (error) throw isMissingTable(error) ? new Error(NOT_MIGRATED) : error
  const { data: platforms, error: pErr } = await supabase.from('game_platforms').select('*').eq('game_id', id)
  if (pErr) throw isMissingTable(pErr) ? new Error(NOT_MIGRATED) : pErr
  return attachPlatforms([game], platforms ?? [])[0]
}

export async function fetchGameStats(): Promise<GameStats> {
  // Paginated for the same reason as fetchAllGames: capped at one page, every
  // total on the Stats panel would silently stop counting at 1000.
  type StatRow = Pick<Game, 'play_status' | 'is_iconic' | 'is_coop' | 'needs_review' | 'rating'>
  const [rows, platforms] = await Promise.all([
    fetchAllPages<StatRow>((from, to) =>
      supabase.from('games').select('play_status, is_iconic, is_coop, needs_review, rating').range(from, to)),
    fetchAllPages<{ system: string }>((from, to) =>
      supabase.from('game_platforms').select('system').range(from, to)),
  ])
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
      storyline:         gameFields.storyline ?? null,
      genres:            gameFields.genres ?? null,
      series_name:       gameFields.series_name ?? null,
      play_status:       gameFields.play_status ?? 'backlog',
      tier:              gameFields.tier ?? null,
      rating:            gameFields.rating ?? null,
      is_coop:           gameFields.is_coop ?? false,
      is_iconic:         gameFields.is_iconic ?? false,
      play_notes:        gameFields.play_notes ?? null,
      primary_cover_url: gameFields.primary_cover_url ?? null,
      age_rating:        gameFields.age_rating ?? null,
      players:           gameFields.players ?? null,
      modes:             gameFields.modes ?? null,
      screenshot_url:    gameFields.screenshot_url ?? null,
      fanart_url:        gameFields.fanart_url ?? null,
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

// The "quick switch" action — a one-tap status change, unlike the generic
// edit form's status dropdown (which never touches these dates itself, so a
// deliberate bulk edit can't accidentally backdate a playthrough). Reads the
// row's own started_at/finished_at first and only ever fills whichever one
// is still NULL — an already-set date (auto or manual) is never overwritten,
// matching Media's own "stamp once" convention for started_at/finished_at.
export async function setPlayStatus(id: string, status: PlayStatus): Promise<void> {
  const { data: current, error: readErr } = await supabase
    .from('games').select('started_at, finished_at').eq('id', id).single()
  if (readErr) throw isMissingTable(readErr) ? new Error(NOT_MIGRATED) : readErr

  const patch: GamePatch = { play_status: status }
  const now = new Date().toISOString()
  if (status === 'playing' && !current?.started_at) patch.started_at = now
  if (status === 'completed' && !current?.finished_at) patch.finished_at = now

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
