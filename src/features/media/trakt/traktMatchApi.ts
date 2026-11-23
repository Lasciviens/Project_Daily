import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'

// Trakt titles the sync could not take in (trakt_unmatched, 116) and the owner's pick for them (trakt_manual_matches, 200).
// The sync reads the picks and fills the missing TMDB id (docs/features/media.md → Trakt matching). Only integers are stored.

export type MatchKind = 'movie' | 'show'

export interface UnmatchedTitle { id: string; kind: MatchKind; trakt_id: number; title: string; year: number | null; reason: string | null; has_tmdb: boolean }
export interface ManualMatch { id: string; kind: MatchKind; trakt_id: number; tmdb_id: number }

const missingTable = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === '42P01' || e.code === 'PGRST205' || /Could not find the table/.test(e.message ?? ''))
const NOT_APPLIED = 'Matching titles needs migration 200 (trakt_manual_matches) — it is applied when the change is merged'

const goodId = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0 && v <= 2_147_483_647

/** Rows of a table in pages (PostgREST stops at 1,000). */
async function readAll<T>(table: string, cols: string): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(cols).order('id').range(from, from + 999)
    if (error) { if (missingTable(error)) return []; throw error }
    out.push(...((data ?? []) as unknown as T[]))
    if (!data || data.length < 1000) return out
  }
}

/** The sync's list of titles it could not match, by title. A row that already has a TMDB id (a failed lookup) is retried by the sync itself. */
export async function fetchUnmatched(): Promise<UnmatchedTitle[]> {
  const rows = await readAll<{ id: string; kind: string; trakt_id: number; title: string; year: number | null; reason: string | null; ids: unknown }>('trakt_unmatched', 'id, kind, trakt_id, title, year, reason, ids')
  return rows
    .filter(r => (r.kind === 'movie' || r.kind === 'show') && goodId(r.trakt_id))
    .map(r => ({
      id: r.id, kind: r.kind as MatchKind, trakt_id: r.trakt_id, title: String(r.title ?? ''), year: typeof r.year === 'number' ? r.year : null,
      reason: r.reason, has_tmdb: typeof r.ids === 'object' && r.ids !== null && !!(r.ids as { tmdb?: unknown }).tmdb,
    }))
    .sort((a, b) => a.title.localeCompare(b.title))
}

export async function fetchMatches(): Promise<ManualMatch[]> {
  const rows = await readAll<ManualMatch>('trakt_manual_matches', 'id, kind, trakt_id, tmdb_id')
  return rows.filter(r => (r.kind === 'movie' || r.kind === 'show') && goodId(r.trakt_id) && goodId(r.tmdb_id))
}

/** Saves a pick (a new one, or a changed one for the same Trakt title). Both ids are checked here and again by the table. */
export async function saveMatch(m: { kind: MatchKind; trakt_id: number; tmdb_id: number }): Promise<ManualMatch> {
  if ((m.kind !== 'movie' && m.kind !== 'show') || !goodId(m.trakt_id) || !goodId(m.tmdb_id)) throw new Error('That match is not valid')
  const user = await requireUser()
  const { data, error } = await supabase.from('trakt_manual_matches')
    .upsert({ user_id: user.id, kind: m.kind, trakt_id: m.trakt_id, tmdb_id: m.tmdb_id }, { onConflict: 'user_id,kind,trakt_id' })
    .select('id, kind, trakt_id, tmdb_id').single()
  if (missingTable(error)) throw new Error(NOT_APPLIED)
  // 23505 on (user, kind, tmdb): another Trakt title already has that TMDB title.
  if (error?.code === '23505') throw new Error('Another Trakt title is already matched to that title')
  if (error) throw error
  return data as unknown as ManualMatch
}
