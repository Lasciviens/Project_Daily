// Pure helpers for the game edit form (GameDetailModal's EditPanel). Import-free
// so scripts/verify-game-edit.cjs can require it without a Supabase client.

/**
 * A stored timestamp → the `yyyy-MM-dd` a date input shows, from LOCAL date
 * parts. Slicing the ISO string showed the UTC day, which is the previous day
 * for anything saved in the first hours of an Oslo day.
 */
export function isoToDateInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * A date input's `yyyy-MM-dd` → a timestamp at LOCAL noon. Noon, not
 * midnight: local midnight is the previous UTC day east of Greenwich, and a
 * DST shift of an hour can never move noon onto another day.
 */
export function dateInputToIso(v: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null
  const d = new Date(`${v}T12:00:00`)
  return Number.isFinite(d.getTime()) ? d.toISOString() : null
}

const same = (a: unknown, b: unknown): boolean => {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => same(x, b[i]))
  return (a ?? null) === (b ?? null)
}

/**
 * Only the keys whose value changed between the form as it opened and as it
 * is saved. Sending the whole form wrote back every field it had loaded — so
 * a rating, status or ScreenScraper write made after the form opened (or read
 * from a stale cache) was silently reverted by an unrelated typo fix.
 */
export function diffPatch<T extends Record<string, unknown>>(initial: T, current: T): Partial<T> {
  const out: Partial<T> = {}
  for (const k of Object.keys(current) as (keyof T)[]) {
    if (!same(initial[k], current[k])) out[k] = current[k]
  }
  return out
}
