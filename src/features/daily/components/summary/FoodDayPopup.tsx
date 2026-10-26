import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { ModalShell } from '../../../../shared/modals'
import { Truncate, cx } from '../../../../shared/ui'
import { formatWeekdayDate } from '../../../../shared/utils/dateFormat'
import { todayStr } from '../../../../shared/utils/dateUtils'
import { useDayNutrition } from '../../hooks/useDayNutrition'
import { useDayTargets } from '../../hooks/useDayTargets'
import { useNutritionCoach } from '../../hooks/useNutritionCoach'
import { dayMacroTargets } from '../../../health/goal/cutDecision'
import { WaterTracker } from './WaterTracker'
import { dayFoodTotals, mealsBySlot } from '../../foodGlance'

// The day's food in more detail, from Personal's Food summary (owner,
// 26.10.2026: "everything I would need but not super super detailed"): what
// was eaten against the goal and what is left, the water (with its quick
// add, the same tracker as Food · Today), and the day's meals with their
// calories. Logging food stays on the Food page — one tap away.

export function FoodDayPopup({ date, onClose }: { date: string; onClose: () => void }) {
  const today = todayStr()
  const nut = useDayNutrition(date)
  const { targets } = useDayTargets()
  const coach = useNutritionCoach(targets)
  const goal = dayMacroTargets(targets, coach.fatFloorG)
  const meals = nut.data?.meals ?? []
  const totals = dayFoodTotals(meals, date, today)
  const rows = [
    { name: 'Calories', unit: 'kcal', have: totals.calories, want: goal.kcal, over: 'danger' as const },
    { name: 'Protein', unit: 'g', have: totals.protein_g, want: goal.protein, reached: true },
    { name: 'Carbs', unit: 'g', have: totals.carbs_g, want: goal.carbs },
    { name: 'Fat', unit: 'g', have: totals.fat_g, want: goal.fat },
  ]
  const n = (v: number) => v.toLocaleString('en-GB')

  return (
    <ModalShell open onClose={onClose} size="sm" title="Food" subtitle={formatWeekdayDate(date)}
      footer={
        <Link to={`/recipes?date=${date}`} onClick={onClose}
          className="flex min-h-[44px] items-center justify-center gap-1 text-body font-semibold text-accent-600 hover:text-accent-700">
          Open the Food page<ChevronRight className="h-4 w-4" aria-hidden />
        </Link>
      }>
      <div className="flex flex-col gap-5">
        <section aria-label={totals.planned ? 'Planned against your goal' : 'Eaten against your goal'}>
          <table className="w-full text-body tabular-nums">
            <thead>
              <tr className="text-left section-label">
                <th className="pb-1 font-normal" />
                <th className="pb-1 text-right font-normal">{totals.planned ? 'Planned' : 'Eaten'}</th>
                <th className="pb-1 text-right font-normal">Goal</th>
                <th className="pb-1 text-right font-normal">Left</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const left = r.want - r.have
                const tone = r.over && left < 0 ? r.over : r.reached && r.want > 0 && r.have >= r.want ? 'success' : undefined
                return (
                  <tr key={r.name} className="border-t border-line">
                    <th scope="row" className="py-1.5 text-left font-medium text-fg-2">{r.name}</th>
                    <td data-tone={tone} className={cx('py-1.5 text-right font-semibold', tone ? 'tone-text' : 'text-fg')}>{n(r.have)} {r.unit}</td>
                    <td className="py-1.5 text-right text-fg-muted">{n(r.want)} {r.unit}</td>
                    <td className="py-1.5 text-right text-fg-muted">{left < 0 ? `${n(-left)} over` : `${n(left)} ${r.unit}`}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>

        <section aria-label="Water">
          <WaterTracker date={date} />
        </section>

        <section aria-label="Meals" className="flex flex-col gap-3">
          {nut.isLoading ? <p className="text-meta text-fg-muted">…</p>
            : meals.length === 0 ? <p className="text-meta text-fg-muted">{date > today ? 'Nothing planned for this day.' : 'Nothing logged for this day.'}</p>
              : mealsBySlot(meals).map(g => (
                <div key={g.slot}>
                  <p className="flex items-baseline justify-between gap-2">
                    <span className="section-label">{g.name}</span>
                    {g.kcal > 0 && <span className="text-meta tabular-nums text-fg-muted">{n(g.kcal)} kcal</span>}
                  </p>
                  <ul className="mt-1 flex flex-col">
                    {g.items.map(m => (
                      <li key={m.id} className={cx('flex items-baseline gap-2 py-0.5 text-body', m.source === 'plan' && 'text-fg-muted')}>
                        <Truncate className="min-w-0 flex-1">{m.title}</Truncate>
                        {m.source === 'plan' && <span className="shrink-0 text-micro text-fg-faint">planned</span>}
                        <span className="shrink-0 text-meta tabular-nums text-fg-muted">{n(m.calories)} kcal</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
        </section>
      </div>
    </ModalShell>
  )
}
