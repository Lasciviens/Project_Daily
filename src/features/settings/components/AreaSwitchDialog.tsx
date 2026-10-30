import { useState } from 'react'
import { useCalendarStore } from '../../../app/store'
import { ModalShell } from '../../../shared/modals'
import { Button } from '../../../shared/ui'
import { AREA_LABEL, type AreaSwitch, type CalendarPrefs } from '../../calendar/areas/calendarAreas'
import type { MoveFrom, SwitchProgress } from '../../calendar/areas/areaMoveApi'
import { useAreaSwitchPreview, useSwitchAreas } from '../../calendar/areas/useAreaSwitch'

// Settings → Calendar, an area switched between Google Calendar and Apple Calendar (2b-2): what moves, then the
// move itself. The owner's rule both ways: the new copy first, confirmed, then the old one goes.

const appName = (to: AreaSwitch['to']) => (to === 'apple' ? 'Apple Calendar' : 'Google Calendar')
const count = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`
const itemsText = (slots: number, plans: number) =>
  [slots ? count(slots, 'event') : '', plans ? count(plans, 'repeating plan') : ''].filter(Boolean).join(' and ') || 'nothing to move'

export function AreaSwitchDialog({ next, switches, onClose, onDone }: {
  /** The settings as the form has them (saved by the move). */
  next: CalendarPrefs
  switches: AreaSwitch[]
  onClose: () => void
  onDone: () => void
}) {
  const [from, setFrom] = useState<MoveFrom>('today')
  const [progress, setProgress] = useState<SwitchProgress | null>(null)
  const preview = useAreaSwitchPreview(switches, from)
  const move = useSwitchAreas()
  const googleConnected = useCalendarStore(s => !!s.accessToken)
  const toApple = switches.some(s => s.to === 'apple')
  const toGoogle = switches.some(s => s.to === 'google')
  // Back to Google needs Google: without it every item would stay in Apple Calendar.
  const needsGoogle = toGoogle && !googleConnected
  const busy = move.isPending
  const title = switches.length === 1 ? `Move ${AREA_LABEL[switches[0].area].replace(/ \(.*\)$/, '')} to ${appName(switches[0].to)}?` : 'Move these areas?'

  function start() {
    setProgress(null)
    move.mutate({ next, switches, from, onProgress: setProgress }, { onSuccess: onDone })
  }

  return (
    <ModalShell
      open
      onClose={onClose}
      dismissible={!busy}
      size="sm"
      title={title}
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button block className="sm:w-auto" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button block className="sm:w-auto" variant="primary" onClick={start} loading={busy} disabled={needsGoogle || preview.isLoading}>Move</Button>
        </div>
      }
    >
      <div className="flex flex-col gap-2.5">
        <ul className="flex flex-col gap-1">
          {switches.map(s => {
            const p = preview.data?.find(x => x.area === s.area)
            return (
              <li key={s.area} className="text-meta text-fg-2">
                <span className="font-semibold">{next.areas[s.area].name}</span> → {appName(s.to)}:{' '}
                {preview.isLoading ? 'counting…' : p ? itemsText(p.slots, p.plans) : '–'}
              </li>
            )
          })}
        </ul>
        {toApple && (
          <label className="flex items-center gap-1.5 text-meta text-fg-2">
            Move
            <select className="select w-auto" value={from} disabled={busy} onChange={e => setFrom(e.target.value as MoveFrom)}>
              <option value="today">From today on</option>
              <option value="all">Every day, past ones too</option>
            </select>
          </label>
        )}
        {toApple && (
          <p className="text-meta text-fg-muted">
            Each one goes to Apple Calendar first; once Apple has it, its Google Calendar copy is removed. Google Tasks isn't touched.
            {from === 'today' && ' Past days stay in Google Calendar until you change them.'}
          </p>
        )}
        {toGoogle && (
          <p className="text-meta text-fg-muted">
            Each one is made in Google Calendar first; once Google has it, its Apple Calendar copy is removed.
          </p>
        )}
        {needsGoogle && <p role="alert" className="text-meta text-danger">Connect Google first (Settings → Subscriptions) — until then they stay in Apple Calendar.</p>}
        {preview.isError && <p role="alert" className="text-meta text-danger">The count could not be read: {(preview.error as Error).message}</p>}
        {preview.data?.some(p => p.partial) && <p className="text-meta text-fg-muted">There are more than one move reads; save again afterwards to move the rest.</p>}
        {busy && progress && progress.total > 0 && <p role="status" className="text-meta text-fg-2">Moving… {Math.min(progress.done, progress.total)} of {progress.total}</p>}
      </div>
    </ModalShell>
  )
}
