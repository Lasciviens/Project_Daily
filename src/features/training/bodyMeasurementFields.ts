import { formatTrainingDate } from './dateFormat'

// ─── Field definitions ────────────────────────────────────────────────────────

export type MeasKey =
  | 'weight_kg' | 'fat_percent' | 'lean_mass_kg'
  | 'neck_cm' | 'shoulder_cm' | 'chest_cm'
  | 'left_bicep_cm' | 'right_bicep_cm' | 'left_forearm_cm' | 'right_forearm_cm'
  | 'abdomen_cm' | 'waist_cm' | 'hips_cm'
  | 'left_thigh_cm' | 'right_thigh_cm' | 'left_calf_cm' | 'right_calf_cm'

export interface FieldDef { label: string; key: MeasKey; unit: string }

export const HERO_FIELDS: FieldDef[] = [
  { label: 'Weight',    key: 'weight_kg',    unit: 'kg' },
  { label: 'Body fat',  key: 'fat_percent',  unit: '%'  },
  { label: 'Lean mass', key: 'lean_mass_kg', unit: 'kg' },
]

export const ALL_FIELDS: FieldDef[] = [
  { label: 'Weight',    key: 'weight_kg',        unit: 'kg' },
  { label: 'Body fat',  key: 'fat_percent',       unit: '%'  },
  { label: 'Lean mass', key: 'lean_mass_kg',      unit: 'kg' },
  { label: 'Neck',      key: 'neck_cm',           unit: 'cm' },
  { label: 'Shoulder',  key: 'shoulder_cm',       unit: 'cm' },
  { label: 'Chest',     key: 'chest_cm',          unit: 'cm' },
  { label: 'L Bicep',   key: 'left_bicep_cm',     unit: 'cm' },
  { label: 'R Bicep',   key: 'right_bicep_cm',    unit: 'cm' },
  { label: 'L Forearm', key: 'left_forearm_cm',   unit: 'cm' },
  { label: 'R Forearm', key: 'right_forearm_cm',  unit: 'cm' },
  { label: 'Abdomen',   key: 'abdomen_cm',        unit: 'cm' },
  { label: 'Waist',     key: 'waist_cm',          unit: 'cm' },
  { label: 'Hips',      key: 'hips_cm',           unit: 'cm' },
  { label: 'L Thigh',   key: 'left_thigh_cm',     unit: 'cm' },
  { label: 'R Thigh',   key: 'right_thigh_cm',    unit: 'cm' },
  { label: 'L Calf',    key: 'left_calf_cm',      unit: 'cm' },
  { label: 'R Calf',    key: 'right_calf_cm',     unit: 'cm' },
]

export const DETAIL_FIELDS = ALL_FIELDS.slice(3)

export function fmtMeasDate(dateStr: string): string {
  return formatTrainingDate(new Date(dateStr + 'T00:00:00'))
}

// ─── Save payload ─────────────────────────────────────────────────────────────
// hevy-api MERGES a save into what is stored for the date: a key that is
// absent keeps the stored value, an explicit null clears it, a number sets
// it. So the form sends only what changed its mind:
//   typed value              → the number
//   a stored value, now empty → null (the user cleared it)
//   empty and nothing stored  → omitted
// Hevy has no way to delete a whole day's entry, so a save that would leave
// the day with no values at all is refused here with a reason.

export type MeasurementValues = Record<MeasKey, string>
export type StoredMeasurement = Partial<Record<MeasKey, number | null>>

export function buildMeasurementPayload(
  date: string,
  values: MeasurementValues,
  stored: StoredMeasurement | null,
): { payload: Record<string, unknown>; error: string | null } {
  const payload: Record<string, unknown> = { date }
  let remaining = 0
  for (const f of ALL_FIELDS) {
    const raw = (values[f.key] ?? '').trim()
    const had = stored?.[f.key] != null
    if (raw === '' || raw === '.') {
      if (had) payload[f.key] = null
      continue
    }
    const n = Number(raw)
    if (!Number.isFinite(n) || n < 0) return { payload, error: `${f.label} isn't a valid number.` }
    payload[f.key] = n
    remaining++
  }
  if (!date) return { payload, error: 'Pick a date.' }
  if (remaining === 0) {
    return {
      payload,
      error: stored && ALL_FIELDS.some(f => stored[f.key] != null)
        ? 'Hevy can’t delete a whole day. Keep at least one value, or delete the entry in the Hevy app.'
        : 'Enter at least one value.',
    }
  }
  return { payload, error: null }
}
