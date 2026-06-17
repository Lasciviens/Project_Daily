import { rp5 } from '../../../integrations/rp5-library/client'

export interface GameStats {
  playing:   number
  wishlist:  number
  completed: number
  total:     number
}

export interface RecentGame {
  id:         string
  title:      string
  cover_url?: string | null
  platform?:  string | null
  status:     string
}

export async function fetchGameStats(): Promise<GameStats> {
  if (!rp5) throw new Error('RP5 client not configured')

  const { data, error } = await rp5
    .from('games')
    .select('status')

  if (error) throw new Error(error.message)

  const rows = data ?? []
  return {
    playing:   rows.filter(r => r.status === 'playing').length,
    wishlist:  rows.filter(r => r.status === 'wishlist').length,
    completed: rows.filter(r => r.status === 'completed').length,
    total:     rows.length,
  }
}

export async function fetchRecentGames(limit = 3): Promise<RecentGame[]> {
  if (!rp5) throw new Error('RP5 client not configured')

  const { data, error } = await rp5
    .from('games')
    .select('id, title, cover_url, platform, status')
    .in('status', ['playing', 'wishlist'])
    .order('updated_at', { ascending: false })
    .limit(limit)

  if (error) throw new Error(error.message)
  return data ?? []
}
