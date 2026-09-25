import { useEffect, useRef, useState } from 'react'

// The overlay is viewport-tall and holds more below this, so it clamps
// generously (a tall monitor has room for twice as much); the phone sheet
// scrolls, so it shows the whole text.
const CLAMP = 'line-clamp-[8] [@media(min-height:1000px)]:line-clamp-[14]'

interface Props {
  text: string
  /** A small heading over the text ("Storyline"). */
  label?: string
  /** `full` — no clamp at all (the phone sheet). */
  mode?: 'clamped' | 'full'
}

/** The description (or storyline), with Read more/less only when the text actually runs longer. */
export function TgDetailDescription({ text, label, mode = 'clamped' }: Props) {
  const ref = useRef<HTMLParagraphElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [clamped, setClamped] = useState(false)
  const full = mode === 'full'

  useEffect(() => {
    const el = ref.current
    if (!el || full) return
    const ro = new ResizeObserver(() => setClamped(el.scrollHeight > el.clientHeight + 1))
    ro.observe(el)
    return () => ro.disconnect()
  }, [text, full])

  return (
    <div className="flex flex-col gap-1.5">
      {label && <h3 className="tg-section-label">{label}</h3>}
      <p
        ref={ref}
        className={`whitespace-pre-line break-words text-[12.5px] leading-[1.55] text-[var(--tg-text-2)] 2xl:text-[13px] ${full || expanded ? '' : CLAMP}`}
      >
        {text}
      </p>
      {!full && (clamped || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          aria-expanded={expanded}
          // A full 44px target, pulled up so it reads as a link under the text.
          className="-mb-3 -ml-2 -mt-3 flex w-fit min-h-[44px] items-center px-2 text-[12px] font-semibold text-[var(--tg-accent)] [@media(hover:hover)]:hover:underline"
        >
          {expanded ? 'Read less' : 'Read more'}
        </button>
      )}
    </div>
  )
}
