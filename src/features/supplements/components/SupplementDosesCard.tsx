import type { ReactNode } from 'react'
import { CalendarClock, Check, PauseCircle, TriangleAlert } from 'lucide-react'
import { Button, Card, MetaLine, SkeletonText, Truncate, cx } from '../../../shared/ui'
import { useEntityModal } from '../../../shared/modals/useEntityModal'
import { formatDate } from '../../../shared/utils/dateFormat'
import { chipClass } from '../../../shared/components/plan-modal/fieldStyles'
import { repeatSummary } from '../../daily/recurrence'
import { useRemoveFoodLogEntries } from '../../recipes/hooks/useFoodLog'
import type { DayMeal } from '../../daily/api/dayNutritionApi'
import {
  usePauseSupplement, useSkipDose, useSnoozeDose, useSupplementDoses, useSupplementStock, useTakeDoses, useUnskipDose,
} from '../hooks/useSupplements'
import { doseLabel, dueDoses, isPaused, resumePause, type Dose } from '../supplementDoses'
import { DoseLine, type DoseActions } from './DoseLine'

export interface SupplementDosesCardProps {
  /** The Food page's viewed day. */
  date: string
  /** The supplement slot's diary rows of that day (useDayNutrition's meals in
   *  the 'supplement' slot). A row a dose wrote shows on its dose's line. */
  meals: DayMeal[]
  /** Renders the slot's other rows (an ad-hoc scoop, a planned line) the way
   *  the meal cards do — FoodTodayTab's group / single rows. */
  renderRows: (meals: DayMeal[]) => ReactNode
  /** The meal cards' own header (title, totals in the rows' columns, + Log),
   *  given this card's Schedule button to show beside the title. */
  renderHeader: (extra: ReactNode) => ReactNode
  /** The empty slot's own quick actions (Log usual, Same as yesterday). */
  emptyActions?: ReactNode
}

/**
 * Food · Today's Supplement card (migration 160): the day's scheduled doses —
 * "Kreatin 5 g · 08:00 · due 2 h ago [Take] [Skip] ⋯" / "taken 08:12" — then
 * the slot's other diary lines, Take all due, refill warnings, paused
 * schedules and the schedules with no dose that day. Mounted in place of the
 * supplement slot; a reminder's tap (`?dose=…`) opens the dose sheet from the Food page (`useDoseLink`).
 */
