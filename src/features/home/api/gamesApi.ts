import { rp5 } from '../../../integrations/rp5-library/client'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GameStats {
  total:     number
  playing:   number
  completed: number
  wishlist:  number
  backlog:   number
  dropped:   number
  iconic:    number
  coop:      number
}

export interface Game {
  id:            string
  title:         string
  cover_url?:    string | null
  play_status:   string
  rating?:       number | null
  igdb_rating?:  number | null   // igdb_rating_canonical in view
  tier?:         string | null
  is_iconic:     boolean
  is_coop:       boolean
  release_year?: number | null
  series_name?:  string | null
  genres?:       string[] | null
  platforms?:    string[] | null
  external_id?:  string | null
}

export interface GameDetail extends Game {
  description?:      string | null
  storyline?:        string | null
  play_notes?:       string | null
  game_log?:         string | null
  publisher?:        string | null
  igdb_url?:         string | null
  age_rating?:       string | null
  rating_count?:     number | null
  coop_notes?:       string | null
  keywords?:         string[] | null
  themes?:           string[] | null
  screenshots?:      string[] | null
  ss_screenshot_url?: string | null
  ss_fanart_url?:    string | null
  multiplayer_info?: unknown[] | null
  play_order?:       number | null
  // platforms in detail view are richer objects
  platforms_detail?: PlatformDetail[] | null
}

export interface PlatformDetail {
  system?:       string
  emulator?:     string
  performance?:  string
  rom_status?:   string
  region?:       string
  is_preferred?: boolean
  igdb_url?:     string
  version_title?: string
  performance_notes?: string
}

