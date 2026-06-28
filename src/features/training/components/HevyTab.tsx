import { useState } from 'react'
import { useHevyWorkouts } from '../hooks/useHevyWorkouts'
import { HevySyncButton } from './HevySyncButton'
import { HevyWorkoutCard } from './HevyWorkoutCard'
import { HevyWorkoutDetail } from './HevyWorkoutDetail'
import { HevyPRList } from './HevyPRList'

const PAGE_SIZE = 20

export function HevyTab() {
  const [page, setPage] = useState(0)
  const [selectedWorkoutId, setSelectedWorkoutId] = useState<string | null>(null)
  const [prOpen, setPrOpen] = useState(false)

  const { data: workouts = [], isLoading } = useHevyWorkouts({
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  })

  return (
    <div className="flex flex-col gap-5">
      {/* Sync controls */}
      <HevySyncButton />

      {/* Personal Records collapsible section */}
      <div className="border border-ink-100 rounded-xl overflow-hidden">
        <button
          type="button"
          onClick={() => setPrOpen(o => !o)}
          className="w-full flex items-center justify-between px-4 py-3 min-h-[44px] text-sm font-semibold text-ink-800 hover:bg-cream-50 transition-colors duration-150"
        >
          <span>Personal Records</span>
          <span className="text-ink-400 text-xs">{prOpen ? '▲' : '▼'}</span>
        </button>

        {prOpen && (
          <div className="px-4 pb-4 border-t border-ink-100">
            <HevyPRList />
          </div>
        )}
      </div>

      {/* Workout list */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 rounded-xl bg-cream-200 animate-pulse" />
          ))}
          <p className="text-sm text-ink-400 text-center pt-1">Loading workouts…</p>
        </div>
      ) : workouts.length === 0 ? (
        <div className="text-center py-10 border border-dashed border-ink-200 rounded-xl">
          <p className="text-ink-400 text-sm">No workouts yet — click Sync all to import your Hevy data</p>
        </div>
      ) : (
        <div className="space-y-2">
          {workouts.map(workout => (
            <HevyWorkoutCard
              key={workout.id}
              workout={workout}
              onClick={() => setSelectedWorkoutId(workout.id)}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {!isLoading && (
        <div className="flex gap-2 justify-between">
          {page > 0 ? (
            <button
              type="button"
              onClick={() => setPage(p => p - 1)}
              className="min-h-[44px] px-4 text-sm border border-ink-200 rounded-xl text-ink-600 hover:bg-ink-50 transition-colors duration-150"
            >
              ← Previous
            </button>
          ) : (
            <div />
          )}

          {workouts.length === PAGE_SIZE ? (
            <button
              type="button"
              onClick={() => setPage(p => p + 1)}
              className="min-h-[44px] px-4 text-sm border border-ink-200 rounded-xl text-ink-600 hover:bg-ink-50 transition-colors duration-150"
            >
              Next →
            </button>
          ) : (
            <div />
          )}
        </div>
      )}

      {/* Workout detail modal */}
      <HevyWorkoutDetail
        workoutId={selectedWorkoutId}
        onClose={() => setSelectedWorkoutId(null)}
      />
    </div>
  )
}
