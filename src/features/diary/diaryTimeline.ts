// What happened on one day, for Personal → Diary (owner, 29.10.2026: "what
// where with whom and when I have eaten, watched, played, trained, planned,
// done tasks… Like a diary"). Pure: every row comes from a feature's own
// data, read as that feature reads it — nothing here is stored or counted
// again (scripts/verify-diary-timeline.cjs).

import { mealsBySlot } from '../daily/foodGlance'
import { splitTitleQty, type MacroAmounts } from '../recipes/foodIngredients'

export type DiaryKind = 'food' | 'training' | 'watched' | 'reading' | 'game' | 'task' | 'planned'

export interface DiaryRow {
  key:    string
  kind:   DiaryKind
  /** "HH:MM"; empty for a meal (it has a meal, not a clock time — its name leads the title). */
  when:   string
  title:  string
  /** Only what the icon doesn't already say: minutes, an episode, a plan's outcome. */
  detail: string | null
}

export interface DiaryInput {
  /** yyyy-MM-dd */
  day: string
  /** Eaten lines only (Food's diary, never a planned row). */
  meals: readonly ({ id: string; source: 'plan' | 'log'; meal_slot: string; title: string; exact?: MacroAmounts } & MacroAmounts)[]
  workouts: readonly { id: string; title: string; start_time: string | null; minutes: number | null }[]
  watches: readonly { at: string; day: string; kind: 'movie' | 'episode'; title: string; season?: number; episode?: number; tmdbId: number }[]
  reading: readonly { book_id: string; started_at: string; duration_seconds: number }[]
  bookTitles: ReadonlyMap<string, string>
  tasksDone: readonly { id: string; title: string; completed_at: string | null; source_type?: string | null; hevy_workout_id?: string | null }[]
  planned: readonly { id: string; title: string; start_time: string | null; task_id?: string | null; task_status?: string | null; task_closed_reason?: string | null; task_workout_id?: string | null }[]
  lastPlayed: { title: string; last_played_at: string } | null
}

/** Where a meal sits among the clock times (its usual hour). */
const MEAL_AT: Record<string, number> = { breakfast: 7 * 60, lunch: 12 * 60, snack: 15 * 60, dinner: 18 * 60, supplement: 21 * 60 }

const pad = (n: number) => String(n).padStart(2, '0')
/** The device's day and clock time of an instant (the owner's phone is on Oslo time). */
function local(iso: string): { day: string; hhmm: string; minutes: number } | null {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return { day: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, hhmm: `${pad(d.getHours())}:${pad(d.getMinutes())}`, minutes: d.getHours() * 60 + d.getMinutes() }
}
const clockMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))
const code = (s?: number, e?: number) => (s != null && e != null ? `S${pad(s)}E${pad(e)}` : null)
const MEDIA_TASK = new Set(['movie', 'tv_series', 'media'])

/** A plan's outcome, read as Daily reads it (dayItems: a passed repeat day is Missed, never Skipped). */
function plannedState(p: DiaryInput['planned'][number]): string | null {
  if (p.task_status === 'done') return 'done'
  if (p.task_status === 'cancelled') return p.task_closed_reason === 'missed' ? 'missed' : 'skipped'
  return null
}

/**
 * The day's rows in time order (a meal at its usual hour); a row with no time
 * sorts last. One thing is one row: a done task with its slot that day shows
 * once, at the slot; a training session that synced shows once, as Trained;
 * a done episode or film task that already shows as Watched doesn't show
 * again as Done.
 */
export function buildDiary(input: DiaryInput): DiaryRow[] {
  const rows: { row: DiaryRow; sort: number }[] = []
  const push = (row: DiaryRow, sort: number) => rows.push({ row, sort })

  // Food's own grouping and eaten kcal (foodGlance.mealsBySlot), every food listed by name (no amounts).
  for (const g of mealsBySlot(input.meals)) {
    push({ key: `food:${g.slot}`, kind: 'food', when: '', title: `${g.name} · ${g.items.map(m => splitTitleQty(m.title).name).join(', ')}`, detail: g.kcal > 0 ? `${g.kcal} kcal` : null }, MEAL_AT[g.slot] ?? 24 * 60)
  }

  const shownWorkouts = new Set<string>()
  for (const w of input.workouts) {
    const t = w.start_time ? local(w.start_time) : null
    if (t && t.day !== input.day) continue
    shownWorkouts.add(w.id)
    push({ key: `training:${w.id}`, kind: 'training', when: t?.hhmm ?? '–', title: w.title, detail: w.minutes ? `${w.minutes} min` : null }, t?.minutes ?? 24 * 60)
  }

  const watchedTitles: string[] = []
  input.watches.forEach((w, i) => {
    if (w.day !== input.day) return
    const t = local(w.at)
    watchedTitles.push(w.title)
    push({ key: `watched:${w.kind}:${w.tmdbId}:${w.at}:${i}`, kind: 'watched', when: t?.hhmm ?? '–', title: w.title, detail: w.kind === 'episode' ? code(w.season, w.episode) : null }, t?.minutes ?? 24 * 60)
  })

  // Reading: one row per book, from its first page turn that day, with the day's minutes.
  const books = new Map<string, { first: number; hhmm: string; seconds: number }>()
  for (const r of input.reading) {
    const t = local(r.started_at)
    if (!t || t.day !== input.day) continue
    const b = books.get(r.book_id)
    if (!b) books.set(r.book_id, { first: t.minutes, hhmm: t.hhmm, seconds: r.duration_seconds })
    else {
      b.seconds += r.duration_seconds
      if (t.minutes < b.first) { b.first = t.minutes; b.hhmm = t.hhmm }
    }
  }
  for (const [id, b] of books) {
    const minutes = Math.round(b.seconds / 60)
    if (minutes < 1) continue
    push({ key: `reading:${id}`, kind: 'reading', when: b.hhmm, title: input.bookTitles.get(id) ?? 'A book', detail: `${minutes} min` }, b.first)
  }

  if (input.lastPlayed) {
    const t = local(input.lastPlayed.last_played_at)
    if (t && t.day === input.day) push({ key: 'game:last', kind: 'game', when: t.hhmm, title: input.lastPlayed.title, detail: null }, t.minutes)
  }

  const slotted = new Set<string>()
  for (const p of input.planned) {
    if (!p.start_time) continue
    if (p.task_id) slotted.add(p.task_id)
    // A training slot whose session synced shows as its workout (Trained), once.
    if (p.task_workout_id && shownWorkouts.has(p.task_workout_id)) continue
    const hhmm = p.start_time.slice(0, 5)
    push({ key: `planned:${p.id}`, kind: p.task_status === 'done' ? 'task' : 'planned', when: hhmm, title: p.title, detail: p.task_status === 'done' ? null : plannedState(p) }, clockMinutes(hhmm))
  }

  for (const task of input.tasksDone) {
    if (slotted.has(task.id)) continue
    if (task.source_type === 'training_session' && task.hevy_workout_id && shownWorkouts.has(task.hevy_workout_id)) continue
    if (task.source_type && MEDIA_TASK.has(task.source_type) && watchedTitles.some(w => task.title.includes(w))) continue
    const t = task.completed_at ? local(task.completed_at) : null
    if (t && t.day !== input.day) continue
    push({ key: `task:${task.id}`, kind: 'task', when: t?.hhmm ?? '–', title: task.title, detail: null }, t?.minutes ?? 24 * 60)
  }

  return rows.sort((a, b) => a.sort - b.sort).map(r => r.row)
}
