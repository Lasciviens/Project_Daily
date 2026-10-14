import { useState } from 'react'
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react'
import { ModalShell } from '../../../shared/modals/ModalShell'
import { Button, IconButton } from '../../../shared/ui'
import { DateInput } from '../../../shared/components/DateInput'
import { todayStr } from '../../../shared/utils/dateUtils'
import { isUnknownWatchedAt } from '../trakt/traktDates'
import { middayIso } from '../watchedWhen'
import { sortWatches, watchDate, type Watch } from '../watches'

const EPOCH = '1970-01-01T00:00:00.000Z'

/** The local calendar day of a timestamp, yyyy-MM-dd. */
function localDay(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** A day, or "date unknown": the one editor for adding a watch and for changing one's date. */
function WatchDateEditor({ start, target, saveLabel, onSave, onCancel }: {
  start: string | null
  target: 'movie' | 'episode'
  saveLabel: string
  onSave: (at: string | null) => void
  onCancel: () => void
}) {
  const known = start && !isUnknownWatchedAt(start) ? start : null
  const [day, setDay] = useState(known ? localDay(known) : todayStr())
  const [unknown, setUnknown] = useState(!!start && !known)
  const valid = unknown || day.length === 10
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-row bg-surface-2 px-2 py-1">
      {!unknown && <DateInput value={day} max={todayStr()} onChange={setDay} aria-label="Watched on" className="input w-[8rem] tabular-nums" />}
      <label className="flex min-h-[36px] items-center gap-1.5 whitespace-nowrap text-meta text-fg-2">
        <input type="checkbox" checked={unknown} onChange={e => setUnknown(e.target.checked)} className="h-4 w-4 accent-accent-500" />
        Date unknown
      </label>
      <span className="ml-auto flex items-center gap-1">
        <IconButton label="Cancel" onClick={onCancel}><X /></IconButton>
        <Button size="sm" variant="primary" icon={<Check />} disabled={!valid} aria-label={saveLabel} title={saveLabel} className="px-2.5"
          onClick={() => onSave(unknown ? (target === 'movie' ? null : EPOCH) : middayIso(day))} />
      </span>
    </div>
  )
}

/**
 * Every watch of one episode or movie with its own date (migration 149): change
 * one's date, remove one (the one delete flow, with Undo), add one. Each
 * change reaches Trakt as that one play — the others keep theirs. Before 149
 * (`editable` false) it only shows the plays at the one date the app kept.
 */
export function WatchesSheet({ title, target, watches, editable, busy, onClose, onAdd, onSetDate, onRemove }: {
  title: string
  target: 'movie' | 'episode'
  watches: readonly Watch[]
  editable: boolean
  busy?: boolean
  onClose: () => void
  onAdd: (at: string | null) => Promise<unknown>
  onSetDate: (watch: Watch, at: string | null) => Promise<unknown>
  onRemove: (watch: Watch) => Promise<unknown>
}) {
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const list = sortWatches(watches)
  const run = async (p: Promise<unknown>) => { await p; setEditing(null) }

  return (
    <ModalShell
      onClose={onClose}
      size="xs"
      title={title}
      subtitle={list.length === 1 ? 'Watched once' : `${list.length} watches`}
      footer={
        <div className="flex justify-between gap-2">
          {editable && editing !== 'new'
            ? <Button variant="ghost" icon={<Plus />} disabled={busy} onClick={() => setEditing('new')}>Add a watch</Button>
            : <span />}
          <Button variant="primary" onClick={onClose}>Done</Button>
        </div>
      }
    >
      <div className="flex flex-col gap-1">
        {list.map((w, i) => editing === w.id ? (
          <WatchDateEditor key={w.id} start={w.watched_at} target={target} saveLabel="Save"
            onCancel={() => setEditing(null)} onSave={at => { void run(onSetDate(w, at)) }} />
        ) : (
          <div key={w.id} className="flex min-h-[40px] items-center gap-2 rounded-row px-2 hover:bg-surface-hover">
            <span className="w-6 shrink-0 text-micro font-semibold tabular-nums text-fg-faint">{i + 1}.</span>
            <span className="min-w-0 flex-1 text-body tabular-nums text-fg">{watchDate(w)}</span>
            {editable && (
              <>
                <IconButton label={`Change the date of watch ${i + 1}`} disabled={busy} onClick={() => setEditing(w.id)} className="text-fg-muted"><Pencil /></IconButton>
                <IconButton label={`Remove watch ${i + 1}`} disabled={busy} onClick={() => { void onRemove(w) }} className="text-fg-muted hover:text-danger"><Trash2 /></IconButton>
              </>
            )}
          </div>
        ))}
        {editing === 'new' && (
          <WatchDateEditor start={null} target={target} saveLabel="Add"
            onCancel={() => setEditing(null)} onSave={at => { void run(onAdd(at)) }} />
        )}
        <p className="mt-1 px-2 text-meta text-fg-muted">
          {editable
            ? 'Each watch keeps its own date, here and on Trakt — a change moves only that one.'
            : 'The app kept one date for every play here; each watch with its own date comes with the next update.'}
        </p>
      </div>
    </ModalShell>
  )
}
