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
