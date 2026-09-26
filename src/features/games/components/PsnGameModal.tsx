import { useState } from 'react'
import { Dialog, DialogPanel, DialogBackdrop } from '@headlessui/react'
import { usePsnTitleMap } from '../hooks/usePlayStation'
import { PsnTrophyPanel } from './PsnTrophyPanel'
import { parsePlayDurationMinutes, type PsnPlayedGame, type PsnPurchasedGame, type PsnTrophyTitle } from '../api/psnApi'
import { OWNERSHIP_LABEL, type Ownership } from '../providerEntries'
import { formatPlaytime } from '../api/playtimeFormat'
import { LibraryControls } from './LibraryControls'
import { useLibraryEntry } from '../hooks/useGames'
import { useHistoryDismiss } from '../../../shared/hooks/useHistoryDismiss'

// Detail popup for one PSN game. Opens from either view:
//   - the playtime library (a store SKU) → the trophy set has to be bridged
//     first, which is ONE extra call for this one game (Sony caps the bridge
//     at 5 ids per request, so mapping a whole library up front is not an
//     option — see psnApi.ts);
//   - the trophy view (already an NPWR id) → no bridge needed.
// Everything above the trophy list paints from data already in hand.

const CATEGORY_LABEL: Record<string, string> = {
  ps5_native_game: 'PS5', ps4_game: 'PS4', pspc_game: 'PC', unknown: '—',
}

const fmtDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB') : '—')

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-ink-50 rounded-lg px-2.5 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-400">{label}</p>
      <p className="text-sm font-semibold text-ink-800 mt-0.5">{value}</p>
    </div>
  )
}

interface Props {
  game?: PsnPlayedGame
  title?: PsnTrophyTitle
  purchased?: PsnPurchasedGame
  /** Merged across every row Sony returned for this title — a game can be
   *  bought AND in the catalogue, and showing one of those hides the other. */
  ownership?: Ownership
  onClose: () => void
}

