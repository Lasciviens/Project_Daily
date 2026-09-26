// ─────────────────────────────────────────────────────────────────────────────
//  Daily brief — a deterministic, rule-based morning summary (no AI).
//
//  Pure and import-free so it is verifiable with scripts/verify-daily-brief.cjs.
//  useDailyBrief() gathers the inputs from existing hooks; this module only
//  decides what to say. The same data always produces the same brief, and a
//  section with nothing worth saying is left out rather than padded.
// ─────────────────────────────────────────────────────────────────────────────

export type BriefTone = 'success' | 'warn' | 'danger' | 'info' | 'neutral'

export interface BriefLine {
  text: string
  tone?: BriefTone
  /** In-app route the line links to. */
  href?: string
}

export type BriefSectionId = 'day' | 'tasks' | 'schedule' | 'training' | 'nutrition' | 'watch' | 'wishes' | 'money'

export interface BriefSection {
  id: BriefSectionId
  title: string
  lines: BriefLine[]
}

export interface DailyBrief {
  greeting: string
  /** One-line headline: the single most useful thing to know right now. */
  headline: BriefLine
  sections: BriefSection[]
}

export interface BriefTask { title: string; priority: 'low' | 'medium' | 'high'; overdue: boolean; dueTime?: string | null }

export interface BriefInput {
  /** Local wall clock, 0–23 (+ fraction for minutes). */
  hour: number
  weather?: { tempC: number; label: string; precipMm: number; windMs: number; highC?: number; lowC?: number; rainLaterMm?: number } | null
  tasks?: { open: BriefTask[]; doneToday: number } | null
  schedule?: {
    next?: { title: string; startLabel: string; startHour: number; inProgress: boolean } | null
    remainingCount: number
    /** Unbooked hours left between now and 22:00. */
    freeHours?: number | null
  } | null
  training?: {
    today?: { title: string; startTime: string | null } | null
    next?: { title: string; date: string; dayLabel: string } | null
    daysSinceLastWorkout?: number | null
    weekSessions?: number | null
    weekTarget?: number | null
  } | null
  nutrition?: { kcal: number; kcalTarget: number; proteinG: number; proteinTarget: number; waterMl?: number; waterTarget?: number } | null
  watch?: { title: string; episodeLabel?: string | null }[] | null
  wishes?: { label: string; count: number }[] | null
  currency?: { pair: string; rate: number; changePct: number }[] | null
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const round = (n: number) => Math.round(n)

export function greetingFor(hour: number): string {
  if (hour < 5) return 'Up late'
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  if (hour < 22) return 'Good evening'
  return 'Winding down'
}

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 } as const

/** Overdue first, then priority, then earliest due time. */
export function pickFocusTask(tasks: BriefTask[]): BriefTask | null {
  if (!tasks.length) return null
  return [...tasks].sort((a, b) =>
    Number(b.overdue) - Number(a.overdue)
    || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
    || (a.dueTime ?? '99').localeCompare(b.dueTime ?? '99'),
  )[0]
}

function daySection(i: BriefInput): BriefSection | null {
  const w = i.weather
  if (!w) return null
  const lines: BriefLine[] = []
  const range = w.highC != null && w.lowC != null ? ` · ${round(w.lowC)}° to ${round(w.highC)}°` : ''
  lines.push({ text: `${round(w.tempC)}°, ${w.label.toLowerCase()}${range}` })
  if (w.precipMm > 0.2) lines.push({ text: 'Raining now — take a jacket.', tone: 'info' })
  else if ((w.rainLaterMm ?? 0) > 0.5) lines.push({ text: 'Rain expected later today.', tone: 'info' })
  if (w.tempC <= 0) lines.push({ text: 'Below freezing — watch for ice.', tone: 'warn' })
  if (w.windMs >= 10) lines.push({ text: `Strong wind, ${round(w.windMs)} m/s.`, tone: 'warn' })
  return { id: 'day', title: 'Weather', lines }
}

