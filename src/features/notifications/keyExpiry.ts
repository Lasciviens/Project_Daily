// The Claude API key's end day (212's integration_expiry; owner, 25.11.2026: "type a start date, default today, and a
// duration; the app computes the end"). The database works the end day out itself (integration_expiry_fill) — this is
// the same rule for the form's preview before the save: a start day plus days, or plus months as Postgres adds them
// (31.01 + 1 month = the last day of February). Pure and import-free; verify-notifications checks it on the same days
// as verify-db-notifications.

export type DurationUnit = 'days' | 'months'

export const MAX_DURATION: Record<DurationUnit, number> = { days: 3650, months: 120 }
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/
const pad = (n: number) => String(n).padStart(2, '0')

/** The end day (YYYY-MM-DD), or null when the start is not a day or the count is out of range. */
export function keyEndDay(startsOn: string, count: number, unit: DurationUnit): string | null {
  const m = DAY.exec(startsOn)
  if (!m || !Number.isInteger(count) || count < 1 || count > MAX_DURATION[unit]) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const start = new Date(Date.UTC(y, mo - 1, d))
  if (start.getUTCFullYear() !== y || start.getUTCMonth() !== mo - 1 || start.getUTCDate() !== d) return null
  if (unit === 'days') {
    const end = new Date(start.getTime() + count * 86_400_000)
    return `${end.getUTCFullYear()}-${pad(end.getUTCMonth() + 1)}-${pad(end.getUTCDate())}`
  }
  const months = mo - 1 + count
  const ey = y + Math.floor(months / 12), em = months % 12
  const last = new Date(Date.UTC(ey, em + 1, 0)).getUTCDate()
  return `${ey}-${pad(em + 1)}-${pad(Math.min(d, last))}`
}

/** The last 4 characters as the owner typed them, or null (empty); undefined when they are not 4 key characters. */
export function keyHint(text: string): string | null | undefined {
  const t = text.trim()
  if (!t) return null
  return /^[A-Za-z0-9_-]{4}$/.test(t) ? t : undefined
}
