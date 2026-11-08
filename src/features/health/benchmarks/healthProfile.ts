// The profile's three health fields, apart from the reference ranges: the
// athlete-profile hook reads this on Home, Daily, Food and Training, and
// importing it through healthBenchmarks loaded every band and source there
// (~76 kB). healthBenchmarks re-exports it, so its callers are unchanged.
import type { HealthProfile, Sex } from './types'

/** Maps an athlete_profile row (or anything shaped like one) to the three health fields. */
export function toHealthProfile(
  row: { birth_year?: number | string | null; sex?: string | null; height_cm?: number | string | null } | null | undefined,
): HealthProfile {
  const num = (v: unknown) => {
    if (v == null || v === '') return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  const sex = row?.sex === 'male' || row?.sex === 'female' ? (row.sex as Sex) : null
  return { birthYear: num(row?.birth_year), sex, heightCm: num(row?.height_cm) }
}
