import { LayoutGrid, LayoutPanelLeft, List, type LucideIcon } from 'lucide-react'
import { useTestGameStore } from '../testGameStore'
import type { TgView } from '../testGameModel'

const VIEWS: { key: TgView; label: string; icon: LucideIcon }[] = [
  { key: 'shelf', label: 'Shelf view', icon: LayoutGrid },
  { key: 'grid', label: 'Cover grid view', icon: LayoutPanelLeft },
  { key: 'list', label: 'List view', icon: List },
]

const ACTIVE = 'border-transparent !bg-[var(--tg-seg-active-bg,var(--tg-nav-active-count-bg))] !text-[var(--tg-nav-active-text)]'
const WIDTH = '[@media(pointer:fine)]:max-lg:!w-9 [@media(pointer:coarse)]:!min-w-[44px]'

/**
 * The shelf / cover grid / list switch. The active button is a mid blue with
 * a white glyph in dark mode and a soft blue with a blue glyph in light mode,
 * as the design draws each (`--tg-seg-active-bg`, falling back to the nav's
 * active badge colour). 36px wide on a tablet with a mouse; never under 44px
 * on touch.
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
            className={`tg-seg-btn border ${WIDTH} ${active ? ACTIVE : 'border-[var(--tg-border)] bg-[var(--tg-panel)]'}`}
          >
            <v.icon aria-hidden className="h-[18px] w-[18px]" strokeWidth={1.9} />
          </button>
        )
      })}
    </div>
  )
}
