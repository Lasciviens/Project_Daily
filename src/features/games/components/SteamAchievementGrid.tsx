import { useState, useEffect, useRef } from 'react'
import { useSteamAchievements } from '../hooks/useSteam'
import type { SteamAchievement } from '../api/steamApi'

// Achievement list for ONE game, shown inside the Steam detail modal.
// Three Steam endpoints feed this (unlock state + schema for icons/names +
// the keyless global-percentage call for rarity) — the edge function joins
// them so this component receives one flat list. Rarity is rendered as a
// plain percentage rather than a "rare/common" label: Steam publishes the
// number, not a tier, and inventing thresholds would overstate it.
//
// LOADS ONLY WHEN SCROLLED INTO VIEW. This is the heaviest thing in the
// modal (three Steam round trips, none of them cacheable in the DB since
// they carry the user's own unlock state) and it renders below the fold —
// firing it on open would make the whole popup feel slow for data the user
// may never scroll to. The instant part of the modal (art, title, playtime)
// comes from props and needs no network at all.

function rarityLabel(p: number | null): { text: string; cls: string } | null {
  if (p == null) return null
  if (p < 5)  return { text: `${p.toFixed(1)}% · ultra rare`, cls: 'text-purple-600 dark:text-purple-400' }
  if (p < 20) return { text: `${p.toFixed(1)}% · rare`,       cls: 'text-blue-600 dark:text-blue-400' }
  return { text: `${p.toFixed(0)}%`, cls: 'text-ink-400' }
}

function AchievementRow({ a }: { a: SteamAchievement }) {
  const rarity = rarityLabel(a.globalPercent)
  const icon = a.achieved ? a.icon : (a.icongray ?? a.icon)
  return (
    <div className={`flex items-start gap-2.5 p-2 rounded-lg border ${a.achieved ? 'border-ink-200 bg-cream-50' : 'border-ink-100 bg-ink-50/50'}`}>
      {icon
        ? <img src={icon} alt="" className={`w-9 h-9 rounded flex-shrink-0 ${a.achieved ? '' : 'opacity-45 grayscale'}`} />
        : <div className="w-9 h-9 rounded bg-ink-100 flex-shrink-0" />}
      <div className="min-w-0 flex-1">
        <p className={`text-xs font-semibold leading-snug ${a.achieved ? 'text-ink-800' : 'text-ink-500'}`}>
          {a.displayName}
        </p>
        {a.description
          ? <p className="text-[11px] text-ink-400 leading-snug line-clamp-2">{a.description}</p>
          : a.hidden && !a.achieved
            ? <p className="text-[11px] text-ink-300 italic">Hidden achievement</p>
            : null}
        <div className="flex items-center gap-2 mt-0.5">
          {rarity && <span className={`text-[10px] font-medium ${rarity.cls}`}>{rarity.text}</span>}
          {a.achieved && a.unlocktime && (
            <span className="text-[10px] text-ink-400">
              {new Date(a.unlocktime * 1000).toLocaleDateString('en-GB')}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

export function SteamAchievementGrid({ appid }: { appid: number }) {
  const [inView, setInView] = useState(false)
  const anchor = useRef<HTMLDivElement>(null)
  const [showLocked, setShowLocked] = useState(true)

  useEffect(() => {
    const el = anchor.current
    if (inView || !el) return
    const io = new IntersectionObserver(
      entries => { if (entries.some(e => e.isIntersecting)) { setInView(true); io.disconnect() } },
      { rootMargin: '150px' },   // start just before it reaches the viewport
    )
    io.observe(el)
    return () => io.disconnect()
  }, [inView])

  const { data, isLoading, error } = useSteamAchievements(inView ? appid : null)

  if (!inView) return <div ref={anchor} className="h-16" />
  if (isLoading) return <div ref={anchor}><p className="text-sm text-ink-400 py-4">Loading achievements…</p></div>
  if (error) return <div ref={anchor}><p className="text-sm text-red-600 py-4">Couldn't load achievements: {(error as Error).message}</p></div>

  const all = data?.achievements ?? []
  if (!all.length) {
    return <div ref={anchor}><p className="text-sm text-ink-400 py-4">{data?.note ?? 'This game has no achievements.'}</p></div>
  }

  const unlocked = all.filter(a => a.achieved)
  const pct = Math.round((unlocked.length / all.length) * 100)
  // Unlocked first, then rarest-first within each group — the rare ones are
  // the interesting half of the list.
  const sorted = [...all].sort((a, b) =>
    Number(b.achieved) - Number(a.achieved) || (a.globalPercent ?? 101) - (b.globalPercent ?? 101))
  const shown = showLocked ? sorted : sorted.filter(a => a.achieved)

  return (
    <div ref={anchor}>
      <div className="flex items-center gap-3 mb-2 flex-wrap">
        <div className="flex-1 min-w-[140px]">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-bold text-ink-900">{unlocked.length}/{all.length}</span>
            <span className="text-xs text-ink-400">{pct}% complete</span>
          </div>
          <div className="h-1.5 bg-ink-100 rounded-full overflow-hidden mt-1">
            <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <button onClick={() => setShowLocked(v => !v)}
          className="min-h-[44px] px-3 text-xs rounded-lg border border-ink-200 bg-cream-50 text-ink-600 hover:border-accent-300 transition-colors">
          {showLocked ? 'Unlocked only' : 'Show all'}
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-[360px] overflow-y-auto pr-1">
        {shown.map(a => <AchievementRow key={a.apiname} a={a} />)}
      </div>
    </div>
  )
}
