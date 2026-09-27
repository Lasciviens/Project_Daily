import { useState } from 'react'
import { ModalShell } from '../../../../shared/modals'
import { Button } from '../../../../shared/ui'
import { useSkipTrainingSession } from '../../hooks/useTrainingSkips'
import { SKIP_REASON_CHIPS, SKIP_REASON_MAX, composeSkipReason, isValidSkipReason, type RoutineAttention } from '../../plan/skippedRoutines'
import { shortDay } from './missedSessionCopy'

const CHIP = 'min-h-[44px] rounded-full border px-3.5 text-body font-medium transition-colors duration-150'
const CHIP_ON = 'border-accent-500 bg-accent-500 text-on-accent'
const CHIP_OFF = 'border-line bg-surface text-fg-2 hover:bg-surface-hover'
const FORM_ID = 'skip-session-form'

// Room for the longest chip plus " — " inside the table's 500-character cap.
const DETAILS_MAX = SKIP_REASON_MAX - 20

/** Skip one missed current-program session. A reason is required (the
 *  owner's rule): a quick chip, a sentence, or both. */
export function SkipSessionSheet({ item, onClose }: { item: RoutineAttention | null; onClose: () => void }) {
  const skip = useSkipTrainingSession()
  // The last item stays rendered while the sheet animates closed; a new item
  // starts with an empty form (state adjusted during render, not in an effect).
  const [shown, setShown] = useState(item)
  const [chip, setChip] = useState<string | null>(null)
  const [details, setDetails] = useState('')
  if (item && item !== shown) {
    if (!shown || shown.routineId !== item.routineId || shown.weekStart !== item.weekStart) { setChip(null); setDetails('') }
    setShown(item)
  }

  const reason = composeSkipReason(chip, details)
  const valid = isValidSkipReason(reason)

  const submit = async () => {
    if (!shown || !valid) return
    try {
      await skip.mutateAsync({ routine_id: shown.routineId, week_start: shown.weekStart, reason })
    } catch { return }
    onClose()
  }

  return (
    <ModalShell
      open={item != null}
      onClose={onClose}
      size="sm"
      dismissible={!skip.isPending}
      title="Skip session"
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button block className="sm:w-auto" onClick={onClose} disabled={skip.isPending}>Cancel</Button>
          <Button block className="sm:w-auto" type="submit" form={FORM_ID} variant="primary" loading={skip.isPending} disabled={!valid}>Skip session</Button>
        </div>
      }
    >
      {shown && (
        <form id={FORM_ID} className="flex flex-col gap-4" onSubmit={e => { e.preventDefault(); void submit() }}>
          <p className="text-body text-fg-2">
            <span className="break-words font-semibold text-fg">{shown.title}</span> · due {shortDay(shown.dueDate)}
          </p>
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
            {valid
              ? 'Only this session stops being flagged. If the next one is missed too, you’ll be asked again.'
              : 'A reason is required — pick one above or write at least 3 characters.'}
          </p>
        </form>
      )}
    </ModalShell>
  )
}
