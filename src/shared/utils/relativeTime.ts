import { formatDistanceToNow, isToday, isYesterday, format } from 'date-fns'
import { formatDate } from './dateFormat'

/**
 * #47 — human, native-feeling relative time. "just now" / "14:30" (today) /
 * "Yesterday 09:12" / "3 hours ago" (this week) / "12.07.2026" (older). Safe on bad input (returns '').
 */
export function relativeTime(input: string | number | Date): string {
  const d = input instanceof Date ? input : new Date(input)
  if (Number.isNaN(d.getTime())) return ''
  const diffMs = Date.now() - d.getTime()
  if (Math.abs(diffMs) < 60_000) return 'just now'
  if (isToday(d)) return format(d, 'HH:mm')
  if (isYesterday(d)) return `Yesterday ${format(d, 'HH:mm')}`
  if (Math.abs(diffMs) < 7 * 24 * 60 * 60 * 1000) return formatDistanceToNow(d, { addSuffix: true })
  return formatDate(d)
}
