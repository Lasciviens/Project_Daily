import { useState, Fragment } from 'react'
import { format, addDays, addWeeks, startOfWeek, endOfWeek, isToday, getISOWeek } from 'date-fns'
import { Check, ClipboardList, Plus } from 'lucide-react'
import { useMealPlan, useEatPlannedEntry } from '../hooks/useMealPlan'
import { useFoodLogRange } from '../hooks/useFoodLog'
import { useEntityModal } from '../../../shared/modals/useEntityModal'
import { DateNav } from '../../../shared/components/DateNav'
import { Card, IconButton, cx } from '../../../shared/ui'
import type { MealSlot, MealPlanEntry } from '../types'
import type { LoggedFood } from '../api/foodLogApi'

const SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack', 'supplement']
const SLOT_LABEL: Record<MealSlot, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack', supplement: 'Suppl.' }

function planLabelOf(entry: MealPlanEntry | null): string | null {
  if (!entry) return null
  const base = entry.recipe?.title ?? entry.custom_title
    ?? (entry.ingredient?.name ? `${entry.ingredient_quantity ?? ''}${entry.ingredient_unit ?? ''} ${entry.ingredient.name}`.trim() : null)
  if (!base) return null
  return entry.servings !== 1 ? `${base} ×${entry.servings}` : base
}

