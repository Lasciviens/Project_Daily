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
