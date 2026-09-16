import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'
import type {
  Game, GamePlatform, QueueGame, PlayStatus,
  CreateGameInput, GamePatch, GamePlatformInput, GameLibrary,
} from '../types'
import type { StatsRow } from '../gameStats'

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
// 42703 / PGRST204 — "column does not exist", the shape every pre-migration
// retry in this repo keys on (recipes.fiber_g's precedent).
function isMissingColumn(e: unknown): boolean {
  const x = e as { code?: string; message?: string } | null
  return x?.code === '42703' || x?.code === 'PGRST204' || /column .* does not exist/i.test(x?.message ?? '')
}

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

/**
 * The RETRO library only (migration 096's `library` discriminator). Steam and
 * PlayStation rows live in the same table — they share every personal column
 * that matters — but the Retro Games tab is a view of one console library, not
 * of everything.
 *
 * Pre-096 the column does not exist, so the filter would 42703 the whole page.
 * It retries unscoped in that case: every row IS retro before the migration.
 */
export async function fetchAllGames(): Promise<Game[]> {
  let rows: Omit<Game, 'platforms'>[]
  try {
    rows = await fetchAllPages<Omit<Game, 'platforms'>>((from, to) =>
      supabase.from('games').select('*').eq('library', 'retro').order('title', { ascending: true }).range(from, to))
  } catch (e) {
    if (!isMissingColumn(e)) throw e
    rows = await fetchAllPages<Omit<Game, 'platforms'>>((from, to) =>
      supabase.from('games').select('*').order('title', { ascending: true }).range(from, to))
  }
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

/**
 * Raw rows for the Stats panel, across EVERY library — retro, Steam and
 * PlayStation together (migration 096). The panel filters by window and by
 * library and totals the result itself (`gameStats.ts::computeGameStats`), so
 * this deliberately aggregates nothing: the numbers depend on what the user
 * picked, not on what the query returned.
 */
export async function fetchGameStats(): Promise<{ rows: StatsRow[]; platforms: { game_id: string; system: string }[] }> {
  // Paginated for the same reason as fetchAllGames: capped at one page, every
  // total on the Stats panel would silently stop counting at 1000.
  const COLUMNS = 'id, title, play_status, is_iconic, is_coop, needs_review, rating, esde_playcount, esde_playtime_seconds, esde_last_played'
  const WITH_096 = `${COLUMNS}, library, play_seconds, play_count, last_played_at`

  let rows: StatsRow[]
  try {
    rows = await fetchAllPages<StatsRow>((from, to) => supabase.from('games').select(WITH_096).range(from, to))
  } catch (e) {
    // Pre-096 the three neutral columns and `library` do not exist yet; the
    // ES-DE figures are then the only ones there are, and every row is retro.
    if (!isMissingColumn(e)) throw e
    rows = await fetchAllPages<StatsRow>((from, to) => supabase.from('games').select(COLUMNS).range(from, to))
  }
  const platforms = await fetchAllPages<{ game_id: string; system: string }>((from, to) =>
    supabase.from('game_platforms').select('game_id, system').range(from, to))
  return { rows, platforms }
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

// ─── Provider import (migration 096) ─────────────────────────────────────────

/** One provider game, already normalised to this table's own shape. */
export type ProviderGameInput = {
  external_ref: string
  title: string
  play_seconds?: number | null
  play_count?: number | null
  last_played_at?: string | null
  primary_cover_url?: string | null
  release_year?: number | null
  genres?: string[] | null
}

/**
 * Bring a provider's owned/played list into `games` so those titles can be
 * tiered, rated, completed and counted like any other.
 *
 * Re-running is safe and is the normal case: the unique index
 * `(user_id, library, external_ref)` turns a second import into an update.
 * Only the PROVIDER's own facts are written on conflict — play statistics and
 * the cover — never `play_status`, `tier`, `rating` or notes, which are the
 * user's and which a re-import must never reset. (The same rule `esde-sync`
 * follows for the same reason.)
 */
export async function importProviderGames(
  library: Exclude<GameLibrary, 'retro'>,
  source: 'steam' | 'psn',
  games: ProviderGameInput[],
): Promise<{ imported: number; updated: number }> {
  if (!games.length) return { imported: 0, updated: 0 }
  const user = await requireUser()
  const now = new Date().toISOString()

  // Read what is already here FIRST, then split into inserts and updates.
  //
  // Not an `upsert(..., { onConflict: 'user_id,library,external_ref' })`: that
  // index is PARTIAL (`WHERE external_ref IS NOT NULL AND library <> 'retro'`,
  // migration 096) and Postgres cannot infer a partial index from a column
  // list alone — it needs the index predicate repeated in the ON CONFLICT
  // clause, which PostgREST has no way to express. The result is a flat
  // "there is no unique or exclusion constraint matching the ON CONFLICT
  // specification". Making the index total instead would be worse: a retro
  // row's `external_ref` is a ScreenScraper id that two different games can
  // legitimately share, so a scrape write would start failing.
  let existing: { id: string; external_ref: string | null }[]
  try {
    existing = await fetchAllPages<{ id: string; external_ref: string | null }>((from, to) =>
      supabase.from('games').select('id, external_ref').eq('library', library).range(from, to))
  } catch (e) {
    throw isMissingTable(e) || isMissingColumn(e)
      ? new Error('Importing Steam/PlayStation games needs migration 096 — apply it first.')
      : e
  }
  const idByRef = new Map(existing.filter(r => r.external_ref).map(r => [r.external_ref as string, r.id]))

  // Only the PROVIDER's own facts. play_status, tier, rating and notes are the
  // user's and are never in this payload, so a re-import cannot reset them.
  const payload = (g: ProviderGameInput) => ({
    user_id: user.id,
    library,
    external_source: source,
    external_ref: g.external_ref,
    title: g.title,
    play_seconds: g.play_seconds ?? null,
    play_count: g.play_count ?? null,
    last_played_at: g.last_played_at ?? null,
    primary_cover_url: g.primary_cover_url ?? null,
    release_year: g.release_year ?? null,
    genres: g.genres ?? null,
    synced_at: now,
  })

  // A provider can list the same id twice (PSN has been seen to, across
  // regional SKUs); the last one wins rather than the insert failing.
  const byRef = new Map(games.map(g => [g.external_ref, g]))
  const toInsert = [...byRef.values()].filter(g => !idByRef.has(g.external_ref)).map(payload)
  const toUpdate = [...byRef.values()].filter(g => idByRef.has(g.external_ref))
    .map(g => ({ id: idByRef.get(g.external_ref)!, ...payload(g) }))

  const fail = (e: unknown) => {
    throw isMissingTable(e) || isMissingColumn(e)
      ? new Error('Importing Steam/PlayStation games needs migration 096 — apply it first.')
      : e
  }

  // Chunked for the same URL/payload-size reason the reads are.
  for (let i = 0; i < toInsert.length; i += 200) {
    const { error } = await supabase.from('games').insert(toInsert.slice(i, i + 200))
    if (error) fail(error)
  }
  for (let i = 0; i < toUpdate.length; i += 200) {
    // Conflict on the PRIMARY KEY, which is always inferable — these rows
    // carry the id read above, so this is an update in upsert's clothing.
    const { error } = await supabase.from('games').upsert(toUpdate.slice(i, i + 200))
    if (error) fail(error)
  }

  return { imported: toInsert.length, updated: toUpdate.length }
}

/** Every game in one provider library, newest-played first. */
export async function fetchLibraryGames(library: GameLibrary): Promise<Game[]> {
  try {
    const rows = await fetchAllPages<Omit<Game, 'platforms'>>((from, to) =>
      supabase.from('games').select('*').eq('library', library)
        .order('last_played_at', { ascending: false, nullsFirst: false }).range(from, to))
    return attachPlatforms(rows, [])
  } catch (e) {
    if (isMissingColumn(e)) return []
    throw e
  }
}
