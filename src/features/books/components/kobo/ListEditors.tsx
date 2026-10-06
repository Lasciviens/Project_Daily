import { useState } from 'react'
import { Button } from '../../../../shared/ui'
import type { SettingDef } from '../../koboSettingsCatalogue'
import { cleanList } from '../../koboSettings'
import {
  WARMTH_ROWS, clockToHours, formatHours, hoursToClock, splitWarmth, visibleTimes, withTimeOrdered, withWarmth,
} from '../../kobo/autowarmth'
import type { Value } from '../../kobo/settingsView'
import { Switch } from './Switch'

type List = (number | null)[]
type ValueOf = (key: string) => Value | undefined

/** One of the list editors, picked by the catalogue's `list.editor`. */
export function ListEditor({ def, value, valueOf, onChange, disabled }: { def: SettingDef; value: List; valueOf: ValueOf; onChange: (v: List) => void; disabled?: boolean }) {
  if (def.list?.editor === 'schedule') return <ScheduleEditor def={def} value={value} simple={valueOf('autowarmth_easy_mode') !== false} onChange={onChange} disabled={disabled} />
  if (def.list?.editor === 'warmth') {
    return <WarmthEditor def={def} value={value} simple={valueOf('autowarmth_easy_mode') !== false}
      warmth={valueOf('autowarmth_control_warmth') !== false} night={valueOf('autowarmth_control_nightmode') !== false} onChange={onChange} disabled={disabled} />
  }
  return <PairEditor def={def} value={value} onChange={onChange} disabled={disabled} />
}

/** Save / Undo for a list edited as a whole (the Kobo stores it as one table). */
function DraftBar({ def, draft, saved, onSave, onUndo, note }: { def: SettingDef; draft: List; saved: List; onSave: () => void; onUndo: () => void; note?: string | null }) {
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved)
  const valid = !!def.list && cleanList(def.list, draft) !== undefined
  if (!dirty) return null
  return (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      <Button size="sm" variant="primary" disabled={!valid} onClick={onSave}>Save</Button>
      <Button size="sm" onClick={onUndo}>Undo</Button>
      {!valid && <span className="text-micro text-danger">Set at least one time.</span>}
      {note && <span className="text-micro text-fg-muted">{note}</span>}
    </div>
  )
}

const HOURS = Array.from({ length: 26 }, (_, i) => i - 1)
const MINUTES = Array.from({ length: 60 }, (_, i) => i)
const two = (n: number) => String(n).padStart(2, '0')
const hourLabel = (h: number) => h < 0 ? '−1 (day before)' : h === 24 ? '24 (midnight)' : two(h)

/** AutoWarmth's fixed times: one HH:MM per moment of the day, in order; Simple mode shows four. */
function ScheduleEditor({ def, value, simple, onChange, disabled }: { def: SettingDef; value: List; simple: boolean; onChange: (v: List) => void; disabled?: boolean }) {
  const [draft, setDraft] = useState<List | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const times = draft ?? value
  const labels = def.list?.labels ?? []
  const set = (i: number, v: number | null) => {
    const r = withTimeOrdered(times, i, v)
    setDraft(r.times)
    setNote(r.moved.length ? `Moved to keep the day in order: ${r.moved.map(j => labels[j]).join(', ')}.` : null)
  }
  return (
    <div className="flex w-full flex-col gap-1">
      <ul className="flex flex-col divide-y divide-line rounded-control border border-line">
        {visibleTimes(simple).map(i => {
          const x = times[i] ?? null
          // Turning a time back on starts from KOReader's own default for it.
          const fallback = Array.isArray(def.absent) ? def.absent[i] : null
          const { h, m } = hoursToClock(x ?? fallback ?? 12)
          return (
            <li key={i} className="flex flex-wrap items-center gap-2 px-3 py-1.5">
              <span className="min-w-0 flex-1 text-body text-fg">{labels[i]}</span>
              {x === null
                ? <span className="text-meta text-fg-muted">Not used</span>
                : (
                  <span className="flex items-center gap-1" aria-label={`${labels[i]} time`}>
                    <select className="input min-h-[44px] w-auto" value={h} disabled={disabled} aria-label={`${labels[i]} hour`}
                      onChange={e => set(i, clockToHours(Number(e.target.value), m))}>
                      {HOURS.map(o => <option key={o} value={o}>{hourLabel(o)}</option>)}
                    </select>
                    <span aria-hidden>:</span>
                    <select className="input min-h-[44px] w-auto" value={m} disabled={disabled} aria-label={`${labels[i]} minutes`}
                      onChange={e => set(i, clockToHours(h, Number(e.target.value)))}>
                      {MINUTES.map(o => <option key={o} value={o}>{two(o)}</option>)}
                    </select>
                  </span>
                )}
              <Switch on={x !== null} label={`Use ${labels[i]}`} disabled={disabled} onChange={on => set(i, on ? clockToHours(h, m) : null)} />
            </li>
          )
        })}
      </ul>
      {simple && <p className="text-micro text-fg-muted">Simple mode: turn it off to set every twilight step.</p>}
      <DraftBar def={def} draft={times} saved={value} note={note}
        onSave={() => { if (draft) onChange(draft); setDraft(null); setNote(null) }}
        onUndo={() => { setDraft(null); setNote(null) }} />
      <p className="sr-only">Times now: {times.map((t, i) => `${labels[i]} ${formatHours(t)}`).join(', ')}</p>
    </div>
  )
}

