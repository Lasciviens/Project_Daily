// ─────────────────────────────────────────────────────────────────────────────
//  The `claude` function · learning: a save against the AI's own answer, and rules from repeated corrections (pure)
//
//  When the owner saves, the browser sends only the call id, the values it saved and the fields it unticked. The
//  "before" is the function's OWN copy of the AI's checked answer (ai_learn_answers), read by call id and verified user:
//  a forged report can never say what the AI answered. Every saved value goes through the job's own field check first;
//  a value that fails is dropped (not recorded), never repaired.
//
//  A rule is only PROPOSED, and only when the owner corrected the same field of the same thing to the same value at
//  least three times, with no other value among the recent corrections of it. The owner turns it on in Learn.
// ─────────────────────────────────────────────────────────────────────────────

import { checkedField, leafOf, type LearnSpec } from './learn-specs.ts'

export type CorrectionKind = 'edited' | 'unticked' | 'kept' | 'dismissed'

export interface CorrectionRow {
  field: string
  match_key: string | null
  ai_value: string | null
  saved_value: string | null
  kind: CorrectionKind
}

export const DIFF_LIMITS = { fields: 200, rows: 40, ruleMin: 3, ruleWindow: 10 } as const

const FIELD_SHAPE = /^[a-z_]{1,40}(\.[0-9]{1,3}\.[a-z_]{1,40})?$/
const same = (a: string, b: string) => a.normalize('NFKC').trim().toLowerCase() === b.normalize('NFKC').trim().toLowerCase()

/** Whether a reported field name is one this job reviews (a list row's index within the rows a receipt can hold). */
export function knownField(spec: LearnSpec, field: string): boolean {
  if (!FIELD_SHAPE.test(field) || !(leafOf(field) in spec.fields)) return false
  const row = /^items\.(\d+)\./.exec(field)
  if (row) return spec.job === 'receipt_read' && Number(row[1]) < DIFF_LIMITS.rows
  return !field.includes('.')
}

/**
 * The corrections of one save, and the final values (what the owner kept or typed: the case's output).
 * `saved`: field → value as saved; `unticked`: AI fields the owner did not take; `dismissed`: the whole answer was dropped.
 */
export function diffSave(
  spec: LearnSpec, aiValues: Record<string, string>, saved: Record<string, unknown>, unticked: readonly string[], dismissed: boolean,
  input: Record<string, unknown> | null,
): { corrections: CorrectionRow[]; final: Record<string, string> } {
  const corrections: CorrectionRow[] = []
  const final: Record<string, string> = {}
  const off = new Set(unticked.filter(f => typeof f === 'string' && knownField(spec, f)))
  const fields = new Set<string>(Object.keys(aiValues).filter(f => knownField(spec, f)))
  for (const f of Object.keys(saved)) if (knownField(spec, f)) fields.add(f)
  for (const field of [...fields].slice(0, DIFF_LIMITS.fields)) {
    const ai = field in aiValues ? aiValues[field] : null
    const key = spec.matchKey(input, field, aiValues)
    if (dismissed) {
      if (ai !== null) corrections.push({ field, match_key: key, ai_value: ai, saved_value: null, kind: 'dismissed' })
      continue
    }
    if (off.has(field)) {
      if (ai !== null) corrections.push({ field, match_key: key, ai_value: ai, saved_value: null, kind: 'unticked' })
      continue
    }
    if (!(field in saved)) continue
    const value = checkedField(spec.fields[leafOf(field)], saved[field], input)
    // A value that fails the job's own check is not the owner's word we can learn from: dropped.
    if (value === null) continue
    if (value !== '') final[field] = value
    if (ai === null && value === '') continue
    corrections.push({ field, match_key: key, ai_value: ai, saved_value: value, kind: ai !== null && same(ai, value) ? 'kept' : 'edited' })
  }
  return { corrections, final }
}

export interface RuleProposal { field: string; match_key: string; value: string; evidence: number }

/**
 * Rules from a job's correction history (newest first): per rule field and key, the latest `ruleMin` edits all say the
 * same value, and no other value is among the latest `ruleWindow` (the owner is not still changing their mind).
 */
export function ruleProposals(spec: LearnSpec, history: readonly { field: string; match_key: string | null; saved_value: string | null; kind: string; state?: string }[]): RuleProposal[] {
  const groups = new Map<string, string[]>()
  for (const c of history) {
    if (c.kind !== 'edited' || c.state === 'ignored' || !c.match_key || !c.saved_value) continue
    const leaf = leafOf(c.field)
    if (!spec.ruleFields.includes(leaf)) continue
    const k = `${leaf}\u0000${c.match_key}`
    const list = groups.get(k) ?? []
    if (list.length < DIFF_LIMITS.ruleWindow) list.push(c.saved_value)
    groups.set(k, list)
  }
  const out: RuleProposal[] = []
  for (const [k, values] of groups) {
    if (values.length < DIFF_LIMITS.ruleMin) continue
    const latest = values[0]
    if (!values.every(v => same(v, latest))) continue
    const [field, match_key] = k.split('\u0000')
    out.push({ field, match_key, value: latest, evidence: values.length })
  }
  return out
}

/** Whether a save counts as corrected for the tripwire: any field edited, unticked or dismissed. */
export function saveCorrected(corrections: readonly CorrectionRow[]): boolean {
  return corrections.some(c => c.kind !== 'kept')
}
