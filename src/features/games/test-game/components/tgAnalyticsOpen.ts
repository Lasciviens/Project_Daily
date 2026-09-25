import { useTestGameStore } from '../testGameStore'

/**
 * Opens one game's details from Analytics. Details only render in a game
 * section, so this moves to the whole Library first (which also clears a
 * lingering platform/genre filter), then opens the game expanded — the phone
 * sheet or the tablet/desktop overlay, whichever the layout renders.
 */
export function openGameFromAnalytics(id: string): void {
  const s = useTestGameStore.getState()
  s.setSearch('')
  s.setSection('library')
  s.openDetail(id)
}
