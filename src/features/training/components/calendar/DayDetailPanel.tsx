import { CalendarPlus, ChevronRight } from 'lucide-react'
import { Button, ListRow } from '../../../../shared/ui'
import { useEntityModal } from '../../../../shared/modals'
import { fmtDateEnGB } from '../../../../shared/utils/enGBDate'
import { formatDistance } from '../../setFormat'
import { openPlanSession } from '../../planTraining'
import { SESSION_STATUS_LABEL, planRefOf } from '../../sessionRef'
import { StravaTypeIcon } from '../StravaIcons'
import { DayMarkGlyph, StravaBar } from './DayMarkGlyph'
import { planStartHHMM, sessionPlanNote, workoutStartHHMM, type DaySession, type OpenPlan } from './calendarSessions'
import { getWorkoutDuration, isDayEmpty, type DayData } from './calendarModel'

type Entry =
  | { kind: 'session'; at: string | null; session: DaySession }
  | { kind: 'plan'; at: string | null; open: OpenPlan }

const chevron = <ChevronRight aria-hidden className="h-4 w-4 text-fg-faint" />
const glyphSlot = 'grid w-4 place-items-center'

/**
 * The selected day under the month grid: one row per real session. A row
 * opens the session popup — the workout (what was lifted), or the plan (its
 * exercises and targets); changing a plan is behind that popup's ⋯. A plan a
 * workout covered is part of that workout's row, never a second row.
 */
export function DayDetailPanel({ day, dateStr, todayStr }: { day: DayData | null; dateStr: string; todayStr: string }) {
  const modal = useEntityModal()
  if (!day) return null
  const canPlan = dateStr >= todayStr
  const empty = isDayEmpty(day)

  const entries: Entry[] = [
    ...day.sessions.map(session => ({ kind: 'session' as const, at: workoutStartHHMM(session.workout), session })),
    ...day.openPlans.map(open => ({ kind: 'plan' as const, at: planStartHHMM(open.plan), open })),
  ].sort((a, b) => (a.at ?? '99:99').localeCompare(b.at ?? '99:99'))

  const heading = fmtDateEnGB(new Date(`${dateStr}T12:00:00`), { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div className="flex flex-col gap-1 border-t border-line pt-3">
      <div className="flex min-h-[36px] flex-wrap items-center justify-between gap-2">
        <p className="text-body font-semibold text-fg">{heading}{dateStr === todayStr && <span className="font-normal text-fg-muted"> · Today</span>}</p>
        {canPlan && <Button size="sm" variant="ghost" icon={<CalendarPlus />} onClick={() => openPlanSession(dateStr)}>Plan a session</Button>}
      </div>

      {entries.map(e => {
        if (e.kind === 'session') {
          const w = e.session.workout
          const dur = getWorkoutDuration(w)
          const note = sessionPlanNote(e.session)
          return (
            <ListRow
              key={w.id}
              className="-mx-3"
              leading={<span className={glyphSlot}><DayMarkGlyph mark="done" /></span>}
              title={w.title}
              subtitle={[e.at, dur != null ? `${dur} min` : null, note].filter(Boolean).join(' · ')}
              trailing={chevron}
              onClick={() => modal.open({ kind: 'training-session', workoutId: w.id })}
            />
          )
        }
        const { plan, status } = e.open
        const ref = planRefOf(plan, dateStr)
        const mark = status === 'done' ? 'done' : status
        return (
          <ListRow
            key={plan.id}
            className="-mx-3"
            leading={<span className={glyphSlot}><DayMarkGlyph mark={mark} /></span>}
            title={`${plan.kind === 'recurring' ? '⟳ ' : ''}${plan.title}`}
            subtitle={[e.at, status === 'done' ? 'Done on Strava' : SESSION_STATUS_LABEL[status]].filter(Boolean).join(' · ')}
            trailing={ref ? chevron : undefined}
            onClick={ref ? () => modal.open({ kind: 'training-session', plan: ref }) : undefined}
          />
        )
      })}

      {day.activities.map(a => (
        <ListRow
          key={a.id}
          className="-mx-3"
          leading={<span className="flex w-4 flex-col items-center gap-0.5"><StravaTypeIcon type={a.type} className="h-4 w-4 text-fg-muted" /><StravaBar /></span>}
          title={a.title}
          subtitle="Strava"
          meta={a.distance_meters ? formatDistance(a.distance_meters) : undefined}
        />
      ))}

      {empty && <p className="py-1 text-meta text-fg-muted">{canPlan ? 'Nothing planned yet.' : 'Nothing planned or logged.'}</p>}
    </div>
  )
}
