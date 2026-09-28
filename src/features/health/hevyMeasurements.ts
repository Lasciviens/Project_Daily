// The Hevy body-measurement log as Health → Body shows it ("Logged in Hevy"):
// the newest entry, each value with its change since the previous entry that
// recorded it. Pure, type-only imports (scripts/verify-hevy-measurements.cjs).
// Never merged into the smart-scale charts — a hand-typed weight is a
// different kind of reading (see bodyweight.ts).
import type { FieldDef, MeasKey } from '../training/bodyMeasurementFields'

export type MeasurementRow = { date: string } & Partial<Record<MeasKey, number | null>>

export interface MeasurementLine {
  key: MeasKey
  label: string
  unit: string
  value: number
  /** The previous entry that recorded this field. */
  prev: { value: number; date: string } | null
  delta: number | null
}

const has = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Newest first, whatever order the rows arrive in; rows with no values are skipped. */
export function sortedEntries<T extends MeasurementRow>(rows: readonly T[], fields: readonly FieldDef[]): T[] {
  return rows.filter(r => fields.some(f => has(r[f.key]))).slice().sort((a, b) => b.date.localeCompare(a.date))
}

/** Every recorded value of one entry, with its change since the entry before that recorded it. */
export function entryLines(rows: readonly MeasurementRow[], index: number, fields: readonly FieldDef[]): MeasurementLine[] {
  const row = rows[index]
  if (!row) return []
  const out: MeasurementLine[] = []
  for (const f of fields) {
    const v = row[f.key]
    if (!has(v)) continue
    const older = rows.slice(index + 1).find(r => has(r[f.key]))
    const prev = older ? { value: older[f.key] as number, date: older.date } : null
    out.push({ key: f.key, label: f.label, unit: f.unit, value: v, prev, delta: prev ? Math.round((v - prev.value) * 10) / 10 : null })
  }
  return out
}