/** AutoWarmth's warmth per moment: 0–100 % and night mode; dawn and dusk share a value. */
function WarmthEditor({ def, value, simple, warmth, night, onChange, disabled }: {
  def: SettingDef; value: List; simple: boolean; warmth: boolean; night: boolean; onChange: (v: List) => void; disabled?: boolean
}) {
  const [draft, setDraft] = useState<number[] | null>(null)
  const current = draft ?? value.map(x => x ?? 0)
  const set = (i: number, percent: number, nightOn: boolean) => setDraft(withWarmth(current, i, percent, nightOn))
  return (
    <div className="flex w-full flex-col gap-1">
      <ul className="flex flex-col divide-y divide-line rounded-control border border-line">
        {WARMTH_ROWS.filter(r => !simple || !r.expert).map(r => {
          const { percent, night: nightOn } = splitWarmth(current[r.index])
          return (
            <li key={r.index} className="flex flex-wrap items-center gap-2 px-3 py-1.5">
              <span className="min-w-0 flex-1 text-body text-fg">{r.label}</span>
              {warmth && (
                <label className="flex items-center gap-2">
                  <input type="range" min={0} max={100} step={1} value={percent} disabled={disabled} aria-label={`${r.label} warmth`}
                    className="w-28 accent-accent-500" onChange={e => set(r.index, Number(e.target.value), nightOn)} />
                  <span className="w-12 text-right text-meta tabular-nums text-fg-2">{percent} %</span>
                </label>
              )}
              {night && (
                <span className="flex items-center gap-1 text-meta text-fg-muted">Night
                  <Switch on={nightOn} label={`${r.label}: night mode`} disabled={disabled} onChange={on => set(r.index, percent, on)} />
                </span>
              )}
            </li>
          )
        })}
      </ul>
      <DraftBar def={def} draft={current} saved={value}
        onSave={() => { if (draft) onChange(draft); setDraft(null) }} onUndo={() => setDraft(null)} />
    </div>
  )
}

/** Two numbers side by side (left/right margin, word spacing), saved on leaving a box. */
function PairEditor({ def, value, onChange, disabled }: { def: SettingDef; value: List; onChange: (v: List) => void; disabled?: boolean }) {
  const [draft, setDraft] = useState<(string | null)[]>([null, null])
  const spec = def.list
  const rangeOf = (i: number) => spec?.positions?.[i] ?? spec?.ranges?.[0] ?? [0, 100]
  const commit = (i: number) => {
    const text = draft[i]
    setDraft(d => d.map((x, j) => j === i ? null : x))
    if (text === null) return
    const n = Math.round(Number(text.replace(',', '.')))
    if (!text.trim() || !Number.isFinite(n)) return
    const [lo, hi] = rangeOf(i)
    const next = [...value]
    next[i] = Math.max(lo, Math.min(hi, n))
    if (JSON.stringify(next) !== JSON.stringify(value)) onChange(next)
  }
  return (
    <div className="flex flex-wrap items-end gap-3">
      {[0, 1].map(i => {
        const [lo, hi] = rangeOf(i)
        return (
          <label key={i} className="flex flex-col gap-0.5 text-micro text-fg-muted">
            {spec?.labels[i]}
            <span className="flex items-center gap-1.5">
              <input inputMode="numeric" className="input min-h-[44px] w-20 text-right tabular-nums" disabled={disabled}
                value={draft[i] ?? String(value[i] ?? '')} aria-label={`${def.label}: ${spec?.labels[i]}`}
                onChange={e => { const v = e.target.value; setDraft(d => d.map((x, j) => j === i ? v : x)) }}
                onBlur={() => commit(i)} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
              <span className="text-fg-faint">{def.unit === '%' ? '%' : ''} {lo}–{hi}</span>
            </span>
          </label>
        )
      })}
    </div>
  )
}
