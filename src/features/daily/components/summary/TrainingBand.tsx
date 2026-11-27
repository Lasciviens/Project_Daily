import { useMemo } from 'react'
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import { CalendarDays, Dumbbell, Flame, Plus, Target, TrendingUp, Trophy } from 'lucide-react'
import { Cell, CellHeader, CellLink, StatBox, StatEmpty, StatNote, StatValue } from './cellKit'
import { useEntityModal } from '../../../../shared/modals'
import { formatDate, formatWeekdayDate } from '../../../../shared/utils/dateFormat'
import { localDayOf, shiftDateStr, todayStr } from '../../../../shared/utils/dateUtils'
import { useHevyWorkoutsRange } from '../../../training/hooks/useHevyWorkouts'
import { useDoneElsewhere } from '../../../training/hooks/useDoneElsewhere'
import { useHevyRoutines } from '../../../training/hooks/useHevyRoutines'
import { useStravaActivities } from '../../../training/hooks/useStravaActivities'
import { useAthleteProfile } from '../../../training/hooks/useAthleteProfile'
import { useTrainingHistory } from '../../../training/hooks/useTrainingProgress'
import { useTrainingPlansByDate } from '../../../training/hooks/useTrainingPlans'
import { useDayPlanContext } from '../../../training/hooks/usePlanContext'
import { useScheduleBlocks, useTrainingBlocks, useTrainingDayTasks } from '../../hooks/useSchedule'
import { NEXT_SESSION_LOOKAHEAD_DAYS } from '../../../training/hooks/useTrainingSessions'
import { pickNextTrainingSession } from '../../../training/trainingPlanModel'
import { usePlanThis } from '../../../items/usePlanThis'
import { matchDaySessions, planStartHHMM } from '../../../training/components/calendar/calendarSessions'
import { getWorkoutDuration } from '../../../training/components/calendar/calendarModel'
import { planRefOf, planStateWord, plannedOnNote, plansClosedBy } from '../../../training/sessionRef'
import { SESSION_TONE } from '../../../training/plan/sessionState'
import { computeLiftChanges, summarizeImprovement } from '../../../training/plan/improvement'
import { localDayBoundsIso, workoutLocalDay } from '../../../training/workoutDates'
import { mondayOf } from '../../../training/progressAggregate'
import { useDayTargets } from '../../hooks/useDayTargets'
import { useNutritionCoach } from '../../hooks/useNutritionCoach'
import { trainingWeekGlance } from '../../personalGlance'
import { ThisWeekStrip } from '../../../training/components/week/ThisWeekStrip'
import { useTrainingWeek } from '../../../training/hooks/useTrainingWeek'

// Personal's Training band (owner, 26.10.2026: "easily understandable results
// and stats: averages, and how the plan is doing — cut / maintain / gain"):
// six boxes across the board — the day's session, its week, the average, the
// streak, the lifts and the plan. Every number comes from THE rule the
// Training and Health pages use (sessionsThisWeek's sessions, the session
// status, the Improvement card's lift changes, the goal decision's pace), for
// the day the page shows.

const PHASE: Record<string, string> = { cut: 'Cut', maintain: 'Maintain', gain: 'Gain' }
const STREAK_WEEKS = 26
const LIFT_WEEKS = 4

