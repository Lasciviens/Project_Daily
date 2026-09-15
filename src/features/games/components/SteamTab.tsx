import { useState, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useSteamProfile, useSteamOwnedGames, useSteamLevelBadges } from '../hooks/useSteam'
import { SteamGameModal } from './SteamGameModal'
import { steamGameHeaderUrl, type SteamGame } from '../api/steamApi'

// Steam integration — read-only proxy through the `steam-api` edge function
// (personal Web API key + SteamID64 in Vault). Everything about the user is a
// live passthrough with no local table; only store metadata is cached
// server-side (`steam_apps`, migration 092) because Steam rate-limits that
// endpoint hard. See CLAUDE.md's Games Feature Detail.

const PERSONA_STATE: Record<number, string> = {
  0: 'Çevrimdışı', 1: 'Çevrimiçi', 2: 'Meşgul', 3: 'Uzakta',
  4: 'Uyku', 5: 'Takas arıyor', 6: 'Oyun arıyor',
}

type SortKey = 'playtime' | 'recent' | 'name'

const SORTS: { v: SortKey; label: string }[] = [
  { v: 'playtime', label: 'Süreye göre' },
  { v: 'recent', label: 'Son oynanan' },
  { v: 'name', label: 'A → Z' },
]

function fmtHours(minutes: number): string {
  const h = minutes / 60
  return h >= 10 ? `${Math.round(h)}s` : `${h.toFixed(1)}s`
}

function relativeDay(unix?: number): string | null {
  if (!unix) return null
  const days = Math.floor((Date.now() - unix * 1000) / 86_400_000)
  if (days <= 0) return 'bugün'
  if (days === 1) return 'dün'
  if (days < 30) return `${days} gün önce`
  if (days < 365) return `${Math.floor(days / 30)} ay önce`
  return `${Math.floor(days / 365)} yıl önce`
}

function NotConfigured() {
  return (
    <div className="max-w-2xl mx-auto text-center py-12 px-4">
      <p className="text-4xl mb-3">🖥️</p>
      <h2 className="text-base font-bold text-ink-900 mb-1">Steam — henüz yapılandırılmadı</h2>
      <p className="text-sm text-ink-500">
        Supabase Vault'a <code className="text-xs bg-ink-100 px-1 py-0.5 rounded">STEAM_API_KEY</code> ve{' '}
        <code className="text-xs bg-ink-100 px-1 py-0.5 rounded">STEAM_ID64</code> ekleyip{' '}
        <code className="text-xs bg-ink-100 px-1 py-0.5 rounded">steam-api</code> fonksiyonunu deploy et.
      </p>
    </div>
  )
}

function GameCard({ game, onOpen }: { game: SteamGame; onOpen: () => void }) {
  const [imgOk, setImgOk] = useState(true)
  const last = relativeDay(game.rtime_last_played)
  const deck = game.playtime_deck_forever ?? 0
  return (
    <button onClick={onOpen}
      className="bg-cream-50 rounded-xl border border-ink-200 shadow-sm overflow-hidden flex flex-col text-left hover:border-accent-300 hover:shadow-md transition-all duration-150 press-feedback">
      <div className="bg-ink-100 relative" style={{ aspectRatio: '460/215' }}>
        {imgOk
          ? <img src={steamGameHeaderUrl(game.appid)} alt={game.name} loading="lazy"
                 onError={() => setImgOk(false)} className="w-full h-full object-cover" />
          : <div className="w-full h-full flex items-center justify-center text-2xl">🎮</div>}
        {deck > 0 && (
          <span className="absolute top-1.5 right-1.5 text-[10px] font-bold bg-black/70 text-white px-1.5 py-0.5 rounded"
            title={`Steam Deck'te ${fmtHours(deck)}`}>🎮 {fmtHours(deck)}</span>
        )}
      </div>
      <div className="p-2 flex-1">
        <p className="text-xs font-semibold text-ink-800 leading-snug line-clamp-2">{game.name}</p>
        <p className="text-[10px] text-ink-400 mt-1">
          {fmtHours(game.playtime_forever)}
          {game.playtime_2weeks ? ` · ${fmtHours(game.playtime_2weeks)} son 2hf` : last ? ` · ${last}` : ''}
        </p>
      </div>
    </button>
  )
}

