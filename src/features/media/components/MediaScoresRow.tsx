import type { ReactNode } from 'react'
import { useMediaScores } from '../trakt/useTraktExtras'
import type { MediaScores } from '../trakt/traktApi'

type Stored = Partial<MediaScores> & { ratings_fetched_at?: string | null }

function Chip({ label, title, href, children }: { label: string; title: string; href?: string | null; children: ReactNode }) {
  const body = (
    <>
      <span className="text-micro font-semibold uppercase tracking-[0.06em] text-fg-muted">{label}</span>
      <span className="text-meta font-semibold tabular-nums text-fg">{children}</span>
    </>
  )
  const cls = 'inline-flex min-h-[32px] items-center gap-1.5 rounded-control border border-line bg-surface px-2'
  return href
    ? <a href={href} target="_blank" rel="noopener noreferrer" title={title} className={`${cls} hover:bg-surface-hover`}>{body}</a>
    : <span title={title} className={cls}>{body}</span>
}

/**
 * Rotten Tomatoes (critics + audience), Metacritic, IMDb and Letterboxd for a
 * title, from MDBList via trakt-api. Renders nothing while none is known.
 */
export function MediaScoresRow({ mediaType, tmdbId, stored }: { mediaType: 'movie' | 'tv'; tmdbId: number; stored?: Stored | null }) {
  const { scores } = useMediaScores(mediaType, tmdbId, stored)
  if (!scores) return null
  const { rt_critics: rt, rt_audience: aud, metacritic: mc, imdb_rating: imdb, letterboxd_rating: lb, rt_url } = scores
  if (rt == null && aud == null && mc == null && imdb == null && lb == null) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {rt != null && <Chip label={rt >= 60 ? '🍅' : '🤢'} title="Rotten Tomatoes — Tomatometer (critics)" href={rt_url}>{rt}%</Chip>}
      {aud != null && <Chip label="🍿" title="Rotten Tomatoes — audience score" href={rt_url}>{aud}%</Chip>}
      {mc != null && <Chip label="MC" title="Metacritic — Metascore">{mc}</Chip>}
      {imdb != null && <Chip label="IMDb" title="IMDb rating (out of 10)">{imdb.toFixed(1)}</Chip>}
      {lb != null && <Chip label="LB" title="Letterboxd rating (out of 5)">{lb.toFixed(1)}</Chip>}
    </div>
  )
}
