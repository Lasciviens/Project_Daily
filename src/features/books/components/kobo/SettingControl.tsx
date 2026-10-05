import { useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { IconButton, TonePill, cx } from '../../../../shared/ui'
import type { SettingDef } from '../../koboSettingsCatalogue'
import { EFFECT_LABEL, type SettingView, type Value } from '../../kobo/settingsView'

/** An on/off control (no shared switch exists yet). */
export function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
      className="press-feedback flex min-h-[44px] shrink-0 items-center px-1 disabled:opacity-50">
      <span className={cx('relative inline-block h-6 w-11 rounded-full border transition-colors',
        on ? 'border-accent-600 bg-accent-500' : 'border-line bg-surface-2')}>
        <span className={cx('absolute top-0.5 h-[18px] w-[18px] rounded-full bg-surface shadow transition-[left]', on ? 'left-[22px]' : 'left-0.5')} />
      </span>
    </button>
  )
}

/** One KOReader setting: its control, where it lives on the Kobo, and what the Kobo has now. */
export function SettingControl({ def, view, onChange, disabled }: {
  def: SettingDef
  view: SettingView
  /** A value, or undefined to drop the owner's change (back to what KOReader does). */
  onChange: (v: Value | undefined) => void
  disabled?: boolean
}) {
  return (
    <div className="flex flex-col gap-1 py-2">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-body font-medium text-fg">{def.label}</p>
          <p className="text-micro text-fg-muted">{def.path}</p>
        </div>
        {def.type === 'bool' && <Switch on={view.value === true} label={def.label} disabled={disabled} onChange={v => onChange(v)} />}
        {view.changed && (
          <IconButton label={`Reset “${def.label}” to KOReader's default`} disabled={disabled} onClick={() => onChange(undefined)}><RotateCcw /></IconButton>
        )}
      </div>
      {def.type !== 'bool' && <ValueInput def={def} value={view.value} disabled={disabled} onChange={onChange} />}
      {def.help && <p className="text-micro text-fg-muted">{def.help}</p>}
      <div className="flex flex-wrap items-center gap-1.5 text-micro text-fg-muted">
        {view.pending && <TonePill tone="warn">Waiting for the Kobo</TonePill>}
        {view.onKobo !== null && <span>On the Kobo: {view.onKobo}</span>}
        {view.changed && <span>· {EFFECT_LABEL[def.effect]}</span>}
      </div>
    </div>
  )
}

function ValueInput({ def, value, onChange, disabled }: { def: SettingDef; value: Value; onChange: (v: Value) => void; disabled?: boolean }) {
  if (def.type === 'enum') {
    return (
      <select className="input min-h-[44px] w-full max-w-md" value={String(value ?? '')} disabled={disabled} aria-label={def.label}
        onChange={e => {
          const opt = def.options?.find(o => String(o.value) === e.target.value)
          if (opt) onChange(opt.value)
        }}>
        {value == null && <option value="">Not set</option>}
        {def.options?.map(o => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
      </select>
    )
  }
  if (def.type === 'int' || def.type === 'number') return <NumberInput def={def} value={typeof value === 'number' ? value : null} disabled={disabled} onChange={onChange} />
  return <TextInput def={def} value={typeof value === 'string' ? value : ''} disabled={disabled} onChange={onChange} />
}

/** Seconds are typed in minutes when the setting moves in whole minutes. */
function NumberInput({ def, value, onChange, disabled }: { def: SettingDef; value: number | null; onChange: (v: number) => void; disabled?: boolean }) {
  const minutes = def.unit === 'seconds' && (def.step ?? 1) % 60 === 0
  const shown = value == null ? '' : String(minutes ? value / 60 : value)
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    if (draft === null) return
    const n = Number(draft.replace(',', '.'))
    setDraft(null)
    if (!Number.isFinite(n)) return
    let v = minutes ? Math.round(n * 60) : def.type === 'int' ? Math.round(n) : n
    if (def.min !== undefined) v = Math.max(def.min, v)
    if (def.max !== undefined) v = Math.min(def.max, v)
    if (v !== value) onChange(v)
  }
  const unit = minutes ? 'min' : def.unit && def.unit !== 'seconds' ? def.unit : def.unit === 'seconds' ? 's' : ''
  return (
    <label className="flex items-center gap-2">
      <input inputMode="decimal" className="input min-h-[44px] w-28" value={draft ?? shown} disabled={disabled} aria-label={def.label}
        onChange={e => setDraft(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
      {unit && <span className="text-meta text-fg-muted">{unit}</span>}
      {def.min !== undefined && def.max !== undefined && (
        <span className="text-micro text-fg-faint">{minutes ? `${def.min / 60}–${def.max / 60}` : `${def.min}–${def.max}`}</span>
      )}
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
    <input className="input min-h-[44px] w-full max-w-md" value={draft ?? value} disabled={disabled} aria-label={def.label} maxLength={def.maxLength ?? 500}
      onChange={e => setDraft(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
  )
}
