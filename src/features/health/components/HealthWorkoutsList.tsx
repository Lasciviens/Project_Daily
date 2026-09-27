import { useState } from 'react'
import { ChevronDown, ChevronRight, Smartphone } from 'lucide-react'
import { Card, EmptyState, Skeleton } from '../../../shared/ui'
import { fmtDateEnGB } from '../../../shared/utils/enGBDate'
import { useHealthWorkoutSummaries } from '../hooks/useHealthExport'
import type { HealthWorkoutSummary } from '../api/healthApi'
import type { HealthWindow } from '../healthWindowStats'
import { HealthWorkoutDetail } from './HealthWorkoutDetail'
import { fmtDuration } from './healthFormat'

function fmtStart(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return fmtDateEnGB(d, sameYear ? { weekday: 'short', day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' })
}

function HealthWorkoutRow({ workout, onOpen }: { workout: HealthWorkoutSummary; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex min-h-[60px] w-full items-center gap-2 rounded-row border border-line bg-surface py-2.5 pl-3 pr-2 text-left transition-colors hover:bg-surface-hover"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start justify-between gap-3">
          <span className="truncate text-body font-semibold text-fg">{workout.name}</span>
          <span className="shrink-0 whitespace-nowrap text-body font-semibold tabular-nums text-fg-2">{fmtDuration(workout.duration_seconds)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-meta tabular-nums text-fg-muted">{fmtStart(workout.start_time)}</span>
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
// columns only; a workout's HR curve and route load when it's opened (H-07).
export function HealthWorkoutsList({ win }: { win: HealthWindow }) {
  const [expanded, setExpanded] = useState(false)
  const [selected, setSelected] = useState<HealthWorkoutSummary | null>(null)
  const { data: workouts = [], isLoading } = useHealthWorkoutSummaries(win.from, win.to)
  return (
    <Card padded={false} className="max-w-3xl overflow-hidden">
      <button type="button" aria-expanded={expanded} onClick={() => setExpanded(e => !e)}
        className="flex min-h-[44px] w-full items-center justify-between px-4 py-2">
        <p className="section-label">Workouts (Apple Health){!isLoading && ` · ${workouts.length}`}</p>
        <ChevronDown aria-hidden className={`h-4 w-4 text-fg-faint transition-transform ${expanded ? 'rotate-180' : ''}`} />
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
            <div className="flex flex-col gap-1.5">
              {workouts.map(w => <HealthWorkoutRow key={w.id} workout={w} onOpen={() => setSelected(w)} />)}
            </div>
          )}
        </div>
      )}
      {selected && <HealthWorkoutDetail summary={selected} onClose={() => setSelected(null)} />}
    </Card>
  )
}
