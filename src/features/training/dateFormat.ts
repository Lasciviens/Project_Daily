// Canonical en-GB date/time formatters for Training views. Was independently
// forked across HevyWorkoutCard/HevyWorkoutDetail/HevyPRList/BodyMeasurementsTab
// — two slightly different day formats existed (`day:'numeric'` vs
// `day:'2-digit'`); '2-digit' was already the majority and matches the
// project's DD/MM/YYYY convention more closely, so it's canonical here.

export function formatTrainingDate(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function formatTrainingTime(d: Date): string {
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

export function fmtTrainingDate(iso: string | null): string {
  return iso ? formatTrainingDate(new Date(iso)) : '—'
}

export function fmtTrainingTime(iso: string | null): string {
  return iso ? formatTrainingTime(new Date(iso)) : ''
}

export function fmtTrainingDateTime(iso: string | null): string {
  return iso ? `${formatTrainingDate(new Date(iso))} · ${formatTrainingTime(new Date(iso))}` : '—'
}

/** Monday→Sunday range for a week chart's tooltip — a single date (e.g.
 *  "3 Aug") is ambiguous about what it means for a WEEKLY value (start?
 *  end? the day it was logged?), which real user confusion (2026-09-01)
 *  confirmed: several Progress-tab weekly charts showed a bare Monday date
 *  as the whole tooltip header. Every weekly chart's tooltip should use
 *  this instead of a single date; short single-date labels stay fine on
 *  the X-AXIS itself, where space is tight. */
export function fmtWeekRange(weekStartIso: string): string {
  const start = new Date(weekStartIso + 'T00:00:00')
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  const fmt = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  return `${fmt(start)} – ${fmt(end)}`
}