export function TrainingBand({ date }: { date: string }) {
  const today = todayStr()
  const modal = useEntityModal()
  const monday = mondayOf(date)
  const sunday = shiftDateStr(monday, 6)
  const from = shiftDateStr(monday, -7 * (STREAK_WEEKS - 1))

  // Sessions: every Hevy workout and Strava activity (sessionsThisWeek's).
  const workouts = useHevyWorkoutsRange(from, sunday)
  const range = useMemo(() => localDayBoundsIso(from, sunday), [from, sunday])
  const strava = useStravaActivities({ from: range.fromISO, to: range.toISO, limit: 300 })
  const sessions = useMemo(() => [
    ...(workouts.data ?? []).map(w => ({ id: `h:${w.id}`, date: workoutLocalDay(w) })),
    ...(strava.data ?? []).map(a => ({ id: `s:${a.id}`, date: localDayOf(a.start_date) ?? '' })).filter(s => s.date),
  ], [workouts.data, strava.data])

  // The week's plans, read the calendar's way (each with its task, 167) — from six days before the day when that is
  // earlier: a late workout closes its week's open plan, and the day's card says which ("Planned for 24.11.2026 16:45").
  const weekBefore = shiftDateStr(date, -6)
  const plans = useTrainingPlansByDate(weekBefore < monday ? weekBefore : monday, sunday)
  const planCtx = useDayPlanContext(date)
  const { data: profile } = useAthleteProfile()
  const dayView = useMemo(() => {
    const byDay = (day: string) => matchDaySessions({
      date: day, todayStr: today, plans: plans.data.get(day) ?? [],
      workouts: (workouts.data ?? []).filter(w => workoutLocalDay(w) === day),
      hasActivity: day === date ? planCtx.hasActivity : false, skips: planCtx.skips,
      routineOf: (p, d) => planCtx.routineOf({ title: p.title, date: d, startHHMM: planStartHHMM(p) }),
    })
    const planned = new Set<string>()
    for (let i = 0; i < 7; i++) {
      const day = shiftDateStr(monday, i)
      if (byDay(day).openPlans.some(o => o.status !== 'skipped' && o.status !== 'done')) planned.add(day)
    }
    return { today: byDay(date), planned }
  }, [plans.data, workouts.data, planCtx, date, today, monday])

  // The week as the strip reads it (sessionState.planWeek): the box counts the same chips.
  const weekView = useTrainingWeek(date)
  const ownChips = weekView.week.sessions.filter(x => x.date >= monday && x.mark !== 'skipped')
  const planned = ownChips.length
  const doneCount = ownChips.filter(x => x.mark === 'done').length
  const stravaCount = sessions.filter(x => x.id.startsWith('s:') && x.date >= monday && x.date <= sunday && x.date <= date).length
  const week = useMemo(() => trainingWeekGlance({
    day: date, today, sessions, plannedDays: dayView.planned, target: profile?.training_days_per_week ?? null,
  }), [date, today, sessions, dayView.planned, profile?.training_days_per_week])

  const history = useTrainingHistory()
  const lifts = useMemo(() => history.data
    ? summarizeImprovement(computeLiftChanges(history.data.sets, history.data.templates, date, LIFT_WEEKS))
    : null, [history.data, date])

  const { targets } = useDayTargets()
  const coach = useNutritionCoach(targets)
  const pace = coach.decision.pace

  // A placeholder (keepPreviousData) is another week's read: never counted as this one's numbers (owner, 27.11.2026:
  // "THIS WEEK 2 of 4" showed another week) — the boxes wait for the shown week's own reads.
  const loading = workouts.isLoading || workouts.isPlaceholderData || strava.isLoading || strava.isPlaceholderData
  // "This week" only for today's week; another day's week says which one (a past day's box read "This week").
  const weekLabel = monday === mondayOf(today) ? 'This week' : `Week of ${formatDate(monday)}`
  const session = dayView.today.sessions[0] ?? null
  // A plan still to do first; else one a workout on another day closed ("Done 26.11.2026" — never "Rest day").
  const open = dayView.today.openPlans.find(o => o.status !== 'done')
    ?? dayView.today.openPlans.find(o => o.session.doneBy === 'workout') ?? null
  const elsewhere = useDoneElsewhere(open?.session ?? null, date)
  // The plans of other days this day's workout closed — the words the Log and the session popup use.
  const plannedFor = useMemo(() => (session ? plansClosedBy(session.workout.id, plans.data, date).map(plannedOnNote) : []), [session, plans.data, date])
  const more = dayView.today.sessions.length + dayView.today.openPlans.length - 1

  return (
    <Cell>
      <CellHeader icon={<Dumbbell />} title="Training" action={<CellLink to="/training">Open</CellLink>} />
      {(workouts.isError || plans.isError) && <p className="text-meta text-fg-muted">Couldn't load all of your training — some numbers below may be missing.</p>}
      <div className="@container">
        <div className="grid grid-cols-2 gap-2 @[34rem]:grid-cols-3 @[62rem]:grid-cols-6">
          {/* 1. The day's session: done, still planned, or a rest day. */}
          {session ? (
            <StatBox icon={<Dumbbell aria-hidden />} label={date === today ? 'Today' : formatWeekdayDate(date)}
              ariaLabel={`${session.workout.title || 'Workout'}, done — open the session`}
              onClick={() => modal.open({ kind: 'training-session', workoutId: session.workout.id })}>
              <StatValue text>{session.workout.title || 'Workout'}</StatValue>
              <StatNote tone="success">Done{getWorkoutDuration(session.workout) ? ` · ${getWorkoutDuration(session.workout)} min` : ''}{more > 0 ? ` · +${more} more` : ''}</StatNote>
              {plannedFor.length > 0 && <StatNote>{plannedFor.join(' · ')}</StatNote>}
            </StatBox>
          ) : open ? (
            <StatBox icon={<Dumbbell aria-hidden />} label={date === today ? 'Today' : formatWeekdayDate(date)}
              ariaLabel={`${open.plan.title}, ${planStateWord(open.status, elsewhere)} — open the session`}
              onClick={() => {
                if (elsewhere) { modal.open({ kind: 'training-session', workoutId: elsewhere.workoutId }); return }
                const ref = planRefOf(open.plan, date); if (ref) modal.open({ kind: 'training-session', plan: ref })
              }}>
              <StatValue text>{open.plan.title}</StatValue>
              <StatNote tone={SESSION_TONE[open.status]}>
                {[planStartHHMM(open.plan), planStateWord(open.status, elsewhere)].filter(Boolean).join(' · ')}{more > 0 ? ` · +${more} more` : ''}
              </StatNote>
            </StatBox>
          ) : (
            <RestDayBox date={date} label={date === today ? 'Today' : formatWeekdayDate(date)} loading={loading || plans.isLoading} />
          )}

          {/* 2. Its week: the strip's own count (done of planned, the chips below) — one week view (owner-critic,
              27.11.2026); Strava activities are a note of their own. */}
          <StatBox icon={<CalendarDays aria-hidden />} label={weekLabel}>
            {loading || weekView.isLoading ? <StatEmpty loading /> : (
              <>
                <StatValue>{planned > 0 ? `${doneCount} of ${planned}` : week.sessions}</StatValue>
                <StatNote>{planned > 0 ? 'planned sessions done' : 'sessions · nothing planned'}{stravaCount > 0 ? ` · +${stravaCount} Strava` : ''}</StatNote>
              </>
            )}
          </StatBox>

          {/* 3. The average over the four weeks before it. */}
          <StatBox icon={<TrendingUp aria-hidden />} label="Average">
            {loading ? <StatEmpty loading /> : week.average == null ? <StatEmpty loading={false} text="No sessions in the last 4 weeks" /> : (
              <>
                <StatValue>{week.average.toLocaleString('en-GB')}</StatValue>
                <StatNote>a week · last 4 weeks</StatNote>
              </>
            )}
          </StatBox>

          {/* 4. Weeks in a row. */}
          <StatBox icon={<Flame aria-hidden />} label="Streak">
            {loading ? <StatEmpty loading /> : (
              <>
                <StatValue tone={week.streakWeeks > 0 ? 'star' : undefined}>{week.streakWeeks >= STREAK_WEEKS ? `${STREAK_WEEKS}+` : week.streakWeeks}</StatValue>
                <StatNote>{week.streakWeeks === 1 ? 'week in a row' : 'weeks in a row'}</StatNote>
              </>
            )}
          </StatBox>

          {/* 5. Lifts over 4 weeks (the Improvement card's rule). */}
          <StatBox icon={<Trophy aria-hidden />} label="Lifts · 4 weeks">
            {!lifts ? <StatEmpty loading={history.isLoading} /> : lifts.judged === 0 ? <StatEmpty loading={false} text="Not enough sessions yet" /> : (
              <>
                <StatValue tone={lifts.improved > 0 ? 'success' : undefined}>{lifts.improved} up</StatValue>
                <StatNote>{lifts.flat} steady · {lifts.declined} down</StatNote>
              </>
            )}
          </StatBox>

          {/* 6. The plan: the phase and how the weight is moving (the goal decision's pace). */}
          <StatBox icon={<Target aria-hidden />} label="Plan" ariaLabel="Your goal — open the goal editor" onClick={() => modal.open({ kind: 'day-targets', date })}>
            <StatValue>{PHASE[targets.goal] ?? targets.goal}</StatValue>
            {pace ? (
              <StatNote tone={pace.tone}>
                {pace.kgPerWeek != null ? `${pace.kgPerWeek > 0 ? '+' : pace.kgPerWeek < 0 ? '−' : '±'}${Math.abs(pace.kgPerWeek).toFixed(1)} kg a week · ` : ''}{pace.label}
              </StatNote>
            ) : <StatNote>{coach.isLoading ? '…' : 'Pace once there are enough weigh-ins'}</StatNote>}
            {targets.goalWeightKg != null && <StatNote>Goal {targets.goalWeightKg.toLocaleString('en-GB')} kg</StatNote>}
          </StatBox>
        </div>
      </div>
      {/* The day's week, session by session (the strip Training's Next and Log show). */}
      <ThisWeekStrip date={date} where="daily" className="mt-1" />
    </Cell>
  )
}

/** Nothing planned that day: the next session, and a menu to plan one of the routines. */
function RestDayBox({ date, label, loading }: { date: string; label: string; loading: boolean }) {
  const plan = usePlanThis()
  const lookaheadTo = shiftDateStr(date, NEXT_SESSION_LOOKAHEAD_DAYS)
  const { data: blocks = [] } = useTrainingBlocks(date, lookaheadTo)
  const { data: templates = [] } = useScheduleBlocks()
  const { data: dayTasks = [] } = useTrainingDayTasks(date, lookaheadTo)
  const { data: routines = [] } = useHevyRoutines()
  // The week's next session (a missed one first, sessionState.planWeek) — the strip's and Training's Next; another
  // week's day, or a week with nothing left, reads the soonest plan after the day.
  const { week } = useTrainingWeek(date)
  // Today: the week's next as it is (a missed one still open first); another day: the next one after it.
  const weekNext = date === todayStr() ? week.next : week.next && week.next.date > date ? week.next : null
  const next = useMemo(() => pickNextTrainingSession({
    blocks, templates: templates.filter(t => t.category === 'training'), dayTasks, today: shiftDateStr(date, 1),
    lookaheadDays: NEXT_SESSION_LOOKAHEAD_DAYS - 1,
  }), [blocks, templates, dayTasks, date])
  if (loading) return <StatBox icon={<Dumbbell aria-hidden />} label={label}><StatEmpty loading /></StatBox>
  return (
    <StatBox icon={<Dumbbell aria-hidden />} label={label}>
      <div className="flex min-w-0 items-start justify-between gap-1">
        <StatValue>Rest day</StatValue>
        {routines.length > 0 && (
          <Menu>
            <MenuButton aria-label="Plan a session for this day" title="Plan a session"
              className="-my-1 -mr-1 grid h-8 w-8 shrink-0 place-items-center rounded-full text-accent-600 transition-colors hover:bg-surface-hover">
              <Plus className="h-4 w-4" aria-hidden />
            </MenuButton>
            <MenuItems anchor={{ to: 'bottom end', gap: 6, padding: 12 }} transition
              className="menu max-h-72 w-[min(16rem,calc(100vw-24px))] origin-top-right overflow-y-auto transition duration-150 ease-out data-[closed]:-translate-y-1 data-[closed]:opacity-0">
              <p className="menu-label">Plan for {formatWeekdayDate(date)}</p>
              {routines.map(r => (
                <MenuItem key={r.id}>
                  <button type="button" className="menu-item" onClick={() => { void plan({ kind: 'training', routine: r, date }) }}>{r.title}</button>
                </MenuItem>
              ))}
            </MenuItems>
          </Menu>
        )}
      </div>
      <StatNote>{weekNext ? `Next: ${weekNext.title} · ${weekNext.date > date ? formatWeekdayDate(weekNext.date) : `open since ${formatWeekdayDate(weekNext.date)}`}`
        : next ? `Next: ${next.title} · ${formatWeekdayDate(next.date)}` : 'Nothing planned ahead'}</StatNote>
    </StatBox>
  )
}
