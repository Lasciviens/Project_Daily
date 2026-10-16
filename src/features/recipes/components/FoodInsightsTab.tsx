import { useMemo, useState, type ReactNode } from 'react'
import { BarChart3, Beef, Carrot, Clock, Repeat } from 'lucide-react'
import { useEntityModal } from '../../../shared/modals/useEntityModal'
import { Card, CardHeader, EmptyState, MetaLine, PageBoard, SegmentedControl, SkeletonText, Truncate, cx, type SegmentedOption } from '../../../shared/ui'
import { formatDate } from '../../../shared/utils/dateFormat'
import { shiftDateStr, todayStr } from '../../../shared/utils/dateUtils'
import { useDayTargets } from '../../daily/hooks/useDayTargets'
import { useFoodLogRange } from '../hooks/useFoodLog'
import { useRecipes } from '../hooks/useRecipes'
import { useIngredientLibrary } from '../hooks/useIngredientLibrary'
import { buildFoodInsights, type FoodInsights, type FoodSource } from '../foodInsights'
import { formatAmount, mostUsedIngredients, type UsedIngredient } from '../foodIngredients'
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

// Every nutrient a diary line stores (food_log_entries), in the order the
// Nutrition card shows them.
const AVERAGES: { key: keyof FoodInsights['avg']; label: string; unit: string; color: string }[] = [
  { key: 'kcal', label: 'Calories', unit: 'kcal', color: MACRO_COLOR.calories },
  { key: 'protein', label: 'Protein', unit: 'g', color: MACRO_COLOR.protein },
  { key: 'carbs', label: 'Carbs', unit: 'g', color: MACRO_COLOR.carbs },
  { key: 'fat', label: 'Fat', unit: 'g', color: MACRO_COLOR.fat },
  { key: 'sugar', label: 'Sugar', unit: 'g', color: MACRO_COLOR.sugar },
  { key: 'fiber', label: 'Fiber', unit: 'g', color: MACRO_COLOR.fiber },
]

/**
 * Food → Insights: what the diary says over 7 / 30 / 90 days — averages per
 * logged day against your targets, the foods you use most, where the protein
 * comes from, how the day splits across meals, and how steadily you log.
 */
