import { useEffect, useReducer, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { TgLightbox } from './TgLightbox'
import { isCoverFailed, reportCoverError } from './coverCache'
import { smoothScroll } from './useShelfLayout'

interface Props {
  images: string[]
  title: string
  /** Optional larger copy per thumbnail URL for the lightbox (Steam's `path_full`). */
  fullSize?: Readonly<Record<string, string>>
}

const RETRY_MS = 1200

/** Three 16:9 thumbnails with a chevron, as drawn; a click opens the lightbox. */
export function TgScreenshotStrip({ images, title, fullSize }: Props) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [, bump] = useReducer((n: number) => n + 1, 0)
  const [retried, setRetried] = useState<ReadonlySet<string>>(() => new Set())
  const [edges, setEdges] = useState({ left: false, right: false })
  const [open, setOpen] = useState<number | null>(null)

  // The shared cover cache: a URL that died once this session (in this strip,
  // the hero or the backdrop) is not requested again.
  const shown = images.filter(u => !isCoverFailed(u))
  const large = shown.map(u => fullSize?.[u] ?? u)

  useEffect(() => {
    const el = trackRef.current
    if (!el) return
    const update = () => {
      const left = el.scrollLeft > 2
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2
      setEdges(p => (p.left === left && p.right === right ? p : { left, right }))
    }
    const ro = new ResizeObserver(update)
    ro.observe(el)
    el.addEventListener('scroll', update, { passive: true })
    return () => { ro.disconnect(); el.removeEventListener('scroll', update) }
  }, [shown.length])

  if (shown.length === 0) return null

  // One retry per URL (a network blip is not a dead link), then it is dropped.
  const onError = (url: string) => {
    if (reportCoverError(url) === 'retry') window.setTimeout(() => setRetried(s => new Set(s).add(url)), RETRY_MS)
    else bump()
  }

  const page = (dir: 1 | -1) => {
    const el = trackRef.current
    if (el) el.scrollBy({ left: dir * el.clientWidth, behavior: smoothScroll() })
  }

  return (
    <section aria-label={`Screenshots of ${title}`} className="relative">
      <div ref={trackRef} className="tg-scroll-x flex snap-x snap-mandatory gap-2.5">
        {shown.map((url, i) => (
          <button
            key={url}
            type="button"
            onClick={() => setOpen(i)}
            aria-label={`Open screenshot ${i + 1} of ${shown.length}`}
            // Three per view as drawn; two larger ones where the screen is tall.
            className="tg-thumb aspect-video w-[calc((100%_-_20px)/3)] shrink-0 snap-start [@media(min-height:1000px)]:w-[calc((100%_-_10px)/2)]"
          >
            <img
              key={retried.has(url) ? `${url}#retry` : url}
              src={url}
              alt=""
              loading="lazy"
              decoding="async"
              draggable={false}
              onError={() => onError(url)}
              className="h-full w-full object-cover transition-transform duration-200 [@media(hover:hover)]:hover:scale-[1.04]"
            />
          </button>
        ))}
      </div>

      {edges.left && (
        <button type="button" onClick={() => page(-1)} aria-label="Previous screenshots" className="tg-chevron-btn -left-[18px]">
          <ChevronLeft aria-hidden className="h-[18px] w-[18px]" strokeWidth={2} />
        </button>
      )}
      {edges.right && (
        <button type="button" onClick={() => page(1)} aria-label="More screenshots" className="tg-chevron-btn -right-[18px]">
          <ChevronRight aria-hidden className="h-[18px] w-[18px]" strokeWidth={2} />
        </button>
      )}

      <TgLightbox images={large} index={open} onClose={() => setOpen(null)} onIndex={setOpen} />
    </section>
  )
}
