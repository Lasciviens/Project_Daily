import { useState } from 'react'
import { ChevronDown, ChevronRight, Dumbbell, Smartphone } from 'lucide-react'
import { Card, EmptyState, Skeleton } from '../../../shared/ui'
import { useEntityModal } from '../../../shared/modals'
import { fmtDateEnGB } from '../../../shared/utils/enGBDate'
import { useHealthWorkoutSummaries } from '../hooks/useHealthExport'
import { useHevyMatches } from '../hooks/useWorkoutLinks'
import type { HealthWorkoutSummary } from '../api/healthApi'
import type { HealthWindow } from '../healthWindowStats'
import { fmtDuration } from './healthFormat'

function fmtStart(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return fmtDateEnGB(d, sameYear ? { weekday: 'short', day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' })
}

function HealthWorkoutRow({ workout, hevyTitle, onOpen }: { workout: HealthWorkoutSummary; hevyTitle?: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      className="flex min-h-[60px] w-full items-center gap-2 rounded-row border border-line bg-surface py-2.5 pl-3 pr-2 text-left transition-colors hover:bg-surface-hover"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start justify-between gap-3">
          <span className="truncate text-body font-semibold text-fg">{workout.name}</span>
          <span className="shrink-0 whitespace-nowrap text-body font-semibold tabular-nums text-fg-2">{fmtDuration(workout.duration_seconds)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-meta tabular-nums text-fg-muted">{fmtStart(workout.start_time)}</span>
          {hevyTitle && (
            <span className="chip min-w-0 max-w-full gap-1">
              <Dumbbell aria-hidden className="h-3 w-3 shrink-0" />
              <span className="truncate">Hevy · {hevyTitle}</span>
            </span>
          )}
          {workout.avg_heart_rate != null && <span className="chip tabular-nums">avg {Math.round(workout.avg_heart_rate)} bpm</span>}
          {/* HAE sends workout energy in kcal despite the column being named *_kj. */}
          {workout.active_energy_kj != null && <span className="chip tabular-nums">{Math.round(workout.active_energy_kj)} kcal</span>}
        </div>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-fg-faint" aria-hidden />
    </button>
  )
}

// Workouts that started inside the selected window. The list reads summary
// columns only; a workout's HR curve and route load when it's opened (the
// `health-workout` popup). One Hevy range read marks the rows that have a
// Hevy session logged at the same time.
export function HealthWorkoutsList({ win }: { win: HealthWindow }) {
  const modal = useEntityModal()
  const [expanded, setExpanded] = useState(true)
  const { data: workouts = [], isLoading } = useHealthWorkoutSummaries(win.from, win.to)
  const hevy = useHevyMatches(win.from, win.to, workouts)
  const linked = hevy.size
  return (
    <Card padded={false} className="@container overflow-hidden">
      <button type="button" aria-expanded={expanded} onClick={() => setExpanded(e => !e)}
        className="flex min-h-[44px] w-full items-center justify-between gap-2 px-4 py-2 text-left">
        <p className="section-label">
          Workouts (Apple Health){!isLoading && ` · ${workouts.length}`}
          {linked > 0 && <span className="normal-case tracking-normal text-fg-faint"> · {linked} with a Hevy session</span>}
        </p>
        <ChevronDown aria-hidden className={`h-4 w-4 shrink-0 text-fg-faint transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded && (
        <div className="px-4 pb-4">
          {isLoading ? (
            <div className="space-y-1.5">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} rounded="rounded-row" className="h-[60px]" />)}
            </div>
          ) : workouts.length === 0 ? (
            <EmptyState bordered icon={<Smartphone />} title="No workouts in this window" className="py-10" />
          ) : (
            // Rows form columns by the card's own width (it spans the board on a wide page).
            // grid-cols-1 = minmax(0,1fr): an implicit auto track grows to a long title's min-content.
            <div className="grid grid-cols-1 gap-1.5 @[46rem]:grid-cols-2 @[72rem]:grid-cols-3 @[98rem]:grid-cols-4 @[124rem]:grid-cols-5">
              {workouts.map(w => (
                <HealthWorkoutRow key={w.id} workout={w} hevyTitle={hevy.get(w.id)?.title}
                  onOpen={() => modal.open({ kind: 'health-workout', id: w.id })} />
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
