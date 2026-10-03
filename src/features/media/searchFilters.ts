// Media search filters — pure and import-free (scripts/verify-media-search.cjs).
// TMDB's search answers in relevance order with no filters of its own, so the
// filters and sorts run over the pages already loaded.

export type SearchSort = 'relevance' | 'newest' | 'oldest' | 'rating'

export interface SearchFilters {
  genre: number | null
  fromYear: number | null
  minRating: number | null
  notInLibrary: boolean
  sort: SearchSort
}

export const NO_SEARCH_FILTERS: SearchFilters = { genre: null, fromYear: null, minRating: null, notInLibrary: false, sort: 'relevance' }

export interface SearchHit {
  id: number
  date: string | null
  rating: number
  votes: number
  genres: number[]
}

/** How many filters narrow the list (sort does not). */
export function searchFilterCount(f: SearchFilters): number {
  return (f.genre != null ? 1 : 0) + (f.fromYear != null ? 1 : 0) + (f.minRating != null ? 1 : 0) + (f.notInLibrary ? 1 : 0)
}

/** The hits that pass, in the chosen order. Undated titles sort last; relevance keeps TMDB's order. */
export function applySearchFilters<T extends SearchHit>(hits: readonly T[], f: SearchFilters, inLibrary: (id: number) => boolean): T[] {
  const out = hits.filter(h =>
    (f.genre == null || h.genres.includes(f.genre)) &&
    (f.fromYear == null || (!!h.date && Number(h.date.slice(0, 4)) >= f.fromYear)) &&
    // A score from a handful of votes says nothing.
    (f.minRating == null || (h.rating >= f.minRating && h.votes >= 20)) &&
    (!f.notInLibrary || !inLibrary(h.id)))
  if (f.sort === 'relevance') return out
  const dated = (h: T) => (h.date ? h.date : null)
  return [...out].sort((a, b) => {
    if (f.sort === 'rating') return b.rating - a.rating
    const da = dated(a), db = dated(b)
    if (!da && !db) return 0
    if (!da) return 1
    if (!db) return -1
    return f.sort === 'newest' ? db.localeCompare(da) : da.localeCompare(db)
  })
}
