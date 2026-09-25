import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { TgLightbox } from './TgLightbox'

interface Props {
  images: string[]
  title: string
  /** Optional larger copy per thumbnail URL for the lightbox (Steam's `path_full`). */
  fullSize?: Readonly<Record<string, string>>
}

/** Three 16:9 thumbnails with a chevron, as drawn; a click opens the lightbox. */
export function TgScreenshotStrip({ images, title, fullSize }: Props) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set())
  const [edges, setEdges] = useState({ left: false, right: false })
  const [open, setOpen] = useState<number | null>(null)

  const shown = useMemo(() => images.filter(u => !failed.has(u)), [images, failed])
  const large = useMemo(() => shown.map(u => fullSize?.[u] ?? u), [shown, fullSize])

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

  const page = (dir: 1 | -1) => {
    const el = trackRef.current
    if (el) el.scrollBy({ left: dir * el.clientWidth, behavior: 'smooth' })
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
            className="tg-thumb aspect-video w-[calc((100%_-_20px)/3)] shrink-0 snap-start"
          >
            <img
              src={url}
              alt=""
              loading="lazy"
              decoding="async"
              draggable={false}
              onError={() => setFailed(f => new Set(f).add(url))}
              className="h-full w-full object-cover transition-transform duration-200 hover:scale-[1.04]"
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
