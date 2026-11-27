import { Check, Circle, CircleDot, Minus } from 'lucide-react'
import { KeepRoom, Skeleton, Truncate, cx } from '../../../../shared/ui'
import { InfoBubble } from '../../../../shared/components/InfoBubble'
import { useEntityModal } from '../../../../shared/modals'
import { formatDate, formatWeekdayDate } from '../../../../shared/utils/dateFormat'
import { mondayOfStr } from '../../../../shared/utils/dateUtils'
import { useTrainingWeek } from '../../hooks/useTrainingWeek'
import { planRefOf } from '../../sessionRef'
import { gapNote, shiftShort, todaysCall, weekSessionWord, type WeekMark, type WeekSession } from '../../plan/sessionState'
import { daysBetween } from '../../plan/nextSession'
import { useTodayStr } from '../../../../shared/hooks/useToday'
import type { CalendarPlanItem } from '../calendar/calendarModel'

// The This week strip (owner, 27.11.2026: "Missed sessions, sessions I did but in different days.. What I actually
// should do"): one chip per planned session of the week in the program's order — ✓ done (+1d late, −1d early),
// ● next, ○ still to do, – dropped or skipped. Every word comes from plan/sessionState (weekSessionWord); a tap opens
// the session popup. One component for Next, Log and Daily's Training card. Missed or dropped is never a warning.

const ICON: Record<WeekMark, typeof Check> = { done: Check, next: CircleDot, open: Circle, carried: Circle, dropped: Minus, skipped: Minus }
const ICON_TONE: Record<WeekMark, string> = {
  done: 'text-success', next: 'text-info', open: 'text-fg-muted', carried: 'text-fg-muted', dropped: 'text-fg-faint', skipped: 'text-fg-faint',
}
const SUFFIX: Partial<Record<WeekMark, string>> = { next: 'next', carried: 'next wk', dropped: 'dropped', skipped: 'skipped' }

function Chip({ s, plan }: { s: WeekSession; plan: CalendarPlanItem | undefined }) {
  const modal = useEntityModal()
  const Icon = ICON[s.mark]
  const suffix = s.mark === 'done' ? shiftShort(s.shift) : SUFFIX[s.mark] ?? ''
  const words = `${s.title} · ${formatWeekdayDate(s.date)} — ${weekSessionWord(s)}`
  const open = () => {
    if (s.mark === 'done' && s.status.workoutId) { modal.open({ kind: 'training-session', workoutId: s.status.workoutId }); return }
    const ref = plan ? planRefOf(plan, s.date) : null
    if (ref) modal.open({ kind: 'training-session', plan: ref })
  }
  return (
    <li className="min-w-0 max-w-full">
      <button type="button" onClick={open} title={words} aria-label={words} data-tip={words}
        className={cx('inline-flex max-w-full min-w-0 items-center gap-1 rounded-full border px-2.5 py-1 text-meta transition-colors hover:bg-surface-hover',
          s.mark === 'next' ? 'border-line-strong bg-surface font-semibold text-fg' : 'border-line bg-surface-2 text-fg-2',
          (s.mark === 'dropped' || s.mark === 'skipped') && 'text-fg-muted')}>
        <Icon aria-hidden className={cx('h-3.5 w-3.5 shrink-0', ICON_TONE[s.mark])} />
        <Truncate className="min-w-0">{s.title}</Truncate>
        {suffix && <span aria-hidden className="shrink-0 font-normal tabular-nums text-fg-muted">{suffix}</span>}
      </button>
    </li>
  )
}

/** The week of `date` (today's by default) as chips. `ids`: where it is shown, for the room it keeps while it loads. */
export function ThisWeekStrip({ date, where, className }: { date?: string; where: string; className?: string }) {
  const { week, planOf, isLoading, isError } = useTrainingWeek(date)
  const today = useTodayStr()
  const label = week.monday === mondayOfStr(today) ? 'This week' : `Week of ${formatDate(week.monday)}`
  return (
    <KeepRoom ids={`training:week:${where}`} loading={isLoading} remember={!isError} first="none" className={className}
      skeleton={<Skeleton rounded="rounded-card" className="h-14 w-full" />}>
      {week.sessions.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="section-label flex items-center gap-1.5">
            {label}
            <InfoBubble>
              Your planned sessions in your program&apos;s order. A workout done up to <b>2 days early</b> or later in the
              session&apos;s week counts as that session; done on another session&apos;s day, it counts as its own and the
              other stays to do. Next is the first session still to do — a missed one comes first and the rest shift, one a
              day. At most one is carried into next week; the rest are dropped — no catch-up needed. A missed session never
              lowers your progress.
            </InfoBubble>
          </p>
          <ul className="flex flex-wrap gap-1.5" aria-label={`${label}: the planned sessions`}>
            {week.sessions.map(s => <Chip key={s.key} s={s} plan={planOf.get(s.key)} />)}
          </ul>
        </div>
      )}
    </KeepRoom>
  )
}

/** Today's call — one plain line at the top of Next, starting with a verb (sessionState.todaysCall), and the note
 *  after a break (S27–S29, gapNote): `lastTrained` is the last day any routine was trained. */
export function TodaysCall({ lastTrained, className }: { lastTrained: string | null; className?: string }) {
  const today = useTodayStr()
  const { week, isLoading } = useTrainingWeek()
  if (isLoading) return null
  const call = todaysCall(week, today)
  const gap = gapNote(lastTrained ? daysBetween(lastTrained, today) : null)
  if (!call && !gap) return null
  return (
    <div className={cx('flex flex-col gap-0.5', className)}>
      {call && <p className="text-body font-semibold text-fg">{call}</p>}
      {gap && <p className="text-meta text-fg-2">{gap}</p>}
    </div>
  )
}