export function MealPlanWeek() {
  const modal = useEntityModal()
  const [weekOffset, setWeekOffset] = useState(0)
  // Phones show ONE day at a time (the 7×5 grid is unusable at 393px);
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

  function entryFor(dateStr: string, slot: MealSlot): MealPlanEntry | null {
    return entries.find(e => e.date === dateStr && e.meal_slot === slot) ?? null
  }
  const eatenBy = new Map<string, LoggedFood[]>()
  for (const l of logged) {
    const k = `${l.date}|${l.meal_slot}`
    const arr = eatenBy.get(k) ?? []
    arr.push(l); eatenBy.set(k, arr)
  }

  const openPlan = (date: string, slot: MealSlot, entry: MealPlanEntry | null) =>
    modal.open({ kind: 'meal-plan', date, slot, entryId: entry?.id })
  // "Add" always CREATES — editing the existing row would overwrite it, and
  // several planned rows per slot are legal (post-061).
  const openAdd = (date: string, slot: MealSlot) => modal.open({ kind: 'meal-plan', date, slot })
  const openEaten = (l: LoggedFood) => modal.open({ kind: 'food-log-edit', entryId: l.id, date: l.date })

  return (
    <div className="flex flex-col gap-3 sm:gap-4">
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
          <span className="text-meta tabular-nums text-fg-muted">{format(weekStart, 'd MMM')} – {format(weekEnd, 'd MMM')}</span>
        </div>
        {/* Plan vs what was actually eaten (the Today diary), shown together. */}
        <p className="flex items-center gap-3 text-meta text-fg-muted">
          <span className="inline-flex items-center gap-1"><ClipboardList aria-hidden className="h-3.5 w-3.5" />Planned</span>
          <span className="inline-flex items-center gap-1 text-success"><Check aria-hidden className="h-3.5 w-3.5" />Eaten</span>
          <span className="hidden sm:inline">Tap to edit</span>
        </p>
      </div>

      {/* ── Phone: one day at a time ── */}
      <div className="md:hidden">
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
              </button>
            )
          })}
        </div>
        <div className="flex flex-col gap-3 stagger-in">
          {SLOTS.map(slot => {
            const dateStr = format(days[dayIdx], 'yyyy-MM-dd')
            const entry = entryFor(dateStr, slot)
            const eaten = eatenBy.get(`${dateStr}|${slot}`) ?? []
            const planLabel = planLabelOf(entry)
            return (
              <Card key={slot} padded={false} className="overflow-hidden">
                <header className="flex items-center gap-2 border-b border-line py-1 pl-4 pr-2">
                  <h3 className="flex-1 text-ui font-semibold text-fg">{SLOT_LABEL[slot]}</h3>
                  <button type="button" onClick={() => openAdd(dateStr, slot)} className="btn-ghost btn-sm gap-1 !px-2.5 text-accent-600">
                    <Plus aria-hidden className="h-4 w-4" />Add
                  </button>
                </header>
                {planLabel || eaten.length > 0 ? (
                  <ul className="divide-y divide-line">
                    {planLabel && entry && (
                      <li className="flex items-center gap-1 pl-4 pr-2 text-body">
                        <button type="button" onClick={() => openPlan(dateStr, slot, entry)} className="flex min-h-[44px] min-w-0 flex-1 items-center gap-2 text-left">
                          <ClipboardList aria-hidden className="h-4 w-4 shrink-0 text-fg-faint" />
                          <span className="min-w-0 flex-1 truncate italic text-fg-muted">{planLabel}</span>
                        </button>
                        <IconButton label="Mark eaten" onClick={() => eat.mutate(entry)} disabled={eat.isPending} className="text-success disabled:opacity-50"><Check /></IconButton>
                      </li>
                    )}
                    {eaten.map(l => (
                      <li key={l.id}>
                        <button type="button" onClick={() => openEaten(l)} className="flex min-h-[44px] w-full items-center gap-2 px-4 text-left text-body transition-colors hover:bg-surface-hover">
                          <Check aria-hidden className="h-4 w-4 shrink-0 text-success" />
                          <span className="min-w-0 flex-1 truncate text-fg">{l.title}</span>
                          {l.calories ? <span className="shrink-0 text-meta tabular-nums text-fg-muted">{Math.round(l.calories)} kcal</span> : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <button type="button" onClick={() => openPlan(dateStr, slot, null)} className="flex min-h-[44px] w-full items-center px-4 text-left text-body text-fg-faint transition-colors hover:text-accent-600">
                    Plan a meal
                  </button>
                )}
              </Card>
            )
          })}
        </div>
      </div>

      {/* ── Tablet and up: the full 7-day × 5-slot grid ── */}
      <Card padded={false} className="hidden overflow-hidden md:block">
        <div className="scroll-x">
          <div className="grid min-w-[760px] gap-1.5 p-3" style={{ gridTemplateColumns: '84px repeat(7, minmax(0, 1fr))' }}>
            <div />
            {days.map(day => (
              <div key={day.toISOString()} className={cx('rounded-row py-1.5 text-center', isToday(day) && 'bg-accent-50')}>
                <p className="section-label">{format(day, 'EEE')}</p>
                <p className={cx('text-ui font-bold tabular-nums', isToday(day) ? 'text-accent-600' : 'text-fg')}>{format(day, 'd')}</p>
              </div>
            ))}

            {SLOTS.map(slot => (
              <Fragment key={slot}>
                <div className="flex items-center text-meta font-semibold text-fg-muted">{SLOT_LABEL[slot]}</div>
                {days.map(day => {
                  const dateStr = format(day, 'yyyy-MM-dd')
                  const entry = entryFor(dateStr, slot)
                  const eaten = eatenBy.get(`${dateStr}|${slot}`) ?? []
                  const planLabel = planLabelOf(entry)
                  const filled = !!planLabel || eaten.length > 0
                  // A div (not a button) so plan / eaten / add are separate controls.
                  return (
                    <div key={`${slot}-${dateStr}`}
                      className={cx('flex min-h-[64px] flex-col overflow-hidden rounded-row border bg-surface', filled ? 'border-line' : 'border-dashed border-line')}>
                      {!filled ? (
                        <button type="button" onClick={() => openAdd(dateStr, slot)} aria-label={`Plan ${SLOT_LABEL[slot]} on ${format(day, 'EEE d MMM')}`}
                          className="flex min-h-[64px] w-full flex-1 items-center justify-center text-fg-faint transition-colors hover:bg-accent-50 hover:text-accent-600">
                          <Plus aria-hidden className="h-5 w-5" />
                        </button>
                      ) : (
                        <>
                          <div className="flex flex-1 flex-col gap-0.5 p-1">
                            {planLabel && entry && (
                              <div className="flex items-start gap-0.5 rounded-md transition-colors hover:bg-surface-hover">
                                <button type="button" onClick={() => openPlan(dateStr, slot, entry)} className="min-w-0 flex-1 px-1 py-0.5 text-left">
                                  <span className="line-clamp-2 text-meta font-medium leading-tight text-fg-2">{planLabel}</span>
                                </button>
                                <button type="button" onClick={() => eat.mutate(entry)} disabled={eat.isPending}
                                  aria-label="Mark eaten" title="Mark eaten"
                                  className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-success transition-colors hover:bg-success-soft disabled:opacity-50">
                                  <Check aria-hidden className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            )}
                            {eaten.map(l => (
                              <button key={l.id} type="button" onClick={() => openEaten(l)}
                                className="flex items-center gap-1 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-success-soft">
                                <Check aria-hidden className="h-3 w-3 shrink-0 text-success" />
                                <span className="line-clamp-1 text-micro leading-tight text-fg-2">{l.title}{l.calories ? ` · ${Math.round(l.calories)}` : ''}</span>
                              </button>
                            ))}
                          </div>
                          <button type="button" onClick={() => openAdd(dateStr, slot)}
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
        </div>
      </Card>
    </div>
  )
}
