// Release reminders (migration 122). Pure and import-free: push-send carries a
// hand-mirrored copy of `dueReminder` and `reminderText` (Deno can't import
// this file) — change both together. Verified by scripts/verify-media-reminders.cjs.

/** Days before release a reminder can go out: a month, a week, a day, the day itself. */
export const REMINDER_OFFSETS = [30, 7, 1, 0] as const
export type ReminderOffset = (typeof REMINDER_OFFSETS)[number]

export const OFFSET_LABEL: Record<ReminderOffset, string> = { 30: '1 month before', 7: '1 week before', 1: '1 day before', 0: 'On release day' }
export const OFFSET_SHORT: Record<ReminderOffset, string> = { 30: '1m', 7: '1w', 1: '1d', 0: 'day' }

/** Whole days from `today` to `release` (both yyyy-MM-dd). */
export function daysUntil(today: string, release: string): number {
  return Math.round((Date.parse(`${release}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000)
}

/**
 * The reminder due today, if any: the smallest chosen offset not yet sent with
 * days-left ≤ it. A missed morning (no push that day) still sends late, once —
 * and only the nearest reminder, never a burst of three. `marks` are every
 * chosen offset now passed, so none of them is sent later.
 */
export function dueReminder(r: { release_date: string; offsets: number[]; sent_offsets: number[] }, today: string): { offset: number; daysLeft: number; marks: number[] } | null {
  const left = daysUntil(today, r.release_date)
  if (left < 0) return null
  const passed = r.offsets.filter(o => left <= o && !r.sent_offsets.includes(o))
  if (!passed.length) return null
  return { offset: Math.min(...passed), daysLeft: left, marks: passed }
}

const ddmmyyyy = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`

export function reminderText(title: string, daysLeft: number, release: string): { title: string; body: string } {
  if (daysLeft <= 0) return { title: `🎬 ${title} is out today`, body: `Released ${ddmmyyyy(release)}` }
  const when = daysLeft === 1 ? 'tomorrow' : daysLeft >= 28 ? `in about a month` : daysLeft >= 7 ? `in ${Math.round(daysLeft / 7)} week${Math.round(daysLeft / 7) === 1 ? '' : 's'}` : `in ${daysLeft} days`
  return { title: `🎬 ${title} comes out ${when}`, body: `Release date ${ddmmyyyy(release)}` }
}
