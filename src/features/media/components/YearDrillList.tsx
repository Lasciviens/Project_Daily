import { posterUrl } from '../../../integrations/tmdb/client'
import { Truncate } from '../../../shared/ui'
import { formatDate } from '../../../shared/utils/dateFormat'
import { useTmdbBasic } from '../hooks/useTMDB'
import type { MediaType, OpenMediaDetail } from '../types'

export interface DrillRow { key: string; tmdbId: number; type: MediaType; title: string; poster: string | null; detail: string; date: string | null }

/** A row's cover: the stored one, else TMDB's (cached per title), so no row is blank when a poster exists. */
function DrillPoster({ row }: { row: DrillRow }) {
  const { data } = useTmdbBasic(row.type, row.tmdbId, !row.poster)
  const path = row.poster ?? data?.poster_path ?? null
  return <img src={posterUrl(path, 'w92')} alt="" loading="lazy" className="h-12 w-8 shrink-0 rounded-md bg-surface-2 object-cover" />
}

/** The titles and episodes behind one Year-in-review number; a row opens the title. */
export function YearDrillList({ heading, rows, onOpenDetail }: { heading: string; rows: DrillRow[]; onOpenDetail: OpenMediaDetail }) {
  return (
    <section className="card p-3 sm:p-4">
      <h3 className="mb-2 text-body font-semibold text-fg">{heading} <span className="font-normal text-fg-muted tabular-nums">· {rows.length}</span></h3>
      {rows.length === 0 ? <p className="text-meta text-fg-muted">Nothing here.</p> : (
        <ul className="grid grid-cols-1 gap-1 @[40rem]:grid-cols-2 @[70rem]:grid-cols-3">
          {rows.map(r => (
            <li key={r.key}>
              <button type="button" onClick={() => onOpenDetail(r.tmdbId, r.type, rows.map(x => ({ tmdbId: x.tmdbId, mediaType: x.type })))} className="row row-interactive w-full py-1 text-left">
                <DrillPoster row={r} />
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
