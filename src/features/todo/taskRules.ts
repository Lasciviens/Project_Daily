// Shared task display rules — used anywhere a "done" task list needs the
// 24h visibility rule applied consistently (Daily's DayView, Home's Today
// widgets, etc).

/** A "Done" task only stays visible for 24h after completion. */
export function completedWithinLast24h(updatedAt: string): boolean {
  return Date.now() - new Date(updatedAt).getTime() < 24 * 60 * 60 * 1000
}
