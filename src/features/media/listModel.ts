import type { LibraryItem } from './libraryModel'

// One model for every list view — a Trakt list or a smart list (a franchise,
// studio, keyword or person pulled live from TMDB): each title gets its
// library status, then the list is filtered and sorted. Pure and type-only
// (scripts/verify-media-lists.cjs).

export interface ListTitle {
  type: 'movie' | 'tv'
  tmdbId: number
  title: string
  posterPath: string | null
  /** yyyy-MM-dd when known (TMDB), else only a year (Trakt lists). */
  release: string | null
  year: number | null
  /** Position in the source list (Trakt rank / TMDB order). */
  order: number
  /** TMDB genre ids, when the source gave them (smart lists). */
  genreIds?: number[]
}

export type ListFilter = 'all' | 'watched' | 'watching' | 'unwatched' | 'library' | 'not_library' | 'upcoming'
export type ListSort = 'order' | 'release' | 'title' | 'rt'

export const LIST_FILTER_LABEL: Record<ListFilter, string> = {
  all: 'All',
  watched: 'Watched',
  watching: 'In progress',
  unwatched: 'Not watched',
  library: 'In my library',
  not_library: 'Not in library',
  upcoming: 'Coming soon',
}

export const LIST_FILTERS: ListFilter[] = ['all', 'watched', 'watching', 'unwatched', 'library', 'not_library', 'upcoming']

export const libraryKey = (type: 'movie' | 'tv', tmdbId: number) => `${type}:${tmdbId}`

export interface ListRow extends ListTitle { item: LibraryItem | null }

export function withLibrary(titles: ListTitle[], index: ReadonlyMap<string, LibraryItem>): ListRow[] {
  return titles.map(t => ({ ...t, item: index.get(libraryKey(t.type, t.tmdbId)) ?? null }))
}

const isInProgressOrDone = (r: ListRow) => r.item?.bucket === 'completed' || r.item?.bucket === 'watching' || r.item?.bucket === 'paused'
// A Trakt row knows only its year: this year's title counts as released (its date is unknown).
const isUpcoming = (r: ListRow, today: string) => (r.release ? r.release > today : r.year != null && r.year > Number(today.slice(0, 4)))

function matches(r: ListRow, f: ListFilter, today: string): boolean {
  switch (f) {
    case 'all': return true
    case 'watched': return r.item?.bucket === 'completed'
    // A show you're midway through (Watching / Paused) is In progress, not "Not watched".
    case 'watching': return r.item?.bucket === 'watching' || r.item?.bucket === 'paused'
    case 'unwatched': return !isInProgressOrDone(r) && !isUpcoming(r, today)
    case 'library': return !!r.item
    case 'not_library': return !r.item
    case 'upcoming': return isUpcoming(r, today)
  }
}

export function listCounts(rows: ListRow[], today: string): Record<ListFilter, number> {
  const out = { all: 0, watched: 0, watching: 0, unwatched: 0, library: 0, not_library: 0, upcoming: 0 } as Record<ListFilter, number>
  for (const r of rows) for (const f of LIST_FILTERS) if (matches(r, f, today)) out[f]++
  return out
}

/** The rows a filter keeps, in the chosen order (unknown dates / scores last). */
export function filterList(rows: ListRow[], f: ListFilter, sort: ListSort, today: string): ListRow[] {
  const byTitle = (a: ListRow, b: ListRow) => a.title.localeCompare(b.title)
  const rel = (r: ListRow) => r.release ?? (r.year != null ? `${r.year}-99` : '9999')
  const cmp: Record<ListSort, (a: ListRow, b: ListRow) => number> = {
    order: (a, b) => a.order - b.order,
    release: (a, b) => rel(a).localeCompare(rel(b)) || byTitle(a, b),
    title: byTitle,
    rt: (a, b) => (b.item?.rt ?? -1) - (a.item?.rt ?? -1) || byTitle(a, b),
  }
  return rows.filter(r => matches(r, f, today)).sort(cmp[sort])
}

/** "7 of 23 watched" — the progress line under a list's name. */
export function watchedProgress(rows: ListRow[], today: string): { watched: number; released: number } {
  const released = rows.filter(r => !isUpcoming(r, today))
  return { watched: released.filter(r => r.item?.bucket === 'completed').length, released: released.length }
}
