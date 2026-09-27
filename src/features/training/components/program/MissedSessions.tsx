import { useState } from 'react'
import { AlertTriangle, CalendarCheck, CalendarPlus, SkipForward, Undo2 } from 'lucide-react'
import { Button, Card, cx } from '../../../../shared/ui'
import { InfoBubble } from '../../../../shared/components/InfoBubble'
import { openPlanRoutine } from '../../planTraining'
import { useMissedSessions, useUndoTrainingSkip } from '../../hooks/useTrainingSkips'
import { OVERDUE_AFTER_DAYS, missedText, type RoutineAttention } from '../../plan/skippedRoutines'
import { plannedDayText, shortDay } from './missedSessionCopy'
import { SkipSessionSheet } from './SkipSessionSheet'

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

function Label() {
  return (
    <p className="section-label flex items-center gap-1.5">
      Missed sessions
      <InfoBubble>
        A current-program routine is flagged once it hasn&apos;t been logged for more than {OVERDUE_AFTER_DAYS} days and no
        one-off session is planned for it. It was due {OVERDUE_AFTER_DAYS} days after you last did it. <b>Plan it</b> on a day
        that works, or <b>skip</b> it with a reason: a skip covers that one session, and if the next one is missed too it is
        flagged again. A weekly repeat on your calendar doesn&apos;t count as a plan — it always has a next date.
      </InfoBubble>
    </p>
  )
}

function Row({ item, today, onSkip }: { item: RoutineAttention; today: string; onSkip: (a: RoutineAttention) => void }) {
  const undo = useUndoTrainingSkip()
  const icon = item.kind === 'overdue'
    ? <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
    : item.kind === 'skipped'
      ? <SkipForward aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-fg-muted" />
      : <CalendarCheck aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-info" />
  const detail = item.kind === 'overdue'
    ? `${capitalize(missedText(item))} · was due ${shortDay(item.dueDate)}`
    : item.kind === 'skipped'
      ? `Skipped the ${shortDay(item.dueDate)} session: ${item.skip.reason}`
      : `Replanned for ${plannedDayText(item.plannedDate, today)}`
  return (
    <li className={cx('flex flex-col gap-2 rounded-row px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3', item.kind === 'overdue' ? 'bg-warn-soft' : 'bg-surface-2')}>
      <div className="flex min-w-0 flex-1 items-start gap-2">
        {icon}
        <div className="min-w-0">
          <p className="break-words text-body font-semibold text-fg">{item.title}</p>
          <p className="break-words text-meta text-fg-2">{detail}</p>
        </div>
      </div>
      {item.kind === 'overdue' && (
        <div className="flex flex-wrap gap-2 pl-6 sm:shrink-0 sm:pl-0">
          <Button size="sm" icon={<CalendarPlus />} onClick={() => openPlanRoutine({ id: item.routineId, title: item.title }, { date: today })}>Plan it</Button>
          <Button size="sm" variant="ghost" icon={<SkipForward />} onClick={() => onSkip(item)}>Skip</Button>
        </div>
      )}
      {item.kind === 'skipped' && (
        <div className="pl-6 sm:shrink-0 sm:pl-0">
          <Button size="sm" variant="ghost" icon={<Undo2 />} loading={undo.isPending} onClick={() => undo.mutate(item.skip.id)}>Undo</Button>
        </div>
      )}
    </li>
  )
}

/** Overdue / skipped (/ replanned) current-program routines with their two
 *  answers — plan it or skip it with a reason. Renders nothing when there is
 *  nothing to say. */
export function MissedSessionsList({ items, today, className }: { items: readonly RoutineAttention[]; today: string; className?: string }) {
  const [skipping, setSkipping] = useState<RoutineAttention | null>(null)
  if (items.length === 0) return null
  return (
    <div className={cx('flex flex-col gap-2', className)}>
      <Label />
      <ul className="flex flex-col gap-2">
        {items.map(a => <Row key={a.routineId} item={a} today={today} onSkip={setSkipping} />)}
      </ul>
      <SkipSessionSheet item={skipping} onClose={() => setSkipping(null)} />
    </div>
  )
}

/** The Next tab's version: its own card, overdue and skipped only (a
 *  replanned session already shows up as the next planned one). */
export function MissedSessionsCard() {
  const { items, today } = useMissedSessions()
  const shown = items.filter(a => a.kind !== 'replanned')
  if (shown.length === 0) return null
  return (
    <Card className="max-w-2xl">
      <MissedSessionsList items={shown} today={today} />
    </Card>
  )
}
