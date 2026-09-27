// Readers for a Health Auto Export workout's `raw` payload — pure and
// import-free (scripts/verify-training-log.cjs). Shared by the Health page's
// workout detail and the Training session detail (Apple Watch block), so
// both read the same fields the same way.
//
// `raw` is free-form jsonb whose shape HAE doesn't document: every field is
// type-checked before use and a missing one reads as null / empty.

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- HAE workout `raw` is a free-form jsonb blob; read defensively.
export type RawWorkout = Record<string, any>

/** HAE numeric fields are either a plain number or a { qty, units } object. */
export function rawQty(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (v && typeof v === 'object') {
    const q = (v as RawWorkout).qty
    if (typeof q === 'number' && Number.isFinite(q)) return q
  }
  return null
}

function rawUnits(v: unknown): string {
  return v && typeof v === 'object' && typeof (v as RawWorkout).units === 'string' ? (v as RawWorkout).units.toLowerCase() : ''
}

const KJ_PER_KCAL = 4.184

/** Energy in kcal. The summary columns are named *_kj but HAE sends kcal
 *  (the webhook stores the number as-is); the raw field's own `units` is
 *  the tie-breaker, so a kJ export is converted instead of shown 4× high. */
export function energyKcal(stored: number | null | undefined, rawField: unknown): number | null {
  const value = typeof stored === 'number' && Number.isFinite(stored) ? stored : rawQty(rawField)
  if (value == null) return null
  return rawUnits(rawField).includes('kj') ? value / KJ_PER_KCAL : value
}

/** A HAE timestamp ("2026-08-25 17:10:00 +0200") as a Date. Safari's Date
 *  parser rejects that form (space separator, offset without a colon), so it
 *  is rewritten to ISO first; an ISO string passes through. */
export function parseRawDate(v: unknown): Date | null {
  if (typeof v !== 'string') return null
  const m = v.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)\s*([+-])(\d{2}):?(\d{2})$/)
  const d = new Date(m ? `${m[1]}T${m[2].length === 5 ? `${m[2]}:00` : m[2]}${m[3]}${m[4]}:${m[5]}` : v)
  return isNaN(d.getTime()) ? null : d
}

/** Local 'HH:MM' of a HAE or ISO timestamp, '' when unreadable. */
export function rawHHMM(v: unknown): string {
  const d = parseRawDate(v)
  return d ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : ''
}

export interface HeartRatePoint {
  label: string
  avg: number
  range: [number, number]
}

/** The per-interval heart-rate curve (`heartRateData`: {Avg, Min, Max, date}). */
export function heartRateSeries(raw: RawWorkout): HeartRatePoint[] {
  if (!Array.isArray(raw.heartRateData)) return []
  return raw.heartRateData.flatMap((p: RawWorkout): HeartRatePoint[] => {
    const avg = rawQty(p?.Avg)
    if (avg == null) return []
    return [{ label: rawHHMM(p?.date), avg: Math.round(avg), range: [Math.round(rawQty(p?.Min) ?? avg), Math.round(rawQty(p?.Max) ?? avg)] }]
  })
}

/** Heart-rate drop over the recovery samples Apple records after the
 *  workout ends (first minus last), or null with fewer than two. */
export function heartRateRecoveryDrop(raw: RawWorkout): number | null {
  if (!Array.isArray(raw.heartRateRecovery)) return null
  const vals = raw.heartRateRecovery.map((p: RawWorkout) => rawQty(p?.Avg)).filter((v: number | null): v is number => v != null)
  return vals.length > 1 ? Math.round(vals[0] - vals[vals.length - 1]) : null
}
