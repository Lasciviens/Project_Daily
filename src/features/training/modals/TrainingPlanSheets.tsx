import { useState } from 'react'
import { CalendarClock, SkipForward } from 'lucide-react'
import { ModalShell, entityModal } from '../../../shared/modals'
import { findTwinOn } from '../api/trainingPlanApi'
import { planTwinMessage } from '../plan/planTwins'
import type { EntityModalProps } from '../../../shared/modals/types'
import { Button } from '../../../shared/ui'
import { DateStepperField, FieldLabel, Time24Field } from '../../../shared/components/plan-modal/fields'
import { formatWeekdayDate } from '../../../shared/utils/dateFormat'
import { shiftDateStr, todayStr } from '../../../shared/utils/dateUtils'
import { useTrainingPlanActions } from '../hooks/useTrainingPlanActions'
import { useSessionFirstDay } from '../hooks/useTrainingPlans'
import { movesPastWeek } from '../plan/sessionState'
import { SKIP_REASON_CHIPS, SKIP_REASON_MAX, composeSkipReason, isValidSkipReason } from '../plan/skippedRoutines'
import type { TrainingPlanRef } from '../api/trainingPlanApi'

const CHIP = 'min-h-[44px] rounded-full border px-3.5 text-body font-medium transition-colors duration-150'
const CHIP_ON = 'border-accent-500 bg-accent-500 text-on-accent'
const CHIP_OFF = 'border-line bg-surface text-fg-2 hover:bg-surface-hover'
// Room for the longest chip plus " — " inside the table's 500-character cap.
const DETAILS_MAX = SKIP_REASON_MAX - 20

const whenOf = (p: TrainingPlanRef) => [formatWeekdayDate(p.info.date), p.info.startHHMM].filter(Boolean).join(' · ')

const shiftHHMM = (hhmm: string, min: number) => {
  const [h, m] = hhmm.split(':').map(Number)
  const t = ((h * 60 + m + min) % 1440 + 1440) % 1440
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}

/** `training-plan-move`: a new day and time for one planned session. The
 *  task and its block move together (migration 142), and its Apple Calendar
 *  event with them. */
export function TrainingPlanMoveModal({ request, onClose }: EntityModalProps<'training-plan-move'>) {
  const { plan, toDate } = request
  const actions = useTrainingPlanActions()
  const today = todayStr()
  // The day asked for ("Plan it" on a picked day); else a session planned in
  // the past moves to today by default, a coming one to its own day.
  const [date, setDate] = useState(toDate ?? (plan.info.date < today ? today : plan.info.date))
  const [time, setTime] = useState((plan.info.startHHMM ?? '18:00').slice(0, 5))
  // A session whose time this view doesn't know keeps its own unless one is picked.
  const [timeTouched, setTimeTouched] = useState(false)
  const pickTime = (t: string) => { setTime(t); setTimeTouched(true) }
  const unchanged = date === plan.info.date && (plan.info.startHHMM ? time === plan.info.startHHMM.slice(0, 5) : !timeTouched)
  // A week is the session's first day and the next six (owner, 26.10.2026: "If it is moved more than 7 days then it is skipped").
  const firstDay = useSessionFirstDay(plan)
  const pastWeek = date !== plan.info.date && movesPastWeek(firstDay, date)

  const submit = async () => {
    // The same session already on that day: ask first (the plan editor's rule).
    if (date !== plan.info.date) {
      const twin = await findTwinOn(date, plan)
      if (twin && !(await entityModal.confirm({
        title: 'Plan this session twice?',
        message: `${planTwinMessage(twin)} Move it there anyway, or keep it where it is.`,
        confirmLabel: 'Move anyway',
        cancelLabel: 'Keep it here',
      }))) return
    }
    try { await actions.move(plan, date, plan.info.startHHMM || timeTouched ? time : null, pastWeek) } catch { return }
    onClose()
  }

  return (
    <ModalShell
      onClose={onClose}
      size="sm"
      dismissible={!actions.busy}
      title="Move session"
      subtitle={`${plan.info.title} · ${whenOf(plan)}`}
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button block className="sm:w-auto" onClick={onClose} disabled={actions.busy}>Cancel</Button>
          <Button block className="sm:w-auto" variant="primary" icon={<CalendarClock />} loading={actions.busy} disabled={unchanged} onClick={() => void submit()}>Move</Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <FieldLabel>Day</FieldLabel>
          <DateStepperField value={date} onChange={v => v && setDate(v)} onStep={d => setDate(shiftDateStr(date, d))} />
        </div>
        <div>
          <FieldLabel>Time</FieldLabel>
          <Time24Field value={time} onChange={pickTime} onShift={m => pickTime(shiftHHMM(time, m))} />
        </div>
        {pastWeek && firstDay
          ? <p data-tone="warn" className="tone-text text-meta">
              7+ days after its first day: it stays in its own week (skipped on {formatWeekdayDate(firstDay)} unless done), and that week's session of this plan comes here instead — none if that one is already done or skipped.
            </p>
          : <p className="text-meta text-fg-muted">The task and the calendar move together.</p>}
      </div>
    </ModalShell>
  )
}

