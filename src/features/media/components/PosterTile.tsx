import type { ReactNode } from 'react'
import { Check, Heart, Ticket } from 'lucide-react'
import { posterUrl } from '../../../integrations/tmdb/client'
import { Truncate } from '../../../shared/ui/Truncate'
import { BUCKET_LABEL, BUCKET_TONE, type LibraryBucket } from '../libraryModel'

// Rotten Tomatoes' own identity colours (fresh tomato / rotten splat) — brand
// literals like Strava orange, never theme tokens.
const RT_FRESH = '#FA320A'
const RT_ROTTEN = '#0AC855'

// Short enough to fit the belt on the smallest cover.
const RIBBON: Record<LibraryBucket, string> = { completed: 'Completed', watching: 'Watching', paused: 'Paused', coming: 'Soon', wishlist: 'Wishlist', dropped: 'Dropped' }

/** Every poster grid's column rule: bigger covers, columns share the row. */
export const POSTER_GRID = 'grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-3 @[40rem]:grid-cols-[repeat(auto-fill,minmax(9rem,1fr))]'

interface Props {
  posterPath: string | null
  title: string
  /** One line under the title (year, type…). Your own rating is never on the cover. */
  meta?: ReactNode
  /** Library status → the corner ribbon. */
  bucket?: LibraryBucket | null
  /** Rotten Tomatoes Tomatometer → the banner along the bottom of the cover. */
  rt?: number | null
  favorite?: boolean
  cinema?: boolean
  onOpen: () => void
  /** A corner action (e.g. remove from a list), drawn over the top right. */
  corner?: ReactNode
  dimmed?: boolean
  /** A small cover (a strip): a status dot instead of the belt, no RT banner. */
  compact?: boolean
}

/** One cover: status ribbon top-left, Rotten Tomatoes banner at the bottom, cinema and favourite marks. */
export function PosterTile({ posterPath, title, meta, bucket, rt, favorite, cinema, onOpen, corner, dimmed, compact }: Props) {
  return (
    <div className="relative min-w-0">
      <button type="button" onClick={onOpen} className="press-feedback group flex w-full min-w-0 flex-col gap-1 rounded-md text-left focus-visible:outline-accent-500">
        <span className="@container relative block aspect-[2/3] w-full overflow-hidden rounded-md bg-surface-2">
          <img
            src={posterUrl(posterPath, compact ? 'w185' : 'w342')}
            alt=""
            loading="lazy"
            decoding="async"
            className={`h-full w-full object-cover transition-[filter] duration-150 group-hover:brightness-90 ${dimmed ? 'grayscale' : ''}`}
          />
          {bucket && !compact && (
            // The status as a belt across the top-left corner. Sized in cqw
            // (the cover's own width) so its centre sits on the corner's 45°
            // line at every cover size and the label never meets an edge.
            <span
              aria-hidden
              data-tone={BUCKET_TONE[bucket]}
              className="poster-belt pointer-events-none absolute left-[25cqw] top-[25cqw] w-[110cqw] -translate-x-1/2 -translate-y-1/2 -rotate-45 py-[3px] text-center text-micro font-bold uppercase leading-none tracking-[0.04em] shadow"
            >
              {RIBBON[bucket]}
            </span>
          )}
          {bucket && compact && (
            <span aria-hidden data-tone={BUCKET_TONE[bucket]} title={BUCKET_LABEL[bucket]}
              className="poster-belt absolute left-1 top-1 grid h-5 w-5 place-items-center rounded-full shadow">
              {bucket === 'completed' ? <Check className="h-3 w-3" strokeWidth={3} /> : <span className="h-1.5 w-1.5 rounded-full bg-white" />}
            </span>
          )}
          {rt != null && !compact && (
            <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-scrim/75 py-1 text-micro font-bold text-white tabular-nums">
              <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: rt >= 60 ? RT_FRESH : RT_ROTTEN }} />
              <span aria-hidden className="opacity-80">RT</span> {rt}%<span className="sr-only"> on Rotten Tomatoes</span>
            </span>
          )}
          {(cinema || favorite) && (
            <span className="absolute right-1 top-1 flex flex-col items-end gap-1">
              {favorite && <span title="Favorite" className="grid h-6 w-6 place-items-center rounded-full bg-scrim/65 text-white"><Heart aria-label="Favorite" className="h-3 w-3 fill-current" /></span>}
              {cinema && <span title="Watched at a cinema" className="grid h-6 w-6 place-items-center rounded-full bg-scrim/65 text-white"><Ticket aria-label="Watched at a cinema" className="h-3.5 w-3.5" /></span>}
            </span>
          )}
          {bucket && <span className="sr-only">{BUCKET_LABEL[bucket]}</span>}
        </span>
        <Truncate className="px-0.5 text-meta font-medium text-fg">{title}</Truncate>
        {meta && <span className="px-0.5 text-micro text-fg-muted tabular-nums">{meta}</span>}
      </button>
      {corner && <div className={`absolute ${cinema || favorite ? 'right-8' : 'right-1'} top-1`}>{corner}</div>}
    </div>
  )
}
