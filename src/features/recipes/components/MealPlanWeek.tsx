import { useState, Fragment } from 'react'
import { format, addDays, addWeeks, startOfWeek, endOfWeek, isToday, getISOWeek } from 'date-fns'
import { formatDateRange, formatWeekdayDate } from '../../../shared/utils/dateFormat'
import { Check, CircleCheck, ClipboardList, Plus } from 'lucide-react'
import { useMealPlan, useEatPlannedEntry } from '../hooks/useMealPlan'
import { useFoodLogRange } from '../hooks/useFoodLog'
import { useEntityModal } from '../../../shared/modals/useEntityModal'
import { DateNav } from '../../../shared/components/DateNav'
import { Card, IconButton, Truncate, cx } from '../../../shared/ui'
import { SLOT_OPTIONS } from './foodLogUtils'
import type { MealSlot, MealPlanEntry } from '../types'
import type { LoggedFood } from '../api/foodLogApi'
import type { PlannedMeal } from '../api/mealPlanApi'

// The week's plan beside what was eaten (the Today diary). Each item reads the
// same in the grid and the list: 📋 planned / ✓ eaten, the name, its kcal
// (a planned one worked out live), and on a planned item the "Mark eaten"
// action — an outline circle, so a green ✓ always means eaten (Today uses the
// same control). A grid cell gives a name two lines, the kcal stays whole.
// Grid or list is chosen by the plan's OWN width (THEME §6.6 W1): the 7-day
// grid only from 64rem, so a sideways phone gets the list.

type Planned = { entry: PlannedMeal; label: string }

/** "Karnıyarık ×2", "Broccoli · 100 g", "Restaurant": the name first, as the diary reads. */
function planLabelOf(entry: MealPlanEntry | null): string | null {
  if (!entry) return null
  const amount = entry.ingredient_quantity != null ? ` · ${entry.ingredient_quantity} ${entry.ingredient_unit ?? 'g'}` : ''
  const base = entry.recipe?.title ?? entry.custom_title ?? (entry.ingredient?.name ? `${entry.ingredient.name}${amount}` : null)
  if (!base) return null
  return entry.servings !== 1 ? `${base} ×${entry.servings}` : base
}

const kcalText = (n: number | null | undefined) => (n ? `${Math.round(n)} kcal` : null)

