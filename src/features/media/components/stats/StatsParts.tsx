import type { ReactNode } from 'react'
import { ToneDot } from '../../../../shared/ui'
import { formatDate } from '../../../../shared/utils/dateFormat'
import { BUCKET_LABEL, BUCKET_ORDER, BUCKET_TONE, type LibraryBucket } from '../../libraryModel'
import type { RatingStats, YearReview } from '../../yearReview'
import { WEEKDAYS, hours } from './statsDrill'

export function StatsCard({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section className="card flex min-w-0 flex-col gap-3 p-4">
      <div>
        <h3 className="text-body font-semibold text-fg">{title}</h3>
        {note && <p className="text-micro text-fg-muted">{note}</p>}
      </div>
      {children}
    </section>
  )
}

export interface Bar { key: string; label: string; value: number; title: string; active?: boolean }

/** Vertical bars (months, years, weekdays); a bar opens what it counts. */
export function ColumnBars({ bars, onPick, height = 'h-32' }: { bars: Bar[]; onPick: (key: string) => void; height?: string }) {
  const max = Math.max(1, ...bars.map(b => b.value))
  return (
    <div className={`flex ${height} items-end gap-1`}>
      {bars.map(b => (
        <button key={b.key} type="button" onClick={() => onPick(b.key)} title={b.title} aria-label={b.title} aria-pressed={!!b.active}
          className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
          <span className="w-full max-w-[3rem] rounded-t bg-accent-500/60 transition-colors group-hover:bg-accent-500 group-aria-pressed:bg-accent-600"
            style={{ height: `${b.value > 0 ? Math.max(3, (b.value / max) * 100) : 0}%` }} />
          <span className="text-micro text-fg-muted tabular-nums">{b.label}</span>
        </button>
      ))}
    </div>
  )
}

export interface RankRow { key: string; label: string; value: number; display: string; sub?: string }