function tasksSection(i: BriefInput): BriefSection | null {
  const t = i.tasks
  if (!t) return null
  const overdue = t.open.filter(x => x.overdue).length
  const lines: BriefLine[] = []
  if (!t.open.length) {
    lines.push({ text: t.doneToday ? `All clear — ${plural(t.doneToday, 'task')} done today.` : 'Nothing on the list for today.', tone: 'success', href: '/daily' })
    return { id: 'tasks', title: 'Tasks', lines }
  }
  const high = t.open.filter(x => x.priority === 'high').length
  const parts = [`${plural(t.open.length, 'open task')}`]
  if (overdue) parts.push(`${overdue} overdue`)
  if (high) parts.push(`${high} high priority`)
  if (t.doneToday) parts.push(`${t.doneToday} done`)
  // Neutral on purpose: the headline already carries the overdue alert, and
  // a red line would paint "1 done" and "high priority" red too.
  lines.push({ text: parts.join(' · '), href: '/daily' })
  const focus = pickFocusTask(t.open)
  if (focus) lines.push({ text: `Start with “${focus.title}”${focus.overdue ? ' (overdue)' : focus.dueTime ? ` (due ${focus.dueTime.slice(0, 5)})` : ''}.`, href: '/daily' })
  return { id: 'tasks', title: 'Tasks', lines }
}

function scheduleSection(i: BriefInput): BriefSection | null {
  const s = i.schedule
  if (!s) return null
  const lines: BriefLine[] = []
  if (s.next) {
    lines.push({ text: s.next.inProgress ? `Now: ${s.next.title}` : `Next: ${s.next.startLabel} ${s.next.title}`, tone: s.next.inProgress ? 'info' : undefined, href: '/daily' })
    if (s.remainingCount > 1) lines.push({ text: `${plural(s.remainingCount - 1, 'more block')} after that.` })
  } else if (i.hour < 22) {
    lines.push({ text: 'Nothing else scheduled today.', href: '/daily' })
  }
  if (s.freeHours != null && s.freeHours >= 1 && i.hour < 21) lines.push({ text: `About ${round(s.freeHours)}h unbooked before 22:00.`, tone: 'neutral' })
  return lines.length ? { id: 'schedule', title: 'Schedule', lines } : null
}

function trainingSection(i: BriefInput): BriefSection | null {
  const t = i.training
  if (!t) return null
  const lines: BriefLine[] = []
  if (t.today) {
    lines.push({ text: `Training today${t.today.startTime ? ` at ${t.today.startTime.slice(0, 5)}` : ''}: ${t.today.title}`, tone: 'info', href: '/training' })
  } else if (t.daysSinceLastWorkout != null) {
    const d = t.daysSinceLastWorkout
    if (d === 0) lines.push({ text: 'Workout logged today — nice.', tone: 'success', href: '/training' })
    else if (d >= 4) lines.push({ text: `${plural(d, 'day')} since your last workout.`, tone: 'warn', href: '/training' })
    else lines.push({ text: `Rest day — last workout ${d === 1 ? 'yesterday' : `${d} days ago`}.`, href: '/training' })
    if (t.next) lines.push({ text: `Next planned: ${t.next.title}, ${t.next.dayLabel}.`, href: '/training' })
  } else if (t.next) {
    lines.push({ text: `Next planned: ${t.next.title}, ${t.next.dayLabel}.`, href: '/training' })
  }
  if (t.weekSessions != null && t.weekTarget) {
    const left = t.weekTarget - t.weekSessions
    lines.push({ text: left > 0 ? `${t.weekSessions} of ${t.weekTarget} sessions this week.` : `Weekly target reached (${t.weekSessions}/${t.weekTarget}).`, tone: left > 0 ? 'neutral' : 'success' })
  }
  return lines.length ? { id: 'training', title: 'Training', lines } : null
}

