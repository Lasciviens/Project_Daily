import { rp5 } from '../../../integrations/rp5-library/client'

export interface GameStats {
  total:     number
  playing:   number
  completed: number
  wishlist:  number
  backlog:   number
  dropped:   number
}

export interface Game {
  id:           string
  title:        string
  cover_url?:   string | null
  play_status:  string
  rating?:      number | null
  igdb_rating?: number | null
  tier?:        string | null
  is_iconic:    boolean
  is_coop:      boolean
  release_year?: number | null
}

const GAME_FIELDS = 'id, title, primary_cover_url, cover_url, play_status, rating, igdb_rating, tier, is_iconic, is_coop, release_year, updated_at'

export async function fetchGameStats(): Promise<GameStats> {
  if (!rp5) throw new Error('RP5 client not configured')

  const { data, error } = await rp5.from('games').select('play_status')
  if (error) throw new Error(error.message)

  const rows = data ?? []
  return {
    total:     rows.length,
    playing:   rows.filter(r => r.play_status === 'playing').length,
    completed: rows.filter(r => r.play_status === 'completed').length,
    wishlist:  rows.filter(r => r.play_status === 'wishlist').length,
    backlog:   rows.filter(r => r.play_status === 'backlog').length,
    dropped:   rows.filter(r => r.play_status === 'dropped').length,
  }
}

function mapGame(r: Record<string, unknown>): Game {
  return {
    id:           r.id as string,
    title:        r.title as string,
    cover_url:    (r.primary_cover_url ?? r.cover_url ?? null) as string | null,
    play_status:  r.play_status as string,
    rating:       (r.rating ?? null) as number | null,
    igdb_rating:  (r.igdb_rating ?? null) as number | null,
    tier:         (r.tier ?? null) as string | null,
    is_iconic:    Boolean(r.is_iconic),
    is_coop:      Boolean(r.is_coop),
    release_year: (r.release_year ?? null) as number | null,
  }
}

export async function fetchGames(status?: string, limit = 50): Promise<Game[]> {
  if (!rp5) throw new Error('RP5 client not configured')

  let q = rp5.from('games').select(GAME_FIELDS)
  if (status) q = q.eq('play_status', status)
  q = q.order('updated_at', { ascending: false }).limit(limit)

  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []).map(mapGame)
}

export async function fetchRecentGames(limit = 6): Promise<Game[]> {
  if (!rp5) throw new Error('RP5 client not configured')

  const { data, error } = await rp5
    .from('games')
    .select(GAME_FIELDS)
    .in('play_status', ['playing', 'wishlist', 'backlog'])
    .order('updated_at', { ascending: false })
    .limit(limit)

  if (error) throw new Error(error.message)
  return (data ?? []).map(mapGame)
}
