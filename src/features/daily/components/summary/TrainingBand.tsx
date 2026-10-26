import { useMemo } from 'react'
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import { CalendarDays, Dumbbell, Flame, Plus, Target, TrendingUp, Trophy } from 'lucide-react'
import { Cell, CellHeader, CellLink, StatBox, StatEmpty, StatNote, StatValue } from './cellKit'
import { cx } from '../../../../shared/ui'
import { useEntityModal } from '../../../../shared/modals'
import { formatWeekdayDate } from '../../../../shared/utils/dateFormat'
import { localDayOf, shiftDateStr, todayStr } from '../../../../shared/utils/dateUtils'
import { useHevyWorkoutsRange } from '../../../training/hooks/useHevyWorkouts'
import { useHevyRoutines } from '../../../training/hooks/useHevyRoutines'
import { useStravaActivities } from '../../../training/hooks/useStravaActivities'
import { useAthleteProfile } from '../../../training/hooks/useAthleteProfile'
import { useTrainingHistory } from '../../../training/hooks/useTrainingProgress'
import { useTrainingPlansByDate } from '../../../training/hooks/useTrainingPlans'
import { useDayPlanContext } from '../../../training/hooks/usePlanContext'
import { useScheduleBlocks, useTrainingBlocks } from '../../hooks/useSchedule'
import { NEXT_SESSION_LOOKAHEAD_DAYS } from '../../../training/hooks/useTrainingSessions'
import { pickNextTrainingSession } from '../../../training/trainingPlanModel'
import { openPlanRoutine } from '../../../training/planTraining'
import { matchDaySessions, planStartHHMM } from '../../../training/components/calendar/calendarSessions'
import { getWorkoutDuration } from '../../../training/components/calendar/calendarModel'
import { planRefOf } from '../../../training/sessionRef'
import { SESSION_LABEL, SESSION_TONE } from '../../../training/plan/sessionState'
import { computeLiftChanges, summarizeImprovement } from '../../../training/plan/improvement'
import { localDayBoundsIso, workoutLocalDay } from '../../../training/workoutDates'
import { mondayOf } from '../../../training/progressAggregate'
import { useDayTargets } from '../../hooks/useDayTargets'
import { useNutritionCoach } from '../../hooks/useNutritionCoach'
import { trainingWeekGlance, type WeekDayMark } from '../../personalGlance'

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

const MARK_CLASS: Record<WeekDayMark, string> = {
  trained: 'bg-success border-success',
  planned: 'border-accent-500 bg-transparent',
  missed:  'border-line-strong bg-transparent',
  none:    'border-transparent bg-line',
}
const MARK_WORD: Record<WeekDayMark, string> = { trained: 'trained', planned: 'planned', missed: 'planned, not done', none: 'nothing planned' }

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

  // The week's plans, read the calendar's way (each with its task, 167).
  const plans = useTrainingPlansByDate(monday, sunday)
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

  const loading = workouts.isLoading
  const session = dayView.today.sessions[0] ?? null
  const open = dayView.today.openPlans.find(o => o.status !== 'done') ?? null
  const more = dayView.today.sessions.length + dayView.today.openPlans.length - 1

  return (
    <Cell>
      <CellHeader icon={<Dumbbell />} title="Training" action={<CellLink to="/training">Open</CellLink>} />
      <div className="@container">
        <div className="grid grid-cols-2 gap-2 @[34rem]:grid-cols-3 @[62rem]:grid-cols-6">
          {/* 1. The day's session: done, still planned, or a rest day. */}
          {session ? (
            <StatBox icon={<Dumbbell aria-hidden />} label={date === today ? 'Today' : formatWeekdayDate(date)}
              ariaLabel={`${session.workout.title || 'Workout'}, done — open the session`}
              onClick={() => modal.open({ kind: 'training-session', workoutId: session.workout.id })}>
              <StatValue>{session.workout.title || 'Workout'}</StatValue>
              <StatNote tone="success">Done{getWorkoutDuration(session.workout) ? ` · ${getWorkoutDuration(session.workout)} min` : ''}{more > 0 ? ` · +${more} more` : ''}</StatNote>
            </StatBox>
          ) : open ? (
            <StatBox icon={<Dumbbell aria-hidden />} label={date === today ? 'Today' : formatWeekdayDate(date)}
              ariaLabel={`${open.plan.title}, ${SESSION_LABEL[open.status]} — open the session`}
              onClick={() => { const ref = planRefOf(open.plan, date); if (ref) modal.open({ kind: 'training-session', plan: ref }) }}>
              <StatValue>{open.plan.title}</StatValue>
              <StatNote tone={SESSION_TONE[open.status]}>
                {[planStartHHMM(open.plan), SESSION_LABEL[open.status]].filter(Boolean).join(' · ')}{more > 0 ? ` · +${more} more` : ''}
              </StatNote>
            </StatBox>
          ) : (
            <RestDayBox date={date} label={date === today ? 'Today' : formatWeekdayDate(date)} loading={loading || plans.isLoading} />
          )}

          {/* 2. Its week, Monday to Sunday. */}
          <StatBox icon={<CalendarDays aria-hidden />} label="This week">
            {loading ? <StatEmpty loading /> : (
              <>
                <StatValue>{week.target ? `${week.sessions} of ${week.target}` : week.sessions}</StatValue>
                <WeekDots week={week.week} />
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
    </Cell>
  )
}

/** Seven small marks, Monday to Sunday: filled = trained, ring = planned. */
function WeekDots({ week }: { week: { date: string; letter: string; mark: WeekDayMark; shown: boolean }[] }) {
  return (
    <ol className="mt-0.5 grid grid-cols-7 gap-0.5" aria-label="This week, Monday to Sunday">
      {week.map(d => (
        <li key={d.date} className="flex flex-col items-center gap-0.5" aria-label={`${formatWeekdayDate(d.date)}: ${MARK_WORD[d.mark]}`}>
          <span aria-hidden className={cx('text-micro leading-none', d.shown ? 'font-bold text-fg' : 'text-fg-faint')}>{d.letter}</span>
          <span aria-hidden className={cx('h-2.5 w-2.5 rounded-full border-2', MARK_CLASS[d.mark])} />
        </li>
      ))}
    </ol>
  )
}

/** Nothing planned that day: the next session, and a menu to plan one of the routines. */
function RestDayBox({ date, label, loading }: { date: string; label: string; loading: boolean }) {
  const lookaheadTo = shiftDateStr(date, NEXT_SESSION_LOOKAHEAD_DAYS)
  const { data: blocks = [] } = useTrainingBlocks(date, lookaheadTo)
  const { data: templates = [] } = useScheduleBlocks()
  const { data: routines = [] } = useHevyRoutines()
  const next = useMemo(() => pickNextTrainingSession({
    blocks, templates: templates.filter(t => t.category === 'training'), today: shiftDateStr(date, 1), nowHHMM: '00:00',
    lookaheadDays: NEXT_SESSION_LOOKAHEAD_DAYS - 1,
  }), [blocks, templates, date])
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
                  <button type="button" className="menu-item" onClick={() => openPlanRoutine(r, { date })}>{r.title}</button>
                </MenuItem>
              ))}
            </MenuItems>
          </Menu>
        )}
      </div>
      <StatNote>{next ? `Next: ${next.title} · ${formatWeekdayDate(next.date)}` : 'Nothing planned ahead'}</StatNote>
    </StatBox>
  )
}
