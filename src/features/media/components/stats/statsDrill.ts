// Which titles a Stats number opens: one pure function per drill, shared by
// every tile, bar and chip on the Stats page.
import type { YearReview } from '../../yearReview'
import { isKnown } from '../../yearReview'
import type { DrillRow } from '../YearDrillList'
import { formatDateRange } from '../../../../shared/utils/dateFormat'

export type Drill =
  | { kind: 'all' } | { kind: 'movies' } | { kind: 'episodes' } | { kind: 'rewatches' } | { kind: 'undated' }
  | { kind: 'month'; month: number } | { kind: 'weekday'; day: number }
  | { kind: 'genre'; name: string } | { kind: 'show'; id: number }

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
export const hours = (min: number) => `${Math.round(min / 60).toLocaleString('en-GB')}h`
const ep = (s: number, e: number) => `S${s} · E${e}`
const weekdayOf = (iso: string) => (new Date(iso).getDay() + 6) % 7
const monthRange = (year: number, m: number) => formatDateRange(new Date(year, m - 1, 1), new Date(year, m, 0))
const dateOf = (iso: string) => (isKnown(iso) ? iso : null)

export function drillRows(r: YearReview, d: Drill): { heading: string; rows: DrillRow[] } {
  const period = r.year == null ? 'all time' : String(r.year)
  const movie = (m: YearReview['movies'][number]): DrillRow => ({ key: `m${m.tmdbId}`, tmdbId: m.tmdbId, type: 'movie', title: m.title, poster: m.poster, detail: m.plays > 1 ? `Movie · ${m.plays} plays` : 'Movie', date: dateOf(m.watchedAt) })
  const episodes = r.shows.flatMap(s => s.episodes.map(e => ({ s, e })))
  const episodeRow = ({ s, e }: (typeof episodes)[number]): DrillRow => ({ key: `e${s.show.tmdbId}-${e.season}x${e.episode}`, tmdbId: s.show.tmdbId, type: 'tv', title: s.show.title, poster: s.show.poster, detail: ep(e.season, e.episode), date: dateOf(e.watchedAt) })
  const byDate = (a: DrillRow, b: DrillRow) => (a.date ?? '').localeCompare(b.date ?? '')
  switch (d.kind) {
    case 'all': return { heading: `Everything watched · ${period}`, rows: [...drillRows(r, { kind: 'movies' }).rows, ...drillRows(r, { kind: 'episodes' }).rows] }
    case 'movies': return { heading: `Movies watched · ${period}`, rows: r.movies.map(movie) }
    case 'episodes': return { heading: `Shows watched · ${period}`, rows: r.shows.map(s => ({ key: `s${s.show.tmdbId}`, tmdbId: s.show.tmdbId, type: 'tv', title: s.show.title, poster: s.show.poster, detail: `${s.episodes.length} episodes · ${hours(s.minutes)}`, date: dateOf(s.episodes[s.episodes.length - 1]?.watchedAt ?? '') })) }
    case 'show': {
      const s = r.shows.find(x => x.show.tmdbId === d.id)
      return { heading: s ? `${s.show.title} · ${period}` : 'Episodes', rows: (s?.episodes ?? []).map(e => ({ key: `${e.season}x${e.episode}`, tmdbId: s!.show.tmdbId, type: 'tv', title: ep(e.season, e.episode), poster: s!.show.poster, detail: e.plays > 1 ? `${e.plays} plays` : s!.show.title, date: dateOf(e.watchedAt) })) }
    }
    case 'rewatches': return { heading: `Watched more than once · ${period}`, rows: r.rewatches.map((x, i) => ({ key: `r${i}`, tmdbId: x.tmdbId, type: x.type === 'movie' ? 'movie' : 'tv', title: x.title, poster: x.poster, detail: `${x.label} · ${x.plays} plays`, date: null })) }
    case 'undated': return { heading: 'Watched on an unknown date', rows: [...r.movies.filter(m => !isKnown(m.watchedAt)).map(movie), ...episodes.filter(x => !isKnown(x.e.watchedAt)).map(episodeRow)] }
    case 'month': {
      const m = r.months[d.month - 1]
      return { heading: r.year == null ? 'Month' : monthRange(r.year, d.month), rows: [
        ...m.movies.map(movie),
        ...m.episodes.map(e => ({ key: `e${e.showId}${e.season}x${e.episode}`, tmdbId: e.show.tmdbId, type: 'tv' as const, title: e.show.title, poster: e.show.poster, detail: ep(e.season, e.episode), date: e.watchedAt })),
      ].sort(byDate) }
    }
    case 'weekday': return { heading: `Watched on a ${WEEKDAYS[d.day]} · ${period}`, rows: [
      ...r.movies.filter(m => isKnown(m.watchedAt) && weekdayOf(m.watchedAt) === d.day).map(movie),
      ...episodes.filter(x => isKnown(x.e.watchedAt) && weekdayOf(x.e.watchedAt) === d.day).map(episodeRow),
    ].sort(byDate) }
    case 'genre': {
      const g = r.genres.find(x => x.name === d.name)
      return { heading: `${d.name} · ${period}`, rows: [
        ...(g?.movies ?? []).map(movie),
        ...(g?.shows ?? []).map(s => ({ key: `gs${s.tmdbId}`, tmdbId: s.tmdbId, type: 'tv' as const, title: s.title, poster: s.poster, detail: 'Series', date: null })),
      ] }
    }
  }
}
