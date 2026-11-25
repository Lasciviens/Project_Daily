// The weekly report's figures as the app draws them (owner, 25.11.2026: "we can have a better ui here"): each section a
// card with its key figures as tiles, a small chart where the week has the data, the change against the week before as
// a tone, and the model's words under them. Every figure here is read from the figures code saved with the report
// (`ai_reports.facts`, written by `week-facts.ts`), never parsed out of the model's text. The facts are a jsonb the
// database holds, so they are input: every number is read as a finite number or left out, every text as a short string.
// The key figures and how they are written are in reportTiles.ts (Home's card reads only that part). Pure (no React,
// no app imports but the report's own rules): scripts/verify-ai-reports-ui.cjs runs it through sucrase.

import { reportDay, reportSections } from './reportRules'
import {
  AGAINST, againstTarget, changeOf, doneTile, duration, figure, kcalTile, num, rec, section, sessionsTile, sleepTile, stepsTile, targetOf,
  type ChangeTone, type Rec, type ReportTile,
} from './reportTiles'

export { changeOf, duration, figure, reportHeadline, type ChangeTone, type FigureChange, type HeadlineFigure, type ReportTile } from './reportTiles'

export type ReportSectionKey = 'intro' | 'training' | 'health' | 'food' | 'tasks' | 'next' | 'other'

/** A small bar chart of the seven days, Monday first. */
export interface DayChart {
  kind: 'days'
  key: string
  label: string
  /** The bars; null = nothing recorded that day (drawn as an empty stub, never a zero). */
  values: (number | null)[]
  /** Each bar's value as text ("12 400 steps"); null with no value. */
  texts: (string | null)[]
  /** The seven days, "Mon 16.11.2026". */
  days: string[]
  /** A dashed line: the target or the week before's average. */
  reference: { value: number; label: string } | null
  /** The line under the chart while no bar is picked. */
  summary: string
}

/** Horizontal bars, one per area (the scheduled time). */
export interface AreaChart {
  kind: 'areas'
  key: string
  label: string
  rows: { label: string; value: number; text: string }[]
}

export type ReportChart = DayChart | AreaChart

/** A key lift: the exercise, its top set and how it compares with the best before. */
export interface ReportRow { label: string; value: string; badge: string | null; tone: ChangeTone }

export interface ReportSectionView {
  key: ReportSectionKey
  title: string
  tiles: ReportTile[]
  charts: ReportChart[]
  rows: ReportRow[]
  /** Short lines code wrote under the tiles ("Done: work 6 · personal 3"), each cut on screen. */
  lines: string[]
  /** What the section's changes are set against, named once in its header ("vs last week"); a tile set against
   *  something else (the weight "in the week") says so itself. Null with no change. */
  against: string | null
  /** A plain note: the section could not be read, or its readings are partial. */
  note: string | null
  /** The model's paragraphs for this section (plain text). */
  text: string[]
}

// ── Reading the stored figures (the rest: reportTiles.ts) ──────────────────

