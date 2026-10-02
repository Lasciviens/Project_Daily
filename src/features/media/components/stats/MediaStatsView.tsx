import { useMemo, useState } from 'react'
import { CalendarClock, Clapperboard, Clock, Repeat, Tv } from 'lucide-react'
import { EmptyState, Skeleton, StatTile } from '../../../../shared/ui'
import { todayStr } from '../../../../shared/utils/dateUtils'
import { formatDateRange } from '../../../../shared/utils/dateFormat'
import { useYearReview } from '../../hooks/useYearReview'
import { useMovies } from '../../hooks/useMovies'
import { useTVSeries } from '../../hooks/useTVSeries'
import { bucketCounts, libraryItems } from '../../libraryModel'
import type { OpenMediaDetail } from '../../types'
import { YearDrillList } from '../YearDrillList'
import { drillRows, hours, type Drill } from './statsDrill'
import { ColumnBars, HabitsCard, LibraryNowCard, RankBars, RatingsCard, StatsCard } from './StatsParts'

type Period = number | 'all'
// Axis letters only; any named date reads DD.MM.YYYY (owner rule).
const AXIS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D']
const monthRange = (year: number, m: number) => formatDateRange(new Date(year, m - 1, 1), new Date(year, m, 0))
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`

/**
 * Stats: all time or one year, from your real watch rows — time, films,
 * episodes, rewatches, when you watch, what you watch, how you rate, and the
 * library by status. Every tile, bar and row opens the titles it counts.
 */
export function MediaStatsView({ onOpenDetail }: { onOpenDetail: OpenMediaDetail }) {
  const [period, setPeriod] = useState<Period>('all')
  const [drill, setDrill] = useState<Drill>({ kind: 'all' })
  const { loading, error, years, review: r, unknown } = useYearReview(period)
  const list = useMemo(() => drillRows(r, drill), [r, drill])
  const { data: movieEntries = [] } = useMovies()
  const { data: tvEntries = [] } = useTVSeries()
  const library = useMemo(() => {
    const today = todayStr()
    return [
      { label: 'Movies', counts: bucketCounts(libraryItems('movies', movieEntries, tvEntries, today)) },
      { label: 'TV', counts: bucketCounts(libraryItems('tv', movieEntries, tvEntries, today)) },
    ]
  }, [movieEntries, tvEntries])

  if (loading) return <Skeleton className="h-64 w-full" />
  if (error) return <p className="text-body text-danger">{error.message}</p>
  if (r.minutes === 0 && years.length === 0) return <EmptyState title="Nothing watched yet" description="Titles you mark watched (or that come from Trakt) show up here." bordered />

  const pick = (p: Period) => { setPeriod(p); setDrill({ kind: 'all' }) }
  const allTime = r.year == null
  const days = Math.round(r.minutes / 60 / 24)
  const genres = r.genres.map(g => ({ key: g.name, label: g.name, value: g.minutes, display: hours(g.minutes), sub: plural(g.movies.length + g.shows.length, 'title') }))
  const shows = r.shows.slice(0, 6).map(s => ({ key: String(s.show.tmdbId), label: s.show.title, value: s.minutes, display: hours(s.minutes), sub: plural(s.episodes.length, 'episode') }))

  return (
    <section className="@container flex flex-col gap-3">
      <div role="tablist" aria-label="Period" className="scroll-x flex gap-1 pb-1">
        <button type="button" role="tab" aria-selected={allTime} onClick={() => pick('all')} className="pill-tab press-feedback shrink-0">All time</button>
        {years.map(y => (
          <button key={y} type="button" role="tab" aria-selected={r.year === y} onClick={() => pick(y)} className="pill-tab press-feedback shrink-0 tabular-nums">{y}</button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2 @[44rem]:grid-cols-4">
        <StatTile icon={<Clock />} label="Time watched" value={hours(r.minutes)} hint={days >= 1 ? `≈ ${plural(days, 'day')} of watching` : 'Runtime × plays'} onClick={() => setDrill({ kind: 'all' })} />
        <StatTile icon={<Clapperboard />} label="Movies" value={r.movies.length} hint={r.moviePlays > r.movies.length ? plural(r.moviePlays, 'play') : 'Watched'} onClick={() => setDrill({ kind: 'movies' })} />
        <StatTile icon={<Tv />} label="Episodes" value={r.episodeCount.toLocaleString('en-GB')} hint={`of ${plural(r.shows.length, 'show')}`} onClick={() => setDrill({ kind: 'episodes' })} />
        <StatTile icon={<Repeat />} label="Rewatched" value={r.rewatches.length} hint="Watched more than once" onClick={() => setDrill({ kind: 'rewatches' })} />
      </div>

      <StatsCard
        title={allTime ? 'Watch time by year' : `Watch time by month · ${r.year}`}
        note={allTime ? 'Tap a year to see that year.' : 'Tap a month to see what you watched.'}>
        {allTime
          ? <ColumnBars onPick={k => pick(Number(k))} bars={r.years.map(y => ({ key: String(y.year), label: String(y.year), value: y.minutes, title: `${y.year}: ${hours(y.minutes)} · ${plural(y.plays, 'play')}` }))} />
          : <ColumnBars onPick={k => setDrill({ kind: 'month', month: Number(k) })} bars={r.months.map(m => ({ key: String(m.month), label: AXIS[m.month - 1], value: m.minutes, title: `${monthRange(r.year!, m.month)}: ${hours(m.minutes)}`, active: drill.kind === 'month' && drill.month === m.month }))} />}
      </StatsCard>

      {/* Cards of different heights: column stacks (CSS columns), never a row grid. */}
      <div className="columns-1 gap-3 @[48rem]:columns-2 @[80rem]:columns-3 [&>*]:mb-3 [&>*]:break-inside-avoid">
        <StatsCard title="What you watch" note="Genres by watch time; a title can count in several.">
          <RankBars rows={genres} empty="No genres yet." onPick={k => setDrill({ kind: 'genre', name: k })} />
        </StatsCard>
        <StatsCard title="Most-watched shows" note="By episode time in this period.">
          <RankBars rows={shows} empty="No episodes in this period." onPick={k => setDrill({ kind: 'show', id: Number(k) })} />
        </StatsCard>
        <HabitsCard r={r} onWeekday={day => setDrill({ kind: 'weekday', day })} />
        <RatingsCard ratings={r.ratings} onDisagreements={() => setDrill({ kind: 'rated' })} />
        {allTime && <LibraryNowCard rows={library} />}
      </div>

      <YearDrillList heading={list.heading} rows={list.rows} onOpenDetail={onOpenDetail} />
      <p className="flex flex-wrap items-center gap-x-2 text-micro text-fg-muted">
        <CalendarClock aria-hidden className="h-3.5 w-3.5" />
        Time = runtime × plays (100 min for a film, 40 for an episode when TMDB has no runtime). A play counts on the latest date it was watched — one date is kept per title or episode.
        {allTime && unknown > 0 && <button type="button" className="font-semibold text-accent-600" onClick={() => setDrill({ kind: 'undated' })}>{plural(unknown, 'play')} with an unknown date count here but in no year →</button>}
        {!allTime && unknown > 0 && ` ${plural(unknown, 'play')} with an unknown date are in All time only.`}
      </p>
    </section>
  )
}
