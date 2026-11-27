import { CalendarClock, Check, Circle, CircleDot, Minus } from 'lucide-react'
import { Button, KeepRoom, Skeleton, Truncate, cx } from '../../../../shared/ui'
import { InfoBubble } from '../../../../shared/components/InfoBubble'
import { useEntityModal } from '../../../../shared/modals'
import { formatDate, formatWeekdayDate } from '../../../../shared/utils/dateFormat'
import { mondayOfStr } from '../../../../shared/utils/dateUtils'
import { useTrainingWeek } from '../../hooks/useTrainingWeek'
import { useShiftTrainingSessions } from '../../hooks/useTrainingShift'
import { planRefOf } from '../../sessionRef'
import { gapNote, shiftOfferWords, todaysCall, weekChipWord, weekSessionWord, type ShiftOffer, type WeekMark, type WeekSession } from '../../plan/sessionState'
import { daysBetween } from '../../plan/nextSession'
import { useTodayStr } from '../../../../shared/hooks/useToday'
import type { CalendarPlanItem } from '../calendar/calendarModel'

// The This week strip (owner, 27.11.2026: "Missed sessions, sessions I did but in different days.. What I actually
// should do"): one chip per planned session of the week as it is stored — ✓ done (2d late, 1d early), ● next, ○ still
// to do (swapped), – skipped. Every word comes from plan/sessionState; a tap opens the session popup. When a session's
// day passed undone or one was done early it offers to move the rest of the cycle (owner: "It should be an option not
// must") — the tap moves them in the data, with Undo. One component for Next, Log and Daily's Training card. Missed is
// never a warning.

const ICON: Record<WeekMark, typeof Check> = { done: Check, next: CircleDot, open: Circle, skipped: Minus }
const ICON_TONE: Record<WeekMark, string> = { done: 'text-success', next: 'text-info', open: 'text-fg-muted', skipped: 'text-fg-faint' }

function Chip({ s, plan }: { s: WeekSession; plan: CalendarPlanItem | undefined }) {
  const modal = useEntityModal()
  const Icon = ICON[s.mark]
  const suffix = weekChipWord(s)
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
          s.mark === 'skipped' && 'text-fg-muted')}>
        <Icon aria-hidden className={cx('h-3.5 w-3.5 shrink-0', ICON_TONE[s.mark])} />
        <Truncate className="min-w-0">{s.title}</Truncate>
        {suffix && <span aria-hidden className="shrink-0 font-normal tabular-nums text-fg-muted">{suffix}</span>}
      </button>
    </li>
  )
}

/** The offer to move the rest of the cycle: its question and one short button (the full words in its tooltip). */
function ShiftOfferLine({ offer }: { offer: ShiftOffer }) {
  const shift = useShiftTrainingSessions()
  const w = shiftOfferWords(offer)
  const taskId = offer.anchor.taskId
  if (!taskId) return null
  return (
    <div className="flex items-center gap-2">
      <p className="min-w-0 flex-1 text-meta text-fg-2">{w.question}</p>
      <Button size="sm" icon={<CalendarClock />} tip={w.tip} loading={shift.isPending}
        onClick={() => shift.mutate({ taskId, days: offer.days })}>{w.button}</Button>
    </div>
  )
}

/** The week of `date` (today's by default) as chips. `where`: where it is shown, for the room it keeps while it loads. */
/** `heading={false}`: a card that names the week itself (Daily's "This week" box) shows only the chips. */
export function ThisWeekStrip({ date, where, className, heading = true }: { date?: string; where: string; className?: string; heading?: boolean }) {
  const { week, planOf, isLoading, isError } = useTrainingWeek(date)
  const today = useTodayStr()
  const thisWeek = week.monday === mondayOfStr(today)
  const label = thisWeek ? 'This week' : `Week of ${formatDate(week.monday)}`
  return (
    <KeepRoom ids={`training:week:${where}`} loading={isLoading} remember={!isError} first="none" className={className}
      skeleton={<Skeleton rounded="rounded-card" className="h-14 w-full" />}>
      {week.sessions.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {heading && <p className="section-label flex items-center gap-1.5">
            {label}
            <InfoBubble>
              Your planned sessions, on the days they are planned. A workout counts as its session from <b>2 days early</b>
              up to <b>6 days late</b>, inside the session&apos;s week; done on another session&apos;s day, it counts as
              its own and the other stays to do. Next is the first session still to do — a missed one first. When a day
              passed undone, or a session was done early, you can move the rest of the cycle later or earlier, the rest
              days kept — only when you tap it, with Undo. A missed session never lowers your progress.
            </InfoBubble>
          </p>}
          <ul className="flex flex-wrap gap-1.5" aria-label={`${label}: the planned sessions`}>
            {week.sessions.map(s => <Chip key={s.key} s={s} plan={planOf.get(s.key)} />)}
          </ul>
          {thisWeek && week.offer && <ShiftOfferLine offer={week.offer} />}
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
