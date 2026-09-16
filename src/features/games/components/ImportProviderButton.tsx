import { useState } from 'react'
import { useQueryClient, useQuery } from '@tanstack/react-query'
import { importProviderGames, fetchProviderRefs, type ProviderGameInput } from '../api/gamesApi'
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

export function ImportProviderButton({ library, source, games }: {
  library: Exclude<GameLibrary, 'retro'>
  source: 'steam' | 'psn'
  games: ProviderGameInput[]
}) {
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)

  // What is already in. Without this the button offered "add all 320" whether
  // or not they were in the library, so the one thing it should say — what is
  // NEW — was the one thing it did not.
  const refs = useQuery({
    queryKey: ['games', 'provider-refs', library],
    queryFn: () => fetchProviderRefs(library),
    staleTime: 60_000,
  })
  const known = refs.data
  const newCount = known ? games.filter(g => !known.has(g.external_ref)).length : null

  async function run() {
    if (!games.length) return
    setBusy(true)
    const tid = toast.loading(`Importing ${games.length} games…`)
    try {
      const { imported, updated, promoted } = await importProviderGames(library, source, games)
      toast.dismiss(tid)
      const bits = [
        imported ? `${imported} added` : null,
        updated ? `${updated} refreshed` : null,
        promoted ? `${promoted} now playing` : null,
      ].filter(Boolean)
      toast.success(bits.length ? `${bits.join(' · ')} ✓` : 'Already up to date ✓')
      qc.invalidateQueries({ queryKey: ['games'] })
    } catch (e) {
      toast.dismiss(tid)
      const msg = (e as Error).message
      logError(`import_provider_games_${source}: ${msg}`)
      toast.error(msg)
    } finally { setBusy(false) }
  }

  // Running with nothing new is still useful — it refreshes playtime on every
  // row — so the button stays enabled and simply says what it will do.
  const label = busy ? 'Importing…'
    : newCount == null ? '＋ Add to library'
    : newCount > 0 ? `＋ Add ${newCount} new`
    : '🔄 Refresh playtime'

  return (
    <button type="button" onClick={run} disabled={busy || !games.length}
      title={newCount === 0
        ? `All ${games.length} are already in your library. Running again refreshes playtime and last-played, and never touches your own status, tier, rating or notes.`
        : `Adds ${newCount ?? games.length} new game${newCount === 1 ? '' : 's'} to your library and refreshes the rest. It never overwrites your own status, tier, rating or notes.`}
      className="min-h-[44px] px-3 text-sm font-semibold rounded-lg border border-ink-200 bg-cream-50 text-ink-600 hover:border-accent-300 hover:text-accent-700 disabled:opacity-40 transition-colors">
      {label}
    </button>
  )
}
