// Discover's lists as TMDB requests, and the filters on top. Pure and
// import-free (scripts/verify-media-lists.cjs).
//
// Why not TMDB's /movie/popular: its "popularity" is recent page views over
// the whole catalogue, so old, foreign-market or straight-to-video titles with
// a local spike sit near the top. Popular here is /discover limited to the
// last three years with a vote floor, so what shows is a recent film people
// actually watched; trending stays /trending (that IS the point of Today /
// This week) with the filters applied to its results. Every list is still
// unverified against a live TMDB sample — no API key in the authoring session.

export type DiscoverTab = 'today' | 'week' | 'popular' | 'top' | 'cinemas' | 'airing' | 'upcoming' | 'norway' | 'turkey' | 'services'
export type DiscoverSort = 'popularity' | 'rating' | 'newest'

export interface DiscoverFilters {
  genre: number | null
  /** Released in or after this year. */
  fromYear: number | null
  /** TMDB score floor (0–10). */
  minRating: number | null
  /** At least this many TMDB votes — a high score from a handful of votes means little (IMDb's "Number of votes" filter). */
  minVotes: number | null
  sort: DiscoverSort | null
  hideLibrary: boolean
  /** Genres never to show (TMDB ids). */
  hideGenres: number[]
  /** Original languages never to show (ISO 639-1, e.g. "hi"). */
  hideLanguages: string[]
}

export const NO_FILTERS: DiscoverFilters = { genre: null, fromYear: null, minRating: null, minVotes: null, sort: null, hideLibrary: false, hideGenres: [], hideLanguages: [] }

/** Original languages offered under "Hide languages" (TMDB's ISO 639-1 codes). */
export const DISCOVER_LANGUAGES: { code: string; label: string }[] = [
  { code: 'en', label: 'English' }, { code: 'no', label: 'Norwegian' }, { code: 'sv', label: 'Swedish' }, { code: 'da', label: 'Danish' },
  { code: 'tr', label: 'Turkish' }, { code: 'de', label: 'German' }, { code: 'fr', label: 'French' }, { code: 'es', label: 'Spanish' },
  { code: 'it', label: 'Italian' }, { code: 'ja', label: 'Japanese' }, { code: 'ko', label: 'Korean' }, { code: 'zh', label: 'Chinese' },
  { code: 'hi', label: 'Hindi' }, { code: 'te', label: 'Telugu' }, { code: 'ta', label: 'Tamil' }, { code: 'th', label: 'Thai' },
  { code: 'id', label: 'Indonesian' }, { code: 'tl', label: 'Tagalog' }, { code: 'pt', label: 'Portuguese' }, { code: 'ru', label: 'Russian' },
  { code: 'ar', label: 'Arabic' }, { code: 'pl', label: 'Polish' },
]

const EXTRA_LANGUAGES: Record<string, string> = { cn: 'Cantonese', tl: 'Tagalog', nb: 'Norwegian', nn: 'Norwegian' }
let displayNames: Intl.DisplayNames | null | undefined

/** "ja" → "Japanese". TMDB's own oddities first ("cn" = Cantonese, "xx" = no language → null). */
export function languageName(code: string | null | undefined): string | null {
  if (!code || code === 'xx') return null
  const c = code.toLowerCase()
  if (EXTRA_LANGUAGES[c]) return EXTRA_LANGUAGES[c]
  const listed = DISCOVER_LANGUAGES.find(l => l.code === c)
  if (listed) return listed.label
  if (displayNames === undefined) {
    try { displayNames = new Intl.DisplayNames(['en'], { type: 'language' }) } catch { displayNames = null }
  }
  try {
    const name = displayNames?.of(c)
    if (name && name.toLowerCase() !== c) return name
  } catch { /* an invalid code */ }
  return c.toUpperCase()
}

/** The cover shows a language only when it isn't English. */
export const coverLanguage = (code: string | null | undefined) => (code && code.toLowerCase() !== 'en' ? languageName(code) : null)

export interface TabMeta { key: DiscoverTab; label: string; types: ('movie' | 'tv')[] }

