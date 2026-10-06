import type { SettingDef } from '../../koboSettingsCatalogue'
import { fontChoices, previewFamily, type FontReport } from '../../kobo/fontChoices'
import { formatValue } from '../../kobo/settingsView'

/**
 * A font setting as a list of the fonts the Kobo has (its own report, else the
 * fonts that come with KOReader), "Default" first, with a one-line preview.
 */
export function FontPicker({ def, value, fonts, onChange, disabled }: {
  def: SettingDef
  value: string | null
  fonts: FontReport | null
  onChange: (v: string | null) => void
  disabled?: boolean
}) {
  const { options, fromKobo } = fontChoices(def, fonts, value)
  const selected = options.find(o => o.value === value)
  const preview = previewFamily(selected?.family ?? (typeof def.absent === 'string' && def.font === 'face' ? def.absent : undefined))
  return (
    <div className="flex w-full max-w-xs flex-col gap-1 @[30rem]:w-64">
      <select className="input min-h-[44px] w-full" value={value ?? ''} disabled={disabled} aria-label={def.label}
        onChange={e => onChange(e.target.value === '' ? null : e.target.value)}>
        <option value="">Default ({formatValue(def, def.absent)})</option>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {preview && def.font === 'face' && (
        <p className="text-meta text-fg-2" style={{ fontFamily: preview }} aria-hidden>The quick brown fox · Æøå · Çğış</p>
      )}
      <p className="text-micro text-fg-faint">
        {fromKobo ? `${options.length} fonts on the Kobo` : 'Fonts that come with KOReader. The Kobo’s own list appears after its next sync.'}
      </p>
    </div>
  )
}
