import { useState } from 'react'
import { useHevyWorkouts } from '../hooks/useHevyWorkouts'
import { HevySyncButton } from './HevySyncButton'
import { HevyWorkoutCard } from './HevyWorkoutCard'
import { HevyWorkoutDetail } from './HevyWorkoutDetail'
import { HevyPRList } from './HevyPRList'
import { RoutinesTab } from './RoutinesTab'
import { BodyMeasurementsTab } from './BodyMeasurementsTab'
import { ExerciseTemplatesTab } from './ExerciseTemplatesTab'
import { SyncStatusPanel } from './SyncStatusPanel'

type SubTab = 'workouts' | 'routines' | 'prs' | 'body' | 'templates'

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: 'workouts',  label: 'Workouts'  },
  { id: 'routines',  label: 'Routines'  },
  { id: 'prs',       label: 'PRs'       },
  { id: 'body',      label: 'Body'      },
  { id: 'templates', label: 'Templates' },
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

      {!isLoading && (
        <div className="flex gap-2 justify-between">
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
  const [syncStatusOpen, setSyncStatusOpen] = useState(false)

  return (
    <div className="flex flex-col gap-4">
      {/* Top controls */}
      <HevySyncButton />

      {/* Sync status collapsible */}
      <div className="border border-ink-100 rounded-xl overflow-hidden">
        <button
          type="button"
          onClick={() => setSyncStatusOpen(o => !o)}
          className="w-full flex items-center justify-between px-4 py-3 min-h-[44px] text-sm font-semibold text-ink-700 hover:bg-cream-50 transition-colors"
        >
          <span>Sync Status</span>
          <span className="text-ink-400 text-xs">{syncStatusOpen ? '▲' : '▼'}</span>
        </button>
        {syncStatusOpen && (
          <div className="px-3 pb-3 border-t border-ink-100">
            <SyncStatusPanel />
          </div>
        )}
      </div>

      {/* Sub-tab bar */}
      <div className="flex gap-1 overflow-x-auto pb-0.5 -mx-1 px-1">
        {SUB_TABS.map(tab => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`min-h-[44px] px-4 text-sm font-medium rounded-xl whitespace-nowrap transition-colors shrink-0 ${
              activeTab === tab.id
                ? 'bg-accent-500 text-white'
                : 'bg-ink-100 text-ink-600 hover:bg-ink-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Sub-tab content */}
      {activeTab === 'workouts'  && <WorkoutsSubTab />}
      {activeTab === 'routines'  && <RoutinesTab />}
      {activeTab === 'prs'       && <HevyPRList />}
      {activeTab === 'body'      && <BodyMeasurementsTab />}
      {activeTab === 'templates' && <ExerciseTemplatesTab />}
    </div>
  )
}
