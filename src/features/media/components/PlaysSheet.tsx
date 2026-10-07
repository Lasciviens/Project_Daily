import { useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { ModalShell } from '../../../shared/modals/ModalShell'
import { Button, IconButton } from '../../../shared/ui'
import { DateInput } from '../../../shared/components/DateInput'
import { todayStr } from '../../../shared/utils/dateUtils'
import { isUnknownWatchedAt } from '../trakt/traktDates'
import { middayIso } from '../watchedWhen'

export interface PlaysAsk {
  title: string
  subtitle?: string
  /** How many times it counts as watched now (1 + repeat_count). */
  plays: number
  /** The kept (latest) watched time: ISO, null (movie, unknown) or the epoch (episode, unknown). */
  at: string | null
  target: 'movie' | 'episode'
}

export interface PlaysAnswer {
  plays: number
  /** The time to store: ISO, null for an unknown movie date, the epoch for an unknown episode date. */
  at: string | null
  /** True when the date was left as it was (no need to write it). */
  dateKept: boolean
}

const MAX_PLAYS = 99

/**
 * The advanced edit for a watched title or episode: how many times it was
 * watched and the date the app keeps (the latest play). Changing only the
 * count keeps that date — "Watched again" always asked for a new one.
 */
export function PlaysSheet({ ask, onDone }: { ask: PlaysAsk; onDone: (a: PlaysAnswer | null) => void }) {
  const knownAt = ask.at && !isUnknownWatchedAt(ask.at) ? ask.at : null
  const startDay = knownAt ? localDay(knownAt) : ''
  const [plays, setPlays] = useState(Math.max(1, ask.plays))
  const [day, setDay] = useState(startDay)
  const [unknown, setUnknown] = useState(!knownAt)

  const dateKept = unknown ? !knownAt : day === startDay
  const valid = unknown || day.length === 10
  const changed = plays !== ask.plays || !dateKept

  function save() {
    if (!valid) return
    const at = dateKept ? ask.at
      : unknown ? (ask.target === 'movie' ? null : '1970-01-01T00:00:00.000Z')
      : middayIso(day)
    onDone({ plays, at, dateKept })
  }

  return (
    <ModalShell
      onClose={() => onDone(null)}
      size="xs"
      layer="confirm"
      title={ask.title}
      subtitle={ask.subtitle ?? 'Plays and date'}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onDone(null)}>Cancel</Button>
          <Button variant="primary" disabled={!valid || !changed} onClick={save}>Save</Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-body font-medium text-fg">Times watched</span>
          <div className="flex items-center gap-1">
            <IconButton label="One less" bordered disabled={plays <= 1} onClick={() => setPlays(p => Math.max(1, p - 1))}><Minus /></IconButton>
            <input
              type="text"
              inputMode="numeric"
              aria-label="Times watched"
              value={plays}
              onChange={e => {
                const n = Number(e.target.value.replace(/\D/g, ''))
                setPlays(Math.min(MAX_PLAYS, Math.max(1, n || 1)))
              }}
              className="input h-11 w-14 text-center tabular-nums"
            />
            <IconButton label="One more" bordered disabled={plays >= MAX_PLAYS} onClick={() => setPlays(p => Math.min(MAX_PLAYS, p + 1))}><Plus /></IconButton>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-body font-medium text-fg">{plays > 1 ? 'Last watched' : 'Watched on'}</span>
          {!unknown && <DateInput value={day} max={todayStr()} onChange={setDay} aria-label="Watched on" className="max-w-[12rem]" />}
          <label className="flex min-h-[44px] items-center gap-2 text-body text-fg-2">
            <input type="checkbox" checked={unknown} onChange={e => setUnknown(e.target.checked)} className="h-4 w-4 accent-accent-500" />
            Date unknown
          </label>
        </div>

        <p className="text-meta text-fg-muted">
          The app keeps one date — the latest play. {plays < ask.plays
            ? 'Trakt gets its plays removed and sent again at this date.'
            : plays > ask.plays ? `The ${plays - ask.plays === 1 ? 'extra play goes' : `${plays - ask.plays} extra plays go`} to Trakt at this date.`
            : 'Trakt follows.'}
        </p>
      </div>
    </ModalShell>
  )
}

/** The local calendar day of a timestamp, yyyy-MM-dd. */
function localDay(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
