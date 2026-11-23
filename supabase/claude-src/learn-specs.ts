// ─────────────────────────────────────────────────────────────────────────────
//  The `claude` function · learning: what each reviewed job means to the learning layer (pure)
//
//  A job the owner reviews before saving has a spec here. It says, in code:
//    · which fields of the CHECKED answer are reviewed (a list row is "items.<n>.<field>"), and how each is stored;
//    · how a saved value the browser reports is checked — the same limits as the job's own answer check (a category is
//      an id from the list that was sent, a number is in range, a text is one line within its length); a value that
//      fails is dropped, never repaired;
//    · the compact text of the input (what a case is found by) and whose words it is (typed by the owner, or confirmed
//      by the owner's save);
//    · the key a rule matches on (the thing's name, the receipt line, the sentence), the fields a rule may set, and how;
//    · whether a case can be replayed in the weekly self-test (a photo or a PDF is never kept, so those cannot).
//  The specs only read values our own checks let through; nothing here calls a model or the database.
// ─────────────────────────────────────────────────────────────────────────────

import { NUTRITION_KEYS, NUTRITION_MAX } from './recipe-rules.ts'
import { learnEscape, normKey, storedValue } from './learn-text.ts'

export type FieldKind =
  | { kind: 'line'; max: number }
  | { kind: 'int'; min: number; max: number }
  | { kind: 'number'; min: number; max: number }
  | { kind: 'category' }
  | { kind: 'day' }
  | { kind: 'clock' }
  | { kind: 'currency' }
  | { kind: 'word'; words: readonly string[] }

/** An active rule as the function reads it (ai_rules). */
export interface LearnRule { id: string; field: string; match_key: string; value: string }

export interface LearnSpec {
  job: string
  /** Who wrote the case's input: the owner typed it, or the owner confirmed it by saving what was read. */
  trust: 'owner_typed' | 'owner_confirmed'
  /** Whether the weekly self-test can send the case again (photos and files are never kept). */
  replayable: boolean
  /** The reviewed fields by their leaf name, and how a value of each is checked. */
  fields: Readonly<Record<string, FieldKind>>
  /** Leaf fields whose answers are free text (scored by word overlap, never by equality). */
  freeFields: readonly string[]
  /** Leaf fields a rule may set (never a date: "Tuesday" means another day next week). */
  ruleFields: readonly string[]
  /** field → stored value of a checked answer. */
  values(result: Record<string, unknown>): Record<string, string>
  /** The compact input a case is found by, or null when there is none. */
  caseText(input: Record<string, unknown> | null, saved: Record<string, string>): string | null
  /** The key a field's rule matches on. */
  matchKey(input: Record<string, unknown> | null, field: string, aiValues: Record<string, string>): string | null
  /** Sets one rule's value on a checked answer (a copy): false when it does not fit this call. */
  setRule(result: Record<string, unknown>, input: Record<string, unknown>, rule: LearnRule): boolean
  /** The answer from active rules alone (no model asked), or null. */
  answerFromRules?(input: Record<string, unknown>, rules: readonly LearnRule[]): Record<string, unknown> | null
  /** The saved values in words, for an example: "field: value · …". */
  outputText(output: Record<string, string>, input: Record<string, unknown> | null): string
}

/** A plain object (not a list, not null). */
export const isLearnObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const learnStr = (v: unknown): string => (typeof v === 'string' ? v : '')
/** A uuid, as our ids are. */
export const LEARN_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A category id from the list the call was sent (ids are plain tokens of ours). */
export function sentCategoryIds(input: Record<string, unknown> | null): string[] {
  const rows = input && Array.isArray(input.categories) ? input.categories : []
  return rows.map(r => (isLearnObj(r) && typeof r.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(r.id) ? r.id : '')).filter(Boolean)
}

/** A category id's path from the list the call was sent ("Food / Snacks"), or the id when it is not there. */
function categoryPath(input: Record<string, unknown> | null, id: string): string {
  const rows = input && Array.isArray(input.categories) ? input.categories : []
  for (const r of rows) if (isLearnObj(r) && r.id === id && typeof r.path === 'string') return r.path.slice(0, 60)
  return 'a category no longer on the list'
}

/** One value checked against its kind; the stored text, or null when it does not fit (dropped, never repaired). */
export function checkedField(kind: FieldKind, value: unknown, input: Record<string, unknown> | null): string | null {
  if (value === null || value === undefined || value === '') return ''
  switch (kind.kind) {
    case 'line': {
      const t = storedValue(value, kind.max)
      return t !== null && [...t].length <= kind.max && !/https?:|www\./i.test(t) ? t : null
    }
    case 'int':
    case 'number': {
      const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.replace(',', '.')) : NaN
      if (!Number.isFinite(n) || n < kind.min || n > kind.max || (kind.kind === 'int' && !Number.isInteger(n))) return null
      return String(Math.round(n * 100) / 100)
    }
    case 'category':
      return typeof value === 'string' && sentCategoryIds(input).includes(value) ? value : null
    case 'day':
      return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null
    case 'clock':
      return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : null
    case 'currency':
      return typeof value === 'string' && /^[A-Z]{3}$/.test(value) ? value : null
    case 'word':
      return typeof value === 'string' && kind.words.includes(value) ? value : null
  }
}