export function MealPlanWeek() {
  const modal = useEntityModal()
  const [weekOffset, setWeekOffset] = useState(0)
  // The list shows ONE day at a time (the 7×5 grid needs a wide plan);
  // default to today's weekday (Mon-based).
  const [dayIdx, setDayIdx] = useState(() => (new Date().getDay() + 6) % 7)
  const eat = useEatPlannedEntry()

  const baseStart = startOfWeek(new Date(), { weekStartsOn: 1 })
  const weekStart = weekOffset === 0 ? baseStart : addWeeks(baseStart, weekOffset)
  const weekEnd   = endOfWeek(weekStart, { weekStartsOn: 1 })
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const fromStr = format(weekStart, 'yyyy-MM-dd')
  const toStr   = format(weekEnd, 'yyyy-MM-dd')

  const { data: entries = [] } = useMealPlan(fromStr, toStr)     // the PLAN
  const { data: logged = [] }  = useFoodLogRange(fromStr, toStr) // the DIARY (eaten)

  // Every planned row for a slot — several are legal since migration 061.
  function plannedFor(dateStr: string, slot: MealSlot): Planned[] {
    return entries
      .filter(e => e.date === dateStr && e.meal_slot === slot)
      .map(entry => ({ entry, label: planLabelOf(entry) }))
      .filter((p): p is Planned => !!p.label)
  }
  // Eaten kcal per day — the week's real intake at a glance.
  const kcalByDay = new Map<string, number>()
  for (const l of logged) kcalByDay.set(l.date, (kcalByDay.get(l.date) ?? 0) + (l.calories ?? 0))
  const eatenBy = new Map<string, LoggedFood[]>()
  for (const l of logged) {
    const k = `${l.date}|${l.meal_slot}`
    const arr = eatenBy.get(k) ?? []
    arr.push(l); eatenBy.set(k, arr)
  }

  const openPlan = (entry: MealPlanEntry) => modal.open({ kind: 'meal-plan', date: entry.date, slot: entry.meal_slot, entryId: entry.id })
  // "Add" always CREATES — editing the existing row would overwrite it, and
  // several planned rows per slot are legal (post-061).
  const openAdd = (date: string, slot: MealSlot) => modal.open({ kind: 'meal-plan', date, slot })
  const openEaten = (l: LoggedFood) => modal.open({ kind: 'food-log-edit', entryId: l.id, date: l.date })

  const markEaten = (p: Planned, size: 'md' | 'sm') => (
    <IconButton label={`Mark ${p.label} eaten`} onClick={() => eat.mutate(p.entry)} disabled={eat.isPending}
      className={cx('text-fg-muted hover:!text-success focus-visible:!text-success disabled:opacity-50',
        size === 'sm' && '!h-6 !w-6 rounded-full [&_svg]:!h-3.5 [&_svg]:!w-3.5')}>
      <CircleCheck />
    </IconButton>
  )

  return (
    <div className="@container flex flex-col gap-3 sm:gap-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <div className="flex items-center gap-2">
          <DateNav
            size="md"
            label={`Week ${getISOWeek(weekStart)}`}
            labelClassName="min-w-[76px] text-center text-ui font-semibold text-fg"
            onPrev={() => setWeekOffset(w => w - 1)}
            onNext={() => setWeekOffset(w => w + 1)}
            onToday={() => setWeekOffset(0)}
            isToday={weekOffset === 0}
          />
          <span className="text-meta tabular-nums text-fg-muted">{formatDateRange(weekStart, weekEnd)}</span>
        </div>
        {/* Plan vs what was actually eaten (the Today diary), shown together. */}
        <p className="flex items-center gap-3 text-meta text-fg-muted">
          <span className="inline-flex items-center gap-1"><ClipboardList aria-hidden className="h-3.5 w-3.5" />Planned</span>
          <span className="inline-flex items-center gap-1 text-success"><Check aria-hidden className="h-3.5 w-3.5" />Eaten</span>
          <span className="inline-flex items-center gap-1"><CircleCheck aria-hidden className="h-3.5 w-3.5" />Mark eaten</span>
        </p>
      </div>

      {/* ── A narrow plan (phones, sideways phones, tablets): one day at a time ── */}
      <div className="@[64rem]:hidden">
        <div role="tablist" aria-label="Day" className="scroll-x -mx-1 mb-3 flex gap-1.5 px-1">
          {days.map((day, i) => {
            const active = i === dayIdx
            return (
              <button key={day.toISOString()} type="button" role="tab" aria-selected={active} onClick={() => setDayIdx(i)}
                className={cx(
                  'press-feedback min-h-[48px] min-w-[46px] shrink-0 rounded-row border px-2 py-1 text-center transition-colors',
                  active ? 'border-accent-500 bg-accent-500 text-on-accent'
                    : cx('bg-surface text-fg-2', isToday(day) ? 'border-accent-500/50' : 'border-line'),
                )}>
                <div className="text-micro font-semibold uppercase opacity-80">{format(day, 'EEE')}</div>
                <div className="text-ui font-bold leading-tight tabular-nums">{format(day, 'd')}</div>
                {kcalByDay.get(format(day, 'yyyy-MM-dd')) ? (
                  <div className="text-micro tabular-nums opacity-80">{Math.round(kcalByDay.get(format(day, 'yyyy-MM-dd'))!)}</div>
                ) : null}
              </button>
            )
          })}
        </div>
        {/* Two column stacks once there is room (sideways phone), never a stretched row. */}
        <div className="stagger-in gap-3 @[40rem]:columns-2 [&>*]:mb-3 [&>*]:break-inside-avoid">
          {SLOT_OPTIONS.map(({ id: slot, icon, label }) => {
            const dateStr = format(days[dayIdx], 'yyyy-MM-dd')
            const planned = plannedFor(dateStr, slot)
            const eaten = eatenBy.get(`${dateStr}|${slot}`) ?? []
            // Eaten rows keep the action's column when the meal has planned ones, so the kcal line up.
            const actionCol = planned.length > 0
            return (
              <Card key={slot} padded={false} className="overflow-hidden">
                <header className="flex items-center gap-2 border-b border-line py-1 pl-4 pr-2">
                  <h3 className="flex flex-1 items-center gap-1.5 text-ui font-semibold text-fg"><span aria-hidden>{icon}</span>{label}</h3>
                  <button type="button" onClick={() => openAdd(dateStr, slot)} aria-label={`Add to ${label} on ${formatWeekdayDate(days[dayIdx])}`}
                    className="btn-ghost btn-sm gap-1 !px-2.5 text-accent-600">
                    <Plus aria-hidden className="h-4 w-4" />Add
                  </button>
                </header>
                {planned.length > 0 || eaten.length > 0 ? (
                  <ul className="divide-y divide-line">
                    {planned.map(p => (
                      <li key={p.entry.id} className="flex items-center gap-1 pl-4 pr-2 text-body">
                        <button type="button" onClick={() => openPlan(p.entry)} className="flex min-h-[44px] min-w-0 flex-1 items-center gap-2 text-left">
                          <ClipboardList aria-hidden className="h-4 w-4 shrink-0 text-fg-faint" />
                          <Truncate className="flex-1 italic text-fg-muted">{p.label}</Truncate>
                          {kcalText(p.entry.kcal) && <span className="shrink-0 text-meta tabular-nums text-fg-muted">{kcalText(p.entry.kcal)}</span>}
                        </button>
                        {markEaten(p, 'md')}
                      </li>
                    ))}
                    {eaten.map(l => (
                      <li key={l.id} className={cx('flex items-center gap-1 pl-4', actionCol ? 'pr-2' : 'pr-4')}>
                        <button type="button" onClick={() => openEaten(l)} className="flex min-h-[44px] min-w-0 flex-1 items-center gap-2 text-left text-body">
                          <Check aria-hidden className="h-4 w-4 shrink-0 text-success" />
                          <Truncate className="flex-1 text-fg">{l.title}</Truncate>
                          {kcalText(l.calories) && <span className="shrink-0 text-meta tabular-nums text-fg-muted">{kcalText(l.calories)}</span>}
                        </button>
                        {actionCol && <span aria-hidden className="w-11 shrink-0" />}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <button type="button" onClick={() => openAdd(dateStr, slot)} className="flex min-h-[44px] w-full items-center px-4 text-left text-body text-fg-faint transition-colors hover:text-accent-600">
                    Plan a meal
                  </button>
                )}
              </Card>
            )
          })}
        </div>
      </div>

      {/* ── A wide plan: the full 7-day × 5-slot grid ── */}
      <Card padded={false} className="hidden overflow-hidden @[64rem]:block">
        <div className="grid gap-1.5 p-3" style={{ gridTemplateColumns: '5.5rem repeat(7, minmax(0, 1fr))' }}>
          <div />
          {days.map(day => (
            <div key={day.toISOString()} className={cx('rounded-row py-1.5 text-center', isToday(day) && 'bg-accent-50')}>
              <p className="section-label">{format(day, 'EEE')}</p>
              <p className={cx('text-ui font-bold tabular-nums', isToday(day) ? 'text-accent-600' : 'text-fg')}>{format(day, 'd')}</p>
              <p className="text-micro normal-case tracking-normal tabular-nums text-fg-muted">
                {kcalByDay.get(format(day, 'yyyy-MM-dd')) ? `${Math.round(kcalByDay.get(format(day, 'yyyy-MM-dd'))!)} kcal` : '—'}
              </p>
            </div>
          ))}

          {SLOT_OPTIONS.map(({ id: slot, label }) => (
            <Fragment key={slot}>
              <div className="flex items-center text-meta font-semibold text-fg-muted">{label}</div>
              {days.map(day => {
                const dateStr = format(day, 'yyyy-MM-dd')
                const planned = plannedFor(dateStr, slot)
                const eaten = eatenBy.get(`${dateStr}|${slot}`) ?? []
                const filled = planned.length > 0 || eaten.length > 0
                const actionCol = planned.length > 0
                // A div (not a button) so plan / eaten / add are separate controls.
                return (
                  <div key={`${slot}-${dateStr}`}
                    className={cx('flex min-h-[64px] min-w-0 flex-col overflow-hidden rounded-row border bg-surface', filled ? 'border-line' : 'border-dashed border-line')}>
                    {!filled ? (
                      <button type="button" onClick={() => openAdd(dateStr, slot)} aria-label={`Plan ${label} on ${formatWeekdayDate(day)}`}
                        className="flex min-h-[64px] w-full flex-1 items-center justify-center text-fg-faint transition-colors hover:bg-accent-50 hover:text-accent-600">
                        <Plus aria-hidden className="h-5 w-5" />
                      </button>
                    ) : (
                      <>
                        <div className="flex flex-1 flex-col gap-0.5 p-1">
                          {planned.map(p => (
                            <div key={p.entry.id} className="flex items-start gap-0.5 rounded-md transition-colors hover:bg-surface-hover">
                              <button type="button" onClick={() => openPlan(p.entry)}
                                className="flex min-h-[24px] min-w-0 flex-1 items-start gap-1 px-1 py-1 text-left text-meta leading-4">
                                <ClipboardList aria-hidden className="mt-0.5 h-3 w-3 shrink-0 text-fg-faint" />
                                <Truncate lines={2} className="flex-1 italic text-fg-muted">{p.label}</Truncate>
                                {p.entry.kcal ? <span className="shrink-0 tabular-nums text-fg-muted">{Math.round(p.entry.kcal)}</span> : null}
                              </button>
                              {markEaten(p, 'sm')}
                            </div>
                          ))}
                          {eaten.map(l => (
                            <div key={l.id} className="flex items-start gap-0.5 rounded-md transition-colors hover:bg-success-soft">
                              <button type="button" onClick={() => openEaten(l)}
                                className="flex min-h-[24px] min-w-0 flex-1 items-start gap-1 px-1 py-1 text-left text-meta leading-4">
                                <Check aria-hidden className="mt-0.5 h-3 w-3 shrink-0 text-success" />
                                <Truncate lines={2} className="flex-1 text-fg-2">{l.title}</Truncate>
                                {l.calories ? <span className="shrink-0 tabular-nums text-fg-muted">{Math.round(l.calories)}</span> : null}
                              </button>
                              {actionCol && <span aria-hidden className="w-6 shrink-0" />}
                            </div>
                          ))}
                        </div>
                        <button type="button" onClick={() => openAdd(dateStr, slot)} aria-label={`Add to ${label} on ${formatWeekdayDate(day)}`}
                          className="flex w-full items-center gap-1 border-t border-line px-2 py-1 text-left text-micro text-fg-faint transition-colors hover:bg-accent-50 hover:text-accent-600">
                          <Plus aria-hidden className="h-3 w-3" />Add
                        </button>
                      </>
                    )}
                  </div>
                )
              })}
            </Fragment>
          ))}
        </div>
      </Card>
    </div>
  )
}
