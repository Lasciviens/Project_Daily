import { useEffect, useRef, useState } from 'react'

/** Three lines, with More/Less only when the text actually runs longer. */
export function TgDetailDescription({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [clamped, setClamped] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setClamped(el.scrollHeight > el.clientHeight + 1))
    ro.observe(el)
    return () => ro.disconnect()
  }, [text])

  return (
    <div>
      <p
        ref={ref}
        className={`whitespace-pre-line text-[12px] leading-[1.5] text-[var(--tg-text-2)] ${expanded ? '' : 'line-clamp-3'}`}
      >
        {text}
      </p>
      {(clamped || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          aria-expanded={expanded}
          // A full 44px target, pulled up so it reads as a link under the text.
          className="-mb-3 -ml-2 -mt-2.5 flex w-fit min-h-[44px] items-center px-2 text-[12px] font-semibold text-[var(--tg-accent)] [@media(hover:hover)]:hover:underline"
        >
          {expanded ? 'Less' : 'More'}
        </button>
      )}
    </div>
  )
}
