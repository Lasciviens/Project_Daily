import { useMemo, useState, type ReactNode } from 'react'
import { BarChart3, Beef, Clock, Flame, Repeat } from 'lucide-react'
import { useEntityModal } from '../../../shared/modals/useEntityModal'
import { Card, CardHeader, EmptyState, PageBoard, SegmentedControl, SkeletonText, StatTile, Truncate, cx, type SegmentedOption } from '../../../shared/ui'
import { formatDate } from '../../../shared/utils/dateFormat'
import { shiftDateStr, todayStr } from '../../../shared/utils/dateUtils'
import { useDayTargets } from '../../daily/hooks/useDayTargets'
import { useFoodLogRange } from '../hooks/useFoodLog'
import { buildFoodInsights, type FoodSource } from '../foodInsights'
import { INSIGHT_BOARD } from '../foodBoards'
import { MACRO_COLOR } from '../macroColors'
import { MacroBar } from './MacroBar'
import { SLOT_OPTIONS } from './foodLogUtils'

type Window = '7' | '30' | '90'
const WINDOWS: SegmentedOption<Window>[] = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
]

/**
 * Food → Insights: what the diary says over 7 / 30 / 90 days — averages per
 * logged day against your targets, where the calories and the protein come
 * from, how the day splits across meals, and how steadily you log.
 */
export function FoodInsightsTab() {
  const [win, setWin] = useState<Window>('30')
  const days = Number(win)
  const today = todayStr()
  const from = shiftDateStr(today, -(days - 1))
  const { data: rows = [], isLoading } = useFoodLogRange(from, today)
  const { targets } = useDayTargets()
  const ins = useMemo(() => buildFoodInsights(rows, days, today), [rows, days, today])
  const modal = useEntityModal()
  const openSource = (s: FoodSource) => { if (s.kind === 'recipe' && s.id) modal.open({ kind: 'recipe-view', id: s.id }) }

  const header = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <SegmentedControl options={WINDOWS} value={win} onChange={setWin} size="sm" />
      <span className="text-meta tabular-nums text-fg-muted">{formatDate(from)} – {formatDate(today)}</span>
    </div>
  )

  if (isLoading) return <div className="flex flex-col gap-3">{header}<Card><SkeletonText lines={6} /></Card></div>
  if (ins.daysLogged === 0) {
    return <div className="flex flex-col gap-3">{header}<EmptyState bordered icon={<BarChart3 />} title="Nothing logged in this window" description="Log a few days and this page shows where your calories and protein come from." /></div>
  }

  const pctOf = (v: number, t: number) => (t > 0 ? Math.round((v / t) * 100) : null)
  const kcalPct = pctOf(ins.avg.kcal, targets.calories)
  const protPct = pctOf(ins.avg.protein, targets.protein)

  return (
    <div className="flex flex-col gap-3">
      {header}
      <PageBoard layout={INSIGHT_BOARD} stackGap="gap-3 sm:gap-4" sections={{
        summary: (
          <Card className="@container">
            <CardHeader title="Your average day" variant="label" icon={<BarChart3 />}
              subtitle={`Per logged day · ${ins.daysLogged} of ${days} days logged`} />
            <div className="grid grid-cols-2 gap-2 @[30rem]:grid-cols-4">
              <StatTile label="Calories" value={ins.avg.kcal.toLocaleString('en-GB')} unit="kcal"
                hint={kcalPct != null ? `${kcalPct}% of ${targets.calories.toLocaleString("en-GB")}` : undefined} />
              <StatTile label="Protein" value={Math.round(ins.avg.protein)} unit="g"
                hint={protPct != null ? `${protPct}% of ${targets.protein} g` : undefined} />
              <StatTile label="Fiber" value={Math.round(ins.avg.fiber)} unit="g" hint="Aim 25–30 g" />
              <StatTile label="Streak" value={ins.streak} unit={ins.streak === 1 ? 'day' : 'days'} hint={`${ins.variety} different foods`} />
            </div>
            <div className="mt-4">
              <p className="mb-1.5 text-meta text-fg-muted">Where your calories come from</p>
              <MacroBar protein={ins.avg.protein} carbs={ins.avg.carbs} fat={ins.avg.fat} />
              <p className="mt-1.5 text-micro tabular-nums text-fg-muted">
                Protein {Math.round(ins.avg.protein)} g · Carbs {Math.round(ins.avg.carbs)} g · Fat {Math.round(ins.avg.fat)} g a day
              </p>
            </div>
          </Card>
        ),
        kcal: (
          <SourceList title="Top calorie sources" icon={<Flame />} items={ins.topKcal} color={MACRO_COLOR.calories} onOpen={openSource}
            value={s => `${s.kcal.toLocaleString('en-GB')} kcal`} hint="Share of every calorie in the window" />
        ),
        protein: (
          <SourceList title="Top protein sources" icon={<Beef />} items={ins.topProtein} color={MACRO_COLOR.protein} onOpen={openSource}
            value={s => `${Math.round(s.protein)} g`} hint="Share of all protein in the window" />
        ),
        most: (
          <SourceList title="Most logged" icon={<Repeat />} items={ins.mostLogged} color="rgb(var(--chart-5))" onOpen={openSource}
            value={s => `${s.count}×`} hint="Share of every diary line" />
        ),
        slots: (
          <Card>
            <CardHeader title="By meal" variant="label" icon={<Clock />} subtitle="Average per logged day" />
            <ul className="flex flex-col gap-2.5">
              {ins.slots.map(s => {
                const o = SLOT_OPTIONS.find(x => x.id === s.slot)
                return (
                  <li key={s.slot} className="flex flex-col gap-1">
                    <div className="flex items-baseline gap-2 text-body">
                      <span aria-hidden>{o?.icon}</span>
                      <span className="flex-1 font-medium text-fg">{o?.label ?? s.slot}</span>
                      <span className="tabular-nums text-fg-2">{s.kcalPerDay} kcal</span>
                      <span className="w-14 text-right text-meta tabular-nums text-fg-muted">{Math.round(s.proteinPerDay)} g P</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                      <div className="h-full rounded-full" style={{ width: `${s.kcalShare}%`, backgroundColor: MACRO_COLOR.calories }} />
                    </div>
                    <p className="text-micro tabular-nums text-fg-muted">{s.kcalShare}% of calories · on {s.daysWith} of {ins.daysLogged} days</p>
                  </li>
                )
              })}
            </ul>
          </Card>
        ),
      }} />
    </div>
  )
}

