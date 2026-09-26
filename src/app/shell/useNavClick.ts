import type { MouseEvent } from 'react'
import { useLocation } from 'react-router-dom'
import { useViewTransitionNav } from '../../shared/hooks/useViewTransitionNav'

/** Scrolls the app's one scroll container (<main data-app-scroller>) back to the top. */
export function scrollMainToTop() {
  document.querySelector<HTMLElement>('[data-app-scroller]')?.scrollTo({ top: 0, behavior: 'smooth' })
}

interface NavClickOptions {
  /** Tab-order slide direction; omitted = crossfade. */
  direction?: 'forward' | 'back'
  /** The entry is already active: re-tapping it scrolls the page to the top. */
  active?: boolean
  /** Replace the current history entry (navigating out of an overlay). */
  replace?: boolean
}

/**
 * onClick for a shell <Link>: a plain click navigates through a view
 * transition; Cmd/Ctrl/Shift/middle-click keep the browser's own behaviour
 * (open in a new tab), which a blanket preventDefault used to break.
 */
export function useNavClick() {
  const go = useViewTransitionNav()
  const { pathname } = useLocation()
  return (to: string, opts: NavClickOptions = {}) => (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    if (opts.active ?? to === pathname) { scrollMainToTop(); return }
    go(to, opts.direction, { replace: opts.replace })
  }
}
