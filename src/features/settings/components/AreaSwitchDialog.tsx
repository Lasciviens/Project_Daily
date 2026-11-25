import { useState } from 'react'
import { ModalShell } from '../../../shared/modals'
import { Button } from '../../../shared/ui'
import { AREA_LABEL, type AreaSwitch, type CalendarPrefs } from '../../calendar/areas/calendarAreas'
import type { MoveFrom, SwitchProgress } from '../../calendar/areas/areaMoveApi'
import { useAreaSwitchPreview, useSwitchAreas } from '../../calendar/areas/useAreaSwitch'

// Settings → Calendar, an area turned on (2b-2): what moves into its Apple calendar, then the move itself.

const count = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`
const itemsText = (slots: number, plans: number) =>
  [slots ? count(slots, 'event') : '', plans ? count(plans, 'repeating plan') : ''].filter(Boolean).join(' and ') || 'nothing to move'

export function AreaSwitchDialog({ previous, next, switches, icloudConnected, onClose, onDone }: {
  /** The saved settings (put back when the move fails before anything moved). */
  previous: CalendarPrefs
  /** The settings as the form has them (saved by the move). */
  next: CalendarPrefs
  icloudConnected: boolean
  switches: AreaSwitch[]
  onClose: () => void
  onDone: () => void
}) {
  const [from, setFrom] = useState<MoveFrom>('today')
  const [progress, setProgress] = useState<SwitchProgress | null>(null)
  const preview = useAreaSwitchPreview(switches, from)
  const move = useSwitchAreas()
  const busy = move.isPending
  const title = switches.length === 1 ? `Move ${AREA_LABEL[switches[0].area].replace(/ \(.*\)$/, '')} to Apple Calendar?` : 'Move these areas?'

  function start() {
    setProgress(null)
    move.mutate({ previous, next, switches, from, icloudConnected, onProgress: setProgress }, { onSuccess: onDone })
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
          <Button block className="sm:w-auto" variant="primary" onClick={start} loading={busy} disabled={preview.isLoading}>Move</Button>
        </div>
      }
    >
      <div className="flex flex-col gap-2.5">
        <ul className="flex flex-col gap-1">
          {switches.map(s => {
            const p = preview.data?.find(x => x.area === s.area)
            return (
              <li key={s.area} className="text-meta text-fg-2">
                <span className="font-semibold">{next.areas[s.area].name}</span> → Apple Calendar:{' '}
                {preview.isLoading ? 'counting…' : p ? itemsText(p.slots, p.plans) : '–'}
              </li>
            )
          })}
        </ul>
        <label className="flex items-center gap-1.5 text-meta text-fg-2">
          Move
          <select className="select w-auto" value={from} disabled={busy} onChange={e => setFrom(e.target.value as MoveFrom)}>
            <option value="today">From today on</option>
            <option value="all">Every day, past ones too</option>
          </select>
        </label>
        <p className="text-meta text-fg-muted">
          The items of the area that go to a calendar are written to its Apple calendar. Google Tasks isn't touched.
          {from === 'today' && ' Single events before today stay only in the app until you change them; a repeating plan moves whole, with its days.'}
        </p>
        {preview.isError && <p role="alert" className="text-meta text-danger">The count could not be read: {(preview.error as Error).message}</p>}
        {preview.data?.some(p => p.partial) && <p className="text-meta text-fg-muted">This area has more items than one move takes; the rest stay where they are.</p>}
        {busy && progress && progress.total > 0 && <p role="status" className="text-meta text-fg-2">Moving… {Math.min(progress.done, progress.total)} of {progress.total}</p>}
      </div>
    </ModalShell>
  )
}
