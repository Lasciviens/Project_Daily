import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useTimeBlocks } from '../../hooks/useSchedule'
import { useHevyWorkouts } from '../../../training/hooks/useHevyWorkouts'
import { useHevyRoutines } from '../../../training/hooks/useHevyRoutines'
import { UnifiedPlanModal } from '../../../../shared/components/plan-modal'
import { formatLocalDate } from '../../../../shared/utils/dateUtils'
import type { HevyRoutine } from '../../../training/types.hevy'

// Rest-day state now offers the actual routine list inline — picking one
// opens the same Plan modal RoutinesTab uses, prefilled for THIS day, so
// scheduling a session never requires leaving Daily.
export function TrainingCard({ date }: { date: string }) {
  const { data: blocks = [] } = useTimeBlocks(date)
  const { data: recent = [] } = useHevyWorkouts({ limit: 30 })
  const { data: routines = [] } = useHevyRoutines()

  const [showPicker, setShowPicker] = useState(false)
  const [planning, setPlanning] = useState<HevyRoutine | null>(null)

  const planned = blocks.filter(b => b.category === 'training')
  const loggedToday = useMemo(
    () => recent.filter(w => w.start_time && formatLocalDate(new Date(w.start_time)) === date),
    [recent, date],
  )

  return (
    <div className="rounded-2xl border border-ink-200 bg-cream-50 p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-ink-800 flex items-center gap-1.5">💪 Training</h3>
        <Link to="/training" className="text-[11px] text-accent-600 hover:text-accent-700 min-h-[28px] px-1.5 flex items-center">
          Open →
        </Link>
      </div>

      {loggedToday.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {loggedToday.map(w => (
            <div key={w.id} className="flex items-center gap-2 text-sm">
              <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
              <span className="text-ink-800 flex-1 truncate">{w.title || 'Workout'}</span>
              <span className="text-[11px] text-green-600 font-medium shrink-0">Done ✓</span>
            </div>
          ))}
        </div>
      ) : planned.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {planned.map(b => (
            <div key={b.id} className="flex items-center gap-2 text-sm">
              <span className="w-2 h-2 rounded-full bg-accent-500 shrink-0" />
              <span className="text-ink-800 flex-1 truncate">{b.title}</span>
              {b.start_time && <span className="text-[11px] text-ink-400 shrink-0">{b.start_time.slice(0, 5)}</span>}
            </div>
          ))}
          <p className="text-[11px] text-ink-400 mt-0.5">Planned — not logged yet</p>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5 py-0.5">
          <p className="text-sm text-ink-500">Rest day — nothing planned.</p>
          {!showPicker ? (
            <button
              onClick={() => setShowPicker(true)}
              className="text-xs text-accent-600 hover:text-accent-700 text-left min-h-[28px]"
            >
              + Plan a routine for this day
            </button>
          ) : routines.length === 0 ? (
            <p className="text-xs text-ink-400">No Hevy routines yet — create one in Training.</p>
          ) : (
            <ul className="flex flex-col gap-1 max-h-40 overflow-y-auto">
              {routines.map(r => (
                <li key={r.id}>
                  <button
                    onClick={() => setPlanning(r)}
                    className="w-full flex items-center gap-2 text-left text-xs px-2 py-1.5 rounded-lg border border-ink-200 hover:border-accent-300 transition-colors min-h-[32px]"
                  >
                    <span className="text-ink-800 font-medium flex-1 truncate">{r.title}</span>
                    <span className="text-ink-400 shrink-0">
                      {r.exercises?.length ?? 0} ex
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {planning && (
        <UnifiedPlanModal
          open
          onClose={() => setPlanning(null)}
          config={{ tabs: ['schedule', 'task'], heading: 'Plan routine' }}
          defaults={{ title: planning.title, date, category: 'training', color: 'accent', alsoCreateTask: true }}
          source={{ sourceType: 'training_session', sourceId: planning.id, taskSourceType: 'training_session' }}
          onSaved={() => { setPlanning(null); setShowPicker(false) }}
        />
      )}
    </div>
  )
}
