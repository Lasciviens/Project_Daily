import { useState } from 'react'
import { useHevyRoutines, useDeleteHevyRoutineLocal } from '../hooks/useHevyRoutines'
import { UnifiedPlanModal } from '../../../shared/components/plan-modal'
import { NewRoutineModal, EditRoutineModal } from './RoutineModals'
import type { HevyRoutine, HevyRoutineSet } from '../types.hevy'

// ─── Set chip display ─────────────────────────────────────────────────────────

function setLabel(s: HevyRoutineSet): string {
  const parts: string[] = []
  if (s.weight_kg != null)   parts.push(`${s.weight_kg}kg`)
  if (s.reps != null)        parts.push(`${s.reps}`)
  else if (s.rep_range_start != null && s.rep_range_end != null)
    parts.push(`${s.rep_range_start}–${s.rep_range_end}`)
  if (s.rpe != null)         parts.push(`RPE${s.rpe}`)
  if (s.duration_seconds != null) parts.push(`${s.duration_seconds}s`)
  if (s.distance_meters != null)  parts.push(`${s.distance_meters}m`)
  return parts.join('×') || '—'
}

const SET_TYPE_COLOR: Record<HevyRoutineSet['type'], string> = {
  warmup:  'bg-accent-100 text-accent-700',
  normal:  'bg-ink-100 text-ink-600',
  dropset: 'bg-blue-100 text-blue-700',
  failure: 'bg-red-100 text-red-700',
}

function SetChip({ s }: { s: HevyRoutineSet }) {
  return (
    <span
      className={`inline-flex items-center text-[11px] font-medium rounded-full px-2 py-0.5 ${SET_TYPE_COLOR[s.type] ?? SET_TYPE_COLOR.normal}`}
    >
      {setLabel(s)}
    </span>
  )
}

// ─── Routine Card ─────────────────────────────────────────────────────────────

const ACCENT_BORDERS = [
  'border-l-accent-500',
  'border-l-blue-400',
  'border-l-green-400',
  'border-l-purple-400',
  'border-l-pink-400',
]

interface RoutineCardProps {
  routine: HevyRoutine
  index:   number
  onEdit:  (r: HevyRoutine) => void
}

const EXERCISES_PREVIEW = 5

