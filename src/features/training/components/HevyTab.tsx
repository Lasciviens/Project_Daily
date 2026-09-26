import { useState, useMemo, useEffect, useRef } from 'react'
import { startOfWeek, startOfMonth, format } from 'date-fns'
import { useHevyWorkouts } from '../hooks/useHevyWorkouts'
import { useHevyPRs } from '../hooks/useHevyPRs'
import { useOpenTrainingSessionTasks } from '../../todo/hooks/useTodos'
import { formatLocalDate } from '../../../shared/utils/dateUtils'
import { HevyWorkoutCard } from './HevyWorkoutCard'
import { entityModal } from '../../../shared/modals'
import { Button, Card, EmptyState, Skeleton } from '../../../shared/ui'
import { ChevronLeft, ChevronRight, Dumbbell, Plus } from 'lucide-react'
import { HevyPRList } from './HevyPRList'
import { ExerciseThumb } from '../exerciseMedia'
import { RoutinesTab } from './RoutinesTab'
import { BodyMeasurementsTab } from './BodyMeasurementsTab'
import { ExerciseTemplatesTab } from './ExerciseTemplatesTab'
import { LogHevyWorkoutModal } from './LogHevyWorkoutModal'
import { WorkedMuscles } from './WorkedMuscles'
import { ProgressTab } from './ProgressTab'

type SubTab = 'workouts' | 'routines' | 'prs' | 'progress' | 'muscles' | 'body' | 'exercises'

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: 'workouts',  label: 'Workouts'         },
  { id: 'routines',  label: 'Routines'          },
  { id: 'prs',       label: 'Personal records'  },
  { id: 'progress',  label: 'Progress'          },
  { id: 'muscles',   label: 'Muscles'           },
  { id: 'body',      label: 'Body'              },
  { id: 'exercises', label: 'Exercises'         },
]

const PAGE_SIZE = 20

// ─── Best Lifts Card (top 5 by weight) ───────────────────────────────────────

function BestLiftsCard({ muscleFilter }: { muscleFilter: string }) {
  const { data: prs = [], isLoading } = useHevyPRs()
  // Hover/tap peek — same GIF affordance the user liked on Personal Records.
  const [peekId, setPeekId] = useState<string | null>(null)

  if (isLoading) {
    return <Skeleton rounded="rounded-card" className="mb-3 h-24 max-w-md" />
  }

  if (prs.length === 0) return null

  // Same "trained 3+ times" gate as the Personal Records list below — a
  // one-off heavy single shouldn't outrank a real, repeatedly-trained lift.
  const eligible = prs.filter(pr => pr.times_performed >= 3)
  if (eligible.length === 0) return null

  // Recomputed against whatever muscle group is currently selected in the
  // Personal Records filter below — a "top 5" that ignored the filter read
  // as broken (picking Legs still showed a bench press at #1).
  const groupFiltered = muscleFilter === 'All'
    ? eligible
    : eligible.filter(pr => pr.primary_muscle_group === muscleFilter)

  if (groupFiltered.length === 0) return null

  const top5 = [...groupFiltered]
    .sort((a, b) => b.max_weight_kg - a.max_weight_kg)
    .slice(0, 5)

  return (
    <Card padded={false} className="mb-3 max-w-md">
      <div className="border-b border-line px-4 py-2.5">
        <p className="section-label">
          Top 5 lifts by weight{muscleFilter !== 'All' ? <span className="capitalize"> · {muscleFilter}</span> : ''}
        </p>
      </div>
      <div className="divide-y divide-line">
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
                className={`flex min-h-[44px] w-full items-center gap-3 px-4 py-2 text-left transition-colors ${open ? 'bg-surface-hover' : 'hover:bg-surface-hover'}`}
              >
                <span className="w-5 shrink-0 text-meta font-bold tabular-nums text-fg-faint">#{i + 1}</span>
                <span className="flex-1 truncate text-body font-medium text-fg">{pr.title}</span>
                <span className="shrink-0 text-body font-bold tabular-nums text-fg">
                  {pr.max_weight_kg} kg{pr.reps_at_max != null ? ` × ${pr.reps_at_max}` : ''}
                </span>
              </button>
              {open && (
                <div className="absolute left-0 right-0 top-full z-popover mt-1 flex items-center gap-3 rounded-menu border border-line-strong bg-surface p-3 shadow-menu animate-fadeSlideIn">
                  <ExerciseThumb title={pr.title} templateId={pr.exercise_template_id} size={72} />
                  <div className="flex min-w-0 flex-col gap-0.5 text-meta">
                    <span className="font-semibold text-fg">{pr.title}</span>
                    <span className="text-fg-muted">Best: <strong>{pr.max_weight_kg} kg{pr.reps_at_max != null ? ` × ${pr.reps_at_max}` : ''}</strong></span>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </Card>
  )
}

// ─── Workouts sub-tab ─────────────────────────────────────────────────────────

function WorkoutsSubTab() {
  const [page, setPage] = useState(0)

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
        <div className="mb-2 flex flex-wrap gap-3 text-meta text-fg-muted">
          <span><strong className="tabular-nums text-fg">{weekCount}</strong> this week</span>
          <span className="text-fg-faint" aria-hidden>·</span>
          <span><strong className="tabular-nums text-fg">{monthCount}</strong> in {monthLabel}</span>
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-[repeat(auto-fill,minmax(19rem,22rem))] justify-start gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} rounded="rounded-card" className="h-[88px]" />
          ))}
        </div>
      ) : workouts.length === 0 ? (
        <EmptyState bordered icon={<Dumbbell />} title="No workouts yet" description="Sync to import your Hevy data." />
      ) : (
        // Content-sized columns (19–22rem); leftover width stays on the right.
        <div className="grid grid-cols-1 sm:grid-cols-[repeat(auto-fill,minmax(19rem,22rem))] gap-2 justify-start items-start">
          {workouts.map(workout => (
            <HevyWorkoutCard
              key={workout.id}
              workout={workout}
              onClick={() => entityModal.open({ kind: 'hevy-workout', id: workout.id })}
              matchedTask={workout.start_time ? taskByDueDate.get(formatLocalDate(new Date(workout.start_time))) : undefined}
            />
          ))}
        </div>
      )}

      {!isLoading && (page > 0 || workouts.length === PAGE_SIZE) && (
        <div className="flex justify-between gap-2 pt-3">
          {page > 0
            ? <Button icon={<ChevronLeft />} onClick={() => setPage(p => p - 1)}>Previous</Button>
            : <div />}
          {workouts.length === PAGE_SIZE
            ? <Button onClick={() => setPage(p => p + 1)}>Next <ChevronRight className="h-4 w-4" aria-hidden /></Button>
            : <div />}
        </div>
      )}
    </>
  )
}

