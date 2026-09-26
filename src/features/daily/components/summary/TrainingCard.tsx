import { useState, useMemo } from 'react'
import { Dumbbell, Plus } from 'lucide-react'
import { Cell, CellHeader, CellLink } from './cellKit'
import { useTimeBlocks } from '../../hooks/useSchedule'
import { useHevyWorkouts } from '../../../training/hooks/useHevyWorkouts'
import { useHevyRoutines } from '../../../training/hooks/useHevyRoutines'
import { useEntityModal } from '../../../../shared/modals'
import { ToneDot, TonePill } from '../../../../shared/ui'
import { formatLocalDate } from '../../../../shared/utils/dateUtils'
import type { HevyRoutine } from '../../../training/types.hevy'

// Rest-day state now offers the actual routine list inline — picking one
// opens the same Plan modal RoutinesTab uses, prefilled for THIS day, so
// scheduling a session never requires leaving Daily.
export function TrainingCard({ date }: { date: string }) {
  const { data: blocks = [] } = useTimeBlocks(date)
  const { data: recent = [] } = useHevyWorkouts({ limit: 30 })
  const { data: routines = [] } = useHevyRoutines()

  const modal = useEntityModal()
  const [showPicker, setShowPicker] = useState(false)

  const planned = blocks.filter(b => b.category === 'training')
  const loggedToday = useMemo(
    () => recent.filter(w => w.start_time && formatLocalDate(new Date(w.start_time)) === date),
    [recent, date],
  )

  const planRoutine = (r: HevyRoutine) => modal.open({
    kind: 'time-block',
    config: { heading: 'Plan routine' },
    defaults: { title: r.title, date, category: 'training', color: 'accent', alsoCreateTask: true },
    source: { sourceType: 'training_session', sourceId: r.id, taskSourceType: 'training_session' },
    onSaved: () => setShowPicker(false),
  })

  return (
    <Cell>
      <CellHeader icon={<Dumbbell />} title="Training" action={<CellLink to="/training">Open</CellLink>} />

      {loggedToday.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {loggedToday.map(w => (
            <li key={w.id} className="flex items-center gap-2 text-body">
              <ToneDot tone="success" />
              <span className="flex-1 truncate text-fg">{w.title || 'Workout'}</span>
              <TonePill tone="success">Done</TonePill>
            </li>
          ))}
        </ul>
      ) : planned.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {planned.map(b => (
            <div key={b.id} className="flex items-center gap-2 text-body">
              <ToneDot tone="accent" />
              <span className="flex-1 truncate text-fg">{b.title}</span>
              {b.start_time && <span className="shrink-0 text-meta tabular-nums text-fg-muted">{b.start_time.slice(0, 5)}</span>}
            </div>
          ))}
          <p className="mt-0.5 text-meta text-fg-muted">Planned — not logged yet</p>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <p className="text-body text-fg-muted">Rest day — nothing planned.</p>
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
                    onClick={() => planRoutine(r)}
                    className="row row-interactive w-full border border-line text-left"
                  >
                    <span className="flex-1 truncate text-body font-medium text-fg">{r.title}</span>
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