export function SupplementDosesCard({ date, meals, renderRows, renderHeader, emptyActions }: SupplementDosesCardProps) {
  const modal = useEntityModal()
  const { doses, schedules, now, isLoading, isError, refetch } = useSupplementDoses(date)
  const stock = useSupplementStock(schedules)
  const take = useTakeDoses()
  const skip = useSkipDose()
  const unskip = useUnskipDose()
  const snooze = useSnoozeDose()
  const pause = usePauseSupplement()
  const remove = useRemoveFoodLogEntries()

  const fromDoses = new Set(doses.map(d => d.entryId).filter(Boolean))
  const others = meals.filter(m => !fromDoses.has(m.id))
  const kcalOf = new Map(meals.map(m => [m.id, m.calories]))
  const due = dueDoses(doses)
  const paused = schedules.filter(s => isPaused(s, now.date))
  const refill = schedules.filter(s => stock.get(s.id)?.refill)
  const elsewhere = schedules.filter(s => !paused.includes(s) && !doses.some(d => d.scheduleId === s.id))
  const busy = take.isPending || skip.isPending || snooze.isPending

  const openSchedule = (id?: string) => modal.open(id ? { kind: 'supplement-schedule', id } : { kind: 'supplement-schedule' })
  const actions: DoseActions = {
    take: d => take.mutate({ doses: [d] }),
    takeAt: d => modal.open({ kind: 'supplement-dose', date: d.date, scheduleId: d.scheduleId, time: d.time }),
    skip: d => skip.mutate(d),
    unskip: d => unskip.mutate(d),
    snooze: d => snooze.mutate({ dose: d }),
    untake: (d: Dose) => {
      if (d.entryId) void remove.run([d.entryId], { title: `Not taken: ${d.title} ${d.time}?`, message: 'Its line leaves the diary; the dose is open again.', done: `${d.title} not taken` })
    },
    edit: d => openSchedule(d.scheduleId),
    pause: d => pause.mutate({ id: d.scheduleId, from: now.date, until: null }),
  }
  const empty = doses.length === 0 && others.length === 0

  return (
    <Card padded={false} className="@container overflow-hidden">
      {renderHeader(
        <button type="button" onClick={() => openSchedule()} className="btn-ghost btn-sm shrink-0 gap-1 !px-2 text-fg-muted"
          aria-label="Schedule a supplement" title="Schedule a supplement">
          <CalendarClock aria-hidden className="h-4 w-4" /><span className="hidden @[26rem]:inline">Schedule</span>
        </button>,
      )}

      {isLoading && doses.length === 0 && <div className="px-4 py-3"><SkeletonText lines={1} /></div>}
      {isError && (
        <p className="flex items-center gap-2 px-4 py-2 text-meta text-danger">
          Your supplement schedules didn't load.
          <button type="button" onClick={() => void refetch()} className="font-semibold text-accent-600">Retry</button>
        </p>
      )}

      {(doses.length > 0 || others.length > 0) && (
        <ul className="divide-y divide-line">
          {doses.map(d => (
            <DoseLine key={d.key} dose={d} now={now} actions={actions} busy={busy} kcal={d.entryId ? kcalOf.get(d.entryId) : null} />
          ))}
          {others.length > 0 && renderRows(others)}
        </ul>
      )}

      {empty && !isLoading && (
        <div className="flex items-center pr-2">
          <button type="button" onClick={() => modal.open({ kind: 'food-log', date, slot: 'supplement' })}
            className="flex min-h-[44px] min-w-0 flex-1 items-center whitespace-nowrap px-4 text-left text-body text-fg-faint transition-colors hover:text-accent-600">
            Add<span className="hidden @[26rem]:inline">&nbsp;something</span>
          </button>
          {emptyActions}
        </div>
      )}

      {(due.length > 1 || refill.length > 0 || paused.length > 0 || elsewhere.length > 0) && (
        <div className="flex flex-col gap-1.5 border-t border-line px-4 py-2">
          {due.length > 1 && (
            <Button size="sm" icon={<Check />} disabled={busy} onClick={() => take.mutate({ doses: due })} className="self-start">
              Take all due ({due.length})
            </Button>
          )}
          {refill.map(s => {
            const left = stock.get(s.id)!
            return (
              <button key={s.id} type="button" onClick={() => openSchedule(s.id)} className="flex min-w-0 items-center gap-1.5 text-left text-meta text-warn">
                <TriangleAlert aria-hidden className="h-3.5 w-3.5 shrink-0" />
                <Truncate className="font-medium">Refill {s.title}</Truncate>
                <MetaLine as="span" className="shrink-0 tabular-nums" items={[
                  left.left <= 0 ? 'none left' : `${doseLabel(left.left, s.dose_unit, s.portion_label)} left`,
                  left.days != null && left.left > 0 && `≈ ${left.days} ${left.days === 1 ? 'day' : 'days'}`,
                ]} />
              </button>
            )
          })}
          {paused.map(s => (
            <div key={s.id} className="flex min-w-0 items-center gap-1.5 text-meta text-fg-muted">
              <PauseCircle aria-hidden className="h-3.5 w-3.5 shrink-0" />
              <button type="button" onClick={() => openSchedule(s.id)} className="min-w-0 text-left hover:text-fg">
                <Truncate>{s.title} paused{s.paused_until ? ` until ${formatDate(s.paused_until)}` : ''}</Truncate>
              </button>
              <button type="button" disabled={pause.isPending} onClick={() => pause.mutate({ id: s.id, ...resumePause(s, now.date) })}
                className={chipClass('quiet', 'ml-auto text-accent-600')}>Resume</button>
            </div>
          ))}
          {elsewhere.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-meta text-fg-muted">
              <span>Not on this day:</span>
              {elsewhere.map(s => (
                <button key={s.id} type="button" onClick={() => openSchedule(s.id)} title={repeatSummary(s)}
                  className={cx(chipClass('quiet'), 'h-7 max-w-[14rem]')}>
                  <Truncate>{s.title}</Truncate>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
