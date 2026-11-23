// ─────────────────────────────────────────────────────────────────────────────
//  The `claude` function · the suggestions, the rules (phase 4c, migration 199, docs/features/ai-plan.md §8)
//
//  "AI last": the system that looks for needless AI use only RECOMMENDS. An idea is a row in `ai_suggestions` that the
//  owner reads; nothing is created, switched on or changed by it. Three things find ideas (the counting function, the
//  `note_shortcut` tool in an answer, one weekly batch) and all three go through this file:
//    · an idea is written by a model, so it is INPUT: plain text only (no angle bracket, control character, link),
//      a kind from a list, lengths held, and rejected whole when it fails (never repaired);
//    · its key is made here from the idea itself, never taken from the model: one row per idea, a dismissed one is
//      never written again (the database says the same);
//    · the counted patterns reach the weekly job as shapes, counts and costs, escaped, never as the owner's data.
//  No database, no network, no provider here.
// ─────────────────────────────────────────────────────────────────────────────

import { answerValue, checkedList, escapeTagText, readAnswerObject } from './answer-reader.ts'
import { sha256Hex } from './chat-rules.ts'

export const SUGGEST_KINDS = ['widget', 'chart', 'automation', 'notification', 'report', 'existing_feature', 'new_tool', 'cheaper_setting'] as const
export type SuggestKind = typeof SUGGEST_KINDS[number]

/** The numbers that bound the system. The counting function in migration 199 asks with the same thresholds. */
export const SUGGEST_LIMITS = {
  titleMin: 3, titleMax: 120, whyMin: 3, whyMax: 400,
  /** The ideas one answer may note (a second call gets an error result and never runs). */
  perAnswer: 1,
  /** The ideas one weekly run may write. */
  perWeek: 5,
  /** A pattern is an idea only from this many sightings in the window. */
  minTimes: 3,
  /** The days the counting looks back. */
  days: 30,
  /** The patterns and the earlier ideas the weekly job is shown, at most. */
  patternsSent: 24,
  existingSent: 40,
  /** What the counting treats as "sent much, used little" and "costly" (migration 199 says the same). */
  bigInputTokens: 15_000, smallOutputTokens: 300, costlyJobUsd: 0.05,
} as const

export const PATTERN_KINDS = ['tool_sequence', 'question_shape', 'database_fingerprint', 'costly_job', 'big_input_small_output'] as const
export type PatternKind = typeof PATTERN_KINDS[number]

export interface CheckedIdea { kind: SuggestKind; title: string; why: string }

// Control characters and the zero-width and text-direction ones: they draw nothing and can hide a word from a check.
// eslint-disable-next-line no-control-regex -- control characters are exactly what is taken out
const HIDDEN = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/
const LINK = /https?:|www\.|\w\.(?:com|net|org|io|app|dev)\b|\/\//i

