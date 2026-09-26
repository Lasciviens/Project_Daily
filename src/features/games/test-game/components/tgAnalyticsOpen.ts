import { useTestGameStore } from '../testGameStore'
import { focusPageHeading } from './tgAnalyticsNav'

/**
 * Opens one game's details from Analytics. Details only render in a game
 * section, so this moves to the whole Library first (which also clears a
 * lingering platform/genre filter), then opens the game expanded — the phone
 * sheet or the tablet/desktop overlay, whichever the layout renders. Focus
 * follows: into the overlay, or (the phone sheet manages its own) the heading.
 */
export function openGameFromAnalytics(id: string): void {
  const s = useTestGameStore.getState()
  s.setSearch('')
  s.setSection('library')
  s.openDetail(id)
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (document.activeElement?.closest('[role="dialog"]')) return // the phone sheet took focus
    const panel = document.querySelector<HTMLElement>('.tg-root aside[data-tg-detail]')
    if (panel) panel.focus({ preventScroll: true })
    else focusPageHeading()
  }))
}
