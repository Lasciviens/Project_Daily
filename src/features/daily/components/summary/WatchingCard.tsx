import { useMemo, useState } from 'react'
import { CalendarDays, Clapperboard, Clock, Film, Shuffle, Tv } from 'lucide-react'
import { Cell, CellHeader, CellLink, StatBox, StatEmpty, StatNote, StatValue } from './cellKit'
import { IconButton, Truncate } from '../../../../shared/ui'
import { useEntityModal } from '../../../../shared/modals'
import { formatDate } from '../../../../shared/utils/dateFormat'
import { todayStr } from '../../../../shared/utils/dateUtils'
import { posterUrl } from '../../../../integrations/tmdb/client'
import { useWatchingGlance } from '../../../media/hooks/useYearReview'
import { libraryItems, type LibraryItem } from '../../../media/libraryModel'
import type { DayWatch } from '../../../media/yearReview'
import type { MediaType } from '../../../media/types'
import { aboutMinutes, pickBySeed } from '../../personalGlance'

// Personal's Watching card (owner, 26.10.2026: "Replace 'Watch next' with what
// I've been watching, average time spent, and wishlist picks for a movie and a
// TV series"): the last 7 days and a day's average over 30 — lengths estimated
// from runtimes (the year review's rule: the app can't know real viewing
// time, so they read "≈") — the titles watched lately, and one film and one
// series from the released watchlist, the same all day until Shuffle.

const code = (w: DayWatch) => (w.kind === 'episode' && w.season != null && w.episode != null
  ? `S${String(w.season).padStart(2, '0')}E${String(w.episode).padStart(2, '0')}` : 'Film')

function Poster({ path }: { path: string | null }) {
  return path
    ? <img src={posterUrl(path, 'w92')} alt="" className="h-12 w-8 shrink-0 rounded-[6px] border border-line bg-surface-2 object-cover" />
    : <span aria-hidden className="grid h-12 w-8 shrink-0 place-items-center rounded-[6px] bg-surface-2 text-fg-faint"><Film className="h-4 w-4" /></span>
}

function TitleRow({ poster, title, line, onOpen, label }: { poster: string | null; title: string; line: string; onOpen: () => void; label: string }) {
  return (
    <li>
      <button type="button" onClick={onOpen} aria-label={label}
        className="row row-interactive -mx-2 w-[calc(100%+1rem)] gap-2.5 px-2 py-1 text-left">
        <Poster path={poster} />
        <span className="min-w-0 flex-1">
          <Truncate as="span" className="block text-body font-semibold text-fg">{title}</Truncate>
          <span className="block text-meta tabular-nums text-fg-muted">{line}</span>
        </span>
      </button>
    </li>
  )
}

export function WatchingCard({ date }: { date: string }) {
  const g = useWatchingGlance(date)
  const modal = useEntityModal()
  const [shuffles, setShuffles] = useState(0)
  const today = todayStr()
  const open = (tmdbId: number, mediaType: MediaType) => modal.open({ kind: 'media', tmdbId, mediaType })

  const week = useMemo(() => {
    const from = (() => { const d = new Date(`${date}T12:00:00`); d.setDate(d.getDate() - 6); return d })()
    const fromDay = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}-${String(from.getDate()).padStart(2, '0')}`
    const w = g.last30.filter(x => x.day >= fromDay)
    return { minutes: w.reduce((a, x) => a + x.minutes, 0), episodes: w.filter(x => x.kind === 'episode').length, films: w.filter(x => x.kind === 'movie').length }
  }, [g.last30, date])
  const perDay = g.last30.reduce((a, x) => a + x.minutes, 0) / 30

  // The latest titles up to the day, each once (its newest watch).
  const lately = useMemo(() => {
    const seen = new Set<string>()
    const out: DayWatch[] = []
    for (const w of g.lately) {
      const key = `${w.kind}:${w.tmdbId}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(w)
      if (out.length === 2) break
    }
    return out
  }, [g.lately])

  const picks = useMemo(() => {
    const film = libraryItems('movies', g.movieEntries, [], today).filter(i => i.bucket === 'wishlist')
    const series = libraryItems('tv', [], g.tvEntries, today).filter(i => i.bucket === 'wishlist')
    return { film: pickBySeed(film, `${date}:${shuffles}:film`), series: pickBySeed(series, `${date}:${shuffles}:series`) }
  }, [g.movieEntries, g.tvEntries, today, date, shuffles])

  const counts = [week.episodes ? `${week.episodes} episode${week.episodes === 1 ? '' : 's'}` : null, week.films ? `${week.films} film${week.films === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ')
  const pickRow = (item: LibraryItem | null, type: MediaType) => item && (
    <TitleRow key={type} poster={item.posterPath} title={item.title} line={type === 'movie' ? `Film${item.year ? ` · ${item.year}` : ''}` : `Series${item.year ? ` · ${item.year}` : ''}`}
      label={`Open ${item.title}`} onOpen={() => open(item.tmdbId, type)} />
  )

  return (
    <Cell>
      <CellHeader icon={<Clapperboard />} title="Watching" action={<CellLink to="/media">Media</CellLink>} />
      <div className="grid grid-cols-2 gap-2">
        <StatBox icon={<CalendarDays aria-hidden />} label="Last 7 days">
          {g.loading ? <StatEmpty loading /> : week.minutes === 0 ? <StatEmpty loading={false} text="Nothing watched" /> : (
            <>
              <StatValue>{aboutMinutes(week.minutes)}</StatValue>
              <StatNote>{counts}</StatNote>
            </>
          )}
        </StatBox>
        <StatBox icon={<Clock aria-hidden />} label="A day">
          {g.loading ? <StatEmpty loading /> : perDay < 1 ? <StatEmpty loading={false} text="Nothing in 30 days" /> : (
            <>
              <StatValue>{aboutMinutes(perDay)}</StatValue>
              <StatNote>average · 30 days</StatNote>
            </>
          )}
        </StatBox>
      </div>

      {lately.length > 0 && (
        <div>
          <p className="section-label">Lately</p>
          <ul className="mt-1 flex flex-col">
            {lately.map(w => (
              <TitleRow key={`${w.kind}:${w.tmdbId}`} poster={w.poster} title={w.title} line={`${code(w)} · ${formatDate(w.day)}`}
                label={`Open ${w.title}`} onOpen={() => open(w.tmdbId, w.kind === 'movie' ? 'movie' : 'tv')} />
            ))}
          </ul>
        </div>
      )}

      {(picks.film || picks.series) && (
        <div>
          <div className="flex items-center justify-between gap-2">
            <p className="section-label">From your watchlist</p>
            <IconButton label="Pick others" onClick={() => setShuffles(n => n + 1)} className="-my-2 -mr-2 text-fg-muted">
              <Shuffle />
            </IconButton>
          </div>
          <ul className="flex flex-col">
            {pickRow(picks.film, 'movie')}
            {pickRow(picks.series, 'tv')}
          </ul>
        </div>
      )}
      {!g.loading && lately.length === 0 && !picks.film && !picks.series && (
        <p className="flex items-center gap-1.5 text-body text-fg-muted"><Tv className="h-4 w-4" aria-hidden />Nothing watched yet, and the watchlist is empty.</p>
      )}
    </Cell>
  )
}
