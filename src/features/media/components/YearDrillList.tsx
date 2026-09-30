import { posterUrl } from '../../../integrations/tmdb/client'
import { Truncate } from '../../../shared/ui'
import { formatDate } from '../../../shared/utils/dateFormat'
import type { MediaType } from '../types'

export interface DrillRow { key: string; tmdbId: number; type: MediaType; title: string; poster: string | null; detail: string; date: string | null }

/** The titles and episodes behind one Year-in-review number; a row opens the title. */
export function YearDrillList({ heading, rows, onOpenDetail }: { heading: string; rows: DrillRow[]; onOpenDetail: (id: number, type: MediaType) => void }) {
  return (
    <section className="card p-3 sm:p-4">
      <h3 className="mb-2 text-body font-semibold text-fg">{heading} <span className="font-normal text-fg-muted tabular-nums">· {rows.length}</span></h3>
      {rows.length === 0 ? <p className="text-meta text-fg-muted">Nothing here.</p> : (
        <ul className="grid grid-cols-1 gap-1 @[40rem]:grid-cols-2 @[70rem]:grid-cols-3">
          {rows.map(r => (
            <li key={r.key}>
              <button type="button" onClick={() => onOpenDetail(r.tmdbId, r.type)} className="row row-interactive w-full py-1 text-left">
                <img src={posterUrl(r.poster, 'w92')} alt="" loading="lazy" className="h-12 w-8 shrink-0 rounded-md bg-surface-2 object-cover" />
                <span className="min-w-0 flex-1">
                  <Truncate className="text-body font-medium text-fg">{r.title}</Truncate>
                  <span className="block text-micro text-fg-muted tabular-nums">{r.detail}</span>
                </span>
                {r.date && <span className="shrink-0 text-micro text-fg-muted tabular-nums">{formatDate(r.date)}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