/** A ranked list with a bar per row, scaled to the first. */
export function RankBars({ rows, onPick, empty }: { rows: RankRow[]; onPick: (key: string) => void; empty: string }) {
  if (rows.length === 0) return <p className="text-meta text-fg-muted">{empty}</p>
  const max = Math.max(1, rows[0].value)
  return (
    <ul className="flex flex-col gap-1">
      {rows.map(r => (
        <li key={r.key}>
          <button type="button" onClick={() => onPick(r.key)} className="row row-interactive w-full flex-col items-stretch gap-1 py-1.5 text-left">
            <span className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-body font-medium text-fg">{r.label}</span>
              <span className="shrink-0 text-meta text-fg-muted tabular-nums">{r.display}{r.sub && <span className="text-fg-faint"> · {r.sub}</span>}</span>
            </span>
            <span className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
              <span className="block h-full rounded-full bg-accent-500/70" style={{ width: `${(r.value / max) * 100}%` }} />
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

/** When you watch: weekdays, active days, the busiest day and the longest run of days. */
export function HabitsCard({ r, onWeekday }: { r: YearReview; onWeekday: (day: number) => void }) {
  const top = [...r.weekdays].sort((a, b) => b.plays - a.plays)[0]
  if (r.activeDays === 0) return <StatsCard title="When you watch"><p className="text-meta text-fg-muted">No dated plays in this period.</p></StatsCard>
  return (
    <StatsCard title="When you watch" note="By the date each title or episode was last watched.">
      <ColumnBars height="h-24" onPick={k => onWeekday(Number(k))}
        bars={r.weekdays.map(w => ({ key: String(w.day), label: WEEKDAYS[w.day].slice(0, 2), value: w.plays, title: `${WEEKDAYS[w.day]}: ${w.plays} plays · ${hours(w.minutes)}` }))} />
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-meta">
        <Fact label="Favourite day" value={top && top.plays > 0 ? WEEKDAYS[top.day] : '—'} />
        <Fact label="Days with something watched" value={r.activeDays.toLocaleString('en-GB')} />
        {r.busiestDay && <Fact label="Busiest day" value={`${formatDate(r.busiestDay.date)} · ${r.busiestDay.plays} plays`} />}
        {r.longestStreak && <Fact label="Longest run" value={r.longestStreak.days === 1 ? '1 day' : `${r.longestStreak.days} days in a row`} sub={r.longestStreak.days > 1 ? `${formatDate(r.longestStreak.from)} – ${formatDate(r.longestStreak.to)}` : undefined} />}
      </dl>
    </StatsCard>
  )
}

function Fact({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="font-semibold text-fg tabular-nums">{value}</dd>
      {sub && <dd className="text-micro text-fg-muted tabular-nums">{sub}</dd>}
    </div>
  )
}

/** Your ratings: average against TMDB users, how you spread them, and where you disagree most. */
export function RatingsCard({ ratings: s, onDisagreements }: { ratings: RatingStats; onDisagreements: () => void }) {
  if (s.count === 0) return <StatsCard title="Your ratings"><p className="text-meta text-fg-muted">Rate titles in their popup (1–10) to see how you compare with TMDB users.</p></StatsCard>
  const max = Math.max(1, ...s.histogram)
  const diff = s.mine != null && s.tmdb != null ? Math.round((s.mine - s.tmdb) * 10) / 10 : null
  return (
    <StatsCard title="Your ratings" note={`${s.count} rated title${s.count === 1 ? '' : 's'} in this period.`}>
      <div className="flex flex-wrap items-end gap-x-6 gap-y-1">
        <div><p className="text-meta text-fg-muted">You</p><p className="text-lead font-bold text-fg tabular-nums"><span data-tone="star" className="tone-text">★</span> {s.mine}/10</p></div>
        {s.tmdb != null && <div><p className="text-meta text-fg-muted">TMDB users, same titles</p><p className="text-lead font-bold text-fg-2 tabular-nums">★ {s.tmdb}/10</p></div>}
      </div>
      {diff != null && <p className="text-meta text-fg-2">{diff === 0 ? 'You rate like TMDB users on average.' : `You rate ${Math.abs(diff)} point${Math.abs(diff) === 1 ? '' : 's'} ${diff > 0 ? 'higher' : 'lower'} than TMDB users on average.`}</p>}
      <div className="flex h-16 items-end gap-1" aria-label="How you spread your ratings">
        {s.histogram.map((n, i) => (
          <div key={i} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-0.5" title={`${i + 1}/10: ${n}`}>
            <span className="w-full rounded-t bg-star/70" style={{ height: `${n > 0 ? Math.max(4, (n / max) * 100) : 0}%` }} />
            <span className="text-micro text-fg-muted tabular-nums">{i + 1}</span>
          </div>
        ))}
      </div>
      {s.disagreements.length > 0 && (
        <button type="button" onClick={onDisagreements} className="w-fit text-meta font-semibold text-accent-600">
          {s.disagreements.length} title{s.disagreements.length === 1 ? '' : 's'} where you and TMDB differ by 1.5+ points →
        </button>
      )}
    </StatsCard>
  )
}

/** The library right now, by status, in the shared status colours. */
export function LibraryNowCard({ rows }: { rows: { label: string; counts: Record<LibraryBucket, number> }[] }) {
  return (
    <StatsCard title="Your library now" note="Every title by status, today — not limited to the period.">
      {rows.map(row => {
        const total = BUCKET_ORDER.reduce((n, b) => n + row.counts[b], 0)
        return (
          <div key={row.label} className="flex flex-col gap-1.5">
            <p className="text-meta text-fg-2"><span className="font-semibold text-fg">{row.label}</span> · {total}</p>
            {total > 0 && (
              <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-surface-2">
                {BUCKET_ORDER.filter(b => row.counts[b] > 0).map(b => (
                  <span key={b} data-tone={BUCKET_TONE[b]} className="tone-solid h-full" style={{ width: `${(row.counts[b] / total) * 100}%` }} title={`${BUCKET_LABEL[b]}: ${row.counts[b]}`} />
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-micro text-fg-muted">
              {BUCKET_ORDER.filter(b => row.counts[b] > 0).map(b => (
                <span key={b} className="inline-flex items-center gap-1"><ToneDot tone={BUCKET_TONE[b]} />{BUCKET_LABEL[b]} <span className="tabular-nums text-fg-2">{row.counts[b]}</span></span>
              ))}
            </div>
          </div>
        )
      })}
    </StatsCard>
  )
}
