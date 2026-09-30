import { useMemo, useState } from 'react'
import { Clapperboard, Clock, Repeat, Tv } from 'lucide-react'
import { EmptyState, Skeleton, StatTile } from '../../../shared/ui'
import { useYearReview } from '../hooks/useYearReview'
import type { YearReview } from '../yearReview'
import type { MediaType } from '../types'
import { YearDrillList, type DrillRow } from './YearDrillList'

type Drill = { kind: 'all' } | { kind: 'movies' } | { kind: 'episodes' } | { kind: 'rewatches' } | { kind: 'month'; month: number } | { kind: 'genre'; name: string } | { kind: 'show'; id: number }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const hours = (min: number) => `${Math.round(min / 60)}h`
const ep = (s: number, e: number) => `S${s} · E${e}`

function drillRows(r: YearReview, d: Drill): { heading: string; rows: DrillRow[] } {
  const movie = (m: YearReview['movies'][number]): DrillRow => ({ key: `m${m.tmdbId}`, tmdbId: m.tmdbId, type: 'movie', title: m.title, poster: m.poster, detail: m.plays > 1 ? `Movie · ${m.plays} plays` : 'Movie', date: m.watchedAt })
  switch (d.kind) {
    case 'all': return { heading: `Everything watched in ${r.year}`, rows: [...drillRows(r, { kind: 'movies' }).rows, ...drillRows(r, { kind: 'episodes' }).rows] }
    case 'movies': return { heading: `Movies watched in ${r.year}`, rows: r.movies.map(movie) }
    case 'episodes': return { heading: `Shows watched in ${r.year}`, rows: r.shows.map(s => ({ key: `s${s.show.tmdbId}`, tmdbId: s.show.tmdbId, type: 'tv', title: s.show.title, poster: s.show.poster, detail: `${s.episodes.length} episodes · ${hours(s.minutes)}`, date: s.episodes[s.episodes.length - 1]?.watchedAt ?? null })) }
    case 'show': {
      const s = r.shows.find(x => x.show.tmdbId === d.id)
      return { heading: s ? `${s.show.title} in ${r.year}` : 'Episodes', rows: (s?.episodes ?? []).map(e => ({ key: `${e.season}x${e.episode}`, tmdbId: s!.show.tmdbId, type: 'tv', title: ep(e.season, e.episode), poster: s!.show.poster, detail: e.plays > 1 ? `${e.plays} plays` : s!.show.title, date: e.watchedAt })) }
    }
    case 'rewatches': return { heading: 'Watched more than once', rows: r.rewatches.map((x, i) => ({ key: `r${i}`, tmdbId: x.tmdbId, type: x.type === 'movie' ? 'movie' : 'tv', title: x.title, poster: null, detail: `${x.label} · ${x.plays} plays`, date: null })) }
    case 'month': {
      const m = r.months[d.month - 1]
      return { heading: `${MONTHS[d.month - 1]} ${r.year}`, rows: [
        ...m.movies.map(movie),
        ...m.episodes.map(e => ({ key: `e${e.showId}${e.season}x${e.episode}`, tmdbId: e.show.tmdbId, type: 'tv' as const, title: e.show.title, poster: e.show.poster, detail: ep(e.season, e.episode), date: e.watchedAt })),
      ].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '')) }
    }
    case 'genre': {
      const g = r.genres.find(x => x.name === d.name)
      return { heading: `${d.name} in ${r.year}`, rows: [
        ...(g?.movies ?? []).map(movie),
        ...(g?.shows ?? []).map(s => ({ key: `gs${s.tmdbId}`, tmdbId: s.tmdbId, type: 'tv' as const, title: s.title, poster: s.poster, detail: 'Series', date: null })),
      ] }
    }
  }
}

/** Your year in media: every tile and bar opens the titles and episodes it counts. */
export function YearInReview({ onOpenDetail }: { onOpenDetail: (id: number, type: MediaType) => void }) {
  const [year, setYear] = useState<number | null>(null)
  const [drill, setDrill] = useState<Drill>({ kind: 'movies' })
  const { loading, error, years, review: r, unknown } = useYearReview(year)
  const maxMonth = Math.max(1, ...r.months.map(m => m.minutes))
  const list = useMemo(() => drillRows(r, drill), [r, drill])

  if (loading) return <Skeleton className="h-64 w-full" />
  if (error) return <p className="text-body text-danger">{error.message}</p>
  if (years.length === 0) return <EmptyState title="Nothing watched with a date yet" description="Titles you mark watched (or that come from Trakt with a date) show up here by year." bordered />

  return (
    <section className="@container flex flex-col gap-3">
      <div role="tablist" aria-label="Year" className="scroll-x flex gap-1 pb-1">
        {years.map(y => (
          <button key={y} type="button" role="tab" aria-selected={r.year === y} onClick={() => { setYear(y); setDrill({ kind: 'movies' }) }} className="pill-tab press-feedback shrink-0 tabular-nums">{y}</button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2 @[40rem]:grid-cols-4">
        <StatTile icon={<Clock />} label="Time watched" value={hours(r.minutes)} hint="Runtime × plays" onClick={() => setDrill({ kind: 'all' })} />
        <StatTile icon={<Clapperboard />} label="Movies" value={r.movies.length} hint={r.moviePlays === 1 ? '1 play' : `${r.moviePlays} plays`} onClick={() => setDrill({ kind: 'movies' })} />
        <StatTile icon={<Tv />} label="Episodes" value={r.episodeCount} hint={`${r.shows.length} shows`} onClick={() => setDrill({ kind: 'episodes' })} />
        <StatTile icon={<Repeat />} label="Rewatched" value={r.rewatches.length} hint="More than one play" onClick={() => setDrill({ kind: 'rewatches' })} />
      </div>

      <div className="card p-3">
        <p className="mb-2 text-meta font-semibold text-fg-muted">By month · tap a bar</p>
        <div className="flex h-28 items-end gap-1">
          {r.months.map(m => (
            <button key={m.month} type="button" onClick={() => setDrill({ kind: 'month', month: m.month })}
              title={`${MONTHS[m.month - 1]}: ${hours(m.minutes)}`}
              aria-pressed={drill.kind === 'month' && drill.month === m.month}
              className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
              <span className="w-full rounded-t bg-accent-500/70 group-hover:bg-accent-500 group-aria-pressed:bg-accent-600" style={{ height: `${Math.max(2, (m.minutes / maxMonth) * 100)}%` }} />
              <span className="text-micro text-fg-muted">{MONTHS[m.month - 1][0]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {r.genres.map(g => (
          <button key={g.name} type="button" onClick={() => setDrill({ kind: 'genre', name: g.name })} aria-pressed={drill.kind === 'genre' && drill.name === g.name} className="chip press-feedback aria-pressed:bg-accent-50 aria-pressed:text-accent-700">
            {g.name} <span className="tabular-nums text-fg-muted">{hours(g.minutes)}</span>
          </button>
        ))}
        {r.shows.slice(0, 5).map(s => (
          <button key={s.show.tmdbId} type="button" onClick={() => setDrill({ kind: 'show', id: s.show.tmdbId })} className="chip press-feedback">
            {s.show.title} <span className="tabular-nums text-fg-muted">{s.episodes.length} ep</span>
          </button>
        ))}
      </div>

      <YearDrillList heading={list.heading} rows={list.rows} onOpenDetail={onOpenDetail} />
      <p className="text-micro text-fg-muted">
        A play is counted on the latest date it was watched (one date is kept per title or episode).
        {unknown > 0 && ` ${unknown} watched with an unknown date aren't in any year.`}
      </p>
    </section>
  )
}
