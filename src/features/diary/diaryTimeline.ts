// What happened on one day, for Personal → Diary (owner, 29.10.2026: "what
// where with whom and when I have eaten, watched, played, trained, planned,
// done tasks… Like a diary"). Pure: every row comes from a feature's own
// data, read as that feature reads it — nothing here is stored or counted
// again (scripts/verify-diary-timeline.cjs).

export type DiaryKind = 'food' | 'training' | 'watched' | 'reading' | 'game' | 'task' | 'planned'

export interface DiaryRow {
  key:    string
  kind:   DiaryKind
  /** "HH:MM", or a meal's name for food (it has a meal, not a clock time). */
  when:   string
  title:  string
  detail: string | null
}

export interface DiaryInput {
  /** yyyy-MM-dd */
  day: string
  /** Eaten lines only (Food's diary, never a planned row). */
  meals: readonly { id: string; meal_slot: MealSlot; title: string; calories: number }[]
  workouts: readonly { id: string; title: string; start_time: string | null; minutes: number | null }[]
  watches: readonly { at: string; day: string; kind: 'movie' | 'episode'; title: string; season?: number; episode?: number; tmdbId: number }[]
  reading: readonly { book_id: string; started_at: string; duration_seconds: number }[]
  bookTitles: ReadonlyMap<string, string>
  tasksDone: readonly { id: string; title: string; completed_at: string | null }[]
  planned: readonly { id: string; title: string; start_time: string | null; task_status?: string | null }[]
  lastPlayed: { title: string; last_played_at: string } | null
}

type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'supplement'

const MEAL: Record<MealSlot, { label: string; at: number }> = {
  breakfast:  { label: 'Breakfast',   at: 7 * 60 },
  lunch:      { label: 'Lunch',       at: 12 * 60 },
  snack:      { label: 'Snack',       at: 15 * 60 },
  dinner:     { label: 'Dinner',      at: 18 * 60 },
  supplement: { label: 'Supplements', at: 21 * 60 },
}

const pad = (n: number) => String(n).padStart(2, '0')
/** The local day and clock time of an instant. */
function local(iso: string): { day: string; hhmm: string; minutes: number } | null {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return { day: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, hhmm: `${pad(d.getHours())}:${pad(d.getMinutes())}`, minutes: d.getHours() * 60 + d.getMinutes() }
}
const clockMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))
const code = (s?: number, e?: number) => (s != null && e != null ? `S${pad(s)}E${pad(e)}` : null)
const listOf = (titles: string[]) => (titles.length <= 3 ? titles.join(', ') : `${titles.slice(0, 3).join(', ')} +${titles.length - 3}`)

/** The day's rows in time order (a meal at its usual hour); a row with no time sorts last. */
export function buildDiary(input: DiaryInput): DiaryRow[] {
  const rows: (DiaryRow & { sort: number })[] = []

  const bySlot = new Map<MealSlot, { titles: string[]; kcal: number }>()
  for (const m of input.meals) {
    const g = bySlot.get(m.meal_slot) ?? { titles: [], kcal: 0 }
    g.titles.push(m.title)
    g.kcal += m.calories
    bySlot.set(m.meal_slot, g)
  }
  for (const [slot, g] of bySlot) {
    rows.push({ key: `food:${slot}`, kind: 'food', when: MEAL[slot].label, title: listOf(g.titles), detail: g.kcal > 0 ? `${Math.round(g.kcal)} kcal` : null, sort: MEAL[slot].at })
  }

  for (const w of input.workouts) {
    const t = w.start_time ? local(w.start_time) : null
    if (t && t.day !== input.day) continue
    rows.push({ key: `training:${w.id}`, kind: 'training', when: t?.hhmm ?? '–', title: w.title, detail: w.minutes ? `${w.minutes} min` : null, sort: t?.minutes ?? 24 * 60 })
  }

  for (const w of input.watches) {
    if (w.day !== input.day) continue
    const t = local(w.at)
    rows.push({ key: `watched:${w.kind}:${w.tmdbId}:${w.at}`, kind: 'watched', when: t?.hhmm ?? '–', title: w.title, detail: w.kind === 'episode' ? code(w.season, w.episode) : 'Film', sort: t?.minutes ?? 24 * 60 })
  }

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
    rows.push({ key: `reading:${id}`, kind: 'reading', when: b.hhmm, title: input.bookTitles.get(id) ?? 'A book', detail: `${minutes} min`, sort: b.first })
  }

  if (input.lastPlayed) {
    const t = local(input.lastPlayed.last_played_at)
    if (t && t.day === input.day) rows.push({ key: 'game:last', kind: 'game', when: t.hhmm, title: input.lastPlayed.title, detail: 'Last played', sort: t.minutes })
  }

  for (const task of input.tasksDone) {
    const t = task.completed_at ? local(task.completed_at) : null
    if (t && t.day !== input.day) continue
    rows.push({ key: `task:${task.id}`, kind: 'task', when: t?.hhmm ?? '–', title: task.title, detail: 'Done', sort: t?.minutes ?? 24 * 60 })
  }

  for (const p of input.planned) {
    if (!p.start_time) continue
    const hhmm = p.start_time.slice(0, 5)
    const state = p.task_status === 'done' ? 'Planned · done' : p.task_status === 'cancelled' ? 'Planned · skipped' : 'Planned'
    rows.push({ key: `planned:${p.id}`, kind: 'planned', when: hhmm, title: p.title, detail: state, sort: clockMinutes(hhmm) })
  }

  return rows.sort((a, b) => a.sort - b.sort).map(({ sort: _sort, ...r }) => r)
}