/** A field's leaf name: "items.3.category_id" → "category_id". */
export const leafOf = (field: string): string => field.split('.').pop() as string

/** The stored values of named fields of a flat object (only fields the spec reviews). */
function flatValues(source: Record<string, unknown>, fields: Readonly<Record<string, FieldKind>>, rename: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = {}
  for (const leaf of Object.keys(fields)) {
    const v = storedValue(source[rename[leaf] ?? leaf])
    if (v !== null) out[leaf] = v
  }
  return out
}

function joined(output: Record<string, string>, label: (field: string, value: string) => string = (f, v) => `${f}: ${v}`): string {
  return Object.entries(output).filter(([, v]) => v !== '').map(([f, v]) => label(f, v)).join(' · ')
}

// ── shop_tidy ────────────────────────────────────────────────────────────────
const TIDY_FIELDS = { name: { kind: 'line', max: 120 }, brand: { kind: 'line', max: 60 }, model: { kind: 'line', max: 60 }, category_id: { kind: 'category' } } as const
const tidyItem = (input: Record<string, unknown> | null): Record<string, unknown> => (input && isLearnObj(input.item) ? input.item : {})

const SHOP_TIDY_SPEC: LearnSpec = {
  job: 'shop_tidy',
  trust: 'owner_confirmed',
  replayable: true,
  fields: TIDY_FIELDS,
  freeFields: ['name'],
  ruleFields: ['brand', 'model', 'category_id', 'name'],
  values: result => flatValues(result, TIDY_FIELDS),
  caseText: input => {
    const item = tidyItem(input)
    return storedValue([learnStr(item.name), learnStr(item.brand), learnStr(item.model)].filter(Boolean).join(' · '), 300)
  },
  matchKey: input => normKey(learnStr(tidyItem(input).name)),
  setRule(result, input, rule) {
    const item = tidyItem(input)
    if (!(rule.field in TIDY_FIELDS)) return false
    const value = checkedField(TIDY_FIELDS[rule.field as keyof typeof TIDY_FIELDS], rule.value, input)
    if (!value) return false
    // The tidy answer names only what changes: a rule that says what is already there removes the field.
    const now = rule.field === 'category_id' ? learnStr(item.category_id) : learnStr(item[rule.field])
    if (value === now) delete result[rule.field]
    else result[rule.field] = value
    return true
  },
  answerFromRules(input, rules) {
    const by = new Map(rules.map(r => [r.field, r]))
    // Only when the owner's own rules cover every field the tidy could change: then no model is asked.
    if (!['name', 'brand', 'model', 'category_id'].every(f => by.has(f))) return null
    const result: Record<string, unknown> = {}
    for (const r of by.values()) if (!SHOP_TIDY_SPEC.setRule(result, input, r)) return null
    return { ...result, searched: false }
  },
  outputText: (output, input) => joined(output, (f, v) => (f === 'category_id' ? `category: ${categoryPath(input, v)}` : `${f}: ${v}`)),
}

// ── receipt_read ─────────────────────────────────────────────────────────────
const RECEIPT_TOP = { store: { kind: 'line', max: 80 }, date: { kind: 'day' }, currency: { kind: 'currency' }, total: { kind: 'number', min: 0, max: 10_000_000 } } as const
const RECEIPT_LINE = { name: { kind: 'line', max: 120 }, product: { kind: 'line', max: 120 }, brand: { kind: 'line', max: 60 }, model: { kind: 'line', max: 60 }, category_id: { kind: 'category' } } as const

