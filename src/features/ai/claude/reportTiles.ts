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
  /** The same in a few characters, for Home's card: the percent when there is one ("+55 %"), else the difference. */
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
  return { text: pctText ? `${main} · ${pctText}` : main, short: pctText ?? main, dir, tone, against: opts.against }
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
  return { key: 'sessions', label: 'Sessions', value: figure(count), change: prev !== null ? changeOf(count, prev, { better: 'up', against: AGAINST.training }) : undefined, hint: prev !== null ? `${figure(prev)} a week before` : undefined }
}

export function sleepTile(sleep: Rec | null): ReportTile | null {
  const avg = num(sleep?.avg_hours), prev = num(sleep?.previous_avg_hours)
  if (!sleep || avg === null) return null
  const nights = num(sleep.nights), under = num(sleep.under_6h_nights)
  return {
    key: 'sleep', label: 'Sleep', value: duration(avg), change: prev !== null ? changeOf(avg, prev, { better: 'up', against: AGAINST.health, show: duration }) : undefined,
    hint: [nights !== null ? `${nights} ${nights === 1 ? 'night' : 'nights'}` : '', under ? `${under} under 6 h` : ''].filter(Boolean).join(' · ') || undefined,
  }
}

export function stepsTile(steps: Rec | null): ReportTile | null {
  const avg = num(steps?.avg_per_day), prev = num(steps?.previous_avg_per_day)
  if (!steps || avg === null) return null
  const best = num(steps.best_day)
  return { key: 'steps', label: 'Steps', value: figure(avg), unit: 'a day', change: prev !== null ? changeOf(avg, prev, { better: 'up', against: AGAINST.health }) : undefined, hint: best !== null ? `best day ${figure(best)}` : undefined }
}

export function kcalTile(f: Rec): ReportTile | null {
  const kcal = num(f.avg_kcal_on_logged_days), target = targetOf(f.target_kcal)
  if (kcal === null) return null
  return { key: 'kcal', label: 'Calories', value: figure(kcal), unit: 'kcal', change: target !== null ? againstTarget(kcal, target, 'kcal', { near: 0.1 }) : undefined, hint: target !== null ? `target ${figure(target)}` : 'a day logged' }
}

export function doneTile(k: Rec, areas: string | undefined): ReportTile | null {
  const done = num(k.done)
  return done === null ? null : { key: 'done', label: 'Done', value: figure(done), hint: areas }
}

// ── Home's card ─────────────────────────────────────────────────────────────

export interface HeadlineFigure { key: string; label: string; value: string; unit?: string; change?: FigureChange }

/**
 * Home's card: three or four figures of the week from the saved figures (never the model's text) — sessions, steps a day,
 * calories, tasks done; sleep stands in for one that is missing. Empty when there are none.
 */
export function reportHeadline(factsRaw: unknown): HeadlineFigure[] {
  const facts = rec(factsRaw) ?? {}
  const t = section(facts, 'training'), h = section(facts, 'health'), f = section(facts, 'food'), k = section(facts, 'tasks')
  const sessions = t && sessionsTile(t)
  const candidates: (HeadlineFigure | null)[] = [
    sessions ? { key: 'sessions', label: 'Training', value: sessions.value, unit: sessions.value === '1' ? 'session' : 'sessions', change: sessions.change } : null,
    h && stepsTile(rec(h.steps)),
    f && kcalTile(f),
    k ? (() => { const d = doneTile(k, undefined); return d && { key: 'done', label: 'Tasks', value: d.value, unit: 'done' } })() : null,
    h && sleepTile(rec(h.sleep)),
  ]
  return candidates.filter((c): c is HeadlineFigure => !!c).slice(0, 4).map(c => ({ key: c.key, label: c.label, value: c.value, unit: c.unit, change: c.change }))
}
