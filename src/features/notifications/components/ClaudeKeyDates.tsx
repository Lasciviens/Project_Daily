import { useState } from 'react'
import { Eraser, Save } from 'lucide-react'
import { Button, SegmentedControl } from '../../../shared/ui'
import { DateInput } from '../../../shared/components/DateInput'
import { formatDate } from '../../../shared/utils/dateFormat'
import { todayStr } from '../../../shared/utils/dateUtils'
import { keyEndDay, keyHint, MAX_DURATION, type DurationUnit } from '../keyExpiry'
import { noticeWhen } from '../notificationKinds'
import type { KeyDates } from '../api/keyExpiryApi'
import { useClaudeKeyDates, useClearClaudeKeyDates, useSaveClaudeKeyDates } from '../hooks/useNotifications'

// The Claude API key's dates on Settings → Subscriptions → Anthropic (owner, 25.11.2026: "type a start date (default
// today) + a duration; the app computes the end, warns 14/7/1 days and on rejection"). The key is a server secret the
// app never reads: only these dates and, if typed, its last 4 characters are kept (212's integration_expiry).

export function ClaudeKeyDates() {
  const stored = useClaudeKeyDates()
  if (stored.isLoading) return <div aria-busy="true" className="h-[7.5rem]" />
  if (stored.isError) return <p role="alert" className="text-meta text-fg-muted">The key dates could not be read.</p>
  // Keyed on the stored row, so the form starts again from what was saved.
  return <KeyDatesForm key={stored.data ? `${stored.data.id}:${stored.data.ends_on}:${stored.data.key_hint}` : 'new'} stored={stored.data ?? null} />
}

function KeyDatesForm({ stored }: { stored: KeyDates | null }) {
  const [startsOn, setStartsOn] = useState(stored?.starts_on ?? todayStr())
  const [count, setCount] = useState(String(stored?.duration_count ?? 12))
  const [unit, setUnit] = useState<DurationUnit>(stored?.duration_unit ?? 'months')
  const [hint, setHint] = useState(stored?.key_hint ?? '')
  const save = useSaveClaudeKeyDates()
  const clear = useClearClaudeKeyDates()

  const n = Number(count)
  const endsOn = startsOn ? keyEndDay(startsOn, n, unit) : null
  const hintValue = keyHint(hint)
  const problem = !startsOn ? 'Type the day the key was made'
    : endsOn === null ? `A duration of 1 to ${MAX_DURATION[unit]} ${unit}`
    : hintValue === undefined ? 'The last 4 characters of the key, or nothing'
    : null
  const changed = !stored || stored.starts_on !== startsOn || stored.duration_count !== n || stored.duration_unit !== unit
    || (stored.key_hint ?? null) !== (hintValue ?? null)
  const today = todayStr()

  return (
    <div className="flex flex-col gap-2.5 border-t border-line pt-3">
      <p className="text-meta text-fg-2">
        When the key ends: the app warns you 14, 7 and 1 days before, and when Anthropic rejects it.
        Only these dates are kept, never the key.
      </p>
      <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
        <label className="flex flex-col items-start gap-1">
          <span className="text-micro font-semibold text-fg-muted">Made on</span>
          <DateInput value={startsOn} onChange={setStartsOn} aria-label="Made on: the day the key was made" className="input w-[8.5rem]" />
        </label>
        <label className="flex flex-col items-start gap-1">
          <span className="text-micro font-semibold text-fg-muted">Lasts</span>
          <span className="flex items-center gap-1.5">
            <input className="input w-16 text-center tabular-nums" inputMode="numeric" value={count} aria-label={`Lasts: how many ${unit}`}
              onChange={e => setCount(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))} />
            <SegmentedControl size="sm" label="Days or months" value={unit} onChange={setUnit}
              options={[{ value: 'days', label: 'Days', tip: 'Days: the duration in days' }, { value: 'months', label: 'Months', tip: 'Months: the duration in months' }]} />
          </span>
        </label>
        <label className="flex flex-col items-start gap-1">
          <span className="text-micro font-semibold text-fg-muted">Last 4</span>
          <input className="input w-20 font-mono" value={hint} maxLength={4} autoComplete="off" spellCheck={false}
            aria-label="Last 4: the key's last 4 characters (optional, to tell keys apart)" placeholder="optional"
            onChange={e => setHint(e.target.value.slice(0, 4))} />
        </label>
      </div>
      <p className="text-meta tabular-nums text-fg-2" aria-live="polite">
        {problem
          ? <span className="text-danger">{problem}</span>
          : <>Ends <span className="font-semibold text-fg">{formatDate(endsOn)}</span> ({(endsOn as string) < today ? 'passed' : noticeWhen(today, endsOn as string)})</>}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="primary" icon={<Save />} disabled={!!problem || !changed} loading={save.isPending}
          tip="Save: keep the key's dates and warn before it ends"
          onClick={() => save.mutate({ startsOn, count: n, unit, keyHint: hintValue ?? null })}>
          Save
        </Button>
        {stored && (
          <Button size="sm" variant="ghost" icon={<Eraser />} loading={clear.busy} tip="Clear: forget the key's dates (no more warnings)"
            onClick={() => clear.run([stored.id], { title: 'Clear the key dates?', message: `Ends ${formatDate(stored.ends_on)}: no more warnings about it.`, done: 'Key dates cleared' })}>
            Clear
          </Button>
        )}
      </div>
    </div>
  )
}
