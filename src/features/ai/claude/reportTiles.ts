// The weekly report's key figures, read from the figures code saved with the report (`ai_reports.facts`, written by
// `week-facts.ts`) and written by code — never parsed out of the model's text (owner, 25.11.2026). The facts are a jsonb
// the database holds, so they are input: every number is read as a finite number or left out. This part is what Home's
// card needs (its first download stays small); the report's cards, charts and words are in reportFigures.ts, which
// builds on it. Pure: scripts/verify-ai-reports-ui.cjs runs it through sucrase.

import { groupDigits } from './reportRules'

/** Better, worse or neither: a tone, never the accent (THEME §2.4). */
export type ChangeTone = 'success' | 'warn' | 'neutral'

export interface FigureChange {
  /** The signed difference, written by code: "+3 286 · +55 %", "+47 min", "-0.5 kg". */
  text: string
  /** The same in a few characters, on the tile's number line: the percent when there is one ("+55 %"), else the
   *  difference ("+47 min", "-1 kg"). */
  short: string
  dir: 'up' | 'down' | 'same'
  tone: ChangeTone
  /** What it is set against: "vs last week", "vs 4-week avg", "vs target", "in the week". */
  against: string
}

export interface ReportTile {
  key: string
  label: string
  value: string
  unit?: string
  change?: FigureChange
  /** One short line of context (cut on screen). */
  hint?: string
}

// ── Reading the stored figures ──────────────────────────────────────────────

export type Rec = Record<string, unknown>
export const rec = (v: unknown): Rec | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Rec : null)
export const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** A section's figures, or null when the report has none for it (an older report, or no data that week). */
export function section(facts: Rec, key: string): Rec | null {
  const s = rec(facts[key])
  return s && s.has_data === true ? s : null
}

// ── Writing them ────────────────────────────────────────────────────────────

/** A number to one decimal at most, thousands grouped: 9286 → "9 286", 2.25 → "2.3", -0.5 → "-0.5". */
export function figure(value: number): string {
  const r = Math.round(value * 10) / 10
  const [whole, frac] = String(Math.abs(r)).split('.')
  return `${r < 0 ? '-' : ''}${groupDigits(Number(whole))}${frac ? `.${frac}` : ''}`
}

/** Hours as "6 h 47 min", "7 h", "47 min". */
export function duration(hours: number): string {
  const total = Math.round(Math.abs(hours) * 60)
  const h = Math.floor(total / 60), m = total % 60
  return h > 0 ? (m > 0 ? `${h} h ${m} min` : `${h} h`) : `${m} min`
}

export const signed = (diff: number, show: (v: number) => string) => `${diff < 0 ? '-' : '+'}${show(Math.abs(diff))}`

/**
 * The change of a figure against another, written by code. `better` says which way is good (resting heart rate: down);
 * 'none' keeps the tone neutral (weight). The percent is left out when the other figure is zero.
 */
export function changeOf(cur: number, prev: number, opts: { better: 'up' | 'down' | 'none'; against: string; show?: (v: number) => string; unit?: string; percent?: boolean }): FigureChange {
  const show = opts.show ?? figure
  const diff = cur - prev
  const same = show(Math.abs(diff)) === show(0)
  const dir: FigureChange['dir'] = same ? 'same' : diff > 0 ? 'up' : 'down'
  const pct = opts.percent !== false && prev > 0 && !same ? Math.round((diff / prev) * 100) : null
  const main = same ? 'no change' : `${signed(diff, show)}${opts.unit ? ` ${opts.unit}` : ''}`
  const tone: ChangeTone = dir === 'same' || opts.better === 'none' ? 'neutral' : dir === opts.better ? 'success' : 'warn'
  const pctText = pct !== null && pct !== 0 ? `${pct > 0 ? '+' : '-'}${Math.abs(pct)} %` : null
  // A duration reads best as itself ("+47 min"); a count or an amount as its percent.
  return { text: pctText ? `${main} · ${pctText}` : main, short: opts.show && opts.show !== figure ? main : pctText ?? main, dir, tone, against: opts.against }
}

/** Set against a target: on target (within `near` of it, or at or above it for `atLeast`) is good, otherwise a warning. */
export function againstTarget(cur: number, target: number, unit: string, rule: { near?: number; atLeast?: boolean }): FigureChange {
  const c = changeOf(cur, target, { better: 'none', against: 'vs target', unit })
  const ok = rule.atLeast ? cur >= target : Math.abs(cur - target) <= target * (rule.near ?? 0.1)
  return { ...c, tone: ok ? 'success' : 'warn' }
}