export type QueueGame = Game & { play_order: number }

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractStrings(val: unknown): string[] | null {
  if (!val) return null
  if (Array.isArray(val)) {
    // Could be array of strings or array of objects with .system or .name
    return val.map(v => (typeof v === 'string' ? v : (v as Record<string, string>)?.system ?? (v as Record<string, string>)?.name ?? String(v))).filter(Boolean)
  }
  return null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapGame(r: any): Game {
  return {
    id:           r.id,
    title:        r.title,
    cover_url:    r.primary_cover_url ?? r.cover_url ?? null,
    play_status:  r.play_status,
    rating:       r.rating              ?? null,
    igdb_rating:  r.igdb_rating_canonical ?? r.igdb_rating ?? null,
    tier:         r.tier                ?? null,
    is_iconic:    Boolean(r.is_iconic),
    is_coop:      Boolean(r.is_coop),
    release_year: r.release_year        ?? null,
    series_name:  r.series_name         ?? null,
    genres:       extractStrings(r.genres),
    platforms:    extractStrings(r.platforms),
    external_id:  r.external_id         ?? null,
  }
}

// ─── Summary view fields ──────────────────────────────────────────────────────

const SUMMARY_FIELDS = [
  'id', 'title', 'release_year', 'publisher', 'play_status', 'tier', 'rating',
  'igdb_rating_canonical', 'is_coop', 'is_iconic', 'primary_cover_url',
  'series_id', 'series_name', 'external_id', 'genres', 'platforms',
].join(',')

// ─── Write types ─────────────────────────────────────────────────────────────

export interface GamePatch {
  play_status?: string
  tier?:        string | null
  rating?:      number | null
  is_iconic?:   boolean
  is_coop?:     boolean
  play_notes?:  string | null
  play_order?:  number | null
}

// ─── Write API ───────────────────────────────────────────────────────────────

export async function updateGame(id: string, patch: GamePatch): Promise<void> {
  if (!rp5) throw new Error('RP5 client not configured')
  const { error } = await rp5.from('games').update(patch).eq('id', id)
  if (error) throw new Error(error.message)
}

// Batch-update play_order for multiple games after reorder
export async function reorderQueue(updates: { id: string; play_order: number }[]): Promise<void> {
  if (!rp5) throw new Error('RP5 client not configured')
  await Promise.all(updates.map(({ id, play_order }) =>
    rp5!.from('games').update({ play_order }).eq('id', id)
  ))
}

// Add game to end of queue (assigns next sequential play_order)
export async function addToQueue(id: string): Promise<void> {
  if (!rp5) throw new Error('RP5 client not configured')
  // Get the current max play_order
  const { data } = await rp5
    .from('games')
    .select('play_order')
    .not('play_order', 'is', null)
    .order('play_order', { ascending: false })
    .limit(1)
  const maxOrder = (data?.[0]?.play_order as number | undefined) ?? 0
  const { error } = await rp5.from('games').update({ play_order: maxOrder + 1 }).eq('id', id)
  if (error) throw new Error(error.message)
}

// Remove game from queue (sets play_order to null, re-indexes remaining)
export async function removeFromQueue(id: string): Promise<void> {
  if (!rp5) throw new Error('RP5 client not configured')
  const { error } = await rp5.from('games').update({ play_order: null }).eq('id', id)
  if (error) throw new Error(error.message)
}

// ─── Queue read — uses v_games_full (same as original website) ───────────────

export async function fetchPlayQueue(): Promise<QueueGame[]> {
  if (!rp5) throw new Error('RP5 client not configured')
  // Mirror original Retroid_Queue.html: query v_games_full where play_order IS NOT NULL
  const { data, error } = await rp5
    .from('v_games_full')
    .select('id,title,primary_cover_url,play_status,tier,platforms,play_order,is_iconic,is_coop,rating,igdb_rating_canonical,release_year,series_name')
    .not('play_order', 'is', null)
    .order('play_order', { ascending: true })
  if (error) throw new Error(error.message)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((r: any) => ({
    ...mapGame(r),
    play_order: r.play_order as number,
  }))
}

// ─── API ─────────────────────────────────────────────────────────────────────

export async function fetchGameStats(): Promise<GameStats> {
  if (!rp5) throw new Error('RP5 client not configured')

  const { data, error } = await rp5
    .from('v_games_summary')
    .select('play_status, is_iconic, is_coop')
  if (error) throw new Error(error.message)

  const rows = data ?? []
  return {
    total:     rows.length,
    playing:   rows.filter(r => r.play_status === 'playing').length,
    completed: rows.filter(r => r.play_status === 'completed').length,
    wishlist:  rows.filter(r => r.play_status === 'wishlist').length,
    backlog:   rows.filter(r => r.play_status === 'backlog').length,
    dropped:   rows.filter(r => r.play_status === 'dropped').length,
    iconic:    rows.filter(r => r.is_iconic).length,
    coop:      rows.filter(r => r.is_coop).length,
  }
}

export async function fetchAllGames(): Promise<Game[]> {
  if (!rp5) throw new Error('RP5 client not configured')

  const { data, error } = await rp5
    .from('v_games_summary')
    .select(SUMMARY_FIELDS)
    .order('title', { ascending: true })
    .limit(500)

  if (error) throw new Error(error.message)
  return (data ?? []).map(mapGame)
}

export async function fetchRecentGames(limit = 6): Promise<Game[]> {
  if (!rp5) throw new Error('RP5 client not configured')

  const { data, error } = await rp5
    .from('v_games_summary')
    .select(SUMMARY_FIELDS)
    .in('play_status', ['playing', 'wishlist', 'backlog'])
    .order('title', { ascending: true })
    .limit(limit)

  if (error) throw new Error(error.message)
  return (data ?? []).map(mapGame)
}

export async function fetchGameDetail(id: string): Promise<GameDetail> {
  if (!rp5) throw new Error('RP5 client not configured')

  // Fetch both views in parallel: summary for cover/status, full for text fields
  const [summaryRes, fullRes] = await Promise.all([
    rp5.from('v_games_summary').select(SUMMARY_FIELDS).eq('id', id).single(),
    rp5.from('v_games_full')
      .select('id,description,storyline,publisher,play_notes,game_log,tier,multiplayer_info,themes,age_rating,rating_count,keywords,screenshots,coop_notes,igdb_url_canonical,platforms,play_order')
      .eq('id', id).single(),
  ])

  if (summaryRes.error) throw new Error(summaryRes.error.message)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = summaryRes.data as any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const f = (fullRes.data ?? {}) as any

  // Platforms in v_games_full are richer objects
  const platformsDetail: PlatformDetail[] = Array.isArray(f.platforms)
    ? f.platforms.map((p: Record<string, unknown>) => ({
        system:            p.system            ?? undefined,
        emulator:          p.emulator          ?? undefined,
        performance:       p.performance       ?? undefined,
        rom_status:        p.rom_status        ?? undefined,
        region:            p.region            ?? undefined,
        is_preferred:      Boolean(p.is_preferred),
        igdb_url:          p.igdb_url          ?? undefined,
        version_title:     p.version_title     ?? undefined,
        performance_notes: p.performance_notes ?? undefined,
      }))
    : []

  return {
    ...mapGame(s),
    description:       f.description       ?? null,
    storyline:         f.storyline         ?? null,
    play_notes:        f.play_notes        ?? null,
    game_log:          f.game_log          ?? null,
    publisher:         f.publisher ?? s.publisher ?? null,
    igdb_url:          f.igdb_url_canonical ?? null,
    age_rating:        f.age_rating        ?? null,
    rating_count:      f.rating_count      ?? null,
    coop_notes:        f.coop_notes        ?? null,
    keywords:          extractStrings(f.keywords),
    themes:            extractStrings(f.themes),
    screenshots:       extractStrings(f.screenshots),
    multiplayer_info:  f.multiplayer_info  ?? null,
    play_order:        f.play_order        ?? null,
    platforms_detail:  platformsDetail.length > 0 ? platformsDetail : null,
  }
}