function RecentStrip({ games, onOpen }: { games: SteamGame[]; onOpen: (g: SteamGame) => void }) {
  if (!games.length) return null
  return (
    <div className="mb-5">
      <h3 className="text-xs font-bold uppercase tracking-wider text-ink-400 mb-2">Son 2 hafta</h3>
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none scroll-fade-x">
        {games.map(g => (
          <button key={g.appid} onClick={() => onOpen(g)}
            className="flex-shrink-0 w-44 rounded-xl border border-ink-200 bg-cream-50 overflow-hidden text-left hover:border-accent-300 transition-colors press-feedback">
            <div className="bg-ink-100" style={{ aspectRatio: '460/215' }}>
              <img src={steamGameHeaderUrl(g.appid)} alt={g.name} loading="lazy" className="w-full h-full object-cover" />
            </div>
            <div className="p-2">
              <p className="text-[11px] font-semibold text-ink-800 truncate">{g.name}</p>
              <p className="text-[10px] text-accent-600 font-medium">{fmtHours(g.playtime_2weeks ?? 0)} bu dönem</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

export function SteamTab() {
  const qc = useQueryClient()
  const profile = useSteamProfile()
  const owned = useSteamOwnedGames()
  // Two Steam round trips for one line of header text — queued behind the
  // library rather than competing with it for the first paint.
  const levelBadges = useSteamLevelBadges(!!owned.data)
  const [sort, setSort] = useState<SortKey>('playtime')
  const [search, setSearch] = useState('')
  const [openGame, setOpenGame] = useState<SteamGame | null>(null)

  // Derived, not fetched: GetOwnedGames already returns `playtime_2weeks`.
  const recentGames = useMemo(
    () => (owned.data?.games ?? [])
      .filter(g => (g.playtime_2weeks ?? 0) > 0)
      .sort((a, b) => (b.playtime_2weeks ?? 0) - (a.playtime_2weeks ?? 0))
      .slice(0, 12),
    [owned.data])

  const games = useMemo(() => {
    let gs = owned.data?.games ?? []
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      gs = gs.filter(g => g.name?.toLowerCase().includes(q))
    }
    return [...gs].sort((a, b) => {
      if (sort === 'name') return (a.sort_as ?? a.name).localeCompare(b.sort_as ?? b.name)
      if (sort === 'recent') return (b.rtime_last_played ?? 0) - (a.rtime_last_played ?? 0)
      return b.playtime_forever - a.playtime_forever
    })
  }, [owned.data, sort, search])

  if ((profile.error as Error)?.message === 'not_configured') return <NotConfigured />

  const player = profile.data
  const totalHours = Math.round((owned.data?.games ?? []).reduce((s, g) => s + g.playtime_forever, 0) / 60)

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-3">
          {player?.avatarfull && <img src={player.avatarfull} alt="" className="w-11 h-11 rounded-lg border border-ink-200" />}
          <div>
            <p className="text-sm font-bold text-ink-900">{player?.personaname ?? (profile.isLoading ? 'Yükleniyor…' : 'Steam')}</p>
            {player && (
              <p className="text-xs text-ink-500">
                {player.gameextrainfo ? `▶ ${player.gameextrainfo} oynuyor` : (PERSONA_STATE[player.personastate] ?? '—')}
                {levelBadges.data?.level != null && ` · Seviye ${levelBadges.data.level}`}
              </p>
            )}
            {player && (player.loccountrycode || player.timecreated) && (
              <p className="text-[11px] text-ink-400">
                {[
                  player.loccountrycode,
                  player.timecreated ? `${new Date(player.timecreated * 1000).getFullYear()}'den beri` : null,
                ].filter(Boolean).join(' · ')}
                {player.profileurl && (
                  <a href={player.profileurl} target="_blank" rel="noreferrer" className="ml-1.5 text-accent-600 hover:underline">profil ↗</a>
                )}
              </p>
            )}
          </div>
        </div>
        <button onClick={() => qc.invalidateQueries({ queryKey: ['steam'] })}
          className="min-h-[44px] px-3 text-sm rounded-lg border border-ink-200 bg-ink-50 text-ink-600 hover:border-accent-300 transition-colors">
          🔄 Yenile
        </button>
      </div>

      {recentGames.length > 0 && <RecentStrip games={recentGames} onOpen={setOpenGame} />}

      {owned.isLoading && <div className="text-sm text-ink-400 py-8 text-center">Kütüphane yükleniyor…</div>}
      {owned.error && (owned.error as Error).message !== 'not_configured' && (
        <div className="text-sm text-red-600 py-8 text-center">Oyunlar alınamadı: {(owned.error as Error).message}</div>
      )}
      {!owned.isLoading && !owned.error && (owned.data?.games.length ?? 0) === 0 && (
        <div className="text-center py-12 text-ink-400 text-sm">
          Hiç oyun bulunamadı — Steam profilindeki "Oyun detayları" gizli olabilir.
        </div>
      )}

      {(owned.data?.games.length ?? 0) > 0 && (
        <>
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Oyun ara…"
              className="min-h-[44px] px-3 text-sm rounded-xl border border-ink-200 bg-cream-50 focus:outline-none focus:ring-2 focus:ring-accent-400 max-w-xs flex-1" />
            <select value={sort} onChange={e => setSort(e.target.value as SortKey)}
              className="min-h-[44px] px-2 text-sm rounded-xl border border-ink-200 bg-cream-50 focus:outline-none focus:ring-2 focus:ring-accent-400">
              {SORTS.map(s => <option key={s.v} value={s.v}>{s.label}</option>)}
            </select>
            <p className="text-xs text-ink-400 ml-auto">
              {games.length} oyun · toplam {totalHours.toLocaleString('en-GB')} saat
            </p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {games.map(g => <GameCard key={g.appid} game={g} onOpen={() => setOpenGame(g)} />)}
          </div>
        </>
      )}

      {openGame && <SteamGameModal game={openGame} onClose={() => setOpenGame(null)} />}
    </div>
  )
}
