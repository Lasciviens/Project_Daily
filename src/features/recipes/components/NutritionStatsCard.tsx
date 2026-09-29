import { useState } from 'react'
import { BarChart3 } from 'lucide-react'
import { Card, CardHeader, SegmentedControl, ToneDot, TonePill, type Tone } from '../../../shared/ui'
import { shiftDateStr } from '../../../shared/utils/dateUtils'
import { useFoodLogRange } from '../hooks/useFoodLog'
import { useDayTargets } from '../../daily/hooks/useDayTargets'
import { useGoalReport } from '../../health/goal/useGoalReport'
import { buildNutritionStats, type StatTier } from '../nutritionStats'

const TIER: Record<StatTier, { label: string; tone: Tone }> = {
  measured: { label: 'Measured', tone: 'neutral' },
  evidence: { label: 'Evidence', tone: 'info' },
  heuristic: { label: 'Heuristic', tone: 'warn' },
}
const PERIODS = [{ value: '7' as const, label: '7 days' }, { value: '28' as const, label: '28 days' }]

/** Protein, calories, logged vs burned, protein per meal, fibre, fat and the
 *  weekend gap over the last 7 or 28 days — one row each, with how sure the
 *  number is (nutritionStats.ts). Reads the diary range, the goal and the
 *  goal report's 28-day window (weight + paired days). */
export function NutritionStatsCard({ date }: { date: string }) {
  const [period, setPeriod] = useState<'7' | '28'>('7')
  const { data: rows = [], isLoading } = useFoodLogRange(shiftDateStr(date, -27), date)
  const { targets } = useDayTargets()
  const { report } = useGoalReport(28)
  const e = report?.energy
  const s = buildNutritionStats({
    rows, endDate: date, period: Number(period) as 7 | 28, targetKcal: targets.calories,
    weightKg: e ? (e.weight.currentTrendKg ?? e.weight.meanKg) : null,
    balance: e ? { days: e.paired.days, meanIntake: e.paired.meanIntake, meanBurn: e.paired.meanBurn, scaleBurn: e.observedTdee } : null,
  })
  return (
    <Card className="@container">
      <CardHeader title="Nutrition stats" variant="label" icon={<BarChart3 />}
        action={<SegmentedControl size="sm" options={PERIODS} value={period} onChange={setPeriod} />} />
      {isLoading ? (
        <p className="text-meta text-fg-muted">Loading…</p>
      ) : !s.rows.length ? (
        <p className="text-body text-fg-muted">Nothing logged in the last {period} days yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {s.rows.map(r => (
            <li key={r.key} className="flex items-start gap-2 py-2 first:pt-0 last:pb-0">
              <ToneDot tone={r.tone} className="mt-1.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-baseline justify-between gap-x-2">
                  <span className="text-body font-medium text-fg">{r.label}</span>
                  <span className="text-meta tabular-nums text-fg-2">{r.value}</span>
                </p>
                <p className="text-meta text-fg-muted">{r.sentence}</p>
              </div>
              <TonePill tone={TIER[r.tier].tone} className="mt-0.5 shrink-0">{TIER[r.tier].label}</TonePill>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