const RECEIPT_SPEC: LearnSpec = {
  job: 'receipt_read',
  // The input is a photo or a PDF (never kept): a case's text is the lines the owner saved, which the save confirmed.
  trust: 'owner_confirmed',
  replayable: false,
  fields: { ...RECEIPT_TOP, ...RECEIPT_LINE },
  freeFields: ['product'],
  ruleFields: ['product', 'brand', 'model', 'category_id'],
  values(result) {
    const out = flatValues(result, RECEIPT_TOP)
    const items = Array.isArray(result.items) ? result.items : []
    items.slice(0, 40).forEach((row, i) => {
      if (!isLearnObj(row)) return
      for (const [leaf, v] of Object.entries(flatValues(row, RECEIPT_LINE))) out[`items.${i}.${leaf}`] = v
    })
    return out
  },
  caseText(_input, saved) {
    const lines = Object.entries(saved).filter(([f]) => /^items\.\d+\.name$/.test(f)).map(([, v]) => v)
    return storedValue([saved.store ? `store: ${saved.store}` : '', ...lines].filter(Boolean).join(' · '), 600)
  },
  matchKey(_input, field, aiValues) {
    const row = /^items\.(\d+)\./.exec(field)
    return row ? normKey(aiValues[`items.${row[1]}.name`] ?? '') : normKey(aiValues.store ?? '')
  },
  setRule(result, input, rule) {
    if (!(rule.field in RECEIPT_LINE) || rule.field === 'name') return false
    const value = checkedField(RECEIPT_LINE[rule.field as keyof typeof RECEIPT_LINE], rule.value, input)
    if (!value) return false
    let set = false
    for (const row of Array.isArray(result.items) ? result.items : []) {
      if (isLearnObj(row) && normKey(learnStr(row.name)) === rule.match_key) { row[rule.field] = value; set = true }
    }
    return set
  },
  outputText(output, input) {
    const lines: string[] = []
    for (const [f, v] of Object.entries(output)) {
      const m = /^items\.(\d+)\.name$/.exec(f)
      if (!m) continue
      const i = m[1]
      const extra = ['product', 'brand', 'model', 'category_id'].map(k => {
        const x = output[`items.${i}.${k}`]
        return x ? (k === 'category_id' ? `category ${categoryPath(input, x)}` : `${k} ${x}`) : ''
      }).filter(Boolean).join(', ')
      lines.push(`line "${v}"${extra ? ` → ${extra}` : ''}`)
    }
    return [output.store ? `store: ${output.store}` : '', ...lines].filter(Boolean).join(' · ')
  },
}

// ── quick_guess ──────────────────────────────────────────────────────────────
const GUESS_FIELDS: Record<string, FieldKind> = {
  title: { kind: 'line', max: 60 }, portion: { kind: 'line', max: 120 },
  ...Object.fromEntries(NUTRITION_KEYS.map(k => [k, { kind: 'number', min: 0, max: NUTRITION_MAX[k] } as FieldKind])),
}

const QUICK_GUESS_SPEC: LearnSpec = {
  job: 'quick_guess',
  trust: 'owner_typed',
  replayable: true,
  fields: GUESS_FIELDS,
  freeFields: ['title', 'portion'],
  ruleFields: Object.keys(GUESS_FIELDS),
  values: result => flatValues(result, GUESS_FIELDS),
  caseText: input => storedValue(learnStr(input?.text), 500),
  matchKey: input => normKey(learnStr(input?.text)),
  setRule(result, input, rule) {
    const kind = GUESS_FIELDS[rule.field]
    if (!kind) return false
    const value = checkedField(kind, rule.value, input)
    if (!value) return false
    result[rule.field] = kind.kind === 'number' ? Number(value) : value
    return true
  },
  answerFromRules(input, rules) {
    const by = new Map(rules.map(r => [r.field, r]))
    if (!['title', ...NUTRITION_KEYS].every(f => by.has(f))) return null
    const result: Record<string, unknown> = { portion: '' }
    for (const r of by.values()) if (!QUICK_GUESS_SPEC.setRule(result, input, r)) return null
    return { ...result, assumptions: ['From your own earlier corrections'] }
  },
  outputText: output => joined(output),
}

// ── item_fill (✨) ────────────────────────────────────────────────────────────
// Field names are stored in snake case (the ledger's field shape); the answer's own names are camel case.
const FILL_NAMES: Record<string, string> = {
  title: 'title', date: 'date', start_time: 'startTime', end_time: 'endTime', duration_minutes: 'durationMinutes', all_day: 'allDay',
  repeat: 'repeat', place: 'place', travel_minutes: 'travelMinutes', show_as: 'showAs', notes: 'notes', deadline_date: 'deadlineDate',
  deadline_time: 'deadlineTime', do_from: 'doFrom', priority: 'priority',
}
const FILL_FIELDS: Record<string, FieldKind> = {
  title: { kind: 'line', max: 200 }, date: { kind: 'day' }, start_time: { kind: 'clock' }, end_time: { kind: 'clock' },
  duration_minutes: { kind: 'int', min: 1, max: 1440 }, all_day: { kind: 'word', words: ['true'] }, repeat: { kind: 'line', max: 20 },
  place: { kind: 'line', max: 200 }, travel_minutes: { kind: 'int', min: 0, max: 1440 }, show_as: { kind: 'line', max: 20 },
  notes: { kind: 'line', max: 1000 }, deadline_date: { kind: 'day' }, deadline_time: { kind: 'clock' }, do_from: { kind: 'day' },
  priority: { kind: 'line', max: 20 },
}
const fillOf = (result: Record<string, unknown>): Record<string, unknown> => (isLearnObj(result.fill) ? result.fill : {})

