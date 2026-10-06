import { useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { IconButton, TonePill, cx } from '../../../../shared/ui'
import { HelpTip } from '../../../../shared/components/HelpTip'
import type { SettingDef } from '../../koboSettingsCatalogue'
import { baseUnit } from '../../kobo/durations'
import type { FontReport } from '../../kobo/fontChoices'
import { EFFECT_LABEL, formatValue, type SettingView, type Value } from '../../kobo/settingsView'
import { DurationInput } from './DurationInput'
import { FontPicker } from './FontPicker'
import { ListEditor } from './ListEditors'
import { Switch } from './Switch'

/** What a control needs to know about the other settings (sub-settings, the Kobo's fonts). */
export interface SettingContext {
  valueOf: (key: string) => Value | undefined
  fonts: FontReport | null
}

export { Switch }

/** What the "?" shows: the plain explanation, an example, where it lives on the Kobo and its default. */
export function SettingHelp({ def }: { def: SettingDef }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-body font-semibold text-fg">{def.label}</p>
      <p>{def.help}</p>
      {def.example && (
        <p className="rounded-control border-l-2 border-accent-400 bg-surface-2 px-2.5 py-1.5 text-fg-2">
          <span className="font-semibold text-fg">Example: </span>{def.example}
        </p>
      )}
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-micro text-fg-muted">
        <dt>Default</dt><dd className="text-fg-2">{formatValue(def, def.absent)}</dd>
        <dt>Takes effect</dt><dd className="text-fg-2">{EFFECT_LABEL[def.effect]}</dd>
        <dt>On the Kobo</dt><dd className="text-fg-2">{def.path}</dd>
      </dl>
    </div>
  )
}

/** One KOReader setting: its name and "?", the control, and what the Kobo has now. */
export function SettingControl({ def, view, onChange, disabled, ctx, note }: {
  def: SettingDef
  view: SettingView
  /** A value, or null for "back to KOReader's default" (the Kobo then deletes the key). */
  onChange: (v: Value) => void
  disabled?: boolean
  ctx: SettingContext
  /** Why the setting does not apply right now (shown in search results). */
  note?: string | null
}) {
  const inline = def.type === 'bool'
  const block = def.type === 'list' && def.list?.editor !== 'pair'
  const reset = view.changed && (
    <IconButton label={`Reset “${def.label}” to the default`} disabled={disabled} onClick={() => onChange(null)}><RotateCcw /></IconButton>
  )
  return (
    <div className="flex flex-col gap-1.5 py-2.5 @container">
      <div className={cx('flex gap-2', inline || block ? 'items-center' : 'flex-col @[30rem]:flex-row @[30rem]:items-center')}>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <p className="min-w-0 text-body font-medium text-fg">{def.label}</p>
          <HelpTip label={`About “${def.label}”`}><SettingHelp def={def} /></HelpTip>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {!block && <Control def={def} view={view} disabled={disabled} onChange={onChange} ctx={ctx} />}
          {reset}
        </div>
      </div>
      {block && <Control def={def} view={view} disabled={disabled} onChange={onChange} ctx={ctx} />}
      {note && <p className="text-micro text-fg-muted">{note}</p>}
      <Status view={view} />
    </div>
  )
}

function Control({ def, view, onChange, disabled, ctx }: { def: SettingDef; view: SettingView; onChange: (v: Value) => void; disabled?: boolean; ctx: SettingContext }) {
  const v = view.value
  if (def.type === 'bool') return <Switch on={v === true} label={def.label} disabled={disabled} onChange={x => onChange(x)} />
  if (def.type === 'list') {
    const list = Array.isArray(v) ? v : Array.isArray(def.absent) ? def.absent : []
    return <ListEditor def={def} value={list} valueOf={ctx.valueOf} disabled={disabled} onChange={onChange} />
  }
  if (def.font) {
    // Not set anywhere = KOReader's own default: the picker shows "Default".
    const current = typeof v === 'string' && (view.changed || v !== def.absent) ? v : null
    return <FontPicker def={def} value={current} fonts={ctx.fonts} disabled={disabled} onChange={onChange} />
  }
  if (baseUnit(def)) return <DurationInput def={def} value={typeof v === 'number' ? v : null} disabled={disabled} onChange={onChange} />
  return <ValueInput def={def} value={v} disabled={disabled} onChange={onChange} />
}

