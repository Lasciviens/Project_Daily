import { useState } from 'react'
import { useHevyWorkouts } from '../hooks/useHevyWorkouts'
import { HevySyncButton } from './HevySyncButton'
import { HevyWorkoutCard } from './HevyWorkoutCard'
import { HevyWorkoutDetail } from './HevyWorkoutDetail'
import { HevyPRList } from './HevyPRList'
import { RoutinesTab } from './RoutinesTab'
import { BodyMeasurementsTab } from './BodyMeasurementsTab'
import { ExerciseTemplatesTab } from './ExerciseTemplatesTab'

type SubTab = 'workouts' | 'routines' | 'prs' | 'body' | 'templates'

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: 'workouts',  label: 'Workouts'   },
  { id: 'routines',  label: 'Routines'   },
  { id: 'prs',       label: 'PRs'        },
  { id: 'body',      label: 'Body'       },
  { id: 'templates', label: 'Templates'  },
]

const PAGE_SIZE = 20

function WorkoutsSubTab() {
  const [page, setPage] = useState(0)
  const [selectedWorkoutId, setSelectedWorkoutId] = useState<string | null>(null)

  const { data: workouts = [], isLoading } = useHevyWorkouts({
    limit:  PAGE_SIZE,
    offset: page * PAGE_SIZE,
  })

  return (
    <>
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-[72px] rounded-xl bg-cream-200 animate-pulse" />
          ))}
        </div>
      ) : workouts.length === 0 ? (
        <div className="text-center py-14 border border-dashed border-ink-200 rounded-xl">
          <p className="text-2xl mb-2">🏋️</p>
          <p className="text-ink-600 font-medium text-sm">No workouts yet</p>
          <p className="text-ink-400 text-xs mt-1">Click Sync to import your Hevy data</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {workouts.map(workout => (
            <HevyWorkoutCard
              key={workout.id}
              workout={workout}
              onClick={() => setSelectedWorkoutId(workout.id)}
            />
          ))}
        </div>
      )}

      {!isLoading && (
        <div className="flex gap-2 justify-between pt-1">
          {page > 0 ? (
            <button
              type="button"
              onClick={() => setPage(p => p - 1)}
              className="min-h-[44px] px-4 text-sm border border-ink-200 rounded-xl text-ink-600 hover:bg-ink-50 transition-colors"
            >
              ← Previous
            </button>
          ) : <div />}
          {workouts.length === PAGE_SIZE ? (
            <button
              type="button"
              onClick={() => setPage(p => p + 1)}
              className="min-h-[44px] px-4 text-sm border border-ink-200 rounded-xl text-ink-600 hover:bg-ink-50 transition-colors"
            >
              Next →
            </button>
          ) : <div />}
        </div>
      )}

      <HevyWorkoutDetail
        workoutId={selectedWorkoutId}
        onClose={() => setSelectedWorkoutId(null)}
      />
    </>
  )
}

// ─── HevyTab ──────────────────────────────────────────────────────────────────

export function HevyTab() {
  const [activeTab, setActiveTab] = useState<SubTab>('workouts')

  return (
    <div className="flex flex-col gap-5">
      {/* Top bar: sync button */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-ink-900 leading-tight">Hevy</h2>
          <p className="text-xs text-ink-400 mt-0.5">Workouts, routines &amp; body data</p>
        </div>
        <HevySyncButton />
      </div>

      {/* Sub-tab bar — pill underline style */}
      <div className="flex gap-0 overflow-x-auto border-b border-ink-100 -mx-1 px-1">
        {SUB_TABS.map(tab => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`min-h-[44px] px-4 text-sm font-medium whitespace-nowrap transition-all shrink-0 border-b-2 -mb-px ${
              activeTab === tab.id
                ? 'border-accent-500 text-accent-600 font-semibold'
                : 'border-transparent text-ink-500 hover:text-ink-700 hover:border-ink-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Sub-tab content */}
      <div>
        {activeTab === 'workouts'  && <WorkoutsSubTab />}
        {activeTab === 'routines'  && <RoutinesTab />}
        {activeTab === 'prs'       && <HevyPRList />}
        {activeTab === 'body'      && <BodyMeasurementsTab />}
        {activeTab === 'templates' && <ExerciseTemplatesTab />}
      </div>
    </div>
  )
}
