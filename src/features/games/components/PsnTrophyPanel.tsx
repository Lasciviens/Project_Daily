import { useState, useEffect, useRef } from 'react'
import { usePsnTitleTrophies, usePsnTrophyGroups } from '../hooks/usePlayStation'
import type { PsnTrophy } from '../api/psnApi'

// Trophy list for ONE trophy set, shared by the played-game modal and the
// trophy view. Two Sony endpoints are joined server-side on `trophyId` —
// the title's own definitions (name, icon, hidden flag; NO rarity on that
// endpoint) and the user's earned state (dates, rarity, PS5 partial
// progress). Neither is useful alone.
//
// LOADS ONLY WHEN SCROLLED INTO VIEW, same rule as the Steam achievement
// grid: this is the heaviest thing in the modal and it renders below the
// fold, so the popup must not wait on it.

const TYPE_ICON: Record<string, string> = {
  platinum: '🏆', gold: '🥇', silver: '🥈', bronze: '🥉',
}
// Sony's own rarity tiers (0-3), not thresholds we invented.
const RARITY_LABEL: Record<number, { text: string; cls: string }> = {
  0: { text: 'Ultra Nadir', cls: 'text-purple-600 dark:text-purple-400' },
  1: { text: 'Çok Nadir', cls: 'text-blue-600 dark:text-blue-400' },
  2: { text: 'Nadir', cls: 'text-teal-600 dark:text-teal-400' },
  3: { text: 'Yaygın', cls: 'text-ink-400' },
}

function TrophyRow({ t }: { t: PsnTrophy }) {
  const rarity = t.rarity != null ? RARITY_LABEL[t.rarity] : null
  return (
    <div className={`flex items-start gap-2.5 p-2 rounded-lg border ${t.earned ? 'border-ink-200 bg-cream-50' : 'border-ink-100 bg-ink-50/50'}`}>
      {t.trophyIconUrl
        ? <img src={t.trophyIconUrl} alt="" loading="lazy"
               className={`w-9 h-9 rounded flex-shrink-0 ${t.earned ? '' : 'opacity-45 grayscale'}`} />
        : <div className="w-9 h-9 rounded bg-ink-100 flex-shrink-0" />}
      <div className="min-w-0 flex-1">
        <p className={`text-xs font-semibold leading-snug ${t.earned ? 'text-ink-800' : 'text-ink-500'}`}>
          <span className="mr-1">{TYPE_ICON[t.trophyType] ?? ''}</span>{t.trophyName}
        </p>
        {t.trophyDetail
          ? <p className="text-[11px] text-ink-400 leading-snug line-clamp-2">{t.trophyDetail}</p>
          : t.trophyHidden && !t.earned
            ? <p className="text-[11px] text-ink-300 italic">Gizli kupa</p>
            : null}
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          {rarity && (
            <span className={`text-[10px] font-medium ${rarity.cls}`}>
              {rarity.text}{t.earnedRate != null ? ` · %${t.earnedRate.toFixed(1)}` : ''}
            </span>
          )}
          {t.earned && t.earnedDateTime && (
            <span className="text-[10px] text-ink-400">
              {new Date(t.earnedDateTime).toLocaleDateString('en-GB')}
            </span>
          )}
          {/* PS5 progress trophies report partial completion — real in the
              response, absent from psn-api's own types. */}
          {!t.earned && t.progressRate != null && (
            <span className="text-[10px] text-accent-600">%{t.progressRate} ilerleme</span>
          )}
          {t.trophyRewardName && (
            <span className="text-[10px] text-ink-400">🎁 {t.trophyRewardName}</span>
          )}
        </div>
      </div>
    </div>
  )
}

export function PsnTrophyPanel({ npCommunicationId, npServiceName, hasGroups }: {
  npCommunicationId: string
  npServiceName?: string
  hasGroups?: boolean
}) {
  const [inView, setInView] = useState(false)
  const anchor = useRef<HTMLDivElement>(null)
  const [showLocked, setShowLocked] = useState(true)
  const [group, setGroup] = useState<string>('all')

  useEffect(() => {
    const el = anchor.current
    if (inView || !el) return
    const io = new IntersectionObserver(
      entries => { if (entries.some(e => e.isIntersecting)) { setInView(true); io.disconnect() } },
      { rootMargin: '150px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [inView])

  const trophies = usePsnTitleTrophies(inView ? npCommunicationId : null, npServiceName)
  // DLC groups are a second call — only worth making when the title
  // actually has them (the trophy-title row already tells us).
  const groups = usePsnTrophyGroups(inView && hasGroups ? npCommunicationId : null, npServiceName)

  if (!inView) return <div ref={anchor} className="h-16" />
  if (trophies.isLoading) return <div ref={anchor}><p className="text-sm text-ink-400 py-4">Kupalar yükleniyor…</p></div>
  if (trophies.error) return <div ref={anchor}><p className="text-sm text-red-600 py-4">Kupalar alınamadı: {(trophies.error as Error).message}</p></div>

  const all = trophies.data?.trophies ?? []
  if (!all.length) return <div ref={anchor}><p className="text-sm text-ink-400 py-4">Bu oyunda kupa yok.</p></div>

  const scoped = group === 'all' ? all : all.filter(t => t.trophyGroupId === group)
  const earned = scoped.filter(t => t.earned)
  const pct = scoped.length ? Math.round((earned.length / scoped.length) * 100) : 0
  // Earned first, then rarest-first — the rare ones are the interesting half.
  const sorted = [...scoped].sort((a, b) =>
    Number(b.earned) - Number(a.earned) || (a.earnedRate ?? 101) - (b.earnedRate ?? 101))
  const shown = showLocked ? sorted : sorted.filter(t => t.earned)
  const groupList = groups.data?.groups ?? []

  return (
    <div ref={anchor}>
      {groupList.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1 mb-2 scrollbar-none">
          <button onClick={() => setGroup('all')}
            className={`min-h-[44px] px-3 text-xs rounded-lg border whitespace-nowrap flex-shrink-0 transition-colors ${group === 'all' ? 'bg-accent-500 text-white border-accent-500' : 'bg-cream-50 text-ink-600 border-ink-200'}`}>
            Tümü
          </button>
          {groupList.map(g => (
            <button key={g.trophyGroupId} onClick={() => setGroup(g.trophyGroupId)}
              className={`min-h-[44px] px-3 text-xs rounded-lg border whitespace-nowrap flex-shrink-0 transition-colors ${group === g.trophyGroupId ? 'bg-accent-500 text-white border-accent-500' : 'bg-cream-50 text-ink-600 border-ink-200'}`}>
              {g.trophyGroupId === 'default' ? 'Ana oyun' : g.trophyGroupName}
              <span className="ml-1 opacity-70">%{g.progress}</span>
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-3 mb-2 flex-wrap">
        <div className="flex-1 min-w-[140px]">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-bold text-ink-900">{earned.length}/{scoped.length}</span>
            <span className="text-xs text-ink-400">%{pct} tamamlandı</span>
          </div>
          <div className="h-1.5 bg-ink-100 rounded-full overflow-hidden mt-1">
            <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <button onClick={() => setShowLocked(v => !v)}
          className="min-h-[44px] px-3 text-xs rounded-lg border border-ink-200 bg-cream-50 text-ink-600 hover:border-accent-300 transition-colors">
          {showLocked ? 'Sadece alınanlar' : 'Hepsini göster'}
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-[360px] overflow-y-auto pr-1">
        {shown.map(t => <TrophyRow key={t.trophyId} t={t} />)}
      </div>
    </div>
  )
}