/**
 * `training-plan-skip`: skip one planned session. A reason is always required
 * (the owner's rule). It can be moved instead. (The routine skip with no plan
 * went with the Missed sessions card, 213; an older one is still undone from
 * its session's popup — sessionActions' undoSkip by its id.)
 */
export function TrainingPlanSkipModal({ request, onClose }: EntityModalProps<'training-plan-skip'>) {
  const { plan } = request
  const actions = useTrainingPlanActions()
  const [chip, setChip] = useState<string | null>(null)
  const [details, setDetails] = useState('')
  const reason = composeSkipReason(chip, details)
  const valid = isValidSkipReason(reason)
  const busy = actions.busy

  const submit = async () => {
    if (!valid) return
    try {
      await actions.skip(plan, reason)
    } catch { return }
    onClose()
  }

  const instead = <Button block className="sm:w-auto" icon={<CalendarClock />} disabled={busy} onClick={() => { onClose(); actions.openMove(plan) }} tip="Move it instead">Move</Button>

  return (
    <ModalShell
      onClose={onClose}
      size="sm"
      dismissible={!busy}
      title="Skip session"
      subtitle={`${plan.info.title} · ${whenOf(plan)}`}
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button block className="sm:w-auto" onClick={onClose} disabled={busy}>Cancel</Button>
          {instead}
          <Button block className="sm:w-auto" variant="primary" icon={<SkipForward />} loading={busy} disabled={!valid} onClick={() => void submit()}>Skip session</Button>
        </div>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={e => { e.preventDefault(); void submit() }}>
        <div>
          <p className="field-label" id="skip-reason-label">Why are you skipping it?</p>
          <div className="flex flex-wrap gap-2" role="group" aria-labelledby="skip-reason-label">
            {SKIP_REASON_CHIPS.map(c => (
              <button key={c} type="button" aria-pressed={chip === c} className={`${CHIP} ${chip === c ? CHIP_ON : CHIP_OFF}`} onClick={() => setChip(prev => (prev === c ? null : c))}>
                {c}
              </button>
            ))}
          </div>
        </div>
        <label className="flex flex-col gap-1">
          <span className="field-label">{chip ? 'Details (optional)' : 'Or write your own reason'}</span>
          <textarea
            value={details}
            onChange={e => setDetails(e.target.value)}
            rows={2}
            maxLength={DETAILS_MAX}
            placeholder={chip ? 'e.g. flu since Thursday' : 'e.g. work trip to Bergen'}
            className="input w-full py-2"
          />
        </label>
        <p className="text-meta text-fg-muted">
          {!valid
            ? 'A reason is required — pick one above or write at least 3 characters.'
            : 'The session shows as skipped, with your reason, and its task is cancelled. Undo brings it back.'}
        </p>
      </form>
    </ModalShell>
  )
}
