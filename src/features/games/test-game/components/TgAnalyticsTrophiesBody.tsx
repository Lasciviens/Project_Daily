import { useMemo } from 'react'
import { Trophy } from 'lucide-react'
import type { PsnTrophyTitle } from '../../api/psnApi'
import { fmtInt, plural, TGA_TINT } from './tgAnalyticsFormat'
import { TGA_TROPHY_GRADES, titlePlatform, titleProgress, trophyStats } from './tgAnalyticsTrophies'
import { TgAnalyticsEmpty } from './TgAnalyticsCard'

const TRACK = `relative block overflow-hidden rounded-full ${TGA_TINT}`
const FILL = 'absolute inset-y-0 left-0 rounded-full bg-[var(--tg-accent)]'
const BONE = 'tg-skeleton rounded-md'
const pct = (p: number) => `${Math.round(p)}%`

/** The trophy card's shape while the set list loads (or before the card is scrolled to). */
export function TgAnalyticsTrophiesSkeleton() {
  return (
    <div aria-busy aria-label="Loading trophies" className="flex flex-col gap-4">
      <div className={`${BONE} h-7 w-24`} />
      {[70, 58, 64, 80].map(w => (
        <div key={w} className="flex items-center gap-3">
          <div className={`${BONE} h-3 w-14`} />
          <div className={`${BONE} h-2`} style={{ width: `${w}%` }} />
        </div>
      ))}
      <div className={`${BONE} h-3 w-32`} />
    </div>
  )
}

/** Platinums, earned of defined per grade, average completion, and the sets closest to a platinum. */
export function TgAnalyticsTrophiesBody({ titles }: { titles: PsnTrophyTitle[] }) {
  const s = useMemo(() => trophyStats(titles), [titles])
  if (!s.titles) {
    return <TgAnalyticsEmpty icon={Trophy} title="No trophy sets yet" hint="Trophy sets appear here once PlayStation reports a game you’ve played." />
  }
  return (
    <div className="grid gap-6 @[40rem]:grid-cols-2 @[40rem]:gap-8">
      <div className="min-w-0">
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <p className="flex items-baseline gap-2">
            <span className="text-[26px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-[var(--tg-text)]">{fmtInt(s.platinums)}</span>
            <span className="text-[13px] font-medium text-[var(--tg-text-2)]">{s.platinums === 1 ? 'platinum' : 'platinums'}</span>
          </p>
          {s.averageProgress != null && (
            <p className="text-[12px] text-[var(--tg-muted)]">
              Average completion <span className="font-semibold tabular-nums text-[var(--tg-text)]">{pct(s.averageProgress)}</span>
            </p>
          )}
        </div>
        <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--tg-muted)]">
          Across {plural(s.titles, 'trophy set')} on your account — the time window doesn’t apply here.
        </p>
        <ul className="mt-4 flex flex-col gap-2.5">
          {TGA_TROPHY_GRADES.map(({ key, label }) => {
            const earned = s.earned[key]
            const defined = s.defined[key]
            return (
              <li key={key} className="grid grid-cols-[4.25rem_minmax(0,1fr)_5.75rem] items-center gap-x-3">
                <span className="text-[12.5px] text-[var(--tg-text-2)]">{label}</span>
                <span aria-hidden className={`${TRACK} h-2`}>
                  <span className={FILL} style={{ width: `${defined ? Math.min(100, (earned / defined) * 100) : 0}%` }} />
                </span>
                <span className="whitespace-nowrap text-right text-[12.5px] tabular-nums text-[var(--tg-muted)]">
                  <span className="font-semibold text-[var(--tg-text)]">{fmtInt(earned)}</span> of {fmtInt(defined)}
                </span>
              </li>
            )
          })}
        </ul>
        <p className="mt-2 text-[11.5px] text-[var(--tg-muted)]">Filled = earned, of every trophy those sets hold.</p>
      </div>

      <div className="min-w-0">
        <p className="text-[12px] font-medium text-[var(--tg-text-2)]">Closest to platinum</p>
        {s.nearest.length ? (
          <ol className="mt-2 flex flex-col gap-3">
            {s.nearest.map(t => {
              const p = titleProgress(t) ?? 0
              return (
                <li key={t.npCommunicationId ?? t.trophyTitleName} className="min-w-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-[13px] font-medium text-[var(--tg-text)]" title={t.trophyTitleName}>{t.trophyTitleName}</span>
                    <span className="shrink-0 text-[13px] font-semibold tabular-nums text-[var(--tg-text)]">{pct(p)}</span>
                  </div>
                  <span className="mt-0.5 block truncate text-[11.5px] text-[var(--tg-muted)]">{titlePlatform(t) || 'PlayStation'}</span>
                  <span aria-hidden className={`${TRACK} mt-1.5 h-[5px]`}><span className={FILL} style={{ width: `${p}%` }} /></span>
                </li>
              )
            })}
          </ol>
        ) : (
          <p className="mt-2 text-[12.5px] leading-relaxed text-[var(--tg-muted)]">No platinum left to chase — you’ve earned every one your sets hold, or none of them has one.</p>
        )}
      </div>
    </div>
  )
}