export function FoodInsightsTab() {
  const [win, setWin] = useState<Window>('30')
  const days = Number(win)
  const today = todayStr()
  const from = shiftDateStr(today, -(days - 1))
  const { data: rows = [], isLoading } = useFoodLogRange(from, today)
  const { data: recipes = [], isLoading: recipesLoading } = useRecipes()
  const { data: library = [], isLoading: libraryLoading } = useIngredientLibrary()
  const { targets } = useDayTargets()
  const ins = useMemo(() => buildFoodInsights(rows, days, today), [rows, days, today])
  const used = useMemo(
    () => mostUsedIngredients(rows, new Map(recipes.map(r => [r.id, r])), new Map(library.map(f => [f.id, f]))),
    [rows, recipes, library],
  )
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
    return <div className="flex flex-col gap-3">{header}<EmptyState bordered icon={<BarChart3 />} title="Nothing logged in this window" description="Log a few days and this page shows your average day and the foods you use most." /></div>
  }

  const pctOf = (v: number, t: number | null) => (t != null && t > 0 ? `${Math.round((v / t) * 100)}% of ${t.toLocaleString('en-GB')}` : null)
  // Against a target where there is one: calories and protein always, carbs and
  // fat only when they are the owner's own goals (a worked-out one is no goal).
  const hint: Record<keyof FoodInsights['avg'], string | null> = {
    kcal: pctOf(ins.avg.kcal, targets.calories),
    protein: pctOf(ins.avg.protein, targets.protein) && `${pctOf(ins.avg.protein, targets.protein)} g`,
    carbs: pctOf(ins.avg.carbs, targets.carbs) && `${pctOf(ins.avg.carbs, targets.carbs)} g`,
    fat: pctOf(ins.avg.fat, targets.fat) && `${pctOf(ins.avg.fat, targets.fat)} g`,
    sugar: null,
    fiber: 'Aim 25–30 g',
  }

  return (
    <div className="flex flex-col gap-3">
      {header}
      <PageBoard layout={INSIGHT_BOARD} stackGap="gap-3 sm:gap-4" sections={{
        summary: (
          <Card className="@container">
            <CardHeader title="Your average day" variant="label" icon={<BarChart3 />} wrap
              subtitle={<MetaLine as="span" items={[
                'Per logged day',
                `${ins.daysLogged} of ${days} days logged`,
                ins.streak > 0 && `${ins.streak}-day streak`,
                `${ins.variety} different foods`,
              ]} />} />
            <div className="grid grid-cols-3 gap-x-3 gap-y-3 @[34rem]:grid-cols-6">
              {AVERAGES.map(a => (
                <AverageFigure key={a.key} label={a.label} unit={a.unit} color={a.color} hint={hint[a.key]}
                  value={Math.round(ins.avg[a.key]).toLocaleString('en-GB')} />
              ))}
            </div>
            <div className="mt-4">
              <p className="mb-1.5 text-meta text-fg-muted">Where your calories come from</p>
              <MacroBar protein={ins.avg.protein} carbs={ins.avg.carbs} fat={ins.avg.fat} />
            </div>
          </Card>
        ),
        ingredients: (
          <IngredientUseList items={used.items} loading={recipesLoading || libraryLoading} />
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

/** One nutrient's average per logged day: its name, the number and, where there is a target, how it compares. */
function AverageFigure({ label, value, unit, color, hint }: { label: string; value: string; unit: string; color: string; hint: string | null }) {
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1 text-meta text-fg-muted">
        <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        {label}
      </p>
      <p className="whitespace-nowrap tabular-nums">
        <span className="text-lead font-bold text-fg">{value}</span>
        <span className="text-meta text-fg-muted"> {unit}</span>
      </p>
      {hint && <Truncate className="text-micro tabular-nums text-fg-muted">{hint}</Truncate>}
    </div>
  )
}

/**
 * The foods eaten most often in the window — logged by themselves or inside a
 * recipe (foodIngredients.mostUsedIngredients) — by the days they were eaten
 * on; the bar is that share of the logged days.
 */
function IngredientUseList({ items, loading }: { items: UsedIngredient[]; loading: boolean }) {
  return (
    <Card>
      <CardHeader title="Most used ingredients" variant="label" icon={<Carrot />} subtitle="Foods and recipe ingredients, by days eaten" />
      {loading ? <SkeletonText lines={5} /> : items.length === 0 ? <p className="text-meta text-fg-muted">Nothing here yet — one-off lines have no ingredients.</p> : (
        <ol className="flex flex-col gap-2">
          {items.map((u, i) => (
            <li key={u.key} className="py-0.5">
              <div className="flex items-baseline gap-2 text-body">
                <span className="w-4 shrink-0 text-right text-micro tabular-nums text-fg-faint">{i + 1}</span>
                <Truncate className="flex-1 font-medium text-fg">{u.title}</Truncate>
                <span className="shrink-0 tabular-nums text-fg-2">{u.days} {u.days === 1 ? 'day' : 'days'}</span>
              </div>
              <div className="ml-6 mt-1 flex items-center gap-2">
                <div className="h-1.5 min-w-12 flex-1 overflow-hidden rounded-full bg-surface-2">
                  <div className="h-full rounded-full" style={{ width: `${Math.max(u.dayShare, 2)}%`, backgroundColor: MACRO_COLOR.calories }} />
                </div>
                <MetaLine as="span" className="shrink-0 text-micro tabular-nums text-fg-muted" items={[
                  u.logs > u.days && `${u.logs}×`,
                  u.grams > 0 && formatAmount(u.grams, u.unit),
                  u.kcal > 0 && (u.kcalShare > 0 ? `${u.kcalShare}% of kcal` : '<1% of kcal'),
                ]} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
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
