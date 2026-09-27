// The Health page's periods: rolling windows ending on the selected day.
export type Period = 'day' | 'week' | 'month' | 'quarter' | 'year'

export const PERIODS: readonly Period[] = ['day', 'week', 'month', 'quarter', 'year']

export function isPeriod(v: unknown): v is Period {
  return typeof v === 'string' && (PERIODS as readonly string[]).includes(v)
}
