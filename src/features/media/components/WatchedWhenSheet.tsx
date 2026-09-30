import { useState, type ReactNode } from 'react'
import { CalendarDays, CheckCheck, HelpCircle, PencilLine } from 'lucide-react'
import { ModalShell } from '../../../shared/modals/ModalShell'
import { Button } from '../../../shared/ui'
import { DateInput } from '../../../shared/components/DateInput'
import { todayStr } from '../../../shared/utils/dateUtils'
import { middayIso, type WatchedWhen } from '../watchedWhen'

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

export interface WatchedWhenAsk { title: string; subtitle?: string; releaseLabel?: string | null }

/** The Trakt app's "when did you watch it?" sheet: Just now · Release date · Other date · Unknown date. */
export function WatchedWhenSheet({ ask, onDone }: { ask: WatchedWhenAsk; onDone: (w: WatchedWhen | null) => void }) {
  const [picking, setPicking] = useState(false)
  // A day, never a time (owner rule): stored as midday local so no zone moves it.
  const [value, setValue] = useState(() => todayStr())
  return (
    <ModalShell onClose={() => onDone(null)} size="xs" layer="confirm" title={ask.title} subtitle={ask.subtitle ?? 'When did you watch it?'} bodyClassName="p-2">
      {!picking ? (
        <div className="divide-y divide-line overflow-hidden rounded-row border border-line">
          <Option icon={<CheckCheck />} label="Just now" onClick={() => onDone({ kind: 'now' })} />
          <Option icon={<CalendarDays />} label="Release date" hint={ask.releaseLabel} onClick={() => onDone({ kind: 'release' })} />
          <Option icon={<PencilLine />} label="Other date" onClick={() => setPicking(true)} />
          <Option icon={<HelpCircle />} label="Unknown date" onClick={() => onDone({ kind: 'unknown' })} />
        </div>
      ) : (
        <div className="flex flex-col gap-3 p-2">
          <span className="field-label" id="watched-when-at">Watched on</span>
          <DateInput value={value} onChange={setValue} max={todayStr()} aria-label="Watched on (DD.MM.YYYY)" className="input w-full" />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setPicking(false)}>Back</Button>
            <Button variant="primary" disabled={!value} onClick={() => onDone({ kind: 'other', iso: middayIso(value) })}>Save</Button>
          </div>
        </div>
      )}
    </ModalShell>
  )
}