function SourceList({ title, icon, items, value, color, hint, onOpen }: {
  title: string
  icon: ReactNode
  items: FoodSource[]
  value: (s: FoodSource) => string
  color: string
  hint: string
  onOpen: (s: FoodSource) => void
}) {
  return (
    <Card>
      <CardHeader title={title} variant="label" icon={icon} subtitle={hint} />
      {items.length === 0 ? <p className="text-meta text-fg-muted">Nothing here yet.</p> : (
        <ol className="flex flex-col gap-2">
          {items.map((s, i) => {
            const body = (
              <>
                <div className="flex items-baseline gap-2 text-body">
                  <span className="w-4 shrink-0 text-right text-micro tabular-nums text-fg-faint">{i + 1}</span>
                  <Truncate className="flex-1 font-medium text-fg">{s.title}</Truncate>
                  <span className="shrink-0 tabular-nums text-fg-2">{value(s)}</span>
                  <span className="w-9 shrink-0 text-right text-meta tabular-nums text-fg-muted">{s.share}%</span>
                </div>
                <div className="ml-6 mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
                  <div className="h-full rounded-full" style={{ width: `${Math.max(s.share, 2)}%`, backgroundColor: color }} />
                </div>
              </>
            )
            return (
              <li key={s.key}>
                {s.kind === 'recipe' && s.id ? (
                  <button type="button" onClick={() => onOpen(s)} className={cx('press-feedback block w-full rounded-row py-0.5 text-left hover:bg-surface-hover')}>{body}</button>
                ) : <div className="py-0.5">{body}</div>}
              </li>
            )
          })}
        </ol>
      )}
    </Card>
  )
}
