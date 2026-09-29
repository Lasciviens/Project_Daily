import { useState, useMemo } from 'react'
import { formatWeekdayDate } from '../../../../shared/utils/dateFormat'
import { ChevronRight, Dumbbell, Plus } from 'lucide-react'
import { Cell, CellHeader, CellLink } from './cellKit'
import { useTrainingBlocks, useScheduleBlocks } from '../../hooks/useSchedule'
import { projectRecurringBlocksForDay } from '../dayAgendaProjection'
import { useHevyWorkoutsRange } from '../../../training/hooks/useHevyWorkouts'
import { useHevyRoutines } from '../../../training/hooks/useHevyRoutines'
import { NEXT_SESSION_LOOKAHEAD_DAYS } from '../../../training/hooks/useTrainingSessions'
import { pickNextTrainingSession } from '../../../training/trainingPlanModel'
import { openPlanRoutine } from '../../../training/planTraining'
import { ToneDot, TonePill, Truncate } from '../../../../shared/ui'
import { useEntityModal } from '../../../../shared/modals'
import { shiftDateStr, todayStr } from '../../../../shared/utils/dateUtils'

interface PlannedRow {
  id: string
  title: string
  time: string | null
  recurring: boolean
  /** The session popup's request: the block, or the template on this day. */
  ref: { kind: 'block' | 'recurring'; id: string; date: string }
}

const ROW = 'row row-interactive -mx-3 w-[calc(100%+1.5rem)] gap-2 text-left'

const hhmm = (hour: number) => {
  const h = Math.floor(hour), m = Math.round((hour - h) * 60)
  return `${String(h + Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

// The viewed day's training: what was logged (Hevy, filed under the LOCAL day
// it was performed), else what is planned — one-off training blocks AND the
// recurring training templates that fall on this day — else a rest day that
// names the next planned session (the same pickNextTrainingSession rule the
// Training banner and Home use) and offers the routine list inline; picking
// one opens the shared "plan routine" request prefilled for this day.
export function TrainingCard({ date }: { date: string }) {
  const lookaheadTo = shiftDateStr(date, NEXT_SESSION_LOOKAHEAD_DAYS)
  const { data: trainingBlocks = [] } = useTrainingBlocks(date, lookaheadTo)
  const { data: templates = [] } = useScheduleBlocks()
  const { data: loggedToday = [] } = useHevyWorkoutsRange(date, date)
  const { data: routines = [] } = useHevyRoutines()
  const [showPicker, setShowPicker] = useState(false)
  // A row opens the session (what was lifted, or the plan's exercises and
  // targets); changing the plan is behind that popup's ⋯.
  const modal = useEntityModal()

  const trainingTemplates = useMemo(() => templates.filter(t => t.category === 'training'), [templates])

  const planned: PlannedRow[] = useMemo(() => [
    ...trainingBlocks.filter(b => b.date === date)
      .map(b => ({ id: b.id, title: b.title, time: b.start_time?.slice(0, 5) ?? null, recurring: false, ref: { kind: 'block' as const, id: b.id, date } })),
    ...projectRecurringBlocksForDay(date, new Date(`${date}T00:00:00`).getDay(), trainingTemplates)
      .filter(p => !p.spillover)
      .map(p => ({ id: `${p.canonicalId}__${date}`, title: p.title, time: hhmm(p.startHour), recurring: true, ref: { kind: 'recurring' as const, id: p.canonicalId, date } })),
  ].sort((a, b) => (a.time ?? '99:99').localeCompare(b.time ?? '99:99')), [trainingBlocks, trainingTemplates, date])

  // Only needed on a rest day: the next session after the viewed day.
  const next = useMemo(() => planned.length ? null : pickNextTrainingSession({
    blocks: trainingBlocks, templates: trainingTemplates, today: shiftDateStr(date, 1), nowHHMM: '00:00',
    lookaheadDays: NEXT_SESSION_LOOKAHEAD_DAYS - 1,
  }), [planned.length, trainingBlocks, trainingTemplates, date])

  return (
    <Cell>
      <CellHeader icon={<Dumbbell />} title="Training" action={<CellLink to="/training">Open</CellLink>} />

      {loggedToday.length > 0 ? (
        <ul className="flex flex-col">
          {loggedToday.map(w => (
            <li key={w.id}>
              <button type="button" className={ROW} onClick={() => modal.open({ kind: 'training-session', workoutId: w.id })}>
                <ToneDot tone="success" />
                <Truncate className="flex-1 text-body text-fg">{w.title || 'Workout'}</Truncate>
                <TonePill tone="success">Done</TonePill>
                <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-fg-faint" />
              </button>
            </li>
          ))}
        </ul>
      ) : planned.length > 0 ? (
        <div className="flex flex-col">
          {planned.map(b => (
            <button key={b.id} type="button" className={ROW} onClick={() => modal.open({ kind: 'training-session', plan: b.ref })}>
              <ToneDot tone="accent" />
              <Truncate className="flex-1 text-body text-fg">{`${b.recurring ? '⟳ ' : ''}${b.title}`}</Truncate>
              {b.time && <span className="shrink-0 text-meta tabular-nums text-fg-muted">{b.time}</span>}
              <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-fg-faint" />
            </button>
          ))}
          <p className="mt-0.5 text-meta text-fg-muted">
            {date < todayStr() ? 'Planned — nothing logged' : 'Planned — not logged yet'}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <p className="text-body text-fg-muted">
            Rest day — nothing planned.
            {next && <> Next: <span className="text-fg-2">{next.title}</span> · {formatWeekdayDate(next.date)}{next.startTime ? ` ${next.startTime}` : ''}</>}
          </p>
          {!showPicker ? (
            <button
              type="button"
              onClick={() => setShowPicker(true)}
              className="flex min-h-[44px] items-center gap-1.5 text-left text-body font-medium text-accent-600 hover:text-accent-700"
            >
              <Plus className="h-4 w-4" aria-hidden /> Plan a routine for this day
            </button>
          ) : routines.length === 0 ? (
            <p className="text-body text-fg-muted">No Hevy routines yet — create one in Training.</p>
          ) : (
            <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto">
              {routines.map(r => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => openPlanRoutine(r, { date, onSaved: () => setShowPicker(false) })}
                    className="row row-interactive w-full border border-line text-left"
                  >
                    <Truncate className="flex-1 text-body font-medium text-fg">{r.title}</Truncate>
                    <span className="shrink-0 text-meta tabular-nums text-fg-muted">{r.exercises?.length ?? 0} ex</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Cell>
  )
}
