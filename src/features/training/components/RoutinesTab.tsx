import { useState } from 'react'
import { format } from 'date-fns'
import { Dialog, DialogPanel, DialogBackdrop } from '@headlessui/react'
import { useHevyRoutines } from '../hooks/useHevyRoutines'
import { useCreateTask } from '../../todo/hooks/useTodos'
import { useCreateTimeBlock } from '../../daily/hooks/useSchedule'
import { toast } from '../../../app/store'
import type { HevyRoutine, HevyRoutineSet } from '../types.hevy'

const TODAY = format(new Date(), 'yyyy-MM-dd')

const SET_TYPE_BADGE: Record<HevyRoutineSet['type'], { label: string; cls: string }> = {
  warmup:  { label: 'W', cls: 'bg-accent-100 text-accent-700' },
  normal:  { label: 'N', cls: 'bg-ink-100 text-ink-600' },
  dropset: { label: 'D', cls: 'bg-blue-100 text-blue-700' },
  failure: { label: 'F', cls: 'bg-red-100 text-red-700' },
}

function SetBadge({ type }: { type: HevyRoutineSet['type'] }) {
  const { label, cls } = SET_TYPE_BADGE[type] ?? SET_TYPE_BADGE.normal
  return (
    <span className={`inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold ${cls}`}>
      {label}
    </span>
  )
}

function SetRow({ s }: { s: HevyRoutineSet }) {
  const parts: string[] = []
  if (s.weight_kg != null)      parts.push(`${s.weight_kg} kg`)
  if (s.reps != null)           parts.push(`${s.reps} reps`)
  else if (s.rep_range_start != null && s.rep_range_end != null)
    parts.push(`${s.rep_range_start}–${s.rep_range_end} reps`)
  if (s.rpe != null)            parts.push(`RPE ${s.rpe}`)
  if (s.duration_seconds != null) parts.push(`${s.duration_seconds}s`)
  if (s.distance_meters != null)  parts.push(`${s.distance_meters}m`)

  return (
    <div className="flex items-center gap-2 py-0.5">
      <SetBadge type={s.type} />
      <span className="text-xs text-ink-500">{parts.join(' · ') || '—'}</span>
    </div>
  )
}

// ─── Plan Dialog ──────────────────────────────────────────────────────────────

interface PlanDialogProps {
  routine:  HevyRoutine
  isOpen:   boolean
  onClose:  () => void
}

function PlanRoutineDialog({ routine, isOpen, onClose }: PlanDialogProps) {
  const [date, setDate] = useState(TODAY)
  const [startTime, setStartTime] = useState('07:00')

  const createTask      = useCreateTask()
  const createTimeBlock = useCreateTimeBlock()

  async function handleAddTask() {
    const tid = toast.loading('Adding task…')
    try {
      await createTask.mutateAsync({
        title:    routine.title,
        section:  'today',
        priority: 'medium',
        domain:   'personal',
        due_date: date || null,
      })
      toast.dismiss(tid)
      toast.success('Task added ✓')
      onClose()
    } catch (err) {
      toast.dismiss(tid)
      toast.error((err as Error).message ?? 'Failed')
    }
  }

  async function handleAddToSchedule() {
    const tid = toast.loading('Adding to schedule…')
    createTimeBlock.mutate(
      {
        date,
        title:            routine.title,
        start_time:       startTime ? `${startTime}:00` : null,
        duration_minutes: 60,
        color:            'accent',
        source_type:      'routine',
      },
      {
        onSuccess: () => {
          toast.dismiss(tid)
          toast.success('Added to schedule ✓')
          onClose()
        },
        onError: (err) => {
          toast.dismiss(tid)
          toast.error((err as Error).message ?? 'Failed')
        },
      }
    )
  }

  return (
    <Dialog open={isOpen} onClose={onClose} className="relative z-[60]">
      <DialogBackdrop
        transition
        className="fixed inset-0 bg-ink-900/30 transition duration-200 data-[closed]:opacity-0"
      />
      <div className="fixed inset-0 flex items-end sm:items-center justify-center p-0 sm:p-4">
        <DialogPanel
          transition
          className="w-full rounded-t-2xl sm:rounded-2xl sm:max-w-md max-h-[90vh] overflow-y-auto bg-white border border-ink-200 transition duration-200 data-[closed]:opacity-0 data-[closed]:translate-y-4 sm:data-[closed]:translate-y-0 sm:data-[closed]:scale-95"
        >
          <div className="flex items-center justify-between px-5 pt-5 pb-3">
            <h2 className="text-sm font-semibold text-ink-800">Plan: {routine.title}</h2>
            <button
              onClick={onClose}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-400 hover:text-ink-700 transition-colors text-xl leading-none"
            >
              ×
            </button>
          </div>

          <div className="px-5 pb-5 flex flex-col gap-4">
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-400 mb-1.5 block">
                  Date
                </label>
                <input
                  type="date"
                  value={date}
                  onChange={e => setDate(e.target.value)}
                  className="w-full min-h-[44px] bg-cream-50 border border-ink-200 rounded-xl px-3 py-2 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-accent-400"
                />
              </div>
              <div className="flex-1">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-400 mb-1.5 block">
                  Start time (schedule)
                </label>
                <input
                  type="time"
                  value={startTime}
                  onChange={e => setStartTime(e.target.value)}
                  className="w-full min-h-[44px] bg-cream-50 border border-ink-200 rounded-xl px-3 py-2 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-accent-400"
                />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={handleAddTask}
                disabled={createTask.isPending}
                className="w-full min-h-[44px] bg-accent-500 text-white rounded-xl text-sm font-medium hover:bg-accent-600 transition-colors disabled:opacity-50"
              >
                Add as task
              </button>
              <button
                type="button"
                onClick={handleAddToSchedule}
                disabled={createTimeBlock.isPending}
                className="w-full min-h-[44px] border border-ink-200 text-ink-700 rounded-xl text-sm font-medium hover:bg-cream-50 transition-colors disabled:opacity-50"
              >
                Add to today's schedule
              </button>
            </div>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  )
}