/** A short plain text: a string of letters, digits and ordinary punctuation. No angle bracket, control character or link; null when it fails. Never cleaned up. */
export function plainText(value: unknown, min: number, max: number): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  const length = [...text].length
  if (length < min || length > max) return null
  if (HIDDEN.test(text) || /[<>`]/.test(text) || LINK.test(text)) return null
  return text.replace(/ {2,}/g, ' ')
}

/** One idea as the model wrote it, or why it cannot be used. */
export function checkedIdea(raw: unknown): { ok: true; idea: CheckedIdea } | { ok: false; message: string } {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, message: 'The idea must be an object.' }
  const kindRaw = answerValue(raw as Record<string, unknown>, 'kind')
  const kind = typeof kindRaw === 'string' ? SUGGEST_KINDS.find(k => k === kindRaw.trim().toLowerCase()) : undefined
  if (!kind) return { ok: false, message: `The kind must be one of: ${SUGGEST_KINDS.join(', ')}.` }
  const title = plainText(answerValue(raw as Record<string, unknown>, 'title'), SUGGEST_LIMITS.titleMin, SUGGEST_LIMITS.titleMax)
  if (!title) return { ok: false, message: `The title must be plain text of ${SUGGEST_LIMITS.titleMin} to ${SUGGEST_LIMITS.titleMax} characters, with no link, no angle brackets and no new line.` }
  const why = plainText(answerValue(raw as Record<string, unknown>, 'why'), SUGGEST_LIMITS.whyMin, SUGGEST_LIMITS.whyMax)
  if (!why) return { ok: false, message: `The reason must be plain text of ${SUGGEST_LIMITS.whyMin} to ${SUGGEST_LIMITS.whyMax} characters, with no link, no angle brackets and no new line.` }
  return { ok: true, idea: { kind, title, why } }
}

/** The key of an idea written in an answer: made here from its kind and its title with the words lower-cased and the punctuation gone, so a reworded copy of the same words is the same idea. */
export async function ideaKey(idea: CheckedIdea): Promise<string> {
  const words = idea.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  return sha256Hex(`idea\n${idea.kind}\n${words}`)
}

/** The key of an idea the weekly job drew from a counted pattern: the pattern's own, so a reworded idea about the same pattern is the same idea. */
export async function patternKey(pattern: { kind: PatternKind; key: string }): Promise<string> {
  return sha256Hex(`pattern\n${pattern.kind}\n${pattern.key}`)
}

// ── The counted patterns ────────────────────────────────────────────────────

/** One counted pattern, as `ai_suggest_patterns` answers it, checked again. */
export interface Pattern {
  /** `p1`, `p2`…: what the weekly job refers to (never a key or an id of ours). */
  id: string
  kind: PatternKind
  key: string
  times: number
  avgTokens: number
  avgInputTokens: number
  avgOutputTokens: number
  avgCostUsd: number
  totalCostUsd: number
  firstCallId: string | null
}

const SUGGEST_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// A shape is words, brackets and the signs of a query with its values taken out: nothing else is kept.
// eslint-disable-next-line no-control-regex -- control characters are exactly what is taken out
const SHAPE = /^[^\u0000-\u001f\u007f]{1,300}$/

const suggestNum = (v: unknown): number => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : 0
}

/** The counting's rows, checked again (a row of an unknown kind, an unreadable key or a count under the threshold is dropped), best first, at most `SUGGEST_LIMITS.patternsSent`. */
export function readPatterns(data: unknown): Pattern[] {
  const out: Omit<Pattern, 'id'>[] = []
  for (const row of Array.isArray(data) ? data : []) {
    if (row === null || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    const kind = PATTERN_KINDS.find(k => k === r.pattern_kind)
    const key = typeof r.pattern_key === 'string' && SHAPE.test(r.pattern_key) ? r.pattern_key.trim() : ''
    const times = Math.floor(suggestNum(r.times))
    if (!kind || !key || times < SUGGEST_LIMITS.minTimes) continue
    out.push({
      kind, key, times, avgTokens: Math.round(suggestNum(r.avg_tokens)), avgInputTokens: Math.round(suggestNum(r.avg_input_tokens)), avgOutputTokens: Math.round(suggestNum(r.avg_output_tokens)),
      avgCostUsd: suggestNum(r.avg_cost_usd), totalCostUsd: suggestNum(r.total_cost_usd), firstCallId: typeof r.first_call_id === 'string' && SUGGEST_UUID.test(r.first_call_id) ? r.first_call_id : null,
    })
  }
  out.sort((a, b) => b.totalCostUsd - a.totalCostUsd || b.times - a.times)
  return out.slice(0, SUGGEST_LIMITS.patternsSent).map((p, i) => ({ ...p, id: `p${i + 1}` }))
}

/** The patterns a run stored when it was queued, checked again (the table is server-written, but the answer is read against them, so they are not taken on trust). */
export function storedPatterns(value: unknown): Pattern[] {
  const list = value !== null && typeof value === 'object' ? answerValue(value as Record<string, unknown>, 'patterns') : undefined
  const out: Pattern[] = []
  for (const row of Array.isArray(list) ? list : []) {
    if (row === null || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    const kind = PATTERN_KINDS.find(k => k === r.kind)
    if (!kind || typeof r.id !== 'string' || !/^p\d{1,3}$/.test(r.id) || typeof r.key !== 'string' || !SHAPE.test(r.key)) continue
    out.push({
      id: r.id, kind, key: r.key, times: Math.floor(suggestNum(r.times)), avgTokens: Math.round(suggestNum(r.avgTokens)), avgInputTokens: Math.round(suggestNum(r.avgInputTokens)),
      avgOutputTokens: Math.round(suggestNum(r.avgOutputTokens)), avgCostUsd: suggestNum(r.avgCostUsd), totalCostUsd: suggestNum(r.totalCostUsd),
      firstCallId: typeof r.firstCallId === 'string' && SUGGEST_UUID.test(r.firstCallId) ? r.firstCallId : null,
    })
  }
  return out.slice(0, SUGGEST_LIMITS.patternsSent)
}

const suggestUsd = (n: number): string => `$${n >= 0.01 ? n.toFixed(2) : n.toFixed(4)}`

/** What the weekly job reads: counts, costs and shapes only, each pattern one line, escaped, and the earlier ideas as title and state only. */
export function weeklyPrompt(patterns: readonly Pattern[], existing: readonly { title: string; state: string; kind: string }[]): string {
  const lines = patterns.map(p => `${p.id} | ${p.kind} | ${escapeTagText(p.key)} | seen ${p.times} times in ${SUGGEST_LIMITS.days} days | each time about ${p.avgTokens} tokens (${p.avgInputTokens} in, ${p.avgOutputTokens} out), ${suggestUsd(p.avgCostUsd)} | total ${suggestUsd(p.totalCostUsd)}`)
  const earlier = existing.slice(0, SUGGEST_LIMITS.existingSent).map(e => `${e.state} | ${e.kind} | ${escapeTagText(e.title)}`)
  return `<patterns>\n${lines.join('\n') || 'NONE'}\n</patterns>\n<earlier_ideas>\n${earlier.join('\n') || 'NONE'}\n</earlier_ideas>`
}

/** The saving worked out from the ledger for one pattern: how many times, and what one time took. */
export function savingOf(p: Pattern): { times: number; tokens: number; cost: number } {
  return { times: p.times, tokens: Math.min(p.avgTokens, 10_000_000), cost: Math.min(Math.round(p.avgCostUsd * 1_000_000) / 1_000_000, 999_999) }
}

// ── The weekly answer ───────────────────────────────────────────────────────

export interface WeeklyIdea { pattern: Pattern; idea: CheckedIdea }

/**
 * The weekly job's answer: `{ "ideas": [{ "pattern": "p3", "kind": "widget", "title": "…", "why": "…" }] }`. Each idea must name a
 * pattern it was shown (the key comes from that pattern, never from the model), pass `checkedIdea`, and be the only one for its
 * pattern; at most five are kept (the first five that pass). An answer with no usable idea is a good answer: nothing is added.
 */
export function readWeeklyIdeas(answerText: string, patterns: readonly Pattern[]): { ok: true; ideas: WeeklyIdea[]; dropped: number } | { ok: false; problem: string } {
  const read = readAnswerObject(answerText)
  if (!read.ok) return { ok: false, problem: read.problem }
  const list = answerValue(read.value, 'ideas')
  if (!Array.isArray(list)) return { ok: false, problem: 'it had no "ideas" list' }
  const ideas: WeeklyIdea[] = []
  const used = new Set<string>()
  let dropped = 0
  for (const raw of checkedList(list, 30)) {
    const id = raw !== null && typeof raw === 'object' ? answerValue(raw as Record<string, unknown>, 'pattern') : undefined
    const pattern = typeof id === 'string' ? patterns.find(p => p.id === id.trim()) : undefined
    const checked = checkedIdea(raw)
    if (!pattern || !checked.ok || used.has(pattern.id) || ideas.length >= SUGGEST_LIMITS.perWeek) { dropped += 1; continue }
    used.add(pattern.id)
    ideas.push({ pattern, idea: checked.idea })
  }
  return { ok: true, ideas, dropped }
}
