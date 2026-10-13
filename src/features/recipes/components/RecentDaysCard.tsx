import { useMemo, useState } from 'react'
import { CalendarRange } from 'lucide-react'
import { Card, CardHeader, MetaLine, SegmentedControl, ToneDot, cx } from '../../../shared/ui'
import { formatDateRange, formatDayMonth, formatWeekday, formatWeekdayDate } from '../../../shared/utils/dateFormat'
import { shiftDateStr, todayStr } from '../../../shared/utils/dateUtils'
import { useFoodLogRange } from '../hooks/useFoodLog'
import { useDayTargets } from '../../daily/hooks/useDayTargets'
import { MACRO_COLOR } from '../macroColors'
import { periodEnd, PERIOD_DAYS, summarizePeriod, ON_TARGET_SHARE, type Macros, type PeriodDay, type PeriodDays } from '../weeklyNutrition'
import { buildFindings, type Finding } from '../nutritionStats'

type PeriodValue = `${PeriodDays}`
// Bare numbers on a phone-width card (the title already says "days"), so the
// date range beside the switch isn't cut off.
const span = (n: number) => <>{n}<span className="hidden @[26rem]:inline"> days</span></>
const PERIODS = PERIOD_DAYS.map(n => ({ value: String(n) as PeriodValue, label: span(n) }))

// Bar heights; taller when the card is wide (findings beside the chart). The
// protein row starts under the kcal row plus the column's gap-2.
const KCAL_H = 'h-20 @[42rem]:h-32'
const PROT_H = 'h-10 @[42rem]:h-16'
const PROT_TOP = 'top-[5.5rem] @[42rem]:top-[8.5rem]'

const macroFacts = (m: Macros) => [
  `${m.kcal.toLocaleString('en-GB')} kcal`, `${m.protein} g protein`, `${m.carbs} g carbs`, `${m.fat} g fat`, `${m.fiber} g fibre`, m.sugar > 0 && `${m.sugar} g sugar`,
]

function Legend() {
  const key = (color: string, label: string) => (
    <span className="inline-flex items-center gap-1"><span aria-hidden className="h-2 w-2 rounded-[2px]" style={{ backgroundColor: color }} />{label}</span>
  )
  return (
    <p className="flex flex-wrap items-center gap-x-3 text-micro text-fg-muted">
      {key(MACRO_COLOR.calories, 'kcal')}{key(MACRO_COLOR.protein, 'protein')}
      <span className="inline-flex items-center gap-1"><span aria-hidden className="w-3 border-t border-dashed border-line-strong" />target</span>
      <span className="ml-auto">Tap a day</span>
    </p>
  )
}

/**
 * One column per day — calories on top, protein below, each against its
 * target line. A column is a button: it shows that day's numbers under the
 * chart. Weekends sit on a faint band so a weekend habit shows at a glance.
 */
function DayChart({ days, targets, overIsBad, selected, onSelect }: {
  days: PeriodDay[]; targets: { calories: number; protein: number }; overIsBad: boolean
  selected: string | null; onSelect: (date: string) => void
}) {
  const kcalMax = Math.max(targets.calories * 1.25, ...days.map(d => d.kcal), 1)
  const protMax = Math.max(targets.protein * 1.25, ...days.map(d => d.protein), 1)
  const pct = (v: number, max: number) => `${Math.max((v / max) * 100, 3)}%`
  const line = (v: number, max: number) => (v > 0
    ? <span aria-hidden className="pointer-events-none absolute inset-x-0 border-t border-dashed border-line-strong" style={{ bottom: `${(v / max) * 100}%` }} />
    : null)
  const labelEvery = days.length > 14 ? 7 : 1
  return (
    <div>
      <div className="relative">
        <div aria-hidden className={`pointer-events-none absolute inset-x-0 top-0 ${KCAL_H}`}>{line(targets.calories, kcalMax)}</div>
        <div aria-hidden className={`pointer-events-none absolute inset-x-0 ${PROT_H} ${PROT_TOP}`}>{line(targets.protein, protMax)}</div>
        <div className={cx('flex', days.length > 14 ? 'gap-px' : 'gap-1')}>
          {days.map(d => {
            const over = overIsBad && targets.calories > 0 && d.kcal - targets.calories > targets.calories * ON_TARGET_SHARE
            const missed = targets.protein > 0 && d.protein < targets.protein
            const facts = d.logged ? `${d.kcal} kcal · ${d.protein} g protein${d.half ? ' · probably not fully logged' : ''}` : 'not logged'
            return (
              <button key={d.date} type="button" onClick={() => onSelect(d.date)} aria-pressed={selected === d.date}
                aria-label={`${formatWeekdayDate(d.date)}: ${facts}`} title={`${formatWeekdayDate(d.date)} · ${facts}`}
                className={cx('flex min-w-0 flex-1 flex-col gap-2 rounded-sm transition-colors',
                  selected === d.date ? 'bg-accent-50 shadow-[inset_0_0_0_1px_rgb(var(--accent-500)/0.5)]' : d.weekend ? 'bg-surface-2/70' : 'hover:bg-surface-hover')}>
                <span className={`flex w-full items-end ${KCAL_H}`}>
                  <span className={cx('w-full rounded-t-sm', !d.logged && 'bg-surface-2', over && 'bg-danger/70', d.half && 'opacity-40')}
                    style={{ height: d.logged ? pct(d.kcal, kcalMax) : '3%', backgroundColor: d.logged && !over ? MACRO_COLOR.calories : undefined }} />
                </span>
                <span className={`flex w-full items-end ${PROT_H}`}>
                  <span className={cx('w-full rounded-t-sm', !d.logged && 'bg-surface-2', d.logged && (d.half || missed) && 'opacity-50')}
                    style={{ height: d.logged ? pct(d.protein, protMax) : '3%', backgroundColor: d.logged ? MACRO_COLOR.protein : undefined }} />
                </span>
              </button>
            )
          })}
        </div>
      </div>
      <div aria-hidden className={cx('mt-1 flex', days.length > 14 ? 'gap-px' : 'gap-1')}>
        {days.map((d, i) => (
          <span key={d.date} className={cx('min-w-0 flex-1 whitespace-nowrap text-micro tabular-nums',
            labelEvery === 1 ? 'text-center' : 'overflow-visible text-left',
            selected === d.date ? 'font-semibold text-fg' : 'text-fg-muted')}>
            {labelEvery === 1 ? formatWeekday(d.date).slice(0, days.length > 7 ? 1 : 2) : i % labelEvery === 0 ? formatDayMonth(d.date) : ''}
          </span>
        ))}
      </div>
    </div>
  )
}

