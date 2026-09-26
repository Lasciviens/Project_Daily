import { useCallback, type KeyboardEvent, type MouseEvent, type ReactNode, type RefObject } from 'react'
import { useTestGameStore } from '../testGameStore'
import type { TgGame } from '../testGameModel'
import type { TgActions } from '../tgTypes'
import { TgDetailOverlay } from './TgDetailOverlay'

interface Props {
  /** The game whose details are open; null when they are closed. */
  game: TgGame | null
  actions: TgActions
  /** The column's heading, and any notice under it. */
  header: ReactNode
  /** Analytics / Advanced scroll in this column; the game views scroll themselves. */
  scroll: boolean
  children: ReactNode
  /** Written here just before a game view's onSelect runs — see TgPickIntent. */
  pickRef: RefObject<TgPickIntent>
  /** The expanded overlay, for the shell to move keyboard focus into. */
  panelRef: RefObject<HTMLElement | null>
  /**
   * Make room for the expanded overlay instead of lying under it (the queue:
   * its rows' controls sit at the right edge). Only where the column keeps a
   * usable width beside it; narrower, the overlay covers as on the shelf.
   */
  reserve?: boolean
}

/**
 * How the game in hand was reached: an arrow key walking the selection, a
 * click (pointer), or Enter / Space on a card — a click with no click count.
 */
export type TgPickIntent = 'pointer' | 'keyboard' | 'arrow' | null
const ARROW_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'])

/**
 * The tablet/desktop content row: the main column at full width, and the
 * detail overlay above its right side.
 *
 * Every game view reports a pick through the same `onSelect(id)`, which can't
 * tell a click from a key. The host's capture handlers, which run just before
 * the view's own, note the gesture in `pickRef` for the shell's onSelect to
 * read. Escape on the games closes the overlay.
 */
export function TgDetailOverlayHost({ game, actions, header, scroll, children, pickRef, panelRef, reserve }: Props) {
  const collapsed = useTestGameStore(s => s.detailCollapsed)
  const closeDetail = useTestGameStore(s => s.closeDetail)
  const setCollapsed = useTestGameStore(s => s.setDetailCollapsed)

  function onKeyDownCapture(e: KeyboardEvent) {
    pickRef.current = ARROW_KEYS.has(e.key) ? 'arrow' : null
  }
  function onClickCapture(e: MouseEvent) {
    pickRef.current = e.detail === 0 ? 'keyboard' : 'pointer'
  }
  function onKeyDown(e: KeyboardEvent) {
    if (e.key !== 'Escape' || e.defaultPrevented || !useTestGameStore.getState().detailOpen) return
    e.preventDefault()
    closeDetail()
  }
  const collapse = useCallback(() => setCollapsed(true), [setCollapsed])
  const expand = useCallback(() => setCollapsed(false), [setCollapsed])
  const reserving = reserve && game != null && !collapsed

  return (
    // Right and bottom insets: a landscape phone's notch, an iPad's home
    // indicator (the sidebar and the top bar pad for theirs). Clips the
    // overlay's slide. --tg-ov is the expanded overlay's width (TgDetailOverlay).
    <div className="relative flex min-h-0 flex-1 gap-5 overflow-hidden pb-[max(1.25rem,env(safe-area-inset-bottom))] pl-5 pr-[max(1.25rem,env(safe-area-inset-right))] [--tg-ov:380px] xl:pl-6 xl:pr-[max(1.5rem,env(safe-area-inset-right))] xl:[--tg-ov:400px] 2xl:[--tg-ov:420px]">
      {/* 992px = a 768px column beside the 224px sidebar. A viewport query, not a
          container query: container-type would make this row the containing
          block and stacking context for everything inside it. */}
      <main className={`flex min-w-0 flex-1 flex-col ${reserving ? 'min-[992px]:pr-[calc(var(--tg-ov)-0.5rem)]' : ''}`}>
        {header}
        <div
          className={`min-h-0 flex-1 ${scroll ? 'tg-scroll-y' : ''}`}
          onKeyDownCapture={onKeyDownCapture}
          onClickCapture={onClickCapture}
          onKeyDown={onKeyDown}
        >
          {children}
        </div>
      </main>
      <TgDetailOverlay
        game={game} collapsed={collapsed} actions={actions}
        onCollapse={collapse} onExpand={expand} onClose={closeDetail} panelRef={panelRef}
      />
    </div>
  )
}
