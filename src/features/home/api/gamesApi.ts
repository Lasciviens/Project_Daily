import { rp5 } from '../../../integrations/rp5-library/client'

export interface GameStats {
  playing:   number
  wishlist:  number
  completed: number
  total:     number
}

export interface RecentGame {
  id:          string
  title:       string
  cover_url?:  string | null
  play_status: string
  rating?:     number | null
  tier?:       string | null
}

export async function fetchGameStats(): Promise<GameStats> {
  if (!rp5) throw new Error('RP5 client not configured')

  const { data, error } = await rp5
    .from('games')
    .select('play_status')

  if (error) throw new Error(error.message)

  const rows = data ?? []
  return {
    // Casting wide nets — will refine once we know the exact play_status values
    playing:   rows.filter(r => ['playing', 'current', 'in_progress'].includes(r.play_status)).length,
    wishlist:  rows.filter(r => ['wishlist', 'want_to_play', 'backlog', 'planned'].includes(r.play_status)).length,
    completed: rows.filter(r => ['completed', 'finished', 'done'].includes(r.play_status)).length,
    total:     rows.length,
  }
}

export async function fetchRecentGames(limit = 3): Promise<RecentGame[]> {
  if (!rp5) throw new Error('RP5 client not configured')

  const { data, error } = await rp5
    .from('games')
    .select('id, title, cover_url, primary_cover_url, play_status, rating, tier')
    .order('updated_at', { ascending: false })
    .limit(limit)

  if (error) throw new Error(error.message)

  return (data ?? []).map(r => ({
    id:          r.id,
    title:       r.title,
    cover_url:   r.primary_cover_url ?? r.cover_url ?? null,
    play_status: r.play_status,
    rating:      r.rating ?? null,
    tier:        r.tier ?? null,
  }))
}
