import { useState } from 'react'
import { Dialog, DialogPanel, DialogBackdrop } from '@headlessui/react'
import { useSteamAppDetails, useSteamAppReviews, useSteamCurrentPlayers, STORE_UNAVAILABLE } from '../hooks/useSteam'
import { SteamAchievementGrid } from './SteamAchievementGrid'
import { LibraryControls } from './LibraryControls'
import { useLibraryEntry } from '../hooks/useGames'
import { steamGameHeaderUrl, type SteamGame } from '../api/steamApi'
import { formatPlaytime } from '../api/playtimeFormat'

// Detail popup for one owned Steam game — the anchor piece of the Steam tab
// (the user asked for a popup showing a game's details). Pulls together
// three sources: the owned-games row already in hand (playtime, per-platform
// split, last played), the cached store metadata (`steam_apps`, migration
// 092), and — on an explicit tap only — the live concurrent-player count.

const fmtDate = (unix?: number) =>
  unix ? new Date(unix * 1000).toLocaleDateString('en-GB') : '—'

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-ink-50 rounded-lg px-2.5 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-400">{label}</p>
      <p className="text-sm font-semibold text-ink-800 mt-0.5">{value}</p>
    </div>
  )
}

function PlatformSplit({ game }: { game: SteamGame }) {
  const rows = [
    { label: '🖥 Windows', min: game.playtime_windows_forever ?? 0 },
    { label: '🍎 macOS', min: game.playtime_mac_forever ?? 0 },
    { label: '🐧 Linux', min: game.playtime_linux_forever ?? 0 },
    { label: '🎮 Steam Deck', min: game.playtime_deck_forever ?? 0 },
    { label: '✈️ Offline', min: game.playtime_disconnected ?? 0 },
  ].filter(r => r.min > 0)
  if (rows.length < 2) return null
  const total = rows.reduce((s, r) => s + r.min, 0)
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-400 mb-1.5">Playtime by platform</p>
      <div className="space-y-1">
        {rows.map(r => (
          <div key={r.label} className="flex items-center gap-2">
            <span className="text-[11px] text-ink-600 w-24 flex-shrink-0">{r.label}</span>
            <div className="flex-1 h-1.5 bg-ink-100 rounded-full overflow-hidden">
              <div className="h-full bg-accent-500 rounded-full" style={{ width: `${(r.min / total) * 100}%` }} />
            </div>
            <span className="text-[11px] text-ink-500 w-16 text-right">{formatPlaytime(r.min)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function SteamGameModal({ game, onClose }: { game: SteamGame; onClose: () => void }) {
  const details = useSteamAppDetails(game.appid)
  const reviews = useSteamAppReviews(game.appid)
  const [wantPlayers, setWantPlayers] = useState(false)
  const players = useSteamCurrentPlayers(game.appid, wantPlayers)
  const [imgOk, setImgOk] = useState(true)
  const { entry } = useLibraryEntry('steam', String(game.appid))

  const d = details.data?.details ?? null
  const genres = details.data?.genres ?? d?.genres?.map(g => g.description) ?? []
  const rv = reviews.data

  return (
    <Dialog open onClose={onClose} className="relative z-[60]">
      <DialogBackdrop transition className="fixed inset-0 bg-ink-900/40 transition duration-200 data-[closed]:opacity-0" />
      <div className="fixed inset-0 flex items-end sm:items-center justify-center p-0 sm:p-4">
        <DialogPanel transition className="w-full rounded-t-2xl sm:rounded-2xl sm:max-w-3xl max-h-[92vh] overflow-y-auto bg-cream-50 border border-ink-200 transition duration-200 data-[closed]:opacity-0 data-[closed]:translate-y-4 sm:data-[closed]:translate-y-0 sm:data-[closed]:scale-95">

          {/* Hero — deliberately painted from data already in hand (the CDN
              header URL is derivable from the appid, the title comes from the
              owned-games row), so the popup is fully legible on the very
              first frame with zero network. Store metadata fills in around
              it; nothing here waits on or swaps because of that. */}
          <div className="relative bg-ink-950" style={{ aspectRatio: '460/215' }}>
            {imgOk
              ? <img src={steamGameHeaderUrl(game.appid)} alt={game.name}
                     onError={() => setImgOk(false)} className="w-full h-full object-cover" />
              : <div className="w-full h-full flex items-center justify-center text-4xl">🎮</div>}
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
            <button onClick={onClose} aria-label="Close"
              className="absolute top-2 right-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl bg-black/50 text-white text-xl hover:bg-black/70">×</button>
            <div className="absolute inset-x-0 bottom-0 px-4 pb-3">
              <h2 className="text-white text-lg font-bold leading-tight drop-shadow">{game.name}</h2>
              {(d?.developers?.length || d?.release_date?.date) && (
                <p className="text-white/70 text-xs mt-0.5">
                  {[d?.developers?.join(', '), d?.release_date?.date].filter(Boolean).join(' · ')}
                </p>
              )}
            </div>
          </div>

          <div className="px-4 py-4 space-y-4">
            {/* The personal side: the same status/rating controls the
                retro library has, now that migration 096 gives a Steam game a
                real row to write them to. */}
            <LibraryControls entry={entry}
              notImportedHint="This game is not in your library yet. Use “Add … to library” on the Steam tab, then status and rating appear here." />

            {/* Your own numbers — always available, no extra request */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Stat label="Total" value={formatPlaytime(game.playtime_forever)} />
              <Stat label="Last 2 weeks" value={game.playtime_2weeks ? formatPlaytime(game.playtime_2weeks) : '—'} />
              <Stat label="Last played" value={fmtDate(game.rtime_last_played)} />
              <Stat label="Metacritic" value={details.data?.metacritic_score ? String(details.data.metacritic_score) : '—'} />
            </div>

            <PlatformSplit game={game} />

            {/* Store metadata */}
            {details.isLoading && <p className="text-sm text-ink-400">Loading store details…</p>}
            {(details.error as Error | null)?.message === STORE_UNAVAILABLE ? (
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm text-ink-500">
                  Store details are unavailable right now (possibly a Steam rate limit) — your own data is below.
                </p>
                <button onClick={() => details.refetch()} disabled={details.isFetching}
                  className="min-h-[44px] px-3 text-sm rounded-lg border border-ink-200 bg-ink-50 text-ink-600 hover:border-accent-300 transition-colors disabled:opacity-40">
                  {details.isFetching ? 'Retrying…' : 'Try again'}
                </button>
              </div>
            ) : details.error ? (
              <p className="text-sm text-red-600">Couldn't load store details: {(details.error as Error).message}</p>
            ) : null}
            {details.data && !d && (
              <p className="text-sm text-ink-400">This game is no longer listed on the Steam store — only your own data is shown.</p>
            )}
            {d?.short_description && <p className="text-sm text-ink-700 leading-relaxed">{d.short_description}</p>}

            {(genres.length > 0 || rv || d?.recommendations) && (
              <div className="flex items-center gap-1.5 flex-wrap">
                {genres.slice(0, 5).map(g => (
                  <span key={g} className="text-[11px] bg-ink-50 text-ink-600 border border-ink-200 px-2 py-0.5 rounded-full">{g}</span>
                ))}
                {rv?.review_score_desc && (
                  <span className="text-[11px] font-semibold bg-green-50 text-green-700 border border-green-200 px-2 py-0.5 rounded-full dark:bg-green-500/10 dark:text-green-400 dark:border-green-500/30">
                    {rv.total_reviews && rv.total_positive != null
                      ? `%${Math.round((rv.total_positive / rv.total_reviews) * 100)} · `
                      : ''}
                    {rv.review_score_desc}
                    {rv.total_reviews ? ` (${rv.total_reviews.toLocaleString('en-GB')})` : ''}
                  </span>
                )}
              </div>
            )}

            {/* Live player count — explicit tap only, never on open */}
            <div className="flex items-center gap-2 flex-wrap">
              {!wantPlayers ? (
                <button onClick={() => setWantPlayers(true)}
                  className="min-h-[44px] px-3 text-sm rounded-lg border border-ink-200 bg-ink-50 text-ink-600 hover:border-accent-300 transition-colors">
                  🟢 How many are playing right now?
                </button>
              ) : players.isLoading ? (
                <span className="text-sm text-ink-400">Checking…</span>
              ) : players.data != null ? (
                <span className="text-sm text-ink-700">
                  🟢 <strong>{players.data.toLocaleString('en-GB')}</strong> playing right now
                </span>
              ) : (
                <span className="text-sm text-ink-400">Couldn't load the player count.</span>
              )}
              {d?.price_overview && (
                <span className="text-sm text-ink-500 ml-auto">
                  {d.price_overview.discount_percent > 0 && (
                    <span className="text-green-600 font-semibold mr-1.5">-{d.price_overview.discount_percent}%</span>
                  )}
                  {d.price_overview.final_formatted}
                </span>
              )}
            </div>

            {/* Achievements */}
            {game.has_community_visible_stats !== false && (
              <div className="pt-1 border-t border-ink-100">
                <h3 className="text-xs font-bold uppercase tracking-wider text-ink-400 mt-3 mb-2">Achievements</h3>
                <SteamAchievementGrid appid={game.appid} />
              </div>
            )}

            {/* Screenshots */}
            {(d?.screenshots?.length ?? 0) > 0 && (
              <div className="pt-1 border-t border-ink-100">
                <h3 className="text-xs font-bold uppercase tracking-wider text-ink-400 mt-3 mb-2">Screenshots</h3>
                <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
                  {d!.screenshots!.slice(0, 8).map(s => (
                    <img key={s.id} src={s.path_thumbnail} alt="" loading="lazy"
                      className="h-28 rounded-lg border border-ink-200 flex-shrink-0" />
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-2 flex-wrap pt-1">
              <a href={`https://store.steampowered.com/app/${game.appid}`} target="_blank" rel="noreferrer"
                className="min-h-[44px] px-3 inline-flex items-center text-sm rounded-lg border border-ink-200 bg-cream-50 text-ink-600 hover:border-accent-300 transition-colors">
                Store page ↗
              </a>
              {d?.website && (
                <a href={d.website} target="_blank" rel="noreferrer"
                  className="min-h-[44px] px-3 inline-flex items-center text-sm rounded-lg border border-ink-200 bg-cream-50 text-ink-600 hover:border-accent-300 transition-colors">
                  Official site ↗
                </a>
              )}
            </div>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  )
}
