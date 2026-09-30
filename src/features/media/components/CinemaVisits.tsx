import { useState } from 'react'
import { PencilLine, Plus, Ticket } from 'lucide-react'
import { useEntityModal } from '../../../shared/modals'
import { Button } from '../../../shared/ui'
import { formatDate, toLocalDate } from '../../../shared/utils/dateFormat'
import { haptic } from '../../../shared/utils/haptics'
import type { CinemaVisit } from '../api/cinemaApi'
import { useDeleteCinemaVisit, useMovieCinemaVisits, useSaveCinemaVisit } from '../hooks/useCinemaVisits'
import type { UserMovieEntry } from '../types'
import { CinemaVisitSheet } from './CinemaVisitSheet'

/** The local yyyy-MM-dd of a stored timestamp (a Trakt time near midnight must not move a day). */
function localDay(iso: string | null): string {
  const d = toLocalDate(iso)
  if (!d) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const money = (v: CinemaVisit) => (v.cost != null ? `${v.cost.toFixed(v.cost % 1 ? 2 : 0)} ${v.currency}` : null)

/** One line per visit: date · cinema, where · with whom · cost. */
function visitLine(v: CinemaVisit): string {
  const place = [v.cinema, v.location].filter(Boolean).join(', ')
  return [v.watched_on ? formatDate(v.watched_on) : null, place || null, v.companions ? `with ${v.companions}` : null, money(v)].filter(Boolean).join(' · ') || 'No details yet'
}

/**
 * "Watched at a cinema": a toggle (a ticket) that records a visit, then the
 * details of each visit — which cinema, where, with whom, what it cost, a
 * note (movie_cinema_visits, migration 120).
 */
export function CinemaVisits({ entry }: { entry: UserMovieEntry }) {
  const { data: visits = [] } = useMovieCinemaVisits(entry.movie_id)
  const save = useSaveCinemaVisit()
  const del = useDeleteCinemaVisit()
  const modal = useEntityModal()
  const [editing, setEditing] = useState<CinemaVisit | 'new' | null>(null)
  const marked = visits.length > 0
  // Offered once it's watched (or being watched); visits already saved always show.
  if (!marked && entry.status !== 'completed' && entry.status !== 'watching') return null

  async function toggle() {
    haptic('light')
    if (!marked) {
      await save.mutateAsync({ id: null, input: { movie_id: entry.movie_id, watched_on: localDay(entry.watched_at) || null } }).catch(() => null)
      return
    }
    const hasDetails = visits.some(v => v.cinema || v.location || v.companions || v.cost != null || v.note)
    if (hasDetails && !(await modal.confirm({ title: 'Remove the cinema visits?', message: 'Their details (cinema, company, cost, note) are deleted too.', confirmLabel: 'Remove', destructive: true }))) return
    await del.mutateAsync(visits.map(v => v.id)).catch(() => null)
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-pressed={marked}
          onClick={() => { void toggle() }}
          disabled={save.isPending || del.isPending}
          className="pill-tab press-feedback border border-line aria-pressed:border-transparent"
        >
          <Ticket aria-hidden className="h-4 w-4" /> {marked ? 'Watched at a cinema' : 'Watched at a cinema?'}
        </button>
        {marked && (
          <Button size="sm" variant="ghost" icon={<Plus />} onClick={() => setEditing('new')}>Another visit</Button>
        )}
      </div>
      {marked && (
        <ul className="flex flex-col gap-1">
          {visits.map(v => (
            <li key={v.id}>
              <button type="button" onClick={() => setEditing(v)} className="row row-interactive w-full gap-2 py-1 text-left">
                <span className="min-w-0 flex-1">
                  <span className="block text-meta text-fg-2 tabular-nums">{visitLine(v)}</span>
                  {v.note && <span className="block text-micro text-fg-muted">{v.note}</span>}
                </span>
                <span className="flex shrink-0 items-center gap-1 text-micro font-semibold text-accent-600"><PencilLine aria-hidden className="h-3.5 w-3.5" /> Details</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <CinemaVisitSheet
          movieId={entry.movie_id}
          title={entry.movie.title}
          visit={editing === 'new' ? null : editing}
          defaultDate={localDay(entry.watched_at)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}