export const DISCOVER_TABS: TabMeta[] = [
  { key: 'today', label: 'Trending', types: ['movie', 'tv'] },
  { key: 'week', label: 'This week', types: ['movie', 'tv'] },
  { key: 'popular', label: 'Popular', types: ['movie', 'tv'] },
  { key: 'top', label: 'Top rated', types: ['movie', 'tv'] },
  { key: 'cinemas', label: 'In cinemas', types: ['movie'] },
  { key: 'airing', label: 'On the air', types: ['tv'] },
  { key: 'upcoming', label: 'Upcoming', types: ['movie', 'tv'] },
  { key: 'norway', label: 'Norway', types: ['movie', 'tv'] },
  { key: 'turkey', label: 'Turkey', types: ['movie', 'tv'] },
  { key: 'services', label: 'My services', types: ['movie', 'tv'] },
]

export const isTrending = (t: DiscoverTab) => t === 'today' || t === 'week'

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export interface DiscoverRequest { path: string; params: Record<string, string> }

/**
 * The TMDB request for one page of a list. `today` is yyyy-MM-dd; `providers`
 * are the picked streaming services (My services).
 */
export function discoverRequest(tab: DiscoverTab, type: 'movie' | 'tv', f: DiscoverFilters, today: string, page: number, providers: number[] = []): DiscoverRequest {
  if (isTrending(tab)) return { path: `/trending/${type}/${tab === 'today' ? 'day' : 'week'}`, params: { page: String(page) } }
  const movie = type === 'movie'
  const date = movie ? 'primary_release_date' : 'first_air_date'
  const p: Record<string, string> = { page: String(page), include_adult: 'false' }
  let floor = movie ? 100 : 50
  let sort = 'popularity.desc'
  // The vote floor a "Best rated" sort needs on this tab (a short window can't reach 300).
  let ratedFloor = movie ? 1500 : 400
  switch (tab) {
    case 'popular':
      p[`${date}.gte`] = addDays(today, -3 * 365)
      p[`${date}.lte`] = today
      break
    case 'top': floor = movie ? 1500 : 400; sort = 'vote_average.desc'; break
    case 'cinemas':
      // Theatrical releases in Norway in the last six weeks.
      Object.assign(p, { region: 'NO', with_release_type: '3', 'release_date.gte': addDays(today, -42), 'release_date.lte': today })
      floor = 0; ratedFloor = 20; break
    case 'airing':
      Object.assign(p, { 'air_date.gte': today, 'air_date.lte': addDays(today, 7) })
      floor = 20; ratedFloor = 100; break
    case 'upcoming':
      // `region` makes release_date mean the Norwegian date: without it TMDB
      // matches a film whose release in ANY country is still ahead, so a film
      // already in Norwegian cinemas also showed here (owner report, "Runner").
      if (movie) Object.assign(p, { region: 'NO', with_release_type: '2|3', 'release_date.gte': addDays(today, 1), 'release_date.lte': addDays(today, 180) })
      else Object.assign(p, { 'first_air_date.gte': addDays(today, 1), 'first_air_date.lte': addDays(today, 180) })
      floor = 0; break
    case 'norway': p.with_origin_country = 'NO'; floor = 5; ratedFloor = 30; break
    case 'turkey': p.with_origin_country = 'TR'; floor = 5; ratedFloor = 30; break
    case 'services':
      Object.assign(p, { watch_region: 'NO', with_watch_providers: [...providers].sort((a, b) => a - b).join('|'), with_watch_monetization_types: 'flatrate|free|ads' })
      floor = movie ? 20 : 10; ratedFloor = movie ? 300 : 100; break
  }
  const upcoming = tab === 'upcoming'
  // Nothing upcoming has a score: rating sort and a score floor would empty it.
  if (f.sort === 'rating' && !upcoming) { sort = 'vote_average.desc'; floor = Math.max(floor, ratedFloor) }
  else if (f.sort === 'newest') {
    // Upcoming "newest" = soonest first; elsewhere the latest release up to today.
    const key = upcoming ? (movie ? 'release_date' : 'first_air_date') : tab === 'cinemas' ? 'release_date' : date
    sort = `${key}.${upcoming ? 'asc' : 'desc'}`
    if (!upcoming && tab !== 'cinemas') p[`${date}.lte`] = p[`${date}.lte`] ?? today
  } else if (f.sort === 'popularity') sort = 'popularity.desc'
  p.sort_by = sort
  if (floor > 0) p['vote_count.gte'] = String(floor)
  if (f.genre != null) p.with_genres = String(f.genre)
  // TMDB has no language exclusion; genres it can drop server-side (a pipe = any of them).
  if (f.hideGenres.length) p.without_genres = [...f.hideGenres].sort((a, b) => a - b).join('|')
  // Upcoming is all in the future already: a year floor changes nothing there.
  if (f.fromYear != null && !upcoming) p[`${date}.gte`] = maxDay(p[`${date}.gte`], `${f.fromYear}-01-01`)
  if (f.minRating != null && !upcoming) p['vote_average.gte'] = String(f.minRating)
  if (f.minVotes != null && !upcoming) p['vote_count.gte'] = String(Math.max(floor, f.minVotes))
  return { path: `/discover/${type}`, params: p }
}

