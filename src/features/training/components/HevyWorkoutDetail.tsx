import { Dialog, DialogPanel, DialogBackdrop } from '@headlessui/react'
import { useHevyWorkoutDetail } from '../hooks/useHevyWorkouts'
import type { HevySet } from '../types.hevy'

interface Props {
  workoutId: string | null
  onClose: () => void
}

function fmtDuration(start: string | null, end: string | null): string {
  if (!start || !end) return '—'
  const mins = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000)
  if (mins < 60) return `${mins}m`
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) +
    ' · ' +
    d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

const SET_TYPE_CONFIG: Record<HevySet['type'], { label: string; className: string }> = {
  warmup:  { label: 'W', className: 'bg-ink-100 text-ink-500' },
  normal:  { label: 'N', className: 'bg-accent-100 text-accent-700' },
  dropset: { label: 'D', className: 'bg-ink-800 text-white' },
  failure: { label: 'F', className: 'bg-red-100 text-red-600' },
}

function SetTypeBadge({ type }: { type: HevySet['type'] }) {
  const cfg = SET_TYPE_CONFIG[type] ?? SET_TYPE_CONFIG.normal
  return (
    <span className={`inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold ${cfg.className}`}>
      {cfg.label}
    </span>
  )
}

export function HevyWorkoutDetail({ workoutId, onClose }: Props) {
  const { data: workout, isLoading } = useHevyWorkoutDetail(workoutId)

  return (
    <Dialog open={!!workoutId} onClose={onClose} className="relative z-[60]">
      <DialogBackdrop
        transition
        className="fixed inset-0 bg-ink-900/30 transition duration-200 data-[closed]:opacity-0"
      />
      <div className="fixed inset-0 flex items-end sm:items-center justify-center p-0 sm:p-4">
        <DialogPanel
          transition
          className="w-full rounded-t-2xl sm:rounded-2xl sm:max-w-lg max-h-[90vh] overflow-y-auto bg-white border border-ink-200 transition duration-200 data-[closed]:opacity-0 data-[closed]:translate-y-4 sm:data-[closed]:translate-y-0 sm:data-[closed]:scale-95"
        >
          <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3 border-b border-ink-100">
            <div className="flex flex-col gap-0.5 min-w-0">
              <h2 className="text-base font-semibold text-ink-900 truncate">
                {workout?.title ?? '—'}
              </h2>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-ink-400">
                <span>{fmtDateTime(workout?.start_time ?? null)}</span>
                <span>{fmtDuration(workout?.start_time ?? null, workout?.end_time ?? null)}</span>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-400 hover:text-ink-700 transition-colors duration-150 text-xl leading-none shrink-0"
            >
              ×
            </button>
          </div>

          <div className="px-5 py-4 flex flex-col gap-6">
            {isLoading && (
              <p className="text-sm text-ink-400 py-4 text-center">Loading…</p>
            )}

            {!isLoading && workout && (
              <>
                {(!workout.exercises || workout.exercises.length === 0) && (
                  <p className="text-sm text-ink-400 py-4 text-center">No exercise data</p>
                )}

                {workout.exercises
                  ?.slice()
                  .sort((a, b) => a.index - b.index)
                  .map((ex) => (
                    <div key={ex.id} className="flex flex-col gap-2">
                      <div>
                        <h3 className="text-sm font-semibold text-ink-900">{ex.title}</h3>
                        {ex.notes && (
                          <p className="text-[12px] text-ink-400 mt-0.5">{ex.notes}</p>
                        )}
                      </div>

                      {ex.sets && ex.sets.length > 0 && (
                        <div className="overflow-x-auto -mx-1">
                          <table className="w-full text-xs min-w-[280px]">
                            <thead>
                              <tr className="text-[10px] font-semibold uppercase tracking-wider text-ink-400">
                                <th className="text-left py-1.5 px-1 w-6">#</th>
                                <th className="text-left py-1.5 px-1 w-8">Type</th>
                                <th className="text-left py-1.5 px-1">Weight × Reps</th>
                                <th className="text-left py-1.5 px-1">RPE</th>
                              </tr>
                            </thead>
                            <tbody>
                              {ex.sets
                                .slice()
                                .sort((a, b) => a.index - b.index)
                                .map((set) => (
                                  <tr key={set.id} className="border-t border-ink-50">
                                    <td className="py-1.5 px-1 text-ink-400">{set.index + 1}</td>
                                    <td className="py-1.5 px-1">
                                      <SetTypeBadge type={set.type} />
                                    </td>
                                    <td className="py-1.5 px-1 text-ink-700">
                                      {set.weight_kg !== null ? `${set.weight_kg} kg` : '—'}
                                      {' × '}
                                      {set.reps !== null ? set.reps : '—'}
                                    </td>
                                    <td className="py-1.5 px-1 text-ink-400">
                                      {set.rpe !== null ? `RPE ${set.rpe}` : '—'}
                                    </td>
                                  </tr>
                                ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  ))}
              </>
            )}
          </div>

          <div className="px-5 pb-5">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary w-full sm:w-auto min-h-[44px]"
            >
              Close
            </button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  )
}