function RoutineCard({ routine, index, onEdit }: RoutineCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [showAllExercises, setShowAllExercises] = useState(false)
  const [planOpen,  setPlanOpen]  = useState(false)
  const deleteMutation = useDeleteHevyRoutineLocal()

  const exerciseCount = routine.exercises?.length ?? 0
  const setCount      = routine.exercises?.reduce((acc, ex) => acc + (ex.sets?.length ?? 0), 0) ?? 0
  const accentBorder  = ACCENT_BORDERS[index % ACCENT_BORDERS.length]

  function handleDelete() {
    if (!confirm(`Delete "${routine.title}" from your local data? This cannot be undone.`)) return
    deleteMutation.mutate(routine.id)
  }

  return (
    <div className={`border border-ink-200 border-l-4 ${accentBorder} rounded-xl overflow-hidden bg-cream-50`}>
      {/* Card header */}
      <div className="flex items-start gap-3 px-3 py-2.5">
        <button
          type="button"
          onClick={() => setExpanded(o => !o)}
          className="flex-1 flex flex-col items-start gap-1 min-w-0 text-left"
        >
          <span className="font-bold text-base text-ink-900 leading-tight">{routine.title}</span>
          <div className="flex items-center gap-2 flex-wrap">
            {routine.folder?.title && (
              <span className="text-[11px] font-semibold bg-accent-100 text-accent-700 rounded-full px-2 py-0.5">
                {routine.folder.title}
              </span>
            )}
            <span className="text-xs text-ink-500">
              {exerciseCount} exercise{exerciseCount !== 1 ? 's' : ''} · {setCount} sets
            </span>
          </div>
        </button>

        {/* Action buttons */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => setPlanOpen(true)}
            className="min-h-[44px] px-3 text-xs font-semibold border border-accent-400 text-accent-600 rounded-lg hover:bg-accent-50 transition-colors"
          >
            Plan
          </button>
          <button
            type="button"
            onClick={() => onEdit(routine)}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center text-ink-500 hover:text-ink-800 hover:bg-cream-50 rounded-lg transition-colors text-sm"
            title="Edit routine"
          >
            ✎
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleteMutation.isPending}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center text-ink-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors text-sm disabled:opacity-50"
            title="Delete from local data"
          >
            🗑
          </button>
          <button
            type="button"
            onClick={() => setExpanded(o => !o)}
            className="min-h-[44px] min-w-[36px] flex items-center justify-center text-ink-400 text-xs"
          >
            {expanded ? '▲' : '▼'}
          </button>
        </div>
      </div>

      {/* Expanded exercises */}
      {expanded && (
        <div className="border-t border-ink-100 bg-cream-50 px-3 py-2 flex flex-col gap-2">
          {exerciseCount === 0 ? (
            <p className="text-xs text-ink-400 italic">No exercises</p>
          ) : (
            <>
              {(routine.exercises ?? [])
                .slice(0, showAllExercises ? undefined : EXERCISES_PREVIEW)
                .map(ex => (
                  <div key={ex.id}>
                    <p className="text-xs font-bold text-ink-700 mb-1">{ex.title}</p>
                    <div className="flex flex-wrap gap-1 pl-2">
                      {(ex.sets ?? []).map((s, i) => (
                        <SetChip key={s.id ?? i} s={s} />
                      ))}
                    </div>
                    {ex.notes && (
                      <p className="text-xs text-ink-400 italic mt-1 pl-2">{ex.notes}</p>
                    )}
                  </div>
                ))}
              {exerciseCount > EXERCISES_PREVIEW && (
                <button
                  type="button"
                  onClick={() => setShowAllExercises(o => !o)}
                  className="text-xs text-accent-600 hover:text-accent-700 font-medium text-left min-h-[44px] flex items-center"
                >
                  {showAllExercises
                    ? '▲ Show less'
                    : `▼ Show all ${exerciseCount} exercises`}
                </button>
              )}
            </>
          )}
        </div>
      )}

      <UnifiedPlanModal
        open={planOpen}
        onClose={() => setPlanOpen(false)}
        config={{ tabs: ['schedule', 'task'], heading: 'Plan routine' }}
        defaults={{ title: routine.title, category: 'training', color: 'accent', alsoCreateTask: true }}
        source={{ sourceType: 'training_session', sourceId: routine.id, taskSourceType: 'training_session' }}
      />
    </div>
  )
}

// ─── RoutinesTab ──────────────────────────────────────────────────────────────

export function RoutinesTab() {
  const { data: routines = [], isLoading } = useHevyRoutines()
  const [newOpen,       setNewOpen]       = useState(false)
  const [editingRoutine, setEditingRoutine] = useState<HevyRoutine | null>(null)

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-16 rounded-xl bg-cream-200 animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-base font-bold text-ink-900">Routines</h3>
          <p className="text-xs text-ink-400">{routines.length} routine{routines.length !== 1 ? 's' : ''}</p>
        </div>
        <button
          type="button"
          onClick={() => setNewOpen(true)}
          className="min-h-[44px] px-4 bg-accent-600 text-white text-sm font-semibold rounded-xl hover:bg-accent-700 transition-colors flex items-center gap-1.5"
        >
          <span className="text-base leading-none">+</span>
          <span>New Routine</span>
        </button>
      </div>

      {routines.length === 0 ? (
        <div className="text-center py-14 border border-dashed border-ink-200 rounded-xl">
          <p className="text-2xl mb-2">📋</p>
          <p className="text-ink-600 font-medium text-sm">No routines yet</p>
          <p className="text-ink-400 text-xs mt-1">Sync from Hevy or create one here</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 items-start">
          {routines.map((r, i) => (
            <RoutineCard key={r.id} routine={r} index={i} onEdit={setEditingRoutine} />
          ))}
        </div>
      )}

      <NewRoutineModal isOpen={newOpen} onClose={() => setNewOpen(false)} />
      <EditRoutineModal routine={editingRoutine} onClose={() => setEditingRoutine(null)} />
    </>
  )
}
