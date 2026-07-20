import { useState, useMemo, useEffect } from 'react'
import { startOfWeek, startOfMonth, format } from 'date-fns'
import { useHevyWorkouts } from '../hooks/useHevyWorkouts'
import { useHevyPRs } from '../hooks/useHevyPRs'
import { useOpenTrainingSessionTasks } from '../../todo/hooks/useTodos'
import { formatLocalDate } from '../../../shared/utils/dateUtils'
import { HevyWorkoutCard } from './HevyWorkoutCard'
import { HevyWorkoutDetail } from './HevyWorkoutDetail'
import { HevyPRList } from './HevyPRList'
import { ExerciseThumb } from '../exerciseMedia'
import { RoutinesTab } from './RoutinesTab'
import { BodyMeasurementsTab } from './BodyMeasurementsTab'
import { ExerciseTemplatesTab } from './ExerciseTemplatesTab'
import { LogHevyWorkoutModal } from './LogHevyWorkoutModal'
import { WorkedMuscles } from './WorkedMuscles'

type SubTab = 'workouts' | 'routines' | 'prs' | 'muscles' | 'body' | 'exercises'

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: 'workouts',  label: 'Workouts'         },
  { id: 'routines',  label: 'Routines'          },
  { id: 'prs',       label: 'Personal Records'  },
  { id: 'muscles',   label: 'Muscles'           },
  { id: 'body',      label: 'Body'              },
  { id: 'exercises', label: 'Exercises'         },
]

const PAGE_SIZE = 20

// ─── Best Lifts Card (top 5 by weight) ───────────────────────────────────────

