import { LayoutGrid, LayoutPanelLeft, List, type LucideIcon } from 'lucide-react'
import { useTestGameStore } from '../testGameStore'
import type { TgView } from '../testGameModel'

const VIEWS: { key: TgView; label: string; icon: LucideIcon }[] = [
  { key: 'shelf', label: 'Shelf view', icon: LayoutGrid },
  { key: 'grid', label: 'Cover grid view', icon: LayoutPanelLeft },
  { key: 'list', label: 'List view', icon: List },
]

/**
 * The shelf / cover grid / list switch. The active button uses the nav
 * "active badge" token pair — a filled blue with a white glyph in dark mode, a
 * soft blue with a blue glyph in light mode, exactly as the design draws each.
 */
export function TgTopBarViews({ className = '' }: { className?: string }) {
  const view = useTestGameStore(s => s.view)
  const setView = useTestGameStore(s => s.setView)

  return (
    <div role="group" aria-label="Library view" className={`tg-seg ${className}`}>
      {VIEWS.map(v => {
        const active = v.key === view
        return (
          <button
            key={v.key}
            type="button"
            aria-pressed={active}
            aria-label={v.label}
            title={v.label}
            onClick={() => setView(v.key)}
            className={`tg-seg-btn border max-lg:!w-9 ${
              active
                ? 'border-transparent !bg-[var(--tg-nav-active-count-bg)] !text-[var(--tg-nav-active-text)]'
                : 'border-[var(--tg-border)] bg-[var(--tg-panel)]'
            }`}
          >
            <v.icon aria-hidden className="h-[18px] w-[18px]" strokeWidth={1.9} />
          </button>
        )
      })}
    </div>
  )
}
