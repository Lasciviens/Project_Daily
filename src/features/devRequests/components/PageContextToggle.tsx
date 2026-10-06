import { MapPinned } from 'lucide-react'
import type { PageContext } from '../devRequestContext'
import { markText } from '../devRequestMarks'
import { Truncate, cx } from '../../../shared/ui'

/** "Attach page context" — what gets appended on save, and the switch for it. */
export function PageContextToggle({ start, checked, onChange }: {
  start: PageContext | null
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex min-h-[44px] w-full items-center gap-3 rounded-row border border-line bg-surface px-3 py-2 text-left transition-colors [@media(hover:hover)]:hover:bg-surface-hover"
    >
      <span className={cx('grid h-8 w-8 shrink-0 place-items-center rounded-control', checked ? 'bg-accent-50 text-accent-600' : 'bg-surface-2 text-fg-faint')}>
        <MapPinned aria-hidden className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-body font-medium text-fg-2">Attach page context</span>
        <Truncate reveal="none" className="text-meta text-fg-muted">
          {start ? `${markText({ type: 'page', start, savedOn: null })} · ${start.breakpoint}` : 'The page you are on, for Claude'}
        </Truncate>
      </span>
      <span aria-hidden className={cx('relative h-6 w-10 shrink-0 rounded-full transition-colors', checked ? 'bg-accent-500' : 'bg-line-strong')}>
        <span className={cx('absolute top-0.5 h-5 w-5 rounded-full bg-surface shadow-card transition-[left]', checked ? 'left-[18px]' : 'left-0.5')} />
      </span>
    </button>
  )
}
