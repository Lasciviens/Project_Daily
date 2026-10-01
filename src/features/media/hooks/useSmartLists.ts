import { useQuery } from '@tanstack/react-query'
import { qk, STALE } from '../../../shared/query'
import { discoverBySource, getCollection, getPersonMovieCredits, searchSource } from '../api/tmdbApi'
import type { FollowKind } from '../api/followsApi'
import type { ListTitle } from '../listModel'
import type { TMDBSearchMovie } from '../types'

const MAX_PAGES = 10 // 200 films
const EXTRAS = [99, 10770] // Documentary, TV Movie
const year = (d?: string | null) => (d ? Number(d.slice(0, 4)) || null : null)
type Part = Pick<TMDBSearchMovie, 'id' | 'title' | 'poster_path'> & { release_date?: string; genre_ids?: number[] }
const toTitle = (m: Part, order: number): ListTitle => ({
  type: 'movie', tmdbId: m.id, title: m.title, posterPath: m.poster_path, release: m.release_date || null, year: year(m.release_date), order, genreIds: m.genre_ids,
})
const extra = (m: Part) => (m.genre_ids ?? []).some(g => EXTRAS.includes(g))
const dedupe = <T extends { id: number }>(rows: T[]) => [...new Map(rows.map(m => [m.id, m])).values()]
// A cameo as oneself ("Self", "Himself") is not an acting role.
const SELF = /^(self|himself|herself|themselves)\b/i

export interface SmartListResult { titles: ListTitle[]; total: number; capped: boolean }

export async function fetchSmart(kind: FollowKind, id: number, hideExtras: boolean): Promise<SmartListResult> {
  if (kind === 'collection') {
    const c = await getCollection(id)
    const titles = c.parts.map(toTitle)
    return { titles, total: titles.length, capped: false }
  }
  if (kind === 'company' || kind === 'keyword') {
    const first = await discoverBySource(kind, id, 1, hideExtras)
    const pages = Math.min(first.total_pages, MAX_PAGES)
    const rest = await Promise.all(Array.from({ length: Math.max(0, pages - 1) }, (_, i) => discoverBySource(kind, id, i + 2, hideExtras)))
    // Undated rows are announcements without a date — kept (they are real
    // plans), but a stub with neither date nor poster is dropped.
    const all = dedupe([first, ...rest].flatMap(p => p.results)).filter(m => m.release_date || m.poster_path)
    return { titles: all.map(toTitle), total: first.total_results, capped: first.total_pages > MAX_PAGES }
  }
  const credits = await getPersonMovieCredits(id)
  const rows = kind === 'director'
    ? credits.crew.filter(c => c.job === 'Director')
    : credits.cast.filter(c => !SELF.test(c.character ?? ''))
  const titles = dedupe(rows).filter(m => (m.release_date || m.poster_path) && !(hideExtras && extra(m))).map(toTitle)
  return { titles, total: titles.length, capped: false }
}

/** Every film in a smart list's source, straight from TMDB (cached for a day). */
export function useSmartListTitles(kind: FollowKind | null, id: number | null, hideExtras: boolean) {
  return useQuery({
    queryKey: [...qk.media.smartList(kind ?? '', id ?? 0), hideExtras],
    queryFn: () => fetchSmart(kind!, id!, hideExtras),
    enabled: !!kind && id != null,
    staleTime: STALE.day,
  })
}

export type SourceKind = 'collection' | 'company' | 'keyword' | 'person'

/** Search TMDB for a franchise, studio, keyword or person to build a smart list from. */
export function useSourceSearch(kind: SourceKind, query: string) {
  const q = query.trim()
  return useQuery({
    queryKey: qk.media.tmdbQuery('source-search', kind, q),
    queryFn: () => searchSource(kind, q).then(r => r.results.slice(0, 12)),
    enabled: q.length > 1,
    staleTime: STALE.short,
  })
}
