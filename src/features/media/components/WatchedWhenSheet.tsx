import { useState, type ReactNode } from 'react'
import { CalendarDays, CalendarRange, CheckCheck, HelpCircle, PencilLine } from 'lucide-react'
import { ModalShell } from '../../../shared/modals/ModalShell'
import { Button } from '../../../shared/ui'
import { DateCalendar } from '../../../shared/components/DateCalendar'
import { formatDate } from '../../../shared/utils/dateFormat'
import { todayStr } from '../../../shared/utils/dateUtils'
import { middayIso, watchedWhenOptions, type WatchedWhen, type WatchedWhenOption } from '../watchedWhen'

function Option({ icon, label, hint, onClick }: { icon: ReactNode; label: string; hint?: string | null; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[52px] w-full items-center gap-3 px-3 text-left transition-colors hover:bg-surface-hover [&_svg]:h-5 [&_svg]:w-5 [&_svg]:shrink-0 [&_svg]:text-fg-muted"
    >
      {icon}
      <span className="min-w-0 flex-1 text-body font-semibold text-fg">{label}</span>
      {hint && <span className="text-meta text-fg-muted tabular-nums">{hint}</span>}
    </button>
  )
}

const OPTIONS: Record<WatchedWhenOption, { icon: ReactNode; label: string }> = {
  now: { icon: <CheckCheck />, label: 'Just now' },
  release: { icon: <CalendarDays />, label: 'Release date' },
  other: { icon: <PencilLine />, label: 'Other date' },
  unknown: { icon: <HelpCircle />, label: 'Unknown date' },
  spread: { icon: <CalendarRange />, label: 'Spread over dates…' },
}

export interface WatchedWhenAsk {
  title: string
  subtitle?: string
  releaseLabel?: string | null
  /**
   * More than one episode (a selection, Up to here, completing a series): also
   * offer "Spread over dates…" (the Spread watched dates popup) as the 5th option.
   */
  allowSpread?: boolean
}

/** The sheet's answer: a time, or (several episodes) "spread them over a period". */
export type WatchedWhenAnswer = WatchedWhen | { kind: 'spread' }

/**
 * The Trakt app's "when did you watch it?" sheet — the ONE copy, asked through
 * `useWatchedWhenPrompt`: Just now · Release date · Other date · Unknown date
 * · Spread over dates… (several episodes only; `watchedWhenOptions`).
 */
export function WatchedWhenSheet({ ask, onDone }: { ask: WatchedWhenAsk; onDone: (w: WatchedWhenAnswer | null) => void }) {
  const [picking, setPicking] = useState(false)
  // A day, never a time (owner rule): stored as midday local so no zone moves it.
  const [value, setValue] = useState(() => todayStr())
  const choose = (kind: WatchedWhenOption) => {
    if (kind === 'other') setPicking(true)
    else onDone({ kind })
  }
  const hint = (kind: WatchedWhenOption) => (kind === 'release' ? ask.releaseLabel : kind === 'spread' ? 'Between two days' : null)
  return (
    <ModalShell onClose={() => onDone(null)} size="xs" layer="confirm" title={ask.title} subtitle={ask.subtitle ?? 'When did you watch it?'} bodyClassName="p-2">
      {!picking ? (
        <div className="divide-y divide-line overflow-hidden rounded-row border border-line">
          {watchedWhenOptions(!!ask.allowSpread).map(kind => (
            <Option key={kind} icon={OPTIONS[kind].icon} label={OPTIONS[kind].label} hint={hint(kind)} onClick={() => choose(kind)} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-2 p-2">
          <p className="text-body text-fg-2">Watched on <strong className="font-semibold tabular-nums text-fg">{formatDate(value)}</strong></p>
          <div className="flex justify-center"><DateCalendar value={value} max={todayStr()} onPick={setValue} /></div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setPicking(false)}>Back</Button>
            <Button variant="primary" disabled={!value} onClick={() => onDone({ kind: 'other', iso: middayIso(value) })}>Save</Button>
          </div>
        </div>
      )}
    </ModalShell>
  )
}
