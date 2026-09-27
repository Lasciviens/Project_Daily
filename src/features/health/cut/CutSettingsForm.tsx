import { useState } from 'react'
import { DateInput } from '../../../shared/components/DateInput'
import type { CutSettings } from './useCutReport'

/** Goal weight and cut start — optional, stored on this device only. */
export function CutSettingsForm({ settings, onChange }: { settings: CutSettings; onChange: (s: CutSettings) => void }) {
  const [goal, setGoal] = useState(settings.goalWeightKg != null ? String(settings.goalWeightKg) : '')

  function commitGoal() {
    const v = Number(goal.replace(',', '.'))
    const next = goal.trim() === '' ? null : Number.isFinite(v) && v > 25 && v < 300 ? Math.round(v * 10) / 10 : settings.goalWeightKg
    setGoal(next != null ? String(next) : '')
    if (next !== settings.goalWeightKg) onChange({ ...settings, goalWeightKg: next })
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="field-label">
        Goal weight (kg)
        <input className="input mt-1 block w-full max-w-[8rem] tabular-nums" inputMode="decimal" value={goal}
          onChange={e => setGoal(e.target.value.replace(/[^\d.,]/g, ''))} onBlur={commitGoal}
          onKeyDown={e => { if (e.key === 'Enter') commitGoal() }} placeholder="e.g. 80" />
      </label>
      <label className="field-label">
        Cut started
        <DateInput value={settings.cutStartDate ?? ''} aria-label="Cut start date"
          onChange={v => onChange({ ...settings, cutStartDate: v || null })}
          className="input mt-1 block w-full max-w-[9rem]" placeholder="DD/MM/YYYY" />
      </label>
      <p className="w-full text-meta text-fg-muted">Saved on this device only. The start date lets the report flag the water-heavy first weeks.</p>
    </div>
  )
}
