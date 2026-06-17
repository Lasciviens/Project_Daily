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
  igdb_rating?:  number | null
  tier?:         string | null
  is_iconic:     boolean
  is_coop:       boolean
  release_year?: number | null
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
  keywords?:         string[] | null
  themes?:           string[] | null
  screenshots?:      string[] | null   // IGDB screenshot IDs
  ss_screenshot_url?: string | null    // ScreenScraper single screenshot
  ss_fanart_url?:    string | null
  multiplayer_info?: unknown[] | null
  series_id?:        number | null
}

// ─── Constants ────────────────────────────────────────────────────────────────

const LIST_FIELDS = 'id, title, primary_cover_url, cover_url, play_status, rating, igdb_rating, tier, is_iconic, is_coop, release_year, updated_at'

// ─── Helpers ─────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapGame(r: any): Game {
  return {
    id:           r.id,
    title:        r.title,
    cover_url:    r.primary_cover_url ?? r.cover_url ?? null,
    play_status:  r.play_status,
    rating:       r.rating    ?? null,
    igdb_rating:  r.igdb_rating ?? null,
    tier:         r.tier      ?? null,
    is_iconic:    Boolean(r.is_iconic),
    is_coop:      Boolean(r.is_coop),
    release_year: r.release_year ?? null,
  }
}

// ─── API ─────────────────────────────────────────────────────────────────────

export async function fetchGameStats(): Promise<GameStats> {
  if (!rp5) throw new Error('RP5 client not configured')

  const { data, error } = await rp5.from('games').select('play_status, is_iconic, is_coop')
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
    .from('games')
    .select(LIST_FIELDS)
    .order('title', { ascending: true })
    .limit(500)

  if (error) throw new Error(error.message)
  return (data ?? []).map(mapGame)
}

export async function fetchRecentGames(limit = 6): Promise<Game[]> {
  if (!rp5) throw new Error('RP5 client not configured')

  const { data, error } = await rp5
    .from('games')
    .select(LIST_FIELDS)
    .in('play_status', ['playing', 'wishlist', 'backlog'])
    .order('updated_at', { ascending: false })
    .limit(limit)

  if (error) throw new Error(error.message)
  return (data ?? []).map(mapGame)
}

export async function fetchGameDetail(id: string): Promise<GameDetail> {
  if (!rp5) throw new Error('RP5 client not configured')

  const { data, error } = await rp5
    .from('games')
    .select('*')
    .eq('id', id)
    .single()

  if (error) throw new Error(error.message)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = data as any
  return {
    ...mapGame(r),
    description:       r.description       ?? null,
    storyline:         r.storyline         ?? null,
    play_notes:        r.play_notes        ?? null,
    game_log:          r.game_log          ?? null,
    publisher:         r.publisher         ?? null,
    igdb_url:          r.igdb_url          ?? null,
    age_rating:        r.age_rating        ?? null,
    rating_count:      r.rating_count      ?? null,
    keywords:          r.keywords          ?? null,
    themes:            r.themes            ?? null,
    screenshots:       r.screenshots       ?? null,
    ss_screenshot_url: r.ss_screenshot_url ?? null,
    ss_fanart_url:     r.ss_fanart_url     ?? null,
    multiplayer_info:  r.multiplayer_info  ?? null,
    series_id:         r.series_id         ?? null,
  }
}

// Legacy — kept for home widget
export async function fetchGames(status?: string, limit = 50): Promise<Game[]> {
  if (!rp5) throw new Error('RP5 client not configured')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = rp5.from('games').select(LIST_FIELDS)
  if (status) q = q.eq('play_status', status)
  q = q.order('updated_at', { ascending: false }).limit(limit)

  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []).map(mapGame)
}
