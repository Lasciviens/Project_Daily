import { useMemo } from 'react'
import { bodySegments, plainText, type Mark } from '../devRequestMarks'
import { useGoToMark } from '../pick/goToMark'
import { Truncate, cx } from '../../../shared/ui'

interface Props {
  text: string
  marks: readonly Mark[]
  lines?: 1 | 2 | 3
  className?: string
}

/** A request's words with their links (a click opens the spot — check a fix where it was reported). */
export function LinkedText({ text, marks, lines = 3, className }: Props) {
  const goTo = useGoToMark()
  const segments = useMemo(() => bodySegments(text, marks), [text, marks])
  return (
    <Truncate lines={lines} fullText={plainText(text, marks)} className={cx('whitespace-pre-line', className)}>
      {segments.map((seg, i) => seg.type === 'text' ? seg.text : (
        <button
          key={i}
          type="button"
          disabled={!seg.mark}
          onClick={() => seg.mark && goTo(seg.mark)}
          title="Open the page and show this spot"
          className="inline font-medium text-accent-600 underline decoration-accent-500/60 underline-offset-2 hover:decoration-accent-600 disabled:text-fg-faint disabled:no-underline"
        >
          {seg.label}
        </button>
      ))}
    </Truncate>
  )
}
