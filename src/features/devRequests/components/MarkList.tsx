import { ArrowUpRight, FileText, MapPin, Quote, X } from 'lucide-react'
import { markLabel, markRoute, markText, type Mark } from '../devRequestMarks'
import { useGoToMark } from '../pick/goToMark'
import { Button, IconButton, Truncate, cx } from '../../../shared/ui'

interface Props {
  marks: readonly Mark[]
  /** The composer: each mark can be taken out again. */
  onRemove?: (index: number) => void
  className?: string
}

/**
 * The spots a request points at, in plain words ("Training › Program tab ›
 * Current program card — “Missed sessions”"), each with Go there to open
 * that page and outline the spot — e.g. to check a fix. The technical
 * detail stays out of sight; only the prompt for Claude carries it.
 */
export function MarkList({ marks, onRemove, className }: Props) {
  const goTo = useGoToMark()
  if (marks.length === 0) return null
  return (
    <ul className={cx('flex flex-col gap-1', className)} aria-label="Places on the app">
      {marks.map((m, i) => {
        const label = markLabel(m)
        const Icon = label.kind === 'page' ? FileText : label.kind === 'quote' ? Quote : MapPin
        const page = label.kind === 'page'
        return (
          <li
            key={i}
            className={cx(
              'flex min-h-[44px] items-center gap-2 rounded-row border py-1 pl-2.5 pr-1',
              page ? 'border-transparent bg-surface-2' : 'border-line bg-surface',
            )}
          >
            <Icon aria-hidden className={cx('h-4 w-4 shrink-0', page ? 'text-fg-faint' : 'text-accent-600')} />
            <Truncate lines={2} className={cx('min-w-0 flex-1 text-meta', page ? 'text-fg-muted' : 'text-fg-2')}>{markText(m)}</Truncate>
            {markRoute(m) && (
              <Button
                size="sm"
                variant="ghost"
                icon={<ArrowUpRight />}
                onClick={() => goTo(m)}
                title={page ? 'Open the page this was written on' : 'Open the page and show the spot'}
                className="shrink-0"
              >
                Go there
              </Button>
            )}
            {onRemove && <IconButton label="Remove this spot" onClick={() => onRemove(i)} className="shrink-0 hover:!text-danger"><X /></IconButton>}
          </li>
        )
      })}
    </ul>
  )
}
