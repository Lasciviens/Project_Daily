import { useState } from 'react'
import { useHevyRoutines, useDeleteHevyRoutineLocal } from '../hooks/useHevyRoutines'
import { CalendarPlus, ChevronDown, ClipboardList, Pencil, Plus, Trash2 } from 'lucide-react'
import { Button, Card, EmptyState, IconButton, Skeleton, TonePill } from '../../../shared/ui'
import { SET_TYPE_META } from '../setTypeMeta'
import { entityModal } from '../../../shared/modals'
import { NewRoutineModal, EditRoutineModal } from './RoutineModals'
import { ExerciseThumb } from '../exerciseMedia'
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

function SetChip({ s }: { s: HevyRoutineSet }) {
  if (s.type === 'normal' || !SET_TYPE_META[s.type]) return <span className="chip tabular-nums">{setLabel(s)}</span>
  const meta = SET_TYPE_META[s.type]
  return <TonePill tone={meta.tone} className="tabular-nums"><span className="sr-only">{meta.label}: </span>{setLabel(s)}</TonePill>
}

// ─── Routine Card ─────────────────────────────────────────────────────────────

const EXERCISES_PREVIEW = 5

function RoutineCard({ routine, onEdit }: { routine: HevyRoutine; onEdit: (r: HevyRoutine) => void }) {
  const [expanded, setExpanded] = useState(false)
  const [showAllExercises, setShowAllExercises] = useState(false)
  const deleteMutation = useDeleteHevyRoutineLocal()

  const exerciseCount = routine.exercises?.length ?? 0
  const setCount      = routine.exercises?.reduce((acc, ex) => acc + (ex.sets?.length ?? 0), 0) ?? 0

  async function handleDelete() {
    const ok = await entityModal.confirm({ title: `Delete "${routine.title}"?`, message: 'This removes it from your local data and cannot be undone.', confirmLabel: 'Delete', destructive: true })
    if (!ok) return
    deleteMutation.mutate(routine.id)
  }

  function plan() {
    entityModal.open({
      kind: 'time-block',
      config: { heading: 'Plan routine' },
      defaults: { title: routine.title, category: 'training', color: 'accent', alsoCreateTask: true },
      source: { sourceType: 'training_session', sourceId: routine.id, taskSourceType: 'training_session' },
    })
  }

  return (
    <Card padded={false} className="overflow-hidden">
      <div className="flex items-start gap-2 py-2 pl-4 pr-2">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded(o => !o)}
          className="flex min-h-[44px] min-w-0 flex-1 flex-col items-start justify-center gap-1 text-left"
        >
          <span className="text-lead font-semibold leading-tight text-fg">{routine.title}</span>
          <span className="flex flex-wrap items-center gap-2">
            {routine.folder?.title && <span className="chip">{routine.folder.title}</span>}
            <span className="text-meta tabular-nums text-fg-muted">
              {exerciseCount} exercise{exerciseCount !== 1 ? 's' : ''} · {setCount} sets
            </span>
          </span>
        </button>

        <div className="flex shrink-0 items-center gap-0.5">
          <Button size="sm" icon={<CalendarPlus />} onClick={plan}>Plan</Button>
          <IconButton label="Edit routine" onClick={() => onEdit(routine)}><Pencil /></IconButton>
          <IconButton
            label="Delete from local data"
            onClick={handleDelete}
            disabled={deleteMutation.isPending}
            className="hover:!bg-danger-soft hover:!text-danger disabled:opacity-50"
          >
            <Trash2 />
          </IconButton>
          <IconButton label={expanded ? 'Collapse' : 'Expand'} onClick={() => setExpanded(o => !o)}>
            <ChevronDown className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </IconButton>
        </div>
      </div>

      {expanded && (
        <div className="flex flex-col gap-2 border-t border-line px-3 py-3">
          {exerciseCount === 0 ? (
            <p className="text-meta italic text-fg-muted">No exercises</p>
          ) : (
            <>
              {(routine.exercises ?? [])
                .slice(0, showAllExercises ? undefined : EXERCISES_PREVIEW)
                .map((ex, exIdx) => (
                  <div key={ex.id} className="flex items-start gap-2.5 rounded-row border border-line bg-surface-2 px-2.5 py-2">
                    <ExerciseThumb title={ex.title} templateId={ex.exercise_template_id} size={52} />
                    <div className="min-w-0 flex-1">
                      <p className="text-body font-semibold leading-snug text-fg">
                        <span className="mr-1 tabular-nums text-fg-faint">{exIdx + 1}.</span>
                        {ex.title}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {(ex.sets ?? []).map((s, i) => <SetChip key={s.id ?? i} s={s} />)}
                      </div>
                      {ex.notes && <p className="mt-1 text-meta italic text-fg-muted">{ex.notes}</p>}
                    </div>
                  </div>
                ))}
              {exerciseCount > EXERCISES_PREVIEW && (
                <button
                  type="button"
                  onClick={() => setShowAllExercises(o => !o)}
                  className="flex min-h-[44px] items-center gap-1 text-left text-meta font-semibold text-accent-600"
                >
                  <ChevronDown aria-hidden className={`h-3.5 w-3.5 transition-transform ${showAllExercises ? 'rotate-180' : ''}`} />
                  {showAllExercises ? 'Show less' : `Show all ${exerciseCount} exercises`}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </Card>
  )
}

// ─── RoutinesTab ──────────────────────────────────────────────────────────────

export function RoutinesTab() {
  const { data: routines = [], isLoading } = useHevyRoutines()
  const [newOpen,       setNewOpen]       = useState(false)
  const [editingRoutine, setEditingRoutine] = useState<HevyRoutine | null>(null)

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} rounded="rounded-card" className="h-[72px]" />)}
      </div>
    )
  }

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-lead font-semibold text-fg">Routines</h3>
          <p className="text-meta tabular-nums text-fg-muted">{routines.length} routine{routines.length !== 1 ? 's' : ''}</p>
        </div>
        <Button variant="primary" icon={<Plus />} onClick={() => setNewOpen(true)}>New routine</Button>
      </div>

      {routines.length === 0 ? (
        <EmptyState bordered icon={<ClipboardList />} title="No routines yet" description="Sync from Hevy or create one here." />
      ) : (
        <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-2">
          {routines.map(r => <RoutineCard key={r.id} routine={r} onEdit={setEditingRoutine} />)}
        </div>
      )}

      <NewRoutineModal isOpen={newOpen} onClose={() => setNewOpen(false)} />
      <EditRoutineModal routine={editingRoutine} onClose={() => setEditingRoutine(null)} />
    </>
  )
}
