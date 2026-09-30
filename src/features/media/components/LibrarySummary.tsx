import { ArrowRight } from 'lucide-react'
import { posterUrl } from '../../../integrations/tmdb/client'
import { Button } from '../../../shared/ui'
import { BUCKET_LABEL, BUCKET_ORDER, bucketCounts, summaryPosters, type LibraryBucket, type LibraryItem } from '../libraryModel'
import type { MediaType } from '../types'

interface Props {
  items: LibraryItem[]
  mediaType: MediaType
  onOpenDetail: (id: number, type: MediaType) => void
  onOpenLibrary: (bucket?: LibraryBucket) => void
}

/**
 * The overview's library: a count per status (each opens the Library view on
 * that status) and one row of posters — what you're watching and what's next.
 * The whole library lives in the Library view, so this card stays one screen tall.
 */
export function LibrarySummary({ items, mediaType, onOpenDetail, onOpenLibrary }: Props) {
  if (items.length === 0) return null
  const counts = bucketCounts(items)
  const posters = summaryPosters(items)

  return (
    <div className="flex flex-col gap-3 rounded-row border border-line bg-surface/70 p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="section-label mr-1">My library <span className="font-normal normal-case tracking-normal text-fg-faint tabular-nums">({items.length})</span></span>
        {BUCKET_ORDER.filter(b => counts[b] > 0).map(b => (
          <button key={b} type="button" onClick={() => onOpenLibrary(b)} className="chip min-h-[44px] press-feedback sm:min-h-[36px]">
            {BUCKET_LABEL[b]} <span className="tabular-nums text-fg-muted">{counts[b]}</span>
          </button>
        ))}
      </div>

      {posters.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {posters.map(p => (
            <button key={p.tmdbId} type="button" onClick={() => onOpenDetail(p.tmdbId, mediaType)} title={p.title} aria-label={p.title}
              className="press-feedback shrink-0 rounded-md focus-visible:outline-accent-500">
              <img src={posterUrl(p.posterPath, 'w185')} alt="" loading="lazy" className="h-[120px] w-[80px] rounded-md bg-surface-2 object-cover" />
            </button>
          ))}
        </div>
      )}

      <Button size="sm" className="w-fit" onClick={() => onOpenLibrary()}>
        Open library <ArrowRight aria-hidden className="h-4 w-4" />
      </Button>
    </div>
  )
}
