import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import { CalendarPlus, ChevronRight, MoreHorizontal, Pencil } from 'lucide-react'
import { Button, IconButton, ToneDot } from '../../../../shared/ui'
import { PLAN_STATUS_LABEL } from '../../trainingPlanModel'
import { formatDistance } from '../../setFormat'
import { openPlanSession } from '../../planTraining'
import { StravaTypeIcon } from '../StravaIcons'
import { StravaDot } from './CalendarBits'
import { planStartHHMM, sessionPlanNote, workoutStartHHMM, type DaySession, type OpenPlan } from './calendarSessions'
import { PLAN_TONE, WORKOUT_TONE, getWorkoutDuration, isDayEmpty, ymd, type CalendarPlanItem, type DayData } from './calendarModel'

type Entry =
  | { kind: 'session'; at: string | null; session: DaySession }
  | { kind: 'plan'; at: string | null; open: OpenPlan }

// Editing, moving or deleting a plan sits behind this menu — two deliberate
// taps, never the row's own tap (that opens the workout, or nothing).
function PlanMenu({ plans, onEditPlan }: { plans: CalendarPlanItem[]; onEditPlan: (p: CalendarPlanItem) => void }) {
  if (plans.length === 0) return null
  return (
    <Menu as="div" className="shrink-0">
      <MenuButton as={IconButton} label="Plan actions"><MoreHorizontal /></MenuButton>
      <MenuItems anchor="bottom end" transition className="menu w-56 [--anchor-gap:4px] transition duration-150 data-[closed]:scale-95 data-[closed]:opacity-0">
        {plans.map(p => (
          <MenuItem key={p.id}>
            <button type="button" onClick={() => onEditPlan(p)} className="menu-item">
              <Pencil aria-hidden className="h-4 w-4 shrink-0" />
              <span className="truncate">
                {p.kind === 'recurring' ? 'Edit repeating plan' : 'Edit plan'}
                {plans.length > 1 && ` · ${p.title}`}
              </span>
            </button>
          </MenuItem>
        ))}
      </MenuItems>
    </Menu>
  )
}

function SessionRow({ session, onOpenWorkout, onEditPlan }: { session: DaySession; onOpenWorkout: (id: string) => void; onEditPlan: (p: CalendarPlanItem) => void }) {
  const w = session.workout
  const dur = getWorkoutDuration(w)
  const note = sessionPlanNote(session)
  const meta = [workoutStartHHMM(w), dur != null ? `${dur} min` : null].filter(Boolean).join(' · ')
  return (
    <div className="flex items-center gap-1 rounded-row border border-line pr-1">
      <button type="button" onClick={() => onOpenWorkout(w.id)} className="row row-interactive min-w-0 flex-1 py-1.5 text-left">
        <ToneDot tone={WORKOUT_TONE} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-body font-medium text-fg">{w.title}</span>
          <span className="flex flex-wrap gap-x-1.5 text-meta tabular-nums text-fg-muted">
            {meta && <span>{meta}</span>}
            {note && <span data-tone="success" className="tone-text">{meta && '· '}{note}</span>}
          </span>
        </span>
        <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-fg-faint" />
      </button>
      <PlanMenu plans={session.plans} onEditPlan={onEditPlan} />
    </div>
  )
}

function OpenPlanRow({ open, onEditPlan }: { open: OpenPlan; onEditPlan: (p: CalendarPlanItem) => void }) {
  const { plan: p, status } = open
  const at = planStartHHMM(p)
  return (
    <div className="flex min-h-[44px] items-center gap-2.5 rounded-row border border-line py-1.5 pl-3 pr-1">
      <ToneDot tone={PLAN_TONE[status]} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body font-medium text-fg-2">{p.kind === 'recurring' && '⟳ '}{p.title}</span>
        {/* The status sits under the title (a pill beside it cut long routine names to a few letters). */}
        <span className="flex flex-wrap gap-x-1.5 text-meta tabular-nums text-fg-muted">
          {at && <span>{at}</span>}
          <span data-tone={PLAN_TONE[status]} className="tone-text font-medium">{at && '· '}{PLAN_STATUS_LABEL[status]}</span>
        </span>
      </span>
      <PlanMenu plans={[p]} onEditPlan={onEditPlan} />
    </div>
  )
}

// Shared by WeekView and MonthView: one row per real session — a workout
// (tap → its full detail) carrying the plan it covered, or a plan nothing
// covered (missed / today / upcoming).
export function DayDetailPanel({
  day, todayStr, onOpenWorkout, onEditPlan,
}: {
  day:           DayData | null | undefined
  todayStr:      string
  onOpenWorkout: (id: string) => void
  onEditPlan:    (p: CalendarPlanItem) => void
}) {
  if (!day) return null
  const dateKey = ymd(day.date)
  const empty = isDayEmpty(day)
  const canPlan = dateKey >= todayStr
  if (empty && !canPlan) return null

  const entries: Entry[] = [
    ...day.sessions.map(session => ({ kind: 'session' as const, at: workoutStartHHMM(session.workout), session })),
    ...day.openPlans.map(open => ({ kind: 'plan' as const, at: planStartHHMM(open.plan), open })),
  ].sort((a, b) => (a.at ?? '99:99').localeCompare(b.at ?? '99:99'))

  return (
    <div className="flex flex-col gap-3 border-t border-line pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-body font-semibold text-fg">
          {day.date.toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'long' })}
        </p>
        {canPlan && (
          <Button size="sm" icon={<CalendarPlus />} onClick={() => openPlanSession(dateKey)}>Plan a session</Button>
        )}
      </div>

      {entries.length > 0 && (
        <div>
          <p className="section-label mb-1.5">Training</p>
          <div className="flex flex-col gap-1">
            {entries.map(e => e.kind === 'session'
              ? <SessionRow key={e.session.workout.id} session={e.session} onOpenWorkout={onOpenWorkout} onEditPlan={onEditPlan} />
              : <OpenPlanRow key={e.open.plan.id} open={e.open} onEditPlan={onEditPlan} />)}
          </div>
        </div>
      )}

      {day.activities.length > 0 && (
        <div>
          <p className="section-label mb-1.5">Strava</p>
          <div className="flex flex-col gap-1">
            {day.activities.map(a => (
              <div key={a.id} className="row border border-line">
                <StravaDot />
                <StravaTypeIcon type={a.type} className="h-4 w-4 shrink-0 text-fg-muted" />
                <span className="flex-1 text-body font-medium text-fg">{a.title}</span>
                {a.distance_meters ? <span className="shrink-0 text-meta tabular-nums text-fg-muted">{formatDistance(a.distance_meters)}</span> : null}
              </div>
            ))}
          </div>
        </div>
      )}

      {empty && <p className="text-meta text-fg-muted">Nothing planned or logged.</p>}
    </div>
  )
}