// ─── Routine Card ─────────────────────────────────────────────────────────────

function RoutineCard({ routine }: { routine: HevyRoutine }) {
  const [expanded, setExpanded] = useState(false)
  const [planOpen,  setPlanOpen]  = useState(false)

  const exerciseCount = routine.exercises?.length ?? 0
  const setCount      = routine.exercises?.reduce((acc, ex) => acc + (ex.sets?.length ?? 0), 0) ?? 0

  return (
    <div className="border border-ink-200 rounded-xl overflow-hidden">
      {/* Header row */}
      <div className="flex items-center justify-between px-4 py-3 min-h-[56px]">
        <button
          type="button"
          onClick={() => setExpanded(o => !o)}
          className="flex-1 flex flex-col items-start gap-0.5 min-w-0 text-left"
        >
          <span className="font-medium text-sm text-ink-900 truncate w-full">{routine.title}</span>
          <span className="text-xs text-ink-400">
            {routine.folder?.title && <span className="mr-2 text-accent-600">{routine.folder.title}</span>}
            {exerciseCount} exercise{exerciseCount !== 1 ? 's' : ''} · {setCount} sets
          </span>
        </button>
        <div className="flex items-center gap-2 shrink-0 pl-2">
          <button
            type="button"
            onClick={() => setPlanOpen(true)}
            className="min-h-[44px] px-3 text-xs font-medium border border-accent-400 text-accent-600 rounded-lg hover:bg-accent-50 transition-colors"
          >
            Plan
          </button>
          <span className="text-ink-400 text-xs w-4 text-center">{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {/* Expanded exercises */}
      {expanded && (
        <div className="border-t border-ink-100 bg-cream-50 px-4 py-3 flex flex-col gap-3">
          {(routine.exercises ?? []).map(ex => (
            <div key={ex.id}>
              <p className="text-xs font-semibold text-ink-700 mb-1">{ex.title}</p>
              <div className="flex flex-col gap-0.5 pl-2">
                {(ex.sets ?? []).map((s, i) => (
                  <SetRow key={s.id ?? i} s={s} />
                ))}
              </div>
              {ex.notes && (
                <p className="text-xs text-ink-400 italic mt-1">{ex.notes}</p>
              )}
            </div>
          ))}
          {exerciseCount === 0 && (
            <p className="text-xs text-ink-400 italic">No exercises</p>
          )}
        </div>
      )}

      <PlanRoutineDialog
        routine={routine}
        isOpen={planOpen}
        onClose={() => setPlanOpen(false)}
      />
    </div>
  )
}

// ─── RoutinesTab ──────────────────────────────────────────────────────────────

export function RoutinesTab() {
  const { data: routines = [], isLoading } = useHevyRoutines()

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-14 rounded-xl bg-cream-200 animate-pulse" />
        ))}
        <p className="text-sm text-ink-400 text-center pt-1">Loading routines…</p>
      </div>
    )
  }

  if (routines.length === 0) {
    return (
      <div className="text-center py-10 border border-dashed border-ink-200 rounded-xl">
        <p className="text-ink-400 text-sm">No routines yet — sync your Hevy data first</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-ink-400 italic">
        Synced from Hevy — read only (edits go to Hevy app)
      </p>
      {routines.map(r => (
        <RoutineCard key={r.id} routine={r} />
      ))}
    </div>
  )
}