function nutritionSection(i: BriefInput): BriefSection | null {
  const n = i.nutrition
  if (!n || n.kcalTarget <= 0) return null
  const lines: BriefLine[] = []
  if (n.kcal === 0) {
    lines.push({ text: i.hour >= 11 ? 'Nothing logged yet today.' : `Target ${round(n.kcalTarget)} kcal · ${round(n.proteinTarget)} g protein.`, tone: i.hour >= 14 ? 'warn' : undefined, href: '/recipes' })
  } else {
    const left = n.kcalTarget - n.kcal
    lines.push({
      text: left >= 0 ? `${round(n.kcal)} / ${round(n.kcalTarget)} kcal — ${round(left)} left.` : `${round(n.kcal)} kcal — ${round(-left)} over target.`,
      tone: left < 0 ? 'warn' : undefined, href: '/recipes',
    })
    const pLeft = n.proteinTarget - n.proteinG
    if (n.proteinTarget > 0) lines.push({ text: pLeft > 0 ? `Protein ${round(n.proteinG)} g — ${round(pLeft)} g to go.` : `Protein target hit (${round(n.proteinG)} g).`, tone: pLeft > 0 ? undefined : 'success' })
  }
  if (n.waterTarget && n.waterMl != null && i.hour >= 12 && n.waterMl < n.waterTarget * (i.hour / 24)) {
    lines.push({ text: `Water ${(n.waterMl / 1000).toFixed(1)} L of ${(n.waterTarget / 1000).toFixed(1)} L — behind pace.`, tone: 'info' })
  }
  return { id: 'nutrition', title: 'Food', lines }
}

function watchSection(i: BriefInput): BriefSection | null {
  const w = i.watch?.filter(x => x.title) ?? []
  if (!w.length) return null
  const lines = w.slice(0, 2).map<BriefLine>(x => ({ text: x.episodeLabel ? `${x.title} — ${x.episodeLabel}` : x.title, href: '/media' }))
  if (w.length > 2) lines.push({ text: `+${w.length - 2} more in progress.`, tone: 'neutral', href: '/media' })
  return { id: 'watch', title: 'Up next to watch', lines }
}

function wishesSection(i: BriefInput): BriefSection | null {
  const w = i.wishes?.filter(x => x.count > 0) ?? []
  if (!w.length) return null
  return { id: 'wishes', title: 'Wishes', lines: w.slice(0, 2).map(x => ({ text: `${x.label} · ${plural(x.count, 'thing')}`, href: '/wishes' })) }
}

function moneySection(i: BriefInput): BriefSection | null {
  const c = i.currency ?? []
  if (!c.length) return null
  return {
    id: 'money', title: 'Currency',
    lines: c.slice(0, 3).map(x => {
      // Anything that rounds to 0.0 prints as a plain 0.0% — never "-0.0%".
      const pct = Math.abs(x.changePct) < 0.05 ? '0.0%' : `${x.changePct > 0 ? '+' : ''}${x.changePct.toFixed(1)}%`
      return { text: `${x.pair} ${x.rate.toFixed(x.rate >= 100 ? 0 : 2)} (${pct})`, tone: Math.abs(x.changePct) >= 1 ? (x.changePct > 0 ? 'success' : 'danger') : undefined }
    }),
  }
}

/** The single most useful sentence right now, in priority order. */
function headlineFor(i: BriefInput, sections: BriefSection[]): BriefLine {
  const overdue = i.tasks?.open.filter(t => t.overdue).length ?? 0
  if (overdue) return { text: `${plural(overdue, 'task')} overdue — clear ${overdue === 1 ? 'it' : 'them'} first.`, tone: 'danger', href: '/daily' }
  if (i.schedule?.next?.inProgress) return { text: `In progress: ${i.schedule.next.title}.`, tone: 'info', href: '/daily' }
  if (i.training?.today) return { text: `Training today${i.training.today.startTime ? ` at ${i.training.today.startTime.slice(0, 5)}` : ''}.`, tone: 'info', href: '/training' }
  if (i.schedule?.next) return { text: `Next up at ${i.schedule.next.startLabel}: ${i.schedule.next.title}.`, href: '/daily' }
  const open = i.tasks?.open.length ?? 0
  if (open) return { text: `${plural(open, 'open task')} today.`, href: '/daily' }
  if (sections.length) return { text: 'A clear day — nothing urgent.', tone: 'success' }
  return { text: 'Nothing to report yet.', tone: 'neutral' }
}

export function buildDailyBrief(input: BriefInput): DailyBrief {
  const sections = [
    tasksSection(input), scheduleSection(input), trainingSection(input), nutritionSection(input),
    daySection(input), watchSection(input), wishesSection(input), moneySection(input),
  ].filter((s): s is BriefSection => !!s && s.lines.length > 0)
  const temp = input.weather ? `, ${round(input.weather.tempC)}°` : ''
  return { greeting: `${greetingFor(input.hour)}${temp}`, headline: headlineFor(input, sections), sections }
}
