import { supabase } from '../../../integrations/supabase/client'

export const CINEMA_CURRENCIES = ['NOK', 'TRY', 'EUR', 'USD'] as const
export type CinemaCurrency = typeof CINEMA_CURRENCIES[number]

/** A movie watched at a cinema (movie_cinema_visits, migration 120). One row per visit. */
export interface CinemaVisit {
  id: string
  movie_id: string
  watched_on: string | null
  cinema: string | null
  location: string | null
  companions: string | null
  cost: number | null
  currency: CinemaCurrency
  note: string | null
  created_at: string
}

export type CinemaVisitInput = Partial<Omit<CinemaVisit, 'id' | 'created_at'>> & { movie_id: string }

const missingTable = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === '42P01' || e.code === 'PGRST205' || /Could not find the table/.test(e.message ?? ''))
const NOT_APPLIED = 'Cinema visits need migration 120 (movie_cinema_visits)'

export async function fetchCinemaVisits(): Promise<CinemaVisit[]> {
  const { data, error } = await supabase.from('movie_cinema_visits').select('*').order('watched_on', { ascending: false, nullsFirst: false })
  if (missingTable(error)) return []
  if (error) throw error
  return (data ?? []).map(r => ({ ...r, cost: r.cost == null ? null : Number(r.cost) })) as CinemaVisit[]
}

export async function saveCinemaVisit(id: string | null, input: CinemaVisitInput): Promise<void> {
  const { error } = id
    ? await supabase.from('movie_cinema_visits').update(input).eq('id', id)
    : await supabase.from('movie_cinema_visits').insert(input)
  if (missingTable(error)) throw new Error(NOT_APPLIED)
  if (error) throw error
}

export async function deleteCinemaVisits(ids: string[]): Promise<void> {
  if (!ids.length) return
  const { error } = await supabase.from('movie_cinema_visits').delete().in('id', ids)
  if (missingTable(error)) throw new Error(NOT_APPLIED)
  if (error) throw error
}
