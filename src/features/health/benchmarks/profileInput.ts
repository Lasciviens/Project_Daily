// Parsing for the Health profile inputs (birth year, height). Pure, import-free.
// The bounds mirror migration 110's CHECK constraints, so a value the form
// accepts is never rejected by the database.

export type ParseResult = { ok: true; value: number | null } | { ok: false; error: string }

export const BIRTH_YEAR_MIN = 1900
export const HEIGHT_MIN_CM = 100
export const HEIGHT_MAX_CM = 250

/** Empty clears the field. Otherwise a 4-digit year from 1900 to this year. */
export function parseBirthYear(text: string, currentYear: number): ParseResult {
  const t = text.trim()
  if (t === '') return { ok: true, value: null }
  const n = /^\d{4}$/.test(t) ? Number(t) : NaN
  if (!Number.isInteger(n) || n < BIRTH_YEAR_MIN || n > currentYear) {
    return { ok: false, error: `Enter a year between ${BIRTH_YEAR_MIN} and ${currentYear}.` }
  }
  return { ok: true, value: n }
}

/** Empty clears the field. Accepts a comma or a dot; stored with one decimal. */
export function parseHeightCm(text: string): ParseResult {
  const t = text.trim().replace(',', '.')
  if (t === '') return { ok: true, value: null }
  const n = /^\d+(\.\d+)?$/.test(t) ? Number(t) : NaN
  if (Number.isFinite(n) && n >= 1 && n <= 2.5) {
    return { ok: false, error: 'Height is in centimetres — for example 182.' }
  }
  if (!Number.isFinite(n) || n < HEIGHT_MIN_CM || n > HEIGHT_MAX_CM) {
    return { ok: false, error: `Enter a height between ${HEIGHT_MIN_CM} and ${HEIGHT_MAX_CM} cm.` }
  }
  return { ok: true, value: Math.round(n * 10) / 10 }
}