// ─── PRs sub-tab with Best Lifts card ────────────────────────────────────────

function PRsSubTab() {
  // Lifted up so BestLiftsCard's "top 5" recomputes against the SAME muscle
  // filter HevyPRList's own pills already control — previously two
  // independent, unconnected components.
  const [muscleFilter, setMuscleFilter] = useState<string>('All')
  return (
    <>
      <BestLiftsCard muscleFilter={muscleFilter} />
      <HevyPRList activeGroup={muscleFilter} onActiveGroupChange={setMuscleFilter} />
    </>
  )
}

// ─── HevyTab ──────────────────────────────────────────────────────────────────

export function HevyTab() {
  const [activeTab, setActiveTab] = useState<SubTab>('workouts')
  const [logOpen, setLogOpen] = useState(false)
  const activeSubRef = useRef<HTMLButtonElement>(null)

  // Keep the active sub-tab in view on the scrolling phone strip.
  useEffect(() => {
    activeSubRef.current?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
  }, [activeTab])

  return (
    <div className="flex flex-col gap-3">
      {/* Seven sub-tabs never fit a phone, so the strip scrolls to the screen
          edge. The Log action sits with the Workouts content below instead of
          beside the strip, where it cut the last tab off mid-word. */}
      <div>
        <div role="tablist" aria-label="Hevy sections" className="scroll-x -mx-4 flex min-w-0 border-b border-line px-4 sm:mx-0 sm:px-0">
          {SUB_TABS.map(tab => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              ref={activeTab === tab.id ? activeSubRef : undefined}
              onClick={() => setActiveTab(tab.id)}
              className={`-mb-px min-h-[44px] shrink-0 whitespace-nowrap border-b-2 px-3 text-body transition-colors ${
                activeTab === tab.id
                  ? 'border-accent-500 font-semibold text-fg'
                  : 'border-transparent font-medium text-fg-muted hover:text-fg'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      {activeTab === 'workouts' && (
        <div className="flex">
          <Button variant="primary" icon={<Plus />} onClick={() => setLogOpen(true)} className="shrink-0">
            Log workout
          </Button>
        </div>
      )}

      {/* Sub-tab content — width is managed by the page (calendar lives there) */}
      <div>
        {activeTab === 'workouts'  && <WorkoutsSubTab />}
        {activeTab === 'routines'  && <RoutinesTab />}
        {activeTab === 'prs'       && <PRsSubTab />}
        {activeTab === 'progress'  && <ProgressTab />}
        {activeTab === 'muscles'   && <WorkedMuscles />}
        {activeTab === 'body'      && <BodyMeasurementsTab />}
        {activeTab === 'exercises' && <ExerciseTemplatesTab />}
      </div>

      <LogHevyWorkoutModal isOpen={logOpen} onClose={() => setLogOpen(false)} />
    </div>
  )
}
