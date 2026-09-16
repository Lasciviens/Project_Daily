import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { importProviderGames, type ProviderGameInput } from '../api/gamesApi'
import { toast } from '../../../app/store'
import { logError } from '../../../shared/utils/logError'
import type { GameLibrary } from '../types'

// Copies a provider's list into `games` (migration 096) so those titles can be
// tiered, rated, marked completed and counted in Stats like any other.
//
// Explicitly a BUTTON, not something that happens on tab load: the Steam and
// PlayStation tabs are deliberately lazy about what they fetch (see CLAUDE.md's
// loading-priority note), and writing several hundred rows every time someone
// glances at a tab would be exactly the kind of eager work that design forbids.
//
// Re-running is the normal case, not a mistake: the import updates play
// statistics and never touches play_status, tier, rating or notes.

export function ImportProviderButton({ library, source, games, label }: {
  library: Exclude<GameLibrary, 'retro'>
  source: 'steam' | 'psn'
  games: ProviderGameInput[]
  label: string
}) {
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)

  async function run() {
    if (!games.length) return
    setBusy(true)
    const tid = toast.loading(`Importing ${games.length} games…`)
    try {
      const { imported } = await importProviderGames(library, source, games)
      toast.dismiss(tid)
      toast.success(`${imported} game${imported === 1 ? '' : 's'} in your library ✓`)
      qc.invalidateQueries({ queryKey: ['games'] })
    } catch (e) {
      toast.dismiss(tid)
      const msg = (e as Error).message
      logError(`import_provider_games_${source}: ${msg}`)
      toast.error(msg)
    } finally { setBusy(false) }
  }

  return (
    <button type="button" onClick={run} disabled={busy || !games.length}
      title={`Adds these ${games.length} games to your library so they can be rated, tiered and counted in Stats. Safe to repeat — it never overwrites your own status or rating.`}
      className="min-h-[44px] px-3 text-sm font-semibold rounded-lg border border-ink-200 bg-cream-50 text-ink-600 hover:border-accent-300 hover:text-accent-700 disabled:opacity-40 transition-colors">
      {busy ? 'Importing…' : label}
    </button>
  )
}
