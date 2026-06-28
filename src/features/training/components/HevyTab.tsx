import { useState, useMemo } from 'react'
import { useHevyWorkouts } from '../hooks/useHevyWorkouts'
import { useHevyPRs } from '../hooks/useHevyPRs'
import { HevyWorkoutCard } from './HevyWorkoutCard'
import { HevyWorkoutDetail } from './HevyWorkoutDetail'
import { HevyPRList } from './HevyPRList'
import { RoutinesTab } from './RoutinesTab'
import { BodyMeasurementsTab } from './BodyMeasurementsTab'
import { ExerciseTemplatesTab } from './ExerciseTemplatesTab'
import { TrainingCalendar } from './TrainingCalendar'
import { LogHevyWorkoutModal } from './LogHevyWorkoutModal'

type SubTab = 'workouts' | 'routines' | 'prs' | 'body' | 'exercises'

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: 'workouts',  label: 'Workouts'         },
  { id: 'routines',  label: 'Routines'          },
  { id: 'prs',       label: 'Personal Records'  },
  { id: 'body',      label: 'Body'              },
  { id: 'exercises', label: 'Exercises'         },
]

const PAGE_SIZE = 20

// ─── Weekly/Monthly summary helpers ──────────────────────────────────────────

function startOfWeek(d: Date): Date {
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  const monday = new Date(d)
  monday.setDate(d.getDate() + diff)
  monday.setHours(0, 0, 0, 0)
  return monday
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

// ─── Best Lifts Card (top 5 by weight) ───────────────────────────────────────

function BestLiftsCard() {
  const { data: prs = [], isLoading } = useHevyPRs()

  if (isLoading) {
    return <div className="h-24 rounded-xl bg-cream-200 animate-pulse" />
  }

  if (prs.length === 0) return null

  const top5 = [...prs]
    .sort((a, b) => b.max_weight_kg - a.max_weight_kg)
    .slice(0, 5)

  return (
    <div className="rounded-xl border border-ink-200 bg-white overflow-hidden mb-3">
      <div className="px-3 py-2 bg-cream-50 border-b border-ink-100">
        <p className="text-[11px] font-bold uppercase tracking-wider text-ink-500">Top 5 Lifts by Weight</p>
      </div>
      <div className="divide-y divide-ink-50">
        {top5.map((pr, i) => (
          <div key={pr.exercise_template_id} className="flex items-center gap-3 px-3 py-2">
            <span className="text-xs font-bold text-ink-400 w-4 shrink-0">#{i + 1}</span>
            <span className="text-sm font-medium text-ink-800 flex-1 truncate">{pr.title}</span>
            <span className="text-sm font-bold text-accent-700 shrink-0">
              {pr.max_weight_kg} kg{pr.reps_at_max != null ? ` × ${pr.reps_at_max}` : ''}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Workouts sub-tab ─────────────────────────────────────────────────────────

function WorkoutsSubTab() {
  const [page, setPage] = useState(0)
  const [selectedWorkoutId, setSelectedWorkoutId] = useState<string | null>(null)
  const [logOpen, setLogOpen] = useState(false)

  const { data: workouts = [], isLoading } = useHevyWorkouts({
    limit:  PAGE_SIZE,
    offset: page * PAGE_SIZE,
  })

  // Fetch a larger set to compute summary counts
  const { data: allRecent = [] } = useHevyWorkouts({ limit: 200 })

  const { weekCount, monthCount } = useMemo(() => {
    const now = new Date()
    const weekStart  = startOfWeek(now).toISOString()
    const monthStart = startOfMonth(now).toISOString()
    const weekCount  = allRecent.filter(w => w.hevy_created_at >= weekStart).length
    const monthCount = allRecent.filter(w => w.hevy_created_at >= monthStart).length
    return { weekCount, monthCount }
  }, [allRecent])

  return (
    <>
      {/* Summary + Log button row */}
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <div className="flex gap-3 text-sm text-ink-500">
          {allRecent.length > 0 && (
            <>
              <span><strong className="text-ink-800">{weekCount}</strong> this week</span>
              <span className="text-ink-200">·</span>
              <span><strong className="text-ink-800">{monthCount}</strong> this month</span>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={() => setLogOpen(true)}
          className="min-h-[44px] px-4 bg-accent-600 text-white text-sm font-semibold rounded-xl hover:bg-accent-700 transition-colors flex items-center gap-1.5 shrink-0"
        >
          <span className="text-base leading-none">+</span>
          <span>Log Workout</span>
        </button>
      </div>

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
        <div className="flex flex-col gap-1.5">
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

      <LogHevyWorkoutModal
        isOpen={logOpen}
        onClose={() => setLogOpen(false)}
      />
    </>
  )
}

// ─── PRs sub-tab with Best Lifts card ────────────────────────────────────────

function PRsSubTab() {
  return (
    <>
      <BestLiftsCard />
      <HevyPRList />
    </>
  )
}

// ─── HevyTab ──────────────────────────────────────────────────────────────────

export function HevyTab() {
  const [activeTab, setActiveTab] = useState<SubTab>('workouts')

  return (
    <div className="flex flex-col gap-3">
      {/* Sub-tab bar — pill underline style */}
      <div className="flex gap-0 overflow-x-auto border-b border-ink-100 -mx-1 px-1">
        {SUB_TABS.map(tab => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`min-h-[40px] px-3 text-sm font-medium whitespace-nowrap transition-all shrink-0 border-b-2 -mb-px ${
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
      <div className="max-w-2xl mx-auto w-full">
        {activeTab === 'workouts'  && <WorkoutsSubTab />}
        {activeTab === 'routines'  && <RoutinesTab />}
        {activeTab === 'prs'       && <PRsSubTab />}
        {activeTab === 'body'      && <BodyMeasurementsTab />}
        {activeTab === 'exercises' && <ExerciseTemplatesTab />}
      </div>

      {/* Training calendar — always visible below tabs */}
      <div className="mt-2 max-w-2xl mx-auto w-full min-h-[200px]">
        <TrainingCalendar />
      </div>
    </div>
  )
}
