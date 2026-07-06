// Canonical duration formatters ("1h 30m" / "45m" / "2h" — omits a trailing
// "0m"). Independently reimplemented with small variations (some always
// showed "1h 0m", some took seconds, some took minutes, some took two ISO
// timestamps) across daily/training/home/transit/plan-modal.

export function formatDurationMinutes(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = Math.round(mins % 60)
  if (h <= 0) return `${m}m`
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

export function formatDurationSeconds(seconds: number): string {
  return formatDurationMinutes(Math.round(seconds / 60))
}

export function formatDurationBetween(startIso: string | null, endIso: string | null): string {
  if (!startIso || !endIso) return '—'
  const mins = Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60_000)
  return formatDurationMinutes(mins)
}