const text = (v: unknown, max = 60): string | null => {
  if (typeof v !== 'string') return null
  const line = [...v].map(ch => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? ' ' : ch)).join('').trim()
  return line ? (line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line) : null
}
/** Seven numbers (or nulls), Monday first; anything else is no series. */
const week7 = (v: unknown): (number | null)[] | null => {
  if (!Array.isArray(v) || v.length !== 7) return null
  const out = v.map(x => (x === null ? null : num(x) !== null && (x as number) >= 0 ? x as number : undefined))
  return out.some(x => x === undefined) || out.every(x => x === null) ? null : out as (number | null)[]
}
const list = (v: unknown, max: number): Rec[] => (Array.isArray(v) ? v.map(rec).filter((r): r is Rec => r !== null).slice(0, max) : [])

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** The seven days of a week as the chart names them: "Mon 16.11.2026". */
export function weekDays(weekStart: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) return WEEKDAYS
  return WEEKDAYS.map((d, i) => `${d} ${reportDay(new Date(Date.parse(`${weekStart}T12:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10))}`)
}

function dayChart(key: string, label: string, values: (number | null)[], days: string[], show: (v: number) => string, reference: DayChart['reference'], summary: string): DayChart {
  return { kind: 'days', key, label, values, texts: values.map(v => (v === null ? null : show(v))), days, reference, summary }
}

/** "best Thu · 12 400 steps" — the highest bar, by its weekday (the line is short; a picked bar names its date). */
function bestOf(values: (number | null)[], days: string[], show: (v: number) => string): string {
  let at = -1
  values.forEach((v, i) => { if (v !== null && (at < 0 || v > (values[at] as number))) at = i })
  return at < 0 ? '' : `best ${days[at].slice(0, 3)} · ${show(values[at] as number)}`
}

// ── The sections ────────────────────────────────────────────────────────────

function training(t: Rec, days: string[]): Omit<ReportSectionView, 'key' | 'title' | 'text' | 'note' | 'against'> {
  const tiles: ReportTile[] = []
  const volume = num(t.volume_kg), prevVolume = num(t.previous_weeks_avg_volume_kg)
  const sets = num(t.working_sets)
  const against = AGAINST.training
  const sessions = sessionsTile(t)
  if (sessions) tiles.push(sessions)
  // The working sets ride along as Volume's line: two tiles a row, none alone.
  const setsLine = sets !== null ? `${figure(sets)} working sets` : undefined
  if (volume !== null) tiles.push({ key: 'volume', label: 'Volume', value: figure(volume), unit: 'kg', change: prevVolume !== null ? changeOf(volume, prevVolume, { better: 'up', against, unit: 'kg' }) : undefined, hint: setsLine })
  else if (sets !== null) tiles.push({ key: 'sets', label: 'Working sets', value: figure(sets) })

  // Volume by day, from the sessions' own dates (DD.MM.YYYY, as code wrote them).
  const byDay: (number | null)[] = days.map(() => null)
  const sessionTitles: string[] = []
  for (const s of list(t.sessions, 21)) {
    const at = days.findIndex(d => d.endsWith(` ${String(s.date)}`))
    const v = num(s.volume_kg)
    if (at < 0 || v === null || v < 0) continue
    byDay[at] = (byDay[at] ?? 0) + v
    const title = text(s.title, 40)
    if (title) sessionTitles.push(title)
  }
  const kg = (v: number) => `${figure(v)} kg`
  const charts: ReportChart[] = byDay.some(v => v !== null)
    ? [dayChart('volume', 'Volume by day', byDay, days, kg, null, sessionTitles.length ? sessionTitles.join(' · ') : bestOf(byDay, days, kg))]
    : []

  const BADGE: Record<string, [string, ChangeTone]> = { new_best: ['New best', 'success'], same: ['Equals best', 'neutral'], lower: ['Below best', 'warn'], no_history: ['First time', 'neutral'] }
  const rows: ReportRow[] = list(t.key_lifts, 3).flatMap(l => {
    const label = text(l.exercise, 60), top = text(l.top_set, 30)
    if (!label || !top) return []
    const badge = typeof l.change === 'string' ? BADGE[l.change] : undefined
    const before = num(l.best_before_kg)
    return [{ label, value: top, badge: l.change === 'lower' && before !== null ? `Below ${figure(before)} kg` : badge?.[0] ?? null, tone: badge?.[1] ?? 'neutral' }]
  })
  return { tiles, charts, rows, lines: [] }
}

function health(h: Rec, days: string[]): Omit<ReportSectionView, 'key' | 'title' | 'text' | 'note' | 'against'> {
  const tiles: ReportTile[] = []
  const charts: ReportChart[] = []
  const against = AGAINST.health
  const sleep = rec(h.sleep), steps = rec(h.steps), energy = rec(h.active_energy), resting = rec(h.resting_heart_rate), weight = rec(h.weight)
  const sleepPrev = num(sleep?.previous_avg_hours), stepsPrev = num(steps?.previous_avg_per_day)
  const kcal = num(energy?.avg_kcal_per_day), kcalPrev = num(energy?.previous_avg_kcal_per_day)
  // The active energy is Steps' line; with no steps it keeps a tile of its own.
  const stepsT = stepsTile(steps, kcal)
  for (const tile of [sleepTile(sleep), stepsT]) if (tile) tiles.push(tile)
  if (!stepsT && kcal !== null) tiles.push({ key: 'energy', label: 'Active energy', value: figure(kcal), unit: 'kcal', change: kcalPrev !== null ? changeOf(kcal, kcalPrev, { better: 'up', against, unit: 'kcal' }) : undefined })
  const bpm = num(resting?.avg_bpm), bpmPrev = num(resting?.previous_avg_bpm)
  if (bpm !== null) tiles.push({ key: 'resting', label: 'Resting HR', value: figure(bpm), unit: 'bpm', change: bpmPrev !== null ? changeOf(bpm, bpmPrev, { better: 'down', against, unit: 'bpm' }) : undefined })
  const kg = num(weight?.latest_kg)
  if (weight && kg !== null) {
    // Against the last weigh-in before the week (the section's "vs last week"); never good or bad.
    const since = num(weight.change_since_before_week_kg)
    tiles.push({ key: 'weight', label: 'Weight', value: figure(kg), unit: 'kg', change: since !== null ? changeOf(kg, kg - since, { better: 'none', against, unit: 'kg', percent: false }) : undefined })
  }
  const stepDays = week7(steps?.per_day)
  if (stepDays) {
    const show = (v: number) => `${figure(v)} steps`
    charts.push(dayChart('steps', 'Steps', stepDays, days, show, stepsPrev !== null ? { value: stepsPrev, label: 'last week' } : null, bestOf(stepDays, days, show)))
  }
  const nights = week7(sleep?.per_night)
  if (nights) charts.push(dayChart('sleep', 'Sleep', nights, days, duration, sleepPrev !== null ? { value: sleepPrev, label: 'last week' } : null, bestOf(nights, days, duration)))
  return { tiles, charts, rows: [], lines: [] }
}

function food(f: Rec, days: string[]): Omit<ReportSectionView, 'key' | 'title' | 'text' | 'note' | 'against'> {
  const tiles: ReportTile[] = []
  const kcalTarget = targetOf(f.target_kcal)
  const protein = num(f.avg_protein_g_on_logged_days), proteinTarget = targetOf(f.target_protein_g)
  const water = num(f.avg_water_ml_on_logged_days), waterTarget = targetOf(f.target_water_ml)
  const logged = num(f.days_logged), onTarget = num(f.days_within_10pct_of_kcal_target), proteinDays = num(f.days_protein_target_met)
  const kcal = kcalTile(f)
  if (kcal) tiles.push(kcal)
  if (logged !== null) tiles.push({ key: 'days', label: 'Days logged', value: figure(logged), unit: 'of 7', hint: onTarget !== null ? `${onTarget} near target` : undefined })
  if (protein !== null) tiles.push({ key: 'protein', label: 'Protein', value: figure(protein), unit: 'g', change: proteinTarget !== null ? againstTarget(protein, proteinTarget, 'g', { atLeast: true }) : undefined, hint: proteinDays !== null ? `target met ${proteinDays} ${proteinDays === 1 ? 'day' : 'days'}` : undefined })
  if (water !== null) tiles.push({ key: 'water', label: 'Water', value: figure(water), unit: 'ml', change: waterTarget !== null ? againstTarget(water, waterTarget, 'ml', { atLeast: true }) : undefined })
  const perDay = week7(f.kcal_per_day)
  const show = (v: number) => `${figure(v)} kcal`
  const charts: ReportChart[] = perDay
    ? [dayChart('kcal', 'Calories by day', perDay, days, show, kcalTarget !== null ? { value: kcalTarget, label: 'target' } : null, bestOf(perDay, days, show).replace(/^best/, 'most'))]
    : []
  return { tiles, charts, rows: [], lines: [] }
}

function tasks(k: Rec): Omit<ReportSectionView, 'key' | 'title' | 'text' | 'note' | 'against'> {
  const tiles: ReportTile[] = []
  const slipped = num(k.slipped), older = num(k.carried_over_open), created = num(k.created)
  const areas = list(k.done_by_area, 6).map(a => ({ area: text(a.area, 30), count: num(a.count) })).filter(a => a.area && a.count !== null)
  const titles = (Array.isArray(k.slipped_titles) ? k.slipped_titles : []).slice(0, 5).map(x => text(x, 60)).filter((x): x is string => !!x)
  // Four small numbers make one row of tiles; what they are made of follows as lines.
  const done = doneTile(k, undefined)
  if (done) tiles.push(done)
  if (slipped !== null) tiles.push({ key: 'slipped', label: 'Slipped', value: figure(slipped) })
  if (older !== null) tiles.push({ key: 'older', label: 'Overdue', value: figure(older) })
  if (created !== null) tiles.push({ key: 'created', label: 'Created', value: figure(created) })
  const rows = list(k.scheduled_hours_by_area, 8).map(a => ({ label: text(a.area, 30), value: num(a.hours) })).filter(a => a.label && a.value !== null && (a.value as number) > 0)
    .map(a => ({ label: a.label as string, value: a.value as number, text: duration(a.value as number) }))
  const lines = [
    ...(areas.length ? [`Done: ${areas.slice(0, 4).map(a => `${a.area} ${a.count}`).join(' · ')}`] : []),
    ...(titles.length ? [`Slipped: ${titles.join(' · ')}`] : []),
  ]
  return { tiles, charts: rows.length ? [{ kind: 'areas', key: 'time', label: 'Scheduled time', rows }] : [], rows: [], lines }
}

const SECTION_TITLE: Record<Exclude<ReportSectionKey, 'intro' | 'other'>, string> = { training: 'Training', health: 'Health', food: 'Food', tasks: 'Tasks & time', next: 'Next week' }
const HEADING_KEY: Record<string, ReportSectionKey> = { training: 'training', health: 'health', food: 'food', 'tasks & time': 'tasks', tasks: 'tasks', 'next week': 'next' }

/**
 * The report as the app draws it: Training, Health, Food, Tasks & time (each from its saved figures, with the model's
 * words for it), then Next week (words only). A section shows when it has figures, words or could not be read; a report
 * saved before the figures were kept (or with none) still shows its words, a section to a card. Text before the first
 * heading comes first; a heading the app does not know keeps its own card.
 */
export function reportView(factsRaw: unknown, content: string | null, weekStart: string): ReportSectionView[] {
  const facts = rec(factsRaw) ?? {}
  const days = weekDays(weekStart)
  const unreadable = Array.isArray(facts.unreadable) ? facts.unreadable.filter((x): x is string => typeof x === 'string') : []
  const words = new Map<ReportSectionKey, string[]>()
  const others: ReportSectionView[] = []
  for (const s of reportSections(content ?? '')) {
    const key = s.heading ? HEADING_KEY[s.heading.toLowerCase()] : 'intro'
    if (key) words.set(key, [...(words.get(key) ?? []), ...s.lines])
    else others.push({ key: 'other', title: s.heading, tiles: [], charts: [], rows: [], lines: [], against: null, note: null, text: s.lines })
  }
  const out: ReportSectionView[] = []
  const intro = words.get('intro')
  if (intro?.length) out.push({ key: 'intro', title: '', tiles: [], charts: [], rows: [], lines: [], against: null, note: null, text: intro })
  const build = { training: (r: Rec) => training(r, days), health: (r: Rec) => health(r, days), food: (r: Rec) => food(r, days), tasks: (r: Rec) => tasks(r) }
  for (const key of ['training', 'health', 'food', 'tasks'] as const) {
    const figures = section(facts, key)
    const body = figures ? build[key](figures) : { tiles: [], charts: [], rows: [], lines: [] }
    const failed = unreadable.includes(key)
    const note = failed ? 'Could not be read this week (a database error).' : key === 'health' && figures?.truncated === true ? 'Some readings could not be read in full, so these figures may be partial.' : null
    const text = words.get(key) ?? []
    if (!figures && !text.length && !failed) continue
    out.push({ key, title: SECTION_TITLE[key], ...body, against: body.tiles.find(t => t.change)?.change?.against ?? null, note, text })
  }
  out.push(...others)
  const next = words.get('next')
  if (next?.length) out.push({ key: 'next', title: SECTION_TITLE.next, tiles: [], charts: [], rows: [], lines: [], against: null, note: null, text: next })
  return out
}
