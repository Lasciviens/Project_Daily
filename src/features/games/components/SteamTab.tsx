import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useSteamProfile, useSteamOwnedGames, useSteamLevelBadges } from '../hooks/useSteam'
import { steamGameHeaderUrl, type SteamGame } from '../api/steamApi'

// Steam integration — read-only proxy through the `steam-api` edge function
// (personal Web API key + SteamID64 in Vault). No local DB table at all: see
// CLAUDE.md's Games Feature Detail research note for why (nothing else in
// this app joins against Steam data, so there's nothing a cache table would
// buy beyond what React Query's own staleTime already gives for free).

const PERSONA_STATE: Record<number, string> = {
  0: 'Offline', 1: 'Online', 2: 'Busy', 3: 'Away', 4: 'Snooze', 5: 'Looking to trade', 6: 'Looking to play',
}

function fmtHours(minutes: number): string {
  const h = minutes / 60
  return h >= 10 ? `${Math.round(h)}h` : `${h.toFixed(1)}h`
}

function NotConfigured() {
  return (
    <div className="max-w-2xl mx-auto text-center py-12 px-4">
      <p className="text-4xl mb-3">🖥️</p>
      <h2 className="text-base font-bold text-ink-900 mb-1">Steam — not configured yet</h2>
      <p className="text-sm text-ink-500">
        Add <code className="text-xs bg-ink-100 px-1 py-0.5 rounded">STEAM_API_KEY</code> and{' '}
        <code className="text-xs bg-ink-100 px-1 py-0.5 rounded">STEAM_ID64</code> to Supabase Vault, then redeploy the{' '}
        <code className="text-xs bg-ink-100 px-1 py-0.5 rounded">steam-api</code> edge function — see CLAUDE.md's Pending manual steps.
      </p>
    </div>
  )
}

function GameCard({ game }: { game: SteamGame }) {
  const [imgOk, setImgOk] = useState(true)
  return (
    <div className="bg-cream-50 rounded-xl border border-ink-200 shadow-sm overflow-hidden flex flex-col">
      <div className="bg-ink-100" style={{ aspectRatio: '460/215' }}>
        {imgOk
          ? <img src={steamGameHeaderUrl(game.appid)} alt={game.name} onError={() => setImgOk(false)} className="w-full h-full object-cover" />
          : <div className="w-full h-full flex items-center justify-center text-2xl">🎮</div>}
      </div>
      <div className="p-2">
        <p className="text-xs font-semibold text-ink-800 leading-snug line-clamp-2">{game.name}</p>
        <p className="text-[10px] text-ink-400 mt-1">{fmtHours(game.playtime_forever)} played{game.playtime_2weeks ? ` · ${fmtHours(game.playtime_2weeks)} last 2wk` : ''}</p>
      </div>
    </div>
  )
}

export function SteamTab() {
  const qc = useQueryClient()
  const profile = useSteamProfile()
  const owned = useSteamOwnedGames()
  const levelBadges = useSteamLevelBadges()

  const notConfigured = (profile.error as Error)?.message === 'not_configured'
  if (notConfigured) return <NotConfigured />

  const player = profile.data
  const games = [...(owned.data?.games ?? [])].sort((a, b) => b.playtime_forever - a.playtime_forever)

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-3">
          {player?.avatarfull && <img src={player.avatarfull} alt="" className="w-11 h-11 rounded-lg border border-ink-200" />}
          <div>
            <p className="text-sm font-bold text-ink-900">{player?.personaname ?? (profile.isLoading ? 'Loading…' : 'Steam')}</p>
            {player && (
              <p className="text-xs text-ink-500">
                {player.gameextrainfo ? `▶ Playing ${player.gameextrainfo}` : (PERSONA_STATE[player.personastate] ?? 'Unknown')}
                {levelBadges.data?.level != null && ` · Level ${levelBadges.data.level}`}
              </p>
            )}
          </div>
        </div>
        <button onClick={() => qc.invalidateQueries({ queryKey: ['steam'] })}
          className="min-h-[44px] px-3 text-sm rounded-lg border border-ink-200 bg-ink-50 text-ink-600 hover:border-accent-300 transition-colors">
          🔄 Refresh
        </button>
      </div>

      {owned.isLoading && <div className="text-sm text-ink-400 py-8 text-center">Loading your library…</div>}
      {owned.error && (owned.error as Error).message !== 'not_configured' && (
        <div className="text-sm text-red-600 py-8 text-center">Couldn't load owned games: {(owned.error as Error).message}</div>
      )}
      {!owned.isLoading && games.length === 0 && !owned.error && (
        <div className="text-center py-12 text-ink-400 text-sm">
          No games found — your Steam profile's "Game details" may be set to private.
        </div>
      )}
      {games.length > 0 && (
        <>
          <p className="text-xs text-ink-400 mb-3">{games.length} games · sorted by playtime</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {games.map(g => <GameCard key={g.appid} game={g} />)}
          </div>
        </>
      )}
    </div>
  )
}
