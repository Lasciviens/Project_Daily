import { format, parseISO } from 'date-fns'
import { formatWeekdayDate } from '../../../shared/utils/dateFormat'
import { CalendarRange } from 'lucide-react'
import { Card, CardHeader, cx } from '../../../shared/ui'
import { useFoodLogRange } from '../hooks/useFoodLog'
import { useDayTargets } from '../../daily/hooks/useDayTargets'
import { shiftDateStr, todayStr } from '../../../shared/utils/dateUtils'
import { MACRO_COLOR } from '../macroColors'
import { summarizeWeek } from '../weeklyNutrition'

// The 7 days ending on the viewed date: average intake over the days you
// actually logged, how often protein and calories landed, and one bar per day
// against the calorie target line. Reads the same diary query the Meal Plan
// week uses, so any log/edit/delete refreshes it.
export function WeeklyNutritionCard({ date }: { date: string }) {
  const from = shiftDateStr(date, -6)
  const { data: rows = [], isLoading } = useFoodLogRange(from, date)
  const { targets } = useDayTargets()
  const partial = date === todayStr() ? date : undefined
  const s = summarizeWeek(rows, date, targets, partial)

  const scaleMax = Math.max(targets.calories * 1.25, ...s.days.map(d => d.kcal), 1)
  const targetPct = targets.calories > 0 ? (targets.calories / scaleMax) * 100 : null

  return (
    <Card>
      <CardHeader title="Last 7 days" variant="label" icon={<CalendarRange />} />
      {isLoading ? (
        <p className="text-meta text-fg-muted">Loading…</p>
      ) : s.days.every(d => !d.logged) ? (
        <p className="text-body text-fg-muted">Nothing logged in the last 7 days yet.</p>
      ) : s.loggedDays === 0 ? (
        <p className="text-body text-fg-muted">Only today so far — averages start once a full day is logged.</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-body">
            <div>
              <dt className="text-meta text-fg-muted">Average</dt>
              <dd className="tabular-nums text-fg"><strong className="text-lead">{s.avgKcal}</strong> <span className="text-fg-muted">/ {targets.calories} kcal</span></dd>
            </div>
            <div>
              <dt className="text-meta text-fg-muted">Protein average</dt>
              <dd className="tabular-nums text-fg"><strong className="text-lead">{s.avgProtein}g</strong> <span className="text-fg-muted">/ {targets.protein}g</span></dd>
            </div>
            <div>
              <dt className="text-meta text-fg-muted">Protein target hit</dt>
              <dd className="tabular-nums text-fg-2">{s.proteinHitDays} of {s.loggedDays} days</dd>
            </div>
            <div>
              <dt className="text-meta text-fg-muted">Calories within 10%</dt>
              <dd className="tabular-nums text-fg-2">{s.kcalOnTargetDays} of {s.loggedDays} days</dd>
            </div>
          </dl>

          {partial && <p className="mt-2 text-micro text-fg-muted">Averages leave out today — it's still being logged.</p>}
          <div className="relative mt-4 flex h-24 items-end gap-1.5" role="img"
            aria-label={`Calories per day: ${s.days.map(d => `${format(parseISO(d.date), 'EEE')} ${d.logged ? d.kcal : 'not logged'}`).join(', ')}`}>
            {targetPct != null && (
              <div aria-hidden className="pointer-events-none absolute inset-x-0 border-t border-dashed border-line-strong" style={{ bottom: `${targetPct}%` }} />
            )}
            {s.days.map(d => {
              const over = targets.calories > 0 && d.kcal > targets.calories * 1.1
              return (
                <div key={d.date} className="flex h-full flex-1 flex-col justify-end" title={`${formatWeekdayDate(d.date)} · ${d.logged ? `${d.kcal} kcal · ${d.protein}g protein` : 'not logged'}`}>
                  <div
                    className={cx('w-full rounded-t-sm', !d.logged && 'bg-surface-2', over && 'bg-danger/70', d.partial && 'opacity-50')}
                    style={{ height: d.logged ? `${Math.max((d.kcal / scaleMax) * 100, 3)}%` : '3%', backgroundColor: d.logged && !over ? MACRO_COLOR.calories : undefined }}
                  />
                </div>
              )
            })}
          </div>
          <div className="mt-1 flex gap-1.5">
            {s.days.map(d => (
              <span key={d.date} className={cx('flex-1 text-center text-micro tabular-nums', d.date === date ? 'font-semibold text-fg' : 'text-fg-muted')}>
                {format(parseISO(d.date), 'EEEEE')}
              </span>
            ))}
          </div>
        </>
      )}
    </Card>
  )
}
