import { useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { Transition } from '@headlessui/react'
import type { TgGame } from '../testGameModel'
import type { TgActions } from '../tgTypes'
import { TgDetailPanel } from './TgDetailPanel'
import { TgDetailOverlayControls } from './TgDetailOverlayControls'
import { TgDetailOverlayTab } from './TgDetailOverlayTab'

interface Props {
  /** The game whose details are open; null when they are closed. */
  game: TgGame | null
  /** Tucked into the slim tab instead of expanded. */
  collapsed: boolean
  actions: TgActions
  onCollapse: () => void
  onExpand: () => void
  onClose: () => void
  /** The expanded overlay, so the shell can move keyboard focus into it. */
  panelRef: RefObject<HTMLElement | null>
}

// Slides in from the right edge and fades; eases out on the way in, quicker on
// the way out. The page's reduced-motion rule turns every transition off.
const MOTION = 'transition ease-[cubic-bezier(0.22,1,0.36,1)] duration-300 data-[leave]:duration-200 data-[leave]:ease-in data-[closed]:translate-x-full data-[closed]:opacity-0'
// Flush with the right edge (rounded on the left only), from just under the
// top bar down to where the games end. The panel is 380px on a tablet (more of
// a narrow column stays visible), 400 on a laptop, 420 on a monitor — set as
// --tg-ov on TgDetailOverlayHost, which also reserves it for the queue.
const FRAME = 'absolute right-0 top-0 z-20 border border-r-0 border-[var(--tg-border-strong)] bg-[var(--tg-panel)] pr-[env(safe-area-inset-right)] shadow-[shadow:var(--tg-menu-shadow)]'

/** Whether keyboard focus is inside one of `els` — closing it would strand focus on the page body. */
function holdsFocus(...els: (HTMLElement | null)[]): boolean {
  const active = document.activeElement
  return active != null && els.some(el => el?.contains(active))
}

/**
 * The tablet/desktop detail overlay: a non-modal panel over the right of the
 * games, so the games themselves get the whole width. The games stay live
 * underneath — another click swaps the game, arrow keys walk it along. It can
 * be tucked into a slim tab at the right edge (which follows the selection
 * without opening) or closed; Escape inside it closes it.
 *
 * Rendered inside the content row: while tucked, it reserves a narrow rail
 * there so the tab never covers a cover or the shelf's scrollbar. The rail
 * stays through a later expand (the shelf does not reflow under the panel)
 * and goes when the overlay closes — so opening never moves the games.
 */
export function TgDetailOverlay({ game, collapsed, actions, onCollapse, onExpand, onClose, panelRef }: Props) {
  const tabRef = useRef<HTMLElement>(null)
  const expandRef = useRef<HTMLButtonElement>(null)

  // Keep painting the last game while the overlay animates out.
  const [last, setLast] = useState(game)
  if (game && game !== last) setLast(game)
  const shown = game ?? last

  const [rail, setRail] = useState(false)
  if (game && collapsed && !rail) setRail(true)
  if (!game && rail) setRail(false)

  function close() {
    const id = shown?.id
    const scope = (panelRef.current ?? tabRef.current)?.closest('.tg-root')
    const refocus = holdsFocus(panelRef.current, tabRef.current)
    onClose()
    // Focus goes back to the game on the shelf rather than to the page body.
    if (!refocus || !id || !scope) return
    const sel = CSS.escape(id)
    requestAnimationFrame(() => {
      scope.querySelector<HTMLElement>(`main [data-game-id="${sel}"], main [data-queue-id="${sel}"] button`)?.focus()
    })
  }

  function collapse() {
    onCollapse()
    requestAnimationFrame(() => expandRef.current?.focus({ preventScroll: true }))
  }

  function expand() {
    onExpand()
    requestAnimationFrame(() => panelRef.current?.focus({ preventScroll: true }))
  }

  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (e.key !== 'Escape' || e.defaultPrevented) return
    // A menu or the screenshot viewer opened from here closes itself first.
    if ((e.target as Element).closest('[role="dialog"], [role="menu"], [role="listbox"]')) return
    e.preventDefault()
    close()
  }

  const label = shown ? `${shown.title} details` : 'Game details'
  return (
    <>
      {rail && <div aria-hidden className="w-6 shrink-0" />}
      <Transition show={game != null && !collapsed}>
        <aside
          ref={panelRef}
          tabIndex={-1}
          data-tg-detail
          aria-label={label}
          onKeyDown={onKeyDown}
          className={`${FRAME} ${MOTION} bottom-[max(1.25rem,env(safe-area-inset-bottom))] flex w-[calc(var(--tg-ov,380px)+env(safe-area-inset-right))] max-w-[calc(100%-2.5rem)] overflow-hidden rounded-l-[18px] focus-visible:!rounded-l-[18px] focus-visible:!rounded-r-none focus-visible:!outline-none`}
        >
          {/* Controls first: Tab from the region reaches Collapse / Close
              before the whole card. */}
          {shown && (
            <>
              <TgDetailOverlayControls title={shown.title} onCollapse={collapse} onClose={close} />
              <TgDetailPanel game={shown} actions={actions} variant="overlay" />
            </>
          )}
        </aside>
      </Transition>
      <Transition show={game != null && collapsed}>
        <aside
          ref={tabRef}
          aria-label={label}
          onKeyDown={onKeyDown}
          className={`${FRAME} ${MOTION} flex w-[calc(56px+env(safe-area-inset-right))] flex-col items-center rounded-l-2xl pb-1.5 pt-1.5`}
        >
          {shown && <TgDetailOverlayTab game={shown} onExpand={expand} onClose={close} expandRef={expandRef} />}
        </aside>
      </Transition>
    </>
  )
}
