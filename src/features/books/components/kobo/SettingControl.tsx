import { useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { IconButton, TonePill, cx } from '../../../../shared/ui'
import { HelpTip } from '../../../../shared/components/HelpTip'
import type { SettingDef } from '../../koboSettingsCatalogue'
import { EFFECT_LABEL, formatValue, type SettingView, type Value } from '../../kobo/settingsView'

/** An on/off control (no shared switch exists yet). */
export function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
      className="press-feedback flex min-h-[44px] shrink-0 items-center px-1 disabled:opacity-50">
      <span className={cx('relative inline-block h-6 w-11 rounded-full border transition-colors',
        on ? 'border-accent-600 bg-accent-500' : 'border-line-strong bg-surface-2')}>
        <span className={cx('absolute top-0.5 h-[18px] w-[18px] rounded-full bg-surface shadow transition-[left]', on ? 'left-[22px]' : 'left-0.5')} />
      </span>
    </button>
  )
}

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
export function SettingControl({ def, view, onChange, disabled }: {
  def: SettingDef
  view: SettingView
  /** A value, or null for "back to KOReader's default" (the Kobo then deletes the key). */
  onChange: (v: Value) => void
  disabled?: boolean
}) {
  const inline = def.type === 'bool'
  return (
    <div className="flex flex-col gap-1.5 py-2.5 @container">
      <div className={cx('flex gap-2', inline ? 'items-center' : 'flex-col @[30rem]:flex-row @[30rem]:items-center')}>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <p className="min-w-0 text-body font-medium text-fg">{def.label}</p>
          <HelpTip label={`About “${def.label}”`}><SettingHelp def={def} /></HelpTip>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {def.type === 'bool'
            ? <Switch on={view.value === true} label={def.label} disabled={disabled} onChange={v => onChange(v)} />
            : <ValueInput def={def} value={view.value} disabled={disabled} onChange={onChange} />}
          {view.changed && (
            <IconButton label={`Reset “${def.label}” to the default`} disabled={disabled} onClick={() => onChange(null)}><RotateCcw /></IconButton>
          )}
        </div>
      </div>
      <Status view={view} />
    </div>
  )
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

/** Seconds are typed in minutes when the setting moves in whole minutes. */
function NumberInput({ def, value, onChange, disabled }: { def: SettingDef; value: number | null; onChange: (v: number) => void; disabled?: boolean }) {
  const minutes = def.unit === 'seconds' && (def.step ?? 1) % 60 === 0
  const shown = value == null ? '' : String(minutes ? value / 60 : value)
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    if (draft === null) return
    const n = Number(draft.replace(',', '.'))
    setDraft(null)
    if (!draft.trim() || !Number.isFinite(n)) return
    let v = minutes ? Math.round(n * 60) : def.type === 'int' ? Math.round(n) : n
    if (def.min !== undefined) v = Math.max(def.min, v)
    if (def.max !== undefined) v = Math.min(def.max, v)
    if (v !== value) onChange(v)
  }
  const unit = minutes ? 'min' : def.unit === 'seconds' ? 's' : def.unit ?? ''
  const range = def.min !== undefined && def.max !== undefined ? (minutes ? `${def.min / 60}–${def.max / 60}` : `${def.min}–${def.max}`) : null
  return (
    <label className="flex items-center gap-2">
      <input inputMode="decimal" className="input min-h-[44px] w-24 text-right tabular-nums" value={draft ?? shown} disabled={disabled} aria-label={def.label}
        placeholder={typeof def.absent === 'number' ? String(minutes ? def.absent / 60 : def.absent) : undefined}
        onChange={e => setDraft(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
      <span className="flex flex-col text-micro leading-tight text-fg-muted">
        {unit && <span className="max-w-[10rem]">{unit}</span>}
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
