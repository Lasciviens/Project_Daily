// Pure 7-day nutrition summary for the Food · Today "Last 7 days" card —
// import-free so scripts/verify-weekly-nutrition.cjs can require it.

export interface WeekRow { date: string; calories: number | null; protein_g: number | null }

export interface WeekDay { date: string; kcal: number; protein: number; logged: boolean }

export interface WeekSummary {
  days:           WeekDay[]   // oldest → newest, always 7
  loggedDays:     number
  avgKcal:        number | null   // over logged days only — an empty day isn't a 0 kcal day
  avgProtein:     number | null
  proteinHitDays: number
  kcalOnTargetDays: number      // within ±10% of the calorie target
}

/** yyyy-MM-dd shifted by n days, calendar-safe (no timezone involved). */
function shift(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return t.toISOString().slice(0, 10)
}

export function summarizeWeek(rows: WeekRow[], endDate: string, targets: { calories: number; protein: number }): WeekSummary {
  const byDate = new Map<string, { kcal: number; protein: number }>()
  for (const r of rows) {
    const cur = byDate.get(r.date) ?? { kcal: 0, protein: 0 }
    cur.kcal += r.calories ?? 0
    cur.protein += r.protein_g ?? 0
    byDate.set(r.date, cur)
  }
  const days: WeekDay[] = []
  for (let i = 6; i >= 0; i--) {
    const date = shift(endDate, -i)
    const v = byDate.get(date)
    days.push({ date, kcal: Math.round(v?.kcal ?? 0), protein: Math.round(v?.protein ?? 0), logged: !!v })
  }
  const logged = days.filter(d => d.logged)
  const avg = (f: (d: WeekDay) => number) => (logged.length ? Math.round(logged.reduce((a, d) => a + f(d), 0) / logged.length) : null)
  return {
    days,
    loggedDays: logged.length,
    avgKcal: avg(d => d.kcal),
    avgProtein: avg(d => d.protein),
    proteinHitDays: targets.protein > 0 ? logged.filter(d => d.protein >= targets.protein).length : 0,
    kcalOnTargetDays: targets.calories > 0 ? logged.filter(d => Math.abs(d.kcal - targets.calories) <= targets.calories * 0.1).length : 0,
  }
}