/** Only what adds something: your change, and the Kobo's value while it still differs. */
function Status({ view }: { view: SettingView }) {
  if (!view.changed && !view.pending) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-micro text-fg-muted">
      {view.changed && !view.pending && <TonePill tone="info">{view.onKobo === null ? "Changed by you" : "Changed by you · on the Kobo"}</TonePill>}
      {view.pending && <TonePill tone="warn">Waiting for the Kobo</TonePill>}
      {view.pending && view.onKobo !== null && <span>Kobo still has: <span className="text-fg-2">{view.onKobo}</span></span>}
    </div>
  )
}

function ValueInput({ def, value, onChange, disabled }: { def: SettingDef; value: Value; onChange: (v: Value) => void; disabled?: boolean }) {
  if (def.type === 'enum') {
    const known = def.options?.some(o => o.value === value)
    return (
      <select className="input min-h-[44px] w-full max-w-xs @[30rem]:w-60" value={known ? String(value) : ''} disabled={disabled} aria-label={def.label}
        onChange={e => {
          if (e.target.value === '') { onChange(null); return }
          const opt = def.options?.find(o => String(o.value) === e.target.value)
          if (opt) onChange(opt.value)
        }}>
        {!known && <option value="">Default ({formatValue(def, def.absent)})</option>}
        {def.options?.map(o => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
      </select>
    )
  }
  if (def.type === 'int' || def.type === 'number') return <NumberInput def={def} value={typeof value === 'number' ? value : null} disabled={disabled} onChange={onChange} />
  return <TextInput def={def} value={typeof value === 'string' ? value : ''} disabled={disabled} onChange={onChange} />
}

/** A plain number with its unit and range. */
function NumberInput({ def, value, onChange, disabled }: { def: SettingDef; value: number | null; onChange: (v: number) => void; disabled?: boolean }) {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    if (draft === null) return
    const n = Number(draft.replace(',', '.'))
    setDraft(null)
    if (!draft.trim() || !Number.isFinite(n)) return
    let v = def.type === 'int' ? Math.round(n) : n
    if (def.min !== undefined) v = Math.max(def.min, v)
    if (def.max !== undefined) v = Math.min(def.max, v)
    if (v !== value) onChange(v)
  }
  const range = def.min !== undefined && def.max !== undefined ? `${def.min}–${def.max}` : null
  return (
    <label className="flex items-center gap-2">
      <input inputMode="decimal" className="input min-h-[44px] w-24 text-right tabular-nums" value={draft ?? (value == null ? '' : String(value))} disabled={disabled} aria-label={def.label}
        placeholder={typeof def.absent === 'number' ? String(def.absent) : undefined}
        onChange={e => setDraft(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
      <span className="flex flex-col text-micro leading-tight text-fg-muted">
        {def.unit && <span className="max-w-[10rem]">{def.unit}</span>}
        {range && <span className="text-fg-faint">{range}</span>}
      </span>
    </label>
  )
}

function TextInput({ def, value, onChange, disabled }: { def: SettingDef; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    if (draft === null) return
    const v = draft.slice(0, def.maxLength ?? 500)
    setDraft(null)
    if (v !== value) onChange(v)
  }
  return (
    <input className="input min-h-[44px] w-full max-w-md @[30rem]:w-72" value={draft ?? value} disabled={disabled} aria-label={def.label} maxLength={def.maxLength ?? 500}
      onChange={e => setDraft(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
  )
}