function FindingRow({ f, onSelect }: { f: Finding; onSelect: (date: string) => void }) {
  const body = (
    <>
      <ToneDot tone={f.tone} className="mt-1.5 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline justify-between gap-x-2">
          <span className="text-body font-medium text-fg">{f.label}</span>
          <span className="text-meta tabular-nums text-fg-2">{f.value}</span>
        </span>
        <span className="block text-meta text-fg-muted">{f.sentence}</span>
      </span>
    </>
  )
  return (
    <li className="py-2 first:pt-0 last:pb-0">
      {f.date
        ? <button type="button" onClick={() => onSelect(f.date!)} className="flex w-full items-start gap-2 text-left transition-colors hover:text-accent-600">{body}</button>
        : <div className="flex items-start gap-2">{body}</div>}
    </li>
  )
}

/**
 * "Last 7 / 14 / 28 days" on Food · Today: the days before the viewed one
 * (today is still being logged), one column per day for calories and
 * protein, the average day's macros, and plain findings — calories and
 * protein against the targets, logging gaps, weekends, low fibre or fat, the
 * best and hardest day. Every number comes from the picked window, so the
 * switch changes all of it (weeklyNutrition.ts + nutritionStats.ts).
 */
export function RecentDaysCard({ date, weightKg }: { date: string; weightKg: number | null }) {
  const [period, setPeriod] = useState<PeriodValue>('7')
  const [selected, setSelected] = useState<string | null>(null)
  const end = periodEnd(date, todayStr())
  // One read covers every period, so the switch never waits on the network.
  const { data: rows = [], isLoading } = useFoodLogRange(shiftDateStr(end, -27), end)
  const { targets } = useDayTargets()
  const n = Number(period) as PeriodDays
  const s = useMemo(() => summarizePeriod(rows, end, n, targets), [rows, end, n, targets])
  const findings = useMemo(() => buildFindings({ summary: s, targets, goal: targets.goal, weightKg }), [s, targets, weightKg])
  const sel = s.days.find(d => d.date === selected) ?? null

  function pickPeriod(v: PeriodValue) { setPeriod(v); setSelected(null) }
  function toggle(d: string) { setSelected(cur => (cur === d ? null : d)) }

  return (
    <Card className="@container">
      <CardHeader title={`Last ${n} days`} variant="label" icon={<CalendarRange />} subtitle={formatDateRange(s.from, s.to)}
        action={<SegmentedControl size="sm" options={PERIODS} value={period} onChange={pickPeriod} />} />
      {isLoading ? (
        <p className="text-meta text-fg-muted">Loading…</p>
      ) : s.loggedDays === 0 ? (
        <p className="text-body text-fg-muted">Nothing logged in these {n} days yet.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 @[42rem]:grid-cols-2 @[42rem]:gap-6">
          <div className="min-w-0">
            <Legend />
            <div className="mt-2"><DayChart days={s.days} targets={targets} overIsBad={targets.goal !== 'gain'} selected={selected} onSelect={toggle} /></div>
            <div className="mt-3 text-meta tabular-nums text-fg-muted">
              {sel ? (
                <MetaLine items={[
                  <strong key="d" className="font-semibold text-fg">{formatWeekdayDate(sel.date)}</strong>,
                  ...(sel.logged ? macroFacts(sel) : ['not logged']),
                  sel.half && 'probably not fully logged',
                ]} />
              ) : s.avg && (
                <MetaLine items={[<strong key="d" className="font-semibold text-fg">Average day</strong>, ...macroFacts(s.avg)]} />
              )}
            </div>
          </div>
          <ul className="flex min-w-0 flex-col divide-y divide-line">
            {findings.map(f => <FindingRow key={f.key} f={f} onSelect={toggle} />)}
          </ul>
        </div>
      )}
    </Card>
  )
}
