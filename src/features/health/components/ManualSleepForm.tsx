import { useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '../../../shared/ui'
import { DateInput } from '../../../shared/components/DateInput'
import { daysAgoStr, todayStr } from '../../../shared/utils/dateUtils'
import { estimateSleepStageProportions, manualNightKeys } from '../healthAggregate'
import { useAddManualSleep, useSleepData } from '../hooks/useHealthExport'

// Log (or correct) a night as source "Manual". The Deep/Core/REM split for
// the entered total comes from the last 30 nights, read only while this form
// is open (it used to be a third always-on sleep query, H-08).
export function ManualSleepForm({ initialDate, initialHours, onClose }: {
  initialDate: string
  /** Existing manual total for that night, if any — the form then corrects it. */
  initialHours: number | null
  onClose: () => void
}) {
  const today = todayStr()
  const [date, setDate] = useState(initialDate)
  const [hours, setHours] = useState(initialHours != null ? String(Math.round(initialHours * 100) / 100) : '')
  const correcting = initialHours != null && date === initialDate
  const history = useSleepData(daysAgoStr(29), today)
  // Only Watch-tracked nights: a manual night's split is itself an estimate.
  const manual = manualNightKeys(history.data?.points ?? [])
  const stageProportions = estimateSleepStageProportions((history.data?.nights ?? []).filter(n => !manual.has(n.date)))
  const add = useAddManualSleep()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const h = parseFloat(hours)
    if (!date || !h || h <= 0 || h > 24) return
    add.mutate({ date, totalHours: h, stageProportions }, { onSuccess: onClose })
  }

  return (
    // pr-12 keeps the fields clear of the absolutely-positioned 44px cancel button.
    <form onSubmit={submit} className="relative flex max-w-xl flex-wrap items-end gap-2 rounded-row border border-line bg-surface-2 p-3 pr-12">
      <button type="button" onClick={onClose} aria-label="Cancel" className="icon-btn absolute right-1.5 top-1.5">
        <X className="h-4 w-4" aria-hidden />
      </button>
      <div className="flex flex-col">
        <label className="field-label">Night ending</label>
        {/* DateInput, not a raw <input type="date">, so the date reads DD.MM.YYYY whatever the browser locale. */}
        <DateInput value={date} max={today} onChange={setDate} className="input w-40" />
      </div>
      <div className="flex flex-col">
        <label className="field-label" htmlFor="manual-sleep-hours">Hours slept</label>
        <input id="manual-sleep-hours" type="number" inputMode="decimal" step="0.25" min="0" max="24" placeholder="7.5"
          value={hours} onChange={e => setHours(e.target.value)} className="input w-24" />
      </div>
      <Button type="submit" variant="primary" loading={add.isPending}>
        {correcting ? 'Save correction' : 'Save sleep'}
      </Button>
      <p className="basis-full pr-6 text-meta text-fg-muted">
        {correcting
          ? 'Overwrites your previous manual entry for this night only — Watch-synced nights are never touched.'
          : `Logged as source "Manual" and used instead of any Watch data for that night. Deep/Core/REM split estimated from your ${stageProportions ? 'own last 30 nights' : 'typical adult average'}.`}
      </p>
    </form>
  )
}
