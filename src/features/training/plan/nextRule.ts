// "Next" for every way in (owner-critic, 27.11.2026: the phone's brief and the morning push must give the same next
// as the app). The block between the markers is copied verbatim into supabase/functions/phone-gateway and push-send
// (edge functions are self-contained); scripts/verify-training-next-mirror.cjs compares the three. Pure, no imports.

// <training-next-rule>
/** A planned training session as "next" reads it. `toDo`: not done, not skipped. `countsUntil`: the last day a
 *  workout still completes it (its week, 167) — a session whose day passed counts only until then. */
export interface NextCandidate { title: string; routineId: string | null; date: string; toDo: boolean; countsUntil: string | null }

/** The program's order: the weekly schedule's training plans by their first weekday (Monday first), then time (S22). */
export function trainingProgramOrder(templates: readonly { title: string; category?: string | null; days_of_week?: readonly number[] | null; start_time?: string | null }[],
  routineOfTitle: (title: string, startHHMM: string | null) => string | null): string[] {
  const order: string[] = []
  const monFirst = (d: number) => (d + 6) % 7
  const sorted = templates.filter(x => x.category === 'training')
    .map(x => ({ x, first: Math.min(...(x.days_of_week ?? []).map(monFirst)) }))
    .sort((a, b) => a.first - b.first || (a.x.start_time ?? '').localeCompare(b.x.start_time ?? ''))
  for (const t of sorted) {
    const id = routineOfTitle(t.x.title, t.x.start_time ? t.x.start_time.slice(0, 5) : null)
    if (id && !order.includes(id)) order.push(id)
  }
  return order
}

/** Next = the first session still to do: one whose day has come (today's, or a passed one still counting) first, in
 *  the program's order — a missed session before today's (S23); then the later ones by day. */
export function pickNextCandidate<T extends NextCandidate>(sessions: readonly T[], order: readonly string[], today: string): T | null {
  const seq = (s: NextCandidate) => { const i = s.routineId ? order.indexOf(s.routineId) : -1; return i < 0 ? order.length : i }
  const due = sessions
    .filter(s => s.toDo && (s.date === today || (s.date < today && s.countsUntil != null && s.countsUntil >= today)))
    .sort((a, b) => seq(a) - seq(b) || a.date.localeCompare(b.date) || a.title.localeCompare(b.title))
  const ahead = sessions
    .filter(s => s.toDo && s.date > today)
    .sort((a, b) => a.date.localeCompare(b.date) || seq(a) - seq(b) || a.title.localeCompare(b.title))
  return due[0] ?? ahead[0] ?? null
}

/** The server's candidates (phone-gateway, push-send), from rows they read with the service role, every one the
 *  account's own: training tasks with their slot's days, and the weekly training plans' days from `today` to `to`
 *  that have no task yet (weekly repeats only — another repeat kind's days are left to its task, made on its day).
 *  A plan's routine: its task's, else the routine titled like it (case and outer spaces ignored). */
export function trainingCandidatesFrom(input: {
  today: string
  to: string
  tasks: readonly { title: string | null; due_date: string | null; due_time?: string | null; status: string; closed_reason?: string | null; hevy_routine_id?: string | null; hevy_workout_id?: string | null; first_plan_date?: string | null; schedule_block_id?: string | null; occurrence_date?: string | null; blocks?: readonly { date: string | null; start_time?: string | null }[] | null }[]
  templates: readonly { id: string; title: string; category?: string | null; days_of_week?: readonly number[] | null; start_time?: string | null; effective_from?: string | null; except_dates?: readonly string[] | null; repeat_kind?: string | null; repeat_until?: string | null }[]
  routines: readonly { id: string; title: string }[]
}): (NextCandidate & { startTime: string | null })[] {
  const addDays = (d: string, n: number) => { const t = new Date(`${d}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10) }
  const key = (t: string) => t.trim().toLowerCase()
  const byTitle = new Map(input.routines.map(r => [key(r.title), r.id]))
  const out: (NextCandidate & { startTime: string | null })[] = []
  const taken = new Set<string>()
  for (const t of input.tasks) {
    if (t.schedule_block_id && t.occurrence_date) taken.add(`${t.schedule_block_id}:${t.occurrence_date}`)
    const slot = (t.blocks ?? []).map(b => b.date).filter((d): d is string => !!d).sort()[0] ?? null
    const date = slot ?? t.due_date
    if (!date) continue
    const routineId = t.hevy_routine_id ?? byTitle.get(key(t.title ?? '')) ?? null
    const toDo = !t.hevy_workout_id && (['open', 'in_progress', 'waiting'].includes(t.status) || (t.status === 'cancelled' && t.closed_reason === 'missed'))
    const week = addDays(t.first_plan_date ?? date, 6)
    const late = addDays(date, 6)
    const countsUntil = date >= input.today ? date : t.hevy_routine_id ? (week < late ? week : late) : null
    const start = (t.blocks ?? []).find(b => b.date === date)?.start_time ?? t.due_time ?? null
    out.push({ title: t.title ?? 'Training', routineId, date, toDo, countsUntil, startTime: start ? start.slice(0, 5) : null })
  }
  for (const p of input.templates) {
    if (p.category !== 'training' || (p.repeat_kind ?? 'weekly') !== 'weekly') continue
    for (let d = input.today; d <= input.to; d = addDays(d, 1)) {
      const dow = new Date(`${d}T12:00:00Z`).getUTCDay()
      if (!(p.days_of_week ?? []).includes(dow) || (p.effective_from && d < p.effective_from) || (p.repeat_until && d > p.repeat_until)) continue
      if ((p.except_dates ?? []).includes(d) || taken.has(`${p.id}:${d}`)) continue
      out.push({ title: p.title, routineId: byTitle.get(key(p.title)) ?? null, date: d, toDo: true, countsUntil: d, startTime: p.start_time ? p.start_time.slice(0, 5) : null })
    }
  }
  return out
}
// </training-next-rule>
