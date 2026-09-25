import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import {
  usePsnStatus, usePsnProfile, usePsnPlayedGames, usePsnPurchasedGames, usePsnTitles,
} from '../hooks/usePlayStation'
import { PsnGameModal } from './PsnGameModal'
import { InfoBubble } from '../../../shared/components/InfoBubble'
import { parsePlayDurationMinutes, isPsnReauthRequired, type PsnPlayedGame, type PsnTrophyTitle } from '../api/psnApi'
import {
  mergeOwnership, psnKind, hideNonGames, countNonGames, OWNERSHIP_LABEL, type Ownership,
} from '../providerEntries'
import { ImportProviderButton } from './ImportProviderButton'
import { PsnNpssoForm } from './PsnNpssoForm'
import { npssoLifetime, npssoLifetimeLabel } from '../api/psnTokenLifetime'
import type { ProviderGameInput } from '../api/gamesApi'

// PlayStation integration — the community npsso-cookie flow (Sony has no
// official API; see CLAUDE.md's Games Feature Detail research note).
// UNVERIFIED against a real account in this authoring session — response
// shapes are read defensively with fallbacks.
//
// Two views over two genuinely different Sony datasets, deliberately not
// merged into one grid: the LIBRARY is keyed by store SKU and carries real
// playtime; TROPHIES are keyed by trophy-set id and carry completion. Sony's
// bridge between the two ids takes 5 titles per request, so joining them
// across a whole library is not viable — a game's modal bridges its own id
// on open instead.

type View = 'library' | 'trophies'
type SortKey = 'playtime' | 'recent' | 'name'

const SORTS: { v: SortKey; label: string }[] = [
  { v: 'playtime', label: 'By playtime' },
  { v: 'recent', label: 'Last played' },
  { v: 'name', label: 'A → Z' },
]

const fmtHours = (min: number) => {
  const h = min / 60
  return h >= 10 ? `${Math.round(h)}s` : `${h.toFixed(1)}s`
}

