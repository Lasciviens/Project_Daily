import { useState } from 'react'
import { Dialog, DialogPanel, DialogBackdrop } from '@headlessui/react'
import { useAllGames, useUpdateGame } from '../../home/hooks/useGames'
import { toast } from '../../../app/store'
import { TIER_COLOR as TIER_BADGE } from '../gamesMeta'
import type { Game } from '../../home/api/gamesApi'

const TIER_ROWS: { tier: string | null; label: string; bg: string; text: string; bar: string }[] = [
  { tier: 'S', label: 'S', bg: 'bg-yellow-50',  text: 'text-yellow-900', bar: 'bg-yellow-400' },
  { tier: 'A', label: 'A', bg: 'bg-orange-50',  text: 'text-orange-900', bar: 'bg-orange-400' },
  { tier: 'B', label: 'B', bg: 'bg-green-50',   text: 'text-green-900',  bar: 'bg-green-500'  },
  { tier: 'C', label: 'C', bg: 'bg-blue-50',    text: 'text-blue-900',   bar: 'bg-blue-400'   },
  { tier: 'D', label: 'D', bg: 'bg-ink-50',     text: 'text-ink-700',    bar: 'bg-ink-400'    },
  { tier: 'F', label: 'F', bg: 'bg-red-50',     text: 'text-red-900',    bar: 'bg-red-400'    },
  { tier: null, label: '—', bg: 'bg-cream-50',     text: 'text-ink-400',    bar: 'bg-ink-200'    },
]

// Small game cover with click-to-edit
function TierCard({ game, onPickTier }: { game: Game; onPickTier: (game: Game) => void }) {
  const [err, setErr] = useState(false)
  return (
    <button
      onClick={() => onPickTier(game)}
      title={`${game.title} — click to change tier`}
      className="relative rounded-lg overflow-hidden border border-ink-200 hover:border-accent-400 hover:scale-105 transition-all duration-150 bg-ink-100 shadow-sm group flex-shrink-0"
      style={{ width: 64, aspectRatio: '3/4' }}
    >
      {game.cover_url && !err
        ? <img src={game.cover_url} alt={game.title} onError={() => setErr(true)} className="w-full h-full object-cover" />
        : <div className="w-full h-full flex items-center justify-center text-base bg-ink-100">🎮</div>
      }
      <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
      {/* Hover edit hint */}
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
        <span className="text-white text-lg">✏️</span>
      </div>
      {game.is_iconic && <span className="absolute top-0.5 right-0.5 text-[10px]">⭐</span>}
    </button>
  )
}

// Tier picker popup
function TierPicker({
  game,
  onSelect,
  onClose,
}: {
  game: Game
  onSelect: (tier: string | null) => void
  onClose: () => void
}) {
  return (
    <Dialog open onClose={onClose} className="relative z-[60]">
      <DialogBackdrop transition className="fixed inset-0 bg-ink-900/30 transition duration-200 data-[closed]:opacity-0" />
      <div className="fixed inset-0 flex items-end sm:items-center justify-center p-0 sm:p-4">
        <DialogPanel transition className="w-full rounded-t-2xl sm:rounded-2xl sm:max-w-md max-h-[90vh] overflow-y-auto bg-cream-50 border border-ink-200 transition duration-200 data-[closed]:opacity-0 data-[closed]:translate-y-4 sm:data-[closed]:translate-y-0 sm:data-[closed]:scale-95">
          <div className="p-5 w-full">
            <p className="text-sm font-semibold text-ink-800 mb-1 truncate">{game.title}</p>
            <p className="text-xs text-ink-400 mb-4">Current tier: <strong>{game.tier ?? '—'}</strong></p>
            <div className="grid grid-cols-4 gap-2">
              {['S', 'A', 'B', 'C', 'D', 'F'].map(t => (
                <button
                  key={t}
                  onClick={() => onSelect(t)}
                  className={`py-3 rounded-xl text-sm font-bold border-2 transition-all hover:scale-105 min-h-[44px] ${
                    game.tier === t
                      ? (TIER_BADGE[t] ?? 'bg-ink-200') + ' border-transparent scale-105 ring-2 ring-offset-1 ring-ink-400'
                      : 'bg-cream-50 text-ink-600 border-ink-200 hover:border-ink-400'
                  }`}
                >{t}</button>
              ))}
              <button
                onClick={() => onSelect(null)}
                className={`col-span-2 py-2.5 rounded-xl text-xs text-ink-500 border-2 transition-all hover:border-ink-400 min-h-[44px] ${
                  game.tier == null ? 'border-ink-400 bg-ink-50' : 'border-ink-200 bg-cream-50'
                }`}
              >Remove tier</button>
            </div>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  )
}

export function TierEditorTab() {
  const { data: allGames = [], isLoading } = useAllGames()
  const { mutate: updateGame, isPending }  = useUpdateGame()
  const [picking, setPicking] = useState<Game | null>(null)

  function handleTierChange(newTier: string | null) {
    if (!picking) return
    const id = toast.loading(`Moving to ${newTier ?? 'untiered'}…`)
    updateGame(
      { id: picking.id, patch: { tier: newTier } },
      {
        onSuccess: () => { toast.dismiss(id); toast.success('Tier updated ✓') },
        onError:   (e) => { toast.dismiss(id); toast.error((e as Error).message) },
      }
    )
    setPicking(null)
  }

  if (isLoading) return (
    <div className="space-y-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-24 rounded-2xl bg-cream-200 animate-pulse" />
      ))}
    </div>
  )

  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-400">Click any game cover to change its tier.</p>

      {TIER_ROWS.map(({ tier, label, bg, text, bar }) => {
        const games = allGames
          .filter(g => g.tier === tier)
          .sort((a, b) => a.title.localeCompare(b.title))

        return (
          <div key={label} className={`rounded-xl border border-ink-200 overflow-hidden ${bg}`}>
            <div className="flex items-stretch">
              {/* Tier label */}
              <div className={`flex-shrink-0 w-12 flex items-center justify-center font-black text-xl ${bar} text-white`}>
                {label}
              </div>
              {/* Games */}
              <div className="flex-1 flex items-center gap-2 p-3 overflow-x-auto scrollbar-none scroll-fade-x min-h-[96px]">
                {games.length === 0 ? (
                  <span className="text-xs text-ink-300 italic">No games</span>
                ) : (
                  games.map(g => (
                    <TierCard key={g.id} game={g} onPickTier={setPicking} />
                  ))
                )}
              </div>
              {/* Count */}
              <div className={`flex-shrink-0 w-10 flex items-center justify-center text-xs font-semibold ${text} opacity-60`}>
                {games.length}
              </div>
            </div>
          </div>
        )
      })}

      {isPending && (
        <div className="fixed bottom-6 right-6 bg-ink-900 text-white text-xs px-4 py-2 rounded-full shadow-lg">
          Saving…
        </div>
      )}

      {picking && (
        <TierPicker game={picking} onSelect={handleTierChange} onClose={() => setPicking(null)} />
      )}
    </div>
  )
}
