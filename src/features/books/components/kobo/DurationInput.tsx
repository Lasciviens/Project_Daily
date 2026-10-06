import { useState } from 'react'
import type { SettingDef } from '../../koboSettingsCatalogue'
import { UNIT_LABEL, convertAmount, formatDuration, splitDuration, toStored, unitChoices, type TimeUnit } from '../../kobo/durations'

const OFF = 'off'

/**
 * A time setting typed in a person's unit (minutes, hours, days…) while the
 * Kobo keeps KOReader's own (seconds, ms…). Settings that can be turned off
 * (KOReader stores -1) get an "Off" choice in the unit list.
 */
export function DurationInput({ def, value, onChange, disabled }: { def: SettingDef; value: number | null; onChange: (v: number) => void; disabled?: boolean }) {
  const units = unitChoices(def)
  const isOff = def.off !== undefined && value === def.off
  const shownValue = value ?? (typeof def.absent === 'number' ? def.absent : null)
  const split = shownValue != null && !(def.off !== undefined && shownValue === def.off) ? splitDuration(shownValue, def) : null
  const [unit, setUnit] = useState<TimeUnit | null>(null)
  const [draft, setDraft] = useState<string | null>(null)
  const activeUnit: TimeUnit = unit ?? split?.unit ?? units[0]
  const shown = draft ?? (isOff || !split ? '' : String(unit && unit !== split.unit ? convertAmount(split.amount, split.unit, unit) : split.amount))

  const commit = (text: string, u: TimeUnit) => {
    const n = Number(text.replace(',', '.'))
    setDraft(null)
    if (!text.trim() || !Number.isFinite(n)) return
    const v = toStored(n, u, def)
    if (v !== value) onChange(v)
  }
  const pickUnit = (next: string) => {
    if (next === OFF) { setUnit(null); setDraft(null); if (def.off !== undefined) onChange(def.off); return }
    const u = next as TimeUnit
    setUnit(u)
    // Leaving "Off": start from KOReader's default so the field is never empty.
    if (isOff && typeof def.absent === 'number' && def.absent !== def.off) onChange(def.absent)
    else if (isOff && def.min !== undefined) onChange(def.min)
  }
  const range = def.min !== undefined && def.max !== undefined ? `${formatDuration(def.min, def)} – ${formatDuration(def.max, def)}` : null

  return (
    <div className="flex flex-col items-end gap-0.5">
      <div className="flex items-center gap-1.5">
        <input inputMode="decimal" className="input min-h-[44px] w-20 text-right tabular-nums" value={shown} disabled={disabled || isOff} aria-label={def.label}
          placeholder={isOff ? '–' : undefined}
          onChange={e => setDraft(e.target.value)} onBlur={() => draft !== null && commit(draft, activeUnit)}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
        {units.length > 1 || def.off !== undefined ? (
          <select className="input min-h-[44px] w-[7.5rem]" value={isOff ? OFF : activeUnit} disabled={disabled} aria-label={`Unit for ${def.label}`}
            onChange={e => pickUnit(e.target.value)}>
            {units.map(u => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}
            {def.off !== undefined && <option value={OFF}>Off</option>}
          </select>
        ) : <span className="text-micro text-fg-muted">{UNIT_LABEL[activeUnit]}</span>}
      </div>
      {range && <span className="text-micro text-fg-faint">{range}</span>}
    </div>
  )
}