function BestLiftsCard() {
  const { data: prs = [], isLoading } = useHevyPRs()
  // Hover/tap peek — same GIF affordance the user liked on Personal Records.
  const [peekId, setPeekId] = useState<string | null>(null)

  if (isLoading) {
    return <div className="h-24 rounded-xl bg-cream-200 animate-pulse" />
  }

  if (prs.length === 0) return null

  const top5 = [...prs]
    .sort((a, b) => b.max_weight_kg - a.max_weight_kg)
    .slice(0, 5)

  return (
    <div className="rounded-xl border border-ink-200 bg-cream-50 mb-3 max-w-md">
      <div className="px-3 py-2 border-b border-ink-100">
        <p className="text-[11px] font-bold uppercase tracking-wider text-ink-500">Top 5 Lifts by Weight</p>
      </div>
      <div className="divide-y divide-ink-50">
        {top5.map((pr, i) => {
          const open = peekId === pr.exercise_template_id
          return (
            <div
              key={pr.exercise_template_id}
              className="relative"
              onMouseEnter={() => setPeekId(pr.exercise_template_id)}
              onMouseLeave={() => setPeekId(p => (p === pr.exercise_template_id ? null : p))}
            >
              <button
                type="button"
                onClick={() => setPeekId(open ? null : pr.exercise_template_id)}
                className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${open ? 'bg-cream-100' : 'hover:bg-cream-50'}`}
              >
                <span className="text-xs font-bold text-ink-400 w-4 shrink-0">#{i + 1}</span>
                <span className="text-sm font-medium text-ink-800 flex-1 truncate">{pr.title}</span>
                <span className="text-sm font-bold text-accent-700 shrink-0 tabular-nums">
                  {pr.max_weight_kg} kg{pr.reps_at_max != null ? ` × ${pr.reps_at_max}` : ''}
                </span>
              </button>
              {open && (
                <div className="absolute z-30 left-0 right-0 top-full mt-1 p-3 rounded-xl border border-ink-200 bg-cream-50 shadow-xl flex items-center gap-3 animate-fadeSlideIn">
                  <ExerciseThumb title={pr.title} size={72} />
                  <div className="flex flex-col gap-0.5 text-xs min-w-0">
                    <span className="font-semibold text-ink-900">{pr.title}</span>
                    <span className="text-ink-600">Best: <strong>{pr.max_weight_kg} kg{pr.reps_at_max != null ? ` × ${pr.reps_at_max}` : ''}</strong></span>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Workouts sub-tab ─────────────────────────────────────────────────────────

function WorkoutsSubTab() {
  const [page, setPage] = useState(0)
  const [selectedWorkoutId, setSelectedWorkoutId] = useState<string | null>(null)

  const { data: workouts = [], isLoading } = useHevyWorkouts({
    limit:  PAGE_SIZE,
    offset: page * PAGE_SIZE,
  })

  // Fetch a larger set to compute summary counts
  const { data: allRecent = [] } = useHevyWorkouts({ limit: 200 })

  const { data: openTrainingTasks = [] } = useOpenTrainingSessionTasks()
  // One open task per calendar day is the common case (RoutinesTab plans a
  // single session at a time) — first match is good enough for a suggestion.
  const taskByDueDate = useMemo(() => {
    const map = new Map<string, (typeof openTrainingTasks)[number]>()
    for (const t of openTrainingTasks) {
      if (t.due_date && !map.has(t.due_date)) map.set(t.due_date, t)
    }
    return map
  }, [openTrainingTasks])

  const { weekCount, monthCount, monthLabel } = useMemo(() => {
    const now = new Date()
    // Compare as Date objects (not ISO strings) so the boundary isn't skewed by
    // a UTC conversion, and use the actual workout date (start_time) rather
    // than the Hevy sync/creation timestamp — matches TrainingCalendar's
    // workoutDay() logic.
    const weekStart  = startOfWeek(now, { weekStartsOn: 1 })
    const monthStart = startOfMonth(now)
    const workoutDate = (w: (typeof allRecent)[number]) => new Date(w.start_time ?? w.hevy_created_at)
    const weekCount  = allRecent.filter(w => { const d = workoutDate(w); return d >= weekStart  && d <= now }).length
    const monthCount = allRecent.filter(w => { const d = workoutDate(w); return d >= monthStart && d <= now }).length
    // "This month" means the calendar month, not a rolling 30 days — name it
    // explicitly (e.g. "in July") so that's never ambiguous.
    const monthLabel = format(now, 'MMMM')
    return { weekCount, monthCount, monthLabel }
  }, [allRecent])

  return (
    <>
      {/* Summary line — compact. The Log button lives in the sub-tab row now
          (HevyTab), so this no longer needs its own full-height button row. */}
      {allRecent.length > 0 && (
        <div className="flex gap-3 text-xs text-ink-500 mb-2 -mt-0.5 flex-wrap">
          <span><strong className="text-ink-800">{weekCount}</strong> this week</span>
          <span className="text-ink-200">·</span>
          <span><strong className="text-ink-800">{monthCount}</strong> in {monthLabel}</span>
        </div>
      )}

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
        // HORIZONTAL fix (the actual complaint): a workout card doesn't need
        // 1900px of monitor width. Cards flow into CONTENT-SIZED columns
        // (each 19–22rem), the column count derives from available width
        // (auto-fill), and leftover space stays empty on the right —
        // the grid form of the repo's content-sized/left-aligned rule.
        <div className="grid grid-cols-[repeat(auto-fill,minmax(19rem,22rem))] gap-2 justify-start items-start">
          {workouts.map(workout => (
            <HevyWorkoutCard
              key={workout.id}
              workout={workout}
              onClick={() => setSelectedWorkoutId(workout.id)}
              matchedTask={workout.start_time ? taskByDueDate.get(formatLocalDate(new Date(workout.start_time))) : undefined}
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

export function HevyTab({ onSubTabChange }: { onSubTabChange?: (id: SubTab) => void } = {}) {
  const [activeTab, setActiveTab] = useState<SubTab>('workouts')
  const [logOpen, setLogOpen] = useState(false)

  // Report the active sub-tab up so the page can widen for the data-dense ones
  // (Exercises grid, Muscles two-column) on large monitors.
  useEffect(() => { onSubTabChange?.(activeTab) }, [activeTab, onSubTabChange])

  return (
    <div className="flex flex-col gap-3">
      {/* Sub-tab bar — pill underline style. The Workouts "Log" action is
          pinned right of the scroll strip so it no longer costs a second
          stacked row on mobile; a right-edge fade cues that the strip scrolls
          (mobile only — all sub-tabs fit on desktop). */}
      <div className="flex items-center gap-2 -mx-1 px-1">
        <div className="relative flex-1 min-w-0">
          <div className="flex gap-0 overflow-x-auto scrollbar-none snap-x snap-mandatory touch-pan-x overscroll-x-contain border-b border-ink-100">
            {SUB_TABS.map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`min-h-[44px] px-3 text-sm font-medium whitespace-nowrap transition-all shrink-0 border-b-2 -mb-px press-feedback snap-start ${
                  activeTab === tab.id
                    ? 'border-accent-500 text-accent-600 font-semibold'
                    : 'border-transparent text-ink-500 hover:text-ink-700 hover:border-ink-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div
            className="sm:hidden pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-canvas to-transparent"
            aria-hidden
          />
        </div>
        {activeTab === 'workouts' && (
          <button
            type="button"
            onClick={() => setLogOpen(true)}
            className="shrink-0 min-h-[44px] px-3 bg-accent-600 text-white text-sm font-semibold rounded-xl hover:bg-accent-700 transition-colors flex items-center gap-1 press-feedback"
          >
            <span className="text-base leading-none">+</span>
            <span className="sm:hidden">Log</span>
            <span className="hidden sm:inline">Log Workout</span>
          </button>
        )}
      </div>

      {/* Sub-tab content — width is managed by the page (calendar lives there) */}
      <div>
        {activeTab === 'workouts'  && <WorkoutsSubTab />}
        {activeTab === 'routines'  && <RoutinesTab />}
        {activeTab === 'prs'       && <PRsSubTab />}
        {activeTab === 'muscles'   && <WorkedMuscles />}
        {activeTab === 'body'      && <BodyMeasurementsTab />}
        {activeTab === 'exercises' && <ExerciseTemplatesTab />}
      </div>

      <LogHevyWorkoutModal isOpen={logOpen} onClose={() => setLogOpen(false)} />
    </div>
  )
}