/** A target that is set (above zero), else null. */
export const targetOf = (v: unknown): number | null => { const n = num(v); return n !== null && n > 0 ? n : null }

// ── The tiles Home's card shares with the report's cards ────────────────────

export const AGAINST = { training: 'vs 4-week avg', health: 'vs last week' } as const

export function sessionsTile(t: Rec): ReportTile | null {
  const count = num(t.session_count), prev = num(t.previous_weeks_avg_sessions)
  if (count === null) return null
  return { key: 'sessions', label: 'Sessions', value: figure(count), change: prev !== null ? changeOf(count, prev, { better: 'up', against: AGAINST.training }) : undefined }
}

export function sleepTile(sleep: Rec | null): ReportTile | null {
  const avg = num(sleep?.avg_hours), prev = num(sleep?.previous_avg_hours)
  if (!sleep || avg === null) return null
  // The nights themselves are the chart; a short night is worth its own words.
  const under = num(sleep.under_6h_nights)
  return {
    key: 'sleep', label: 'Sleep', value: duration(avg), change: prev !== null ? changeOf(avg, prev, { better: 'up', against: AGAINST.health, show: duration }) : undefined,
    hint: under ? `${under} ${under === 1 ? 'night' : 'nights'} under 6 h` : undefined,
  }
}

/** Steps a day; the active energy rides along as its line (one figure less to scroll past). */
export function stepsTile(steps: Rec | null, activeKcal: number | null = null): ReportTile | null {
  const avg = num(steps?.avg_per_day), prev = num(steps?.previous_avg_per_day)
  if (!steps || avg === null) return null
  return { key: 'steps', label: 'Steps', value: figure(avg), unit: 'a day', change: prev !== null ? changeOf(avg, prev, { better: 'up', against: AGAINST.health }) : undefined, hint: activeKcal !== null ? `${figure(activeKcal)} kcal active` : undefined }
}

export function kcalTile(f: Rec): ReportTile | null {
  const kcal = num(f.avg_kcal_on_logged_days), target = targetOf(f.target_kcal)
  if (kcal === null) return null
  return { key: 'kcal', label: 'Calories', value: figure(kcal), unit: 'kcal', change: target !== null ? againstTarget(kcal, target, 'kcal', { near: 0.1 }) : undefined }
}

export function doneTile(k: Rec, areas: string | undefined): ReportTile | null {
  const done = num(k.done)
  return done === null ? null : { key: 'done', label: 'Done', value: figure(done), hint: areas }
}

// ── Home's card ─────────────────────────────────────────────────────────────

export interface HeadlineFigure { key: string; label: string; value: string }

/**
 * Home's card: four figures of the week in one row, from the saved figures (never the model's text), each label
 * carrying its unit — Sessions, Steps/day, kcal/day ("1 933 of 2 200" against the target), Tasks done; sleep stands in
 * for a missing one. No change on the card (owner-critic, 25.11.2026: a percent with no visible basis says nothing);
 * the popup has them. Empty when there are none.
 */
export function reportHeadline(factsRaw: unknown): HeadlineFigure[] {
  const facts = rec(factsRaw) ?? {}
  const t = section(facts, 'training'), h = section(facts, 'health'), f = section(facts, 'food'), k = section(facts, 'tasks')
  const sessions = t && num(t.session_count)
  const steps = h && num(rec(h.steps)?.avg_per_day)
  const kcal = f && num(f.avg_kcal_on_logged_days), target = f && targetOf(f.target_kcal)
  const done = k && num(k.done)
  const sleep = h && num(rec(h.sleep)?.avg_hours)
  const candidates: (HeadlineFigure | null)[] = [
    sessions != null ? { key: 'sessions', label: sessions === 1 ? 'Session' : 'Sessions', value: figure(sessions) } : null,
    steps != null ? { key: 'steps', label: 'Steps/day', value: figure(steps) } : null,
    kcal != null ? { key: 'kcal', label: 'kcal/day', value: target != null ? `${figure(kcal)} of ${figure(target)}` : figure(kcal) } : null,
    done != null ? { key: 'done', label: 'Tasks done', value: figure(done) } : null,
    sleep != null ? { key: 'sleep', label: 'Sleep', value: duration(sleep) } : null,
  ]
  return candidates.filter((c): c is HeadlineFigure => !!c).slice(0, 4)
}