const maxDay = (a: string | undefined, b: string) => (a && a > b ? a : b)

export interface DiscoverTitle { id: number; genre_ids?: number[]; original_language?: string; vote_average: number; vote_count?: number; release_date?: string; first_air_date?: string }

/**
 * Trending comes back unfiltered: apply genre, year, score and votes here. The
 * library, hidden-genre and hidden-language filters apply to every list
 * (`inLibrary` says whether a title is already yours). Upcoming keeps only
 * titles whose own release date is yesterday or later: TMDB's result date is
 * the primary (often another country's) release, so a filter on Norwegian
 * dates alone can still return a film that is already out.
 */
export function applyClientFilters<T extends DiscoverTitle>(tab: DiscoverTab, items: T[], f: DiscoverFilters, inLibrary: (id: number) => boolean, today?: string): T[] {
  const trending = isTrending(tab)
  const oldest = today ? addDays(today, -1) : null
  const seen = new Set<number>()
  return items.filter(i => {
    if (seen.has(i.id)) return false
    seen.add(i.id)
    if (f.hideLibrary && inLibrary(i.id)) return false
    if (f.hideGenres.length && (i.genre_ids ?? []).some(g => f.hideGenres.includes(g))) return false
    if (f.hideLanguages.length && i.original_language && f.hideLanguages.includes(i.original_language)) return false
    if (tab === 'upcoming' && oldest) {
      const d = i.release_date || i.first_air_date
      if (d && d < oldest) return false
    }
    if (!trending) return true
    if (f.genre != null && !(i.genre_ids ?? []).includes(f.genre)) return false
    const y = Number((i.release_date ?? i.first_air_date ?? '').slice(0, 4)) || null
    if (f.fromYear != null && (y == null || y < f.fromYear)) return false
    if (f.minRating != null && i.vote_average < f.minRating) return false
    if (f.minVotes != null && (i.vote_count ?? 0) < f.minVotes) return false
    return true
  })
}

/**
 * What the server request depends on, for the query key: page 1's params
 * minus the page. Every filter TMDB sees must be in the key, or changing it
 * shows the list fetched for the previous filters.
 */
export function discoverKey(tab: DiscoverTab, type: 'movie' | 'tv', f: DiscoverFilters, today: string, providers: number[] = []) {
  const r = discoverRequest(tab, type, f, today, 1, providers)
  const params = Object.fromEntries(Object.entries(r.params).filter(([k]) => k !== 'page').sort(([a], [b]) => a.localeCompare(b)))
  return { path: r.path, params }
}

/** Same filters? (hide lists compared as sets). */
function sameSet<T>(x: T[], y: T[]) { return x.length === y.length && x.every(v => y.includes(v)) }

export function sameFilters(a: DiscoverFilters, b: DiscoverFilters): boolean {
  return a.genre === b.genre && a.fromYear === b.fromYear && a.minRating === b.minRating && a.minVotes === b.minVotes
    && a.sort === b.sort && a.hideLibrary === b.hideLibrary && sameSet(a.hideGenres, b.hideGenres) && sameSet(a.hideLanguages, b.hideLanguages)
}

/** Filters a tab ignores, to say so instead of silently doing nothing. */
export function ignoredFilters(tab: DiscoverTab, f: DiscoverFilters): string[] {
  const out: string[] = []
  if (tab === 'upcoming') {
    if (f.fromYear != null) out.push('year')
    if (f.minRating != null) out.push('score')
    if (f.minVotes != null) out.push('votes')
    if (f.sort === 'rating') out.push('Best rated')
  }
  return out
}

/** Filters that change this tab's list (a sort does nothing on trending). */
export const activeFilterCount = (f: DiscoverFilters, tab?: DiscoverTab) =>
  (f.genre != null ? 1 : 0) + (f.fromYear != null ? 1 : 0) + (f.minRating != null ? 1 : 0) + (f.minVotes != null ? 1 : 0) + (f.sort && !(tab && isTrending(tab)) ? 1 : 0) + (f.hideLibrary ? 1 : 0) + (f.hideGenres.length ? 1 : 0) + (f.hideLanguages.length ? 1 : 0)