function relativeDay(iso?: string): string | null {
  if (!iso) return null
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

function GameCard({ game, ownership, onOpen }: {
  game: PsnPlayedGame
  ownership: Ownership | undefined
  onOpen: () => void
}) {
  const [imgOk, setImgOk] = useState(true)
  const minutes = parsePlayDurationMinutes(game.playDuration)
  const last = relativeDay(game.lastPlayedDateTime)
  return (
    <button onClick={onOpen}
      className="bg-cream-50 rounded-xl border border-ink-200 shadow-sm overflow-hidden flex flex-col text-left hover:border-accent-300 hover:shadow-md transition-all duration-150 press-feedback">
      <div className="bg-ink-100 relative" style={{ aspectRatio: '1/1' }}>
        {game.imageUrl && imgOk
          ? <img src={game.imageUrl} alt={game.name} loading="lazy" onError={() => setImgOk(false)}
                 className="w-full h-full object-cover" />
          : <div className="w-full h-full flex items-center justify-center text-2xl">🎮</div>}
        {/* "PS+ & Own" is a real state and Sony reports it as two separate
            rows for one title — showing only one of them makes a game you
            paid for read as a rental. */}
        {ownership && (
          <span className={`absolute top-1.5 right-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded text-white ${
            ownership === 'both' ? 'bg-violet-600/90' : ownership === 'plus' ? 'bg-blue-500/90' : 'bg-ink-600/90'
          }`}>{OWNERSHIP_LABEL[ownership]}</span>
        )}
      </div>
      <div className="p-2 flex-1">
        <p className="text-xs font-semibold text-ink-800 leading-snug line-clamp-2">{game.name}</p>
        <p className="text-[10px] text-ink-400 mt-1">
          {minutes > 0 ? fmtHours(minutes) : '—'}{last ? ` · ${last}` : ''}
        </p>
      </div>
    </button>
  )
}

function TrophyCard({ title, onOpen }: { title: PsnTrophyTitle; onOpen: () => void }) {
  const [imgOk, setImgOk] = useState(true)
  // Sony omits the counts entirely on some titles, and psn-api's own types
  // don't admit it — a missing object here used to take the whole grid down.
  const t = title.earnedTrophies ?? { bronze: 0, silver: 0, gold: 0, platinum: 0 }
  return (
    <button onClick={onOpen}
      className="bg-cream-50 rounded-xl border border-ink-200 shadow-sm overflow-hidden flex flex-col text-left hover:border-accent-300 hover:shadow-md transition-all duration-150 press-feedback">
      <div className="bg-ink-100" style={{ aspectRatio: '1/1' }}>
        {title.trophyTitleIconUrl && imgOk
          ? <img src={title.trophyTitleIconUrl} alt={title.trophyTitleName} loading="lazy"
                 onError={() => setImgOk(false)} className="w-full h-full object-cover" />
          : <div className="w-full h-full flex items-center justify-center text-2xl">🏆</div>}
      </div>
      <div className="p-2 flex-1">
        <p className="text-xs font-semibold text-ink-800 leading-snug line-clamp-2">{title.trophyTitleName}</p>
        <div className="flex items-center gap-1.5 mt-1 text-[10px] text-ink-500">
          {t.platinum > 0 && <span title="Platinum">🏆{t.platinum}</span>}
          <span>🥇{t.gold}</span><span>🥈{t.silver}</span><span>🥉{t.bronze}</span>
        </div>
        <div className="h-1.5 bg-ink-100 rounded-full overflow-hidden mt-1.5">
          <div className="h-full bg-green-500" style={{ width: `${title.progress}%` }} />
        </div>
      </div>
    </button>
  )
}

// A dead session can also surface from a LIST call rather than from the gate:
// the profile query may still be serving a cached success when the library
// call is the first to hit Sony's rejection. Wherever it lands, it reads as
// the same actionable sentence rather than a red error string.
function LoadError({ error, what }: { error: unknown; what: string }) {
  if (isPsnReauthRequired(error)) {
    return (
      <div className="max-w-md mx-auto py-8">
        <p className="text-sm text-ink-500 text-center mb-3">Your PlayStation session expired.</p>
        <div className="rounded-2xl border border-ink-200 bg-cream-50 p-4">
          <PsnNpssoForm />
        </div>
      </div>
    )
  }
  return (
    <div className="text-sm text-red-600 py-8 text-center">Couldn't load {what}: {(error as Error).message}</div>
  )
}

function ConnectedView() {
  const qc = useQueryClient()
  const profile = usePsnProfile(true)
  const played = usePsnPlayedGames(true)
  // Enrichment (PS Plus badges) — queued behind the library, and Sony's
  // most fragile endpoint, so it must never gate the page.
  const purchased = usePsnPurchasedGames(!!played.data)
  const [view, setView] = useState<View>('library')
  // The trophy-set list is a separate Sony dataset — only fetched if the
  // user actually switches to that view.
  const titles = usePsnTitles(view === 'trophies')

  const [sort, setSort] = useState<SortKey>('playtime')
  const [search, setSearch] = useState('')
  const [gamesOnly, setGamesOnly] = useState(false)
  const [openGame, setOpenGame] = useState<PsnPlayedGame | null>(null)
  const [openTitle, setOpenTitle] = useState<PsnTrophyTitle | null>(null)

  // Bought, in the catalogue, or BOTH. An earlier version kept only the
  // PS_PLUS rows, which is exactly the half that makes a purchase invisible.
  const ownershipByTitleId = useMemo(
    () => mergeOwnership(purchased.data?.games ?? []),
    [purchased.data],
  )

  const nonGameCount = useMemo(
    () => countNonGames(played.data ?? [], g => psnKind(g.category)),
    [played.data],
  )

  const games = useMemo(() => {
    let gs = played.data ?? []
    if (gamesOnly) gs = hideNonGames(gs, g => psnKind(g.category))
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      gs = gs.filter(g => g.name?.toLowerCase().includes(q))
    }
    return [...gs].sort((a, b) => {
      if (sort === 'name') return (a.name ?? '').localeCompare(b.name ?? '')
      if (sort === 'recent') {
        return new Date(b.lastPlayedDateTime ?? 0).getTime() - new Date(a.lastPlayedDateTime ?? 0).getTime()
      }
      return parsePlayDurationMinutes(b.playDuration) - parsePlayDurationMinutes(a.playDuration)
    })
  }, [played.data, sort, search, gamesOnly])

  const p = profile.data?.profile
  const summary = profile.data?.summary
  const avatar = p?.avatars?.find(a => a.size === 'l')?.url ?? p?.avatars?.[0]?.url
  const totalHours = Math.round(
    (played.data ?? []).reduce((s, g) => s + parsePlayDurationMinutes(g.playDuration), 0) / 60)

  // PSN reports playtime as an ISO-8601 duration and keys games by store SKU
  // (npTitleId). Converted to seconds here so `games.play_seconds` has one
  // unit whatever the provider. `imageUrl` is a public Sony CDN URL with no
  // credentials in it, unlike ScreenScraper's, so it can be stored as-is.
  const importRows: ProviderGameInput[] = (played.data ?? []).map(g => ({
    external_ref: g.titleId,
    title: g.localizedName || g.name,
    play_seconds: parsePlayDurationMinutes(g.playDuration) * 60,
    play_count: g.playCount ?? null,
    last_played_at: g.lastPlayedDateTime ?? null,
    primary_cover_url: g.imageUrl ?? null,
    genres: g.concept?.genres ? String(g.concept.genres).split(',').map(x => x.trim()).filter(Boolean) : null,
  }))

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-3">
          {avatar && <img src={avatar} alt="" className="w-11 h-11 rounded-lg border border-ink-200" />}
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-bold text-ink-900">{p?.onlineId ?? (profile.isLoading ? 'Loading…' : 'PlayStation')}</p>
              {p?.isPlus && (
                <span className="text-[10px] font-bold bg-blue-500/10 text-blue-600 border border-blue-500/30 px-1.5 py-0.5 rounded dark:text-blue-400">PS Plus</span>
              )}
            </div>
            {summary?.earnedTrophies && (
              <p className="text-xs text-ink-500">
                Level {summary.trophyLevel} · 🏆 {summary.earnedTrophies.platinum} platinum ·{' '}
                {(summary.earnedTrophies.bronze + summary.earnedTrophies.silver +
                  summary.earnedTrophies.gold + summary.earnedTrophies.platinum).toLocaleString('en-GB')} trophies
              </p>
            )}
            {(profile.data?.region || p?.aboutMe) && (
              <p className="text-[11px] text-ink-400">
                {[profile.data?.region?.name, p?.aboutMe].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ImportProviderButton library="playstation" source="psn" games={importRows} />
          <button onClick={() => qc.invalidateQueries({ queryKey: ['psn'] })}
            className="min-h-[44px] px-3 text-sm rounded-lg border border-ink-200 bg-ink-50 text-ink-600 hover:border-accent-300 transition-colors">
            🔄 Refresh
          </button>
        </div>
      </div>

      <div className="flex items-center gap-1.5 mb-4">
        <button onClick={() => setView('library')}
          className={`min-h-[44px] px-4 text-sm font-semibold rounded-xl border transition-colors ${view === 'library' ? 'bg-ink-900 text-cream-50 border-ink-900' : 'bg-cream-50 text-ink-600 border-ink-200'}`}>
          📚 Library
        </button>
        <button onClick={() => setView('trophies')}
          className={`min-h-[44px] px-4 text-sm font-semibold rounded-xl border transition-colors ${view === 'trophies' ? 'bg-ink-900 text-cream-50 border-ink-900' : 'bg-cream-50 text-ink-600 border-ink-200'}`}>
          🏆 Trophies
        </button>
      </div>

      {view === 'library' && (
        <>
          {played.isLoading && <div className="text-sm text-ink-400 py-8 text-center">Loading library…</div>}
          {played.error && <LoadError error={played.error} what="games" />}
          {!played.isLoading && !played.error && games.length === 0 && (
            <div className="text-center py-12 text-ink-400 text-sm">No played games found.</div>
          )}
          {(played.data?.length ?? 0) > 0 && (
            <>
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search games…"
                  className="min-h-[44px] px-3 text-sm rounded-xl border border-ink-200 bg-cream-50 focus:outline-none focus:ring-2 focus:ring-accent-400 max-w-xs flex-1" />
                <select value={sort} onChange={e => setSort(e.target.value as SortKey)}
                  className="min-h-[44px] px-2 text-sm rounded-xl border border-ink-200 bg-cream-50 focus:outline-none focus:ring-2 focus:ring-accent-400">
                  {SORTS.map(s => <option key={s.v} value={s.v}>{s.label}</option>)}
                </select>
                {/* Only offered when Sony actually flagged something as not a
                    game — a toggle that would change nothing is noise. */}
                {nonGameCount > 0 && (
                  <label className="flex items-center gap-1.5 text-xs text-ink-600 min-h-[44px] cursor-pointer">
                    <input type="checkbox" checked={gamesOnly} onChange={e => setGamesOnly(e.target.checked)}
                      className="w-4 h-4 accent-current text-accent-500" />
                    Games only
                    <InfoBubble label="What gets hidden?">
                      The {nonGameCount} entries Sony's own category says are apps or media players,
                      not games. Anything it does not classify stays visible — hiding what is merely
                      unclassified would look like the app losing your library.
                    </InfoBubble>
                  </label>
                )}
                <p className="text-xs text-ink-400 ml-auto">
                  {games.length} games · {totalHours.toLocaleString('en-GB')} hours total
                </p>
              </div>
              {/* PS Plus provenance comes from Sony's most fragile call. If
                  it came back empty or partial, say so — otherwise a missing
                  PS Plus badge reads as "this game isn't from PS Plus". */}
              {(purchased.data?.note || purchased.error) && (
                <p className="text-xs text-ink-400 mb-2">
                  ⚠ PS Plus data {purchased.data?.note?.startsWith('partial') ? 'loaded only partially' : 'could not be loaded'} — badges may be missing.
                </p>
              )}
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-3">
                {games.map(g => (
                  <GameCard key={g.titleId} game={g} ownership={ownershipByTitleId.get(g.titleId)}
                    onOpen={() => setOpenGame(g)} />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {view === 'trophies' && (
        <>
          {titles.isLoading && <div className="text-sm text-ink-400 py-8 text-center">Loading trophies…</div>}
          {titles.error && <LoadError error={titles.error} what="trophies" />}
          {(titles.data?.length ?? 0) > 0 && (
            <>
              <p className="text-xs text-ink-400 mb-3">{titles.data!.length} games</p>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-3">
                {titles.data!.map(t => (
                  <TrophyCard key={t.npCommunicationId} title={t} onOpen={() => setOpenTitle(t)} />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {openGame && (
        <PsnGameModal game={openGame}
          purchased={(purchased.data?.games ?? []).find(x => x.titleId === openGame.titleId)}
          ownership={ownershipByTitleId.get(openGame.titleId)}
          onClose={() => setOpenGame(null)} />
      )}
      {openTitle && <PsnGameModal title={openTitle} onClose={() => setOpenTitle(null)} />}
    </div>
  )
}

// CLAUDE.md's "connections live in ONE place" rule says a feature page may
// LINK to Developer → Connections but must never carry its own connect UI.
// This is a deliberate, narrow exception the user asked for (2026-09-25), and
// it serves the rule's actual purpose rather than defeating it: the rule
// exists so "is X connected?" has one answer and reconnecting isn't a hunt
// across pages. Re-authenticating an ALREADY-configured integration, at the
// exact point where it just failed, is recovery in place — not a second
// status widget. The form is the same component Connections renders, so there
// is one implementation; first-time connect and disconnect stay there only.
function NotConnected({ expired, detail }: { expired?: boolean; detail?: string }) {
  return (
    <div className="max-w-md mx-auto py-12 px-4">
      <div className="text-center">
        <p className="text-4xl mb-3">🎮</p>
        <h2 className="text-base font-bold text-ink-900 mb-1">
          {expired ? 'PlayStation session expired' : 'PlayStation is not connected'}
        </h2>
      </div>
      {expired ? (
        <>
          <p className="text-sm text-ink-500 text-center">
            Sony stopped accepting the stored session{detail ? ` (“${detail}”)` : ''}. This is expected
            rather than a fault: Sony guards its login with a reCAPTCHA, so the token behind this
            integration cannot be renewed automatically and has to be pasted again every month or two.
          </p>
          <div className="mt-4 rounded-2xl border border-ink-200 bg-cream-50 p-4">
            <PsnNpssoForm />
          </div>
          <p className="text-[11px] text-ink-400 mt-3 text-center">
            Also available in{' '}
            <Link to="/developer?tab=connections" className="text-accent-600 underline">Developer → Connections</Link>,
            along with every other integration.
          </p>
        </>
      ) : (
        <p className="text-sm text-ink-500 text-center">
          Connect it in{' '}
          <Link to="/developer?tab=connections" className="text-accent-600 underline">Developer → Connections</Link>,
          where every integration is managed.
        </p>
      )}
    </div>
  )
}

// Shown while the session still WORKS but its token is about to die. The
// renewal needs a desktop browser and a manual paste, so a warning that only
// arrives at the moment of failure arrives too late to be useful — this is
// the window in which the user can still choose when to do it.
function ExpiringSoonBanner({ label }: { label: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs text-amber-700">
          Your PlayStation token {label}. Renewing early replaces it — nothing else changes.
        </p>
        <button type="button" onClick={() => setOpen(o => !o)}
          className="text-xs font-semibold text-accent-600 underline min-h-[44px] px-1">
          {open ? 'Hide' : 'Renew now'}
        </button>
      </div>
      {open && (
        <div className="mt-2 rounded-lg border border-ink-200 bg-cream-50 p-3">
          <PsnNpssoForm onConnected={() => setOpen(false)} />
        </div>
      )}
    </div>
  )
}

export function PlayStationTab() {
  const status = usePsnStatus()
  // `status` only proves a psn_tokens ROW exists — it has never asked Sony
  // whether that session still works, which is why an expired one used to
  // sail straight into ConnectedView and crash there. The profile query is
  // the first real call, so it is what actually decides.
  const profile = usePsnProfile(!!status.data?.connected)

  if (status.isLoading) return <div className="text-sm text-ink-400 py-12 text-center">Checking connection…</div>
  if (!status.data?.connected) return <NotConnected />
  if (isPsnReauthRequired(profile.error)) {
    return <NotConnected expired detail={profile.error.sonyMessage} />
  }
  const life = npssoLifetime(status.data?.npssoExpiresAt)
  const label = npssoLifetimeLabel(life)
  return (
    <>
      {life.state === 'soon' && label && <ExpiringSoonBanner label={label} />}
      <ConnectedView />
    </>
  )
}
