import { useId, useState } from 'react'
import { SegmentedControl } from '../../../../shared/ui'
import { useAthleteProfile, useUpsertAthleteProfile } from '../../../training/hooks/useAthleteProfile'
import type { BiologicalSex } from '../../../training/types.athlete'
import { parseBirthYear, parseHeightCm, type ParseResult } from '../../benchmarks/profileInput'

// Birth year, sex and height (athlete_profile, migration 110) — the three
// facts the Health page's reference ranges need. Settings-style, like
// AthleteProfileSheet: the text fields save on blur, sex saves on tap, and
// useUpsertAthleteProfile owns the toasts (including the named
// "migration 110 not applied" error). A draft stays in its field after a save,
// so the value never flickers back while the profile refetches.

type SexChoice = BiologicalSex | 'unset'

const SEX_OPTIONS: { value: SexChoice; label: string }[] = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'unset', label: 'Not set' },
]

interface FieldProps {
  label: string
  value: string
  placeholder: string
  inputMode: 'numeric' | 'decimal'
  error: string | null
  onChange: (v: string) => void
  onBlur: () => void
}

function TextField({ label, value, placeholder, inputMode, error, onChange, onBlur }: FieldProps) {
  const id = useId()
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="field-label">{label}</label>
      <input
        id={id}
        type="text"
        inputMode={inputMode}
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        onBlur={onBlur}
        aria-invalid={error != null || undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className="input max-w-[12rem] tabular-nums"
      />
      {error && <p id={`${id}-error`} className="mt-1 text-meta text-danger">{error}</p>}
    </div>
  )
}

/** One text field's draft/validate/save cycle. `saved` is the stored value. */
function useDraftField(saved: number | null, parse: (text: string) => ParseResult, save: (v: number | null) => void) {
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const value = draft ?? (saved != null ? String(saved) : '')
  return {
    value,
    error,
    onChange: (v: string) => { setDraft(v); if (error) setError(null) },
    onBlur: () => {
      if (draft == null) return
      const r = parse(draft)
      if (!r.ok) { setError(r.error); return }
      setError(null)
      if (r.value !== saved) save(r.value)
    },
  }
}

export function HealthProfileForm() {
  const { data: profile } = useAthleteProfile()
  const upsert = useUpsertAthleteProfile()
  const currentYear = new Date().getFullYear()

  const year = useDraftField(profile?.birth_year ?? null, t => parseBirthYear(t, currentYear), birth_year => upsert.mutate({ birth_year }))
  const height = useDraftField(profile?.height_cm ?? null, parseHeightCm, height_cm => upsert.mutate({ height_cm }))

  return (
    <div className="@container">
      <div className="grid gap-4 @lg:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_minmax(0,10rem)] @lg:items-start">
        <TextField label="Birth year" placeholder="e.g. 1986" inputMode="numeric" {...year} />
        <div className="min-w-0">
          <p className="field-label">Sex</p>
          <SegmentedControl<SexChoice>
            value={profile?.sex ?? 'unset'}
            onChange={choice => {
              const sex = choice === 'unset' ? null : choice
              if (sex !== (profile?.sex ?? null)) upsert.mutate({ sex })
            }}
            options={SEX_OPTIONS}
            size="sm"
            fullWidth
          />
        </div>
        <TextField label="Height (cm)" placeholder="e.g. 180" inputMode="decimal" {...height} />
      </div>
    </div>
  )
}