export function PsnGameModal({ game, title, purchased, ownership, onClose }: Props) {
  useHistoryDismiss(true, onClose)
  const [imgOk, setImgOk] = useState(true)
  // Keyed by the store SKU, which is what the import writes as external_ref.
  // A trophy-only entry has no npTitleId, so it simply has no library row.
  const { entry } = useLibraryEntry('playstation', game?.titleId)

  // Bridge only when we came from the playtime library.
  const bridged = usePsnTitleMap(game && !title ? game.titleId : null)
  const trophyTitle = title ?? bridged.data ?? null

  // Every field below is reverse-engineered from Sony's own responses, so it
  // is read defensively: a shape drift must degrade a line, never throw during
  // render (which blanks the page — see ErrorBoundary).
  const EMPTY_TROPHIES = { bronze: 0, silver: 0, gold: 0, platinum: 0 }
  const earnedT = title?.earnedTrophies ?? EMPTY_TROPHIES
  const definedT = title?.definedTrophies ?? EMPTY_TROPHIES
  const rawGenres: unknown = game?.concept?.genres
  const genres: string[] = Array.isArray(rawGenres)
    ? rawGenres.filter((g): g is string => typeof g === 'string')
    : typeof rawGenres === 'string' ? rawGenres.split(/\s+/).filter(Boolean) : []

  const name = game?.name ?? title?.trophyTitleName ?? ''
  const art = game?.imageUrl ?? title?.trophyTitleIconUrl ?? null
  const minutes = parsePlayDurationMinutes(game?.playDuration)
  // The merged state wins; the single purchased row and Sony's own `service`
  // field are the fallbacks for a title the purchased call never returned.
  const owned: Ownership | null = ownership
    ?? (purchased?.membership === 'PS_PLUS' || game?.service === 'ps_plus' ? 'plus' : null)

  return (
    <Dialog open onClose={onClose} className="relative z-[60]">
      <DialogBackdrop transition className="fixed inset-0 bg-ink-900/40 transition duration-200 data-[closed]:opacity-0" />
      <div className="fixed inset-0 flex items-end sm:items-center justify-center p-0 sm:p-4">
        <DialogPanel transition className="w-full rounded-t-2xl sm:rounded-2xl sm:max-w-3xl max-h-[92vh] overflow-y-auto bg-cream-50 border border-ink-200 transition duration-200 data-[closed]:opacity-0 data-[closed]:translate-y-4 sm:data-[closed]:translate-y-0 sm:data-[closed]:scale-95">

          {/* Painted entirely from data already in hand — no network on open. */}
          <div className="relative bg-ink-950" style={{ aspectRatio: '16/9' }}>
            {art && imgOk
              ? <img src={art} alt={name} onError={() => setImgOk(false)} className="w-full h-full object-cover" />
              : <div className="w-full h-full flex items-center justify-center text-4xl">🎮</div>}
            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />
            <button onClick={onClose} aria-label="Close"
              className="absolute top-2 right-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl bg-black/50 text-white text-xl hover:bg-black/70">×</button>
            <div className="absolute inset-x-0 bottom-0 px-4 pb-3">
              <h2 className="text-white text-lg font-bold leading-tight drop-shadow">{name}</h2>
              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                {game?.category && (
                  <span className="text-[10px] font-semibold bg-white/20 text-white px-1.5 py-0.5 rounded">
                    {CATEGORY_LABEL[game.category] ?? game.category}
                  </span>
                )}
                {title?.trophyTitlePlatform && !game && (
                  <span className="text-[10px] font-semibold bg-white/20 text-white px-1.5 py-0.5 rounded">
                    {title.trophyTitlePlatform}
                  </span>
                )}
                {owned && (
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded text-white ${
                    owned === 'both' ? 'bg-violet-600/90' : owned === 'plus' ? 'bg-blue-500/90' : 'bg-white/25'
                  }`}>{OWNERSHIP_LABEL[owned]}</span>
                )}
              </div>
            </div>
          </div>

          <div className="px-4 py-4 space-y-4">
            {/* The personal side: the same status/rating controls the
                retro library has, now that migration 096 gives a PlayStation
                game a real row to write them to. */}
            {game && (
              <LibraryControls entry={entry}
                notImportedHint="This game is not in your library yet. Use “Add … to library” on the PlayStation tab, then status and rating appear here." />
            )}

            {game && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <Stat label="Total playtime" value={minutes > 0 ? formatPlaytime(minutes) : '—'} />
                <Stat label="Times launched" value={game.playCount != null ? String(game.playCount) : '—'} />
                <Stat label="First played" value={fmtDate(game.firstPlayedDateTime)} />
                <Stat label="Last played" value={fmtDate(game.lastPlayedDateTime)} />
              </div>
            )}

            {genres.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                {genres.slice(0, 5).map(g => (
                  <span key={g} className="text-[11px] bg-ink-50 text-ink-600 border border-ink-200 px-2 py-0.5 rounded-full">
                    {g.toLowerCase()}
                  </span>
                ))}
              </div>
            )}

            {title && (
              <div className="flex items-center gap-3 flex-wrap text-sm text-ink-600">
                <span>🏆 {earnedT.platinum}</span>
                <span>🥇 {earnedT.gold}/{definedT.gold}</span>
                <span>🥈 {earnedT.silver}/{definedT.silver}</span>
                <span>🥉 {earnedT.bronze}/{definedT.bronze}</span>
                {title.progress != null && <span className="text-ink-400">· {title.progress}%</span>}
              </div>
            )}

            <div className="pt-1 border-t border-ink-100">
              <h3 className="text-xs font-bold uppercase tracking-wider text-ink-400 mt-3 mb-2">Trophies</h3>
              {bridged.isLoading && <p className="text-sm text-ink-400 py-2">Looking up the trophy set…</p>}
              {bridged.error && (
                <p className="text-sm text-red-600 py-2">
                  Couldn't look up the trophy set: {(bridged.error as Error).message}
                </p>
              )}
              {!bridged.isLoading && !bridged.error && !trophyTitle && (
                <p className="text-sm text-ink-400 py-2">
                  No trophy set found for this game — it may not support trophies, or none have synced to your account yet.
                </p>
              )}
              {trophyTitle && (
                <PsnTrophyPanel
                  npCommunicationId={trophyTitle.npCommunicationId}
                  npServiceName={trophyTitle.npServiceName}
                  hasGroups={trophyTitle.hasTrophyGroups}
                />
              )}
            </div>

            {game?.media?.screenshotUrl && (
              <div className="pt-1 border-t border-ink-100">
                <img src={game.media.screenshotUrl} alt="" loading="lazy"
                  className="w-full rounded-lg border border-ink-200 mt-3" />
              </div>
            )}
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  )
}