const ITEM_FILL_SPEC: LearnSpec = {
  job: 'item_fill',
  trust: 'owner_typed',
  replayable: true,
  fields: FILL_FIELDS,
  freeFields: ['title', 'notes', 'place'],
  // Never a date or a time: the same words mean another day next week.
  ruleFields: ['title', 'place', 'priority', 'show_as', 'travel_minutes'],
  values: result => flatValues(fillOf(result), FILL_FIELDS, FILL_NAMES),
  caseText: input => storedValue(learnStr(input?.text), 500),
  matchKey: input => normKey(learnStr(input?.text)),
  setRule(result, input, rule) {
    const kind = FILL_FIELDS[rule.field]
    if (!kind || !ITEM_FILL_SPEC.ruleFields.includes(rule.field)) return false
    const value = checkedField(kind, rule.value, input)
    if (!value) return false
    const fill = { ...fillOf(result) }
    fill[FILL_NAMES[rule.field]] = kind.kind === 'int' ? Number(value) : value
    result.fill = fill
    return true
  },
  outputText: output => joined(output),
}

// ── recipe_from_text ─────────────────────────────────────────────────────────
const RECIPE_FIELDS = { title: { kind: 'line', max: 120 }, servings: { kind: 'int', min: 1, max: 100 }, ingredients: { kind: 'line', max: 2000 } } as const

const RECIPE_SPEC: LearnSpec = {
  job: 'recipe_from_text',
  // A pasted recipe may come from a page: the case is kept only once the owner saved the recipe (confirmed).
  trust: 'owner_confirmed',
  replayable: true,
  fields: RECIPE_FIELDS,
  freeFields: ['title', 'ingredients'],
  ruleFields: [],
  values(result) {
    const out = flatValues(result, { title: RECIPE_FIELDS.title, servings: RECIPE_FIELDS.servings })
    const rows = Array.isArray(result.ingredients) ? result.ingredients : []
    const lines = rows.filter(isLearnObj).map(r => [r.quantity, r.unit, r.name].filter(x => x !== undefined && x !== null && x !== '').join(' ')).filter(Boolean)
    const joinedLines = storedValue(lines.join('; '), 2000)
    if (joinedLines) out.ingredients = joinedLines
    return out
  },
  // The case is found by its first words (the dish), not by the whole pasted page.
  caseText: input => storedValue(learnStr(input?.text).slice(0, 300), 300),
  matchKey: input => normKey(learnStr(input?.text).slice(0, 200)),
  setRule: () => false,
  outputText: output => joined(output),
}

export const LEARN_SPECS: ReadonlyMap<string, LearnSpec> = new Map([SHOP_TIDY_SPEC, RECEIPT_SPEC, QUICK_GUESS_SPEC, ITEM_FILL_SPEC, RECIPE_SPEC].map(s => [s.job, s]))

/** The spec of a reviewed job, or null (a job nobody reviews field by field learns nothing this way). */
export function learnSpecOf(job: string): LearnSpec | null {
  return LEARN_SPECS.get(job) ?? null
}

/** The job's input as kept for a case: no photo, no file, no long text value (a replay never sends a picture again). */
export function keptInput(input: unknown): Record<string, unknown> | null {
  if (!isLearnObj(input)) return null
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(input)) {
    if (/^(image|images|photo|photos|pdf|document|documents|file|files)$/i.test(k)) continue
    if (typeof v === 'string' && v.length > 6000) continue
    out[k] = v
  }
  const text = JSON.stringify(out)
  return text.length <= 30_000 ? out : null
}

/** An example for a call: the case's input and the owner's saved answer, each escaped, as one plain block of text. */
export function exampleBody(spec: LearnSpec, inputText: string, output: Record<string, string>, input: Record<string, unknown> | null): string {
  return `<past_case>\n<input>${learnEscape(inputText)}</input>\n<owner_saved>${learnEscape(spec.outputText(output, input))}</owner_saved>\n</past_case>`
}

/** Applies the active rules to a checked answer (a copy). Answers the new result and which rules were used. */
export function applyRules(spec: LearnSpec, result: Record<string, unknown>, input: Record<string, unknown>, rules: readonly LearnRule[]): { result: Record<string, unknown>; applied: string[] } {
  const copy = JSON.parse(JSON.stringify(result)) as Record<string, unknown>
  const applied: string[] = []
  const key = spec.matchKey(input, '', {})
  for (const rule of rules) {
    if (!spec.ruleFields.includes(rule.field)) continue
    // A row rule (a receipt line) finds its own rows; any other rule needs the input's own key.
    if (spec.job !== 'receipt_read' && rule.match_key !== key) continue
    if (spec.setRule(copy, input, rule)) applied.push(rule.id)
  }
  return { result: copy, applied }
}
