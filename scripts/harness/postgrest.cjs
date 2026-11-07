'use strict'
// A small PostgREST emulator over in-memory tables — the part of the query
// language supabase-js sends: column filters (eq … ilike, in, is, cs/cd/ov,
// fts, not., (any)/(all)), or=/and= trees, select with renamed columns, JSON
// paths and embedded tables (!inner, hints, spreads), order, limit/offset,
// counts, single-object answers, insert / upsert / update / delete.
// SQL's NULL rules hold: a comparison with NULL is neither true nor false.
// See README.md in this folder for what it leaves out.

const crypto = require('node:crypto')

// ── Small parsing helpers ────────────────────────────────────────────────────

/** Splits on `sep` outside quotes and brackets: "a,in.(b,c),or(d,e)" → 3 parts. */
function splitTop(s, sep = ',') {
  const out = []
  let depth = 0, quoted = false, cur = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quoted) {
      cur += c
      if (c === '\\' && i + 1 < s.length) { cur += s[++i]; continue }
      if (c === '"') quoted = false
      continue
    }
    if (c === '"') { quoted = true; cur += c; continue }
    if (c === '(' || c === '{' || c === '[') depth++
    else if (c === ')' || c === '}' || c === ']') depth--
    if (c === sep && depth === 0) { out.push(cur); cur = ''; continue }
    cur += c
  }
  if (cur !== '' || out.length) out.push(cur)
  return out
}

const unquote = (s) => (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"' ? s.slice(1, -1).replace(/\\(.)/g, '$1') : s)

/** "{a,b,\"c d\"}" or "[\"a\"]" or "(a,b)" → ['a','b','c d']; a JSON object literal stays an object. */
function parseList(raw) {
  const s = raw.trim()
  if (s.startsWith('[') || (s.startsWith('{') && /^\{\s*"[^"]*"\s*:/.test(s))) {
    try { return JSON.parse(s) } catch { /* fall through to the array-literal form */ }
  }
  const inner = /^[({]([\s\S]*)[)}]$/.exec(s)
  if (!inner) return [unquote(s)]
  if (inner[1].trim() === '') return []
  return splitTop(inner[1]).map(x => unquote(x.trim()))
}

/** "data->'a'->>b::int" → { name: 'data', path: [{ key: 'a', text: false }, { key: 'b', text: true }], cast: 'int' } */
function parseColumn(expr) {
  let s = expr.trim(), cast = null
  const castAt = s.indexOf('::')
  if (castAt >= 0) { cast = s.slice(castAt + 2); s = s.slice(0, castAt) }
  const parts = s.split(/(->>|->)/)
  const name = unquote(parts[0])
  const path = []
  for (let i = 1; i < parts.length; i += 2) path.push({ key: unquote(parts[i + 1].replace(/^'|'$/g, '')), text: parts[i] === '->>' })
  return { name, path, cast }
}

function readColumn(row, col) {
  let v = row[col.name]
  for (const step of col.path) {
    if (typeof v === 'string') { try { v = JSON.parse(v) } catch { v = undefined } }
    if (v == null || typeof v !== 'object') { v = null; break }
    v = Array.isArray(v) && /^-?\d+$/.test(step.key) ? v[Number(step.key) < 0 ? v.length + Number(step.key) : Number(step.key)] : v[step.key]
    if (v === undefined) v = null
    if (step.text && v != null) v = typeof v === 'object' ? JSON.stringify(v) : String(v)
  }
  if (v === undefined) v = null
  if (col.cast && v != null) {
    if (/^(int|integer|bigint|smallint|numeric|float|real|double)/.test(col.cast)) { const n = Number(v); v = Number.isNaN(n) ? v : n }
    else if (/^(text|varchar|char)/.test(col.cast)) v = typeof v === 'object' ? JSON.stringify(v) : String(v)
    else if (col.cast === 'date' && typeof v === 'string') v = v.slice(0, 10)
  }
  return v
}

const outputKey = (col) => (col.path.length ? col.path[col.path.length - 1].key : col.name)

// ── Comparison under SQL rules ───────────────────────────────────────────────

const ISO_DAY = /^\d{4}-\d{2}-\d{2}/
const asTime = (s) => Date.parse(s.length === 10 ? `${s}T00:00:00Z` : /[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s.replace(' ', 'T') : `${s.replace(' ', 'T')}Z`)

/** Brings a filter's text to the row value's type. */
function coerce(rowVal, raw) {
  if (raw === null || raw === undefined) return raw
  if (typeof rowVal === 'number') { const n = Number(raw); return Number.isNaN(n) ? raw : n }
  if (typeof rowVal === 'boolean') {
    if (raw === 'true' || raw === 't' || raw === true) return true
    if (raw === 'false' || raw === 'f' || raw === false) return false
  }
  return raw
}

/** -1 / 0 / 1, or null when either side is NULL. */
function compare(a, b) {
  if (a === null || a === undefined || b === null || b === undefined) return null
  if (typeof a === 'string' && typeof b === 'string' && ISO_DAY.test(a) && ISO_DAY.test(b) && (a.length > 10 || b.length > 10)) {
    const ta = asTime(a), tb = asTime(b)
    if (!Number.isNaN(ta) && !Number.isNaN(tb)) return ta < tb ? -1 : ta > tb ? 1 : 0
  }
  if (typeof a === 'number' && typeof b === 'number') return a < b ? -1 : a > b ? 1 : 0
  if (typeof a === 'boolean' && typeof b === 'boolean') return a === b ? 0 : a ? 1 : -1
  const sa = typeof a === 'object' ? JSON.stringify(a) : String(a)
  const sb = typeof b === 'object' ? JSON.stringify(b) : String(b)
  return sa < sb ? -1 : sa > sb ? 1 : 0
}

function likeRegex(pattern, flags) {
  const body = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/[%*]/g, '.*').replace(/_/g, '.')
  return new RegExp(`^${body}$`, flags)
}

/** Does `big` contain `small` the way jsonb / array `@>` does? */
function contains(big, small) {
  if (Array.isArray(small)) {
    if (!Array.isArray(big)) return false
    return small.every(s => big.some(b => contains(b, s)))
  }
  if (small !== null && typeof small === 'object') {
    if (big === null || typeof big !== 'object' || Array.isArray(big)) return false
    return Object.keys(small).every(k => k in big && contains(big[k], small[k]))
  }
  if (Array.isArray(big)) return big.some(b => contains(b, small))
  return compare(big, coerce(big, small)) === 0
}

const asArray = (v) => {
  if (Array.isArray(v)) return v
  if (typeof v === 'string' && /^[{[]/.test(v)) { try { return parseList(v) } catch { return [v] } }
  return [v]
}

/** true / false / null (unknown) for one operator on one value. */
function applyOp(v, op, mod, raw) {
  if (op === 'is') {
    const w = String(raw).toLowerCase()
    if (w === 'null' || w === 'unknown') return v === null || v === undefined
    if (w === 'not_null') return v !== null && v !== undefined
    if (w === 'true') return v === true
    if (w === 'false') return v === false
    return null
  }
  if (op === 'isdistinct') {
    if (v == null) return raw !== 'null'
    return compare(v, coerce(v, raw)) !== 0
  }
  if (v === null || v === undefined) return null
  if (op === 'in') {
    const list = parseList(raw)
    return list.some(x => compare(v, coerce(v, x)) === 0)
  }
  const one = (x) => {
    switch (op) {
      case 'eq': return compare(v, coerce(v, x)) === 0
      case 'neq': return compare(v, coerce(v, x)) !== 0
      case 'gt': return compare(v, coerce(v, x)) > 0
      case 'gte': return compare(v, coerce(v, x)) >= 0
      case 'lt': return compare(v, coerce(v, x)) < 0
      case 'lte': return compare(v, coerce(v, x)) <= 0
      case 'like': return likeRegex(String(x), '').test(typeof v === 'object' ? JSON.stringify(v) : String(v))
      case 'ilike': return likeRegex(String(x), 'i').test(typeof v === 'object' ? JSON.stringify(v) : String(v))
      case 'match': try { return new RegExp(String(x)).test(String(v)) } catch { return false }
      case 'imatch': try { return new RegExp(String(x), 'i').test(String(v)) } catch { return false }
      default: return null
    }
  }
  if (mod) {
    const list = parseList(raw)
    const results = list.map(one)
    return mod === 'any' ? results.some(Boolean) : results.every(Boolean)
  }
  switch (op) {
    case 'cs': return contains(typeof v === 'string' ? asArray(v) : v, parseList(raw))
    case 'cd': { const big = parseList(raw); return asArray(v).every(x => contains(big, x)) }
    case 'ov': { const other = parseList(raw); return asArray(v).some(x => other.some(o => compare(x, coerce(x, o)) === 0)) }
    case 'fts': case 'plfts': case 'phfts': case 'wfts': {
      const words = String(raw).replace(/^\([^)]*\)/, '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)
      const text = String(typeof v === 'object' ? JSON.stringify(v) : v).toLowerCase()
      return words.every(w => text.includes(w))
    }
    case 'sl': case 'sr': case 'nxl': case 'nxr': case 'adj': return true
    default: return one(raw)
  }
}

// ── Filters: one condition, or an and/or tree of them ────────────────────────

/** "not.in.(a,b)" → { not: true, op: 'in', mod: null, value: '(a,b)' } */
function parseOpValue(s) {
  let not = false
  if (s.startsWith('not.')) { not = true; s = s.slice(4) }
  const dot = s.indexOf('.')
  const head = dot < 0 ? s : s.slice(0, dot)
  const value = dot < 0 ? '' : s.slice(dot + 1)
  const m = /^(\w+)(?:\((any|all)\))?$/.exec(head)
  return { not, op: m ? m[1] : head, mod: m ? m[2] || null : null, value: unquote(value) }
}

/** One item inside or=(…): "col.op.value", "or(…)", "and(…)", "not.and(…)". */
function parseLogicItem(item) {
  const g = /^(not\.)?(or|and)\(([\s\S]*)\)$/.exec(item)
  if (g) return { type: g[2], not: !!g[1], items: splitTop(g[3]).map(parseLogicItem) }
  const parts = /^([^.]+)\.([\s\S]*)$/.exec(item)
  if (!parts) return { type: 'cond', col: parseColumn(item), op: 'eq', mod: null, value: '', not: false }
  return { type: 'cond', col: parseColumn(parts[1]), ...parseOpValue(parts[2]) }
}

function logicTree(type, raw, not) {
  const inner = /^\(([\s\S]*)\)$/.exec(raw.trim())
  return { type, not, items: splitTop(inner ? inner[1] : raw).map(parseLogicItem) }
}

/** Three-valued: true / false / null. */
function evalNode(row, node, embeds) {
  let r
  if (node.type === 'cond') {
    const embedded = embeds ? embeds.get(node.col.name) : undefined
    const v = embedded !== undefined && node.col.path.length === 0 ? embedded : readColumn(row, node.col)
    if (embedded !== undefined && node.op === 'is') r = applyOp(Array.isArray(v) && v.length === 0 ? null : v, 'is', null, node.value)
    else r = applyOp(v, node.op, node.mod, node.value)
  } else {
    const results = node.items.map(n => evalNode(row, n, embeds))
    if (node.type === 'and') r = results.includes(false) ? false : results.includes(null) ? null : true
    else r = results.includes(true) ? true : results.includes(null) ? null : false
  }
  if (node.not) r = r === null ? null : !r
  return r
}

// ── select=… ────────────────────────────────────────────────────────────────

function parseSelect(raw) {
  const fields = []
  for (let item of splitTop(raw || '*')) {
    item = item.trim()
    if (!item) continue
    if (item === '*') { fields.push({ kind: 'star' }); continue }
    let alias = null
    const a = /^("?[\w$]+"?):(?!:)/.exec(item)
    if (a) { alias = unquote(a[1]); item = item.slice(a[0].length) }
    let spread = false
    if (item.startsWith('...')) { spread = true; item = item.slice(3) }
    const e = /^([\w$]+)((?:![\w$]+)*)\(([\s\S]*)\)$/.exec(item)
    if (e && !/^(count|sum|avg|min|max)$/.test(e[1])) {
      const hints = e[2].split('!').filter(Boolean)
      const inner = hints.includes('inner')
      const hint = hints.find(h => h !== 'inner' && h !== 'left') || null
      fields.push({ kind: 'embed', table: e[1], alias: alias || e[1], hint, inner, spread, fields: parseSelect(e[3]) })
      continue
    }
    const agg = /^(?:([\s\S]+?)\.)?(count|sum|avg|min|max)\(\)(?:::(\w+))?$/.exec(item)
    if (agg) { fields.push({ kind: 'agg', fn: agg[2], col: agg[1] ? parseColumn(agg[1]) : null, alias: alias || agg[2] }); continue }
    const col = parseColumn(item)
    fields.push({ kind: 'col', col, alias: alias || outputKey(col) })
  }
  return fields
}

// ── Query parameters → a plan ────────────────────────────────────────────────

const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns', 'or', 'and', 'not.or', 'not.and'])

/** Finds the embed a dotted parameter names ("recipe_ingredients.order" → that embed). */
function embedPathOf(fields, segments) {
  let list = fields, path = []
  for (let i = 0; i < segments.length; i++) {
    const hit = list.find(f => f.kind === 'embed' && (f.alias === segments[i] || f.table === segments[i]))
    if (!hit) return { path, rest: segments.slice(i) }
    path.push(hit.alias)
    list = hit.fields
  }
  return { path, rest: [] }
}

function planFor(url) {
  const fields = parseSelect(url.searchParams.get('select') || '*')
  const scopes = new Map() // '' = the top level, 'a' / 'a.b' = an embed
  const scope = (key) => {
    if (!scopes.has(key)) scopes.set(key, { conds: [], order: null, limit: null, offset: null })
    return scopes.get(key)
  }
  scope('')
  for (const [key, value] of url.searchParams.entries()) {
    if (key === 'select' || key === 'on_conflict' || key === 'columns') continue
    const segments = key.split('.')
    const { path, rest } = segments.length > 1 ? embedPathOf(fields, segments) : { path: [], rest: segments }
    const s = scope(path.join('.'))
    const name = rest.join('.')
    if (name === 'order') s.order = value
    else if (name === 'limit') s.limit = Number(value)
    else if (name === 'offset') s.offset = Number(value)
    else if (name === 'or' || name === 'and') s.conds.push(logicTree(name, value, false))
    else if (name === 'not.or' || name === 'not.and') s.conds.push(logicTree(name.slice(4), value, true))
    else if (!RESERVED.has(name)) s.conds.push({ type: 'cond', col: parseColumn(name), ...parseOpValue(value) })
  }
  return { fields, scopes }
}

function parseOrder(raw) {
  if (!raw) return []
  return splitTop(raw).map(term => {
    const bits = term.split('.')
    let dir = 'asc', nulls = null
    while (bits.length > 1 && /^(asc|desc|nullsfirst|nullslast)$/.test(bits[bits.length - 1])) {
      const b = bits.pop()
      if (b === 'asc' || b === 'desc') dir = b
      else nulls = b
    }
    const colText = bits.join('.')
    const embedRef = /^([\w$]+)\(([\s\S]+)\)$/.exec(colText)
    return { col: parseColumn(embedRef ? embedRef[2] : colText), embed: embedRef ? embedRef[1] : null, desc: dir === 'desc', nullsFirst: nulls ? nulls === 'nullsfirst' : dir === 'desc' }
  })
}

function sortRows(items, orderRaw, valueOf) {
  const terms = parseOrder(orderRaw)
  if (!terms.length) return items
  return [...items].sort((x, y) => {
    for (const t of terms) {
      const a = valueOf(x, t), b = valueOf(y, t)
      const an = a === null || a === undefined, bn = b === null || b === undefined
      if (an && bn) continue
      if (an || bn) return (an ? -1 : 1) * (t.nullsFirst ? 1 : -1)
      const c = compare(a, b)
      if (c) return t.desc ? -c : c
    }
    return 0
  })
}

// ── The store ────────────────────────────────────────────────────────────────

/** The forms a table's name may take in a foreign key: movies → movie, categories → category, boxes → box. */
const singulars = (t) => [...new Set([t.replace(/s$/, ''), t.replace(/ies$/, 'y'), t.replace(/es$/, ''), t])]

class Store {
  /**
   * @param tables   { name: rows[] } — rows are used as they are (copy first if they are shared)
   * @param relations { 'parent.embed': { kind: 'one'|'many', local, foreign } } — embeds the naming rules can't infer
   * @param ownerId  the signed-in user's id (filled into inserts without user_id)
   */
  constructor({ tables = {}, relations = {}, ownerId = null, log = null } = {}) {
    this.tables = tables
    this.relations = relations
    this.ownerId = ownerId
    this.log = log || (() => {})
  }

  rows(table) { return this.tables[table] || [] }

  columns(table) {
    const cols = new Set()
    for (const r of this.rows(table)) for (const k of Object.keys(r)) cols.add(k)
    return cols
  }

  /** How `embed` hangs off `parent`: many-to-one ('one') or one-to-many ('many'). */
  relation(parent, embed, hint) {
    const key = `${parent}.${embed}!${hint || ''}`
    if (!this._relations) this._relations = new Map()
    if (!this._relations.has(key)) this._relations.set(key, this.findRelation(parent, embed, hint))
    return this._relations.get(key)
  }

  findRelation(parent, embed, hint) {
    const cfg = this.relations[`${parent}.${embed}${hint ? `!${hint}` : ''}`] || this.relations[`${parent}.${embed}`]
    if (cfg) return { table: cfg.table || embed, ...cfg }
    const pc = this.columns(parent), ec = this.columns(embed)
    if (hint) {
      const col = hint.replace(new RegExp(`^(${parent}|${embed})_`), '').replace(/_fkey$/, '')
      for (const c of [hint, col]) {
        if (pc.has(c)) return { table: embed, kind: 'one', local: c, foreign: 'id' }
        if (ec.has(c)) return { table: embed, kind: 'many', local: 'id', foreign: c }
      }
    }
    // An embed named after a column (`project:project_id(*)`): the column points at a table of the same stem.
    if (pc.has(embed) && /_id$/.test(embed)) {
      const target = Object.keys(this.tables).find(t => singulars(t).includes(embed.slice(0, -3)))
      if (target) return { table: target, kind: 'one', local: embed, foreign: 'id' }
    }
    for (const se of singulars(embed)) if (pc.has(`${se}_id`)) return { table: embed, kind: 'one', local: `${se}_id`, foreign: 'id' }
    for (const sp of singulars(parent)) if (ec.has(`${sp}_id`)) return { table: embed, kind: 'many', local: 'id', foreign: `${sp}_id` }
    this.log(`embed ${parent} → ${embed}${hint ? `!${hint}` : ''}: relation unknown, answered empty`)
    return { table: embed, kind: embed.endsWith('s') ? 'many' : 'one', local: null, foreign: null }
  }

  /** Rows of `table` passing the conditions of one scope. */
  filtered(table, rows, scope, embedsFor) {
    if (!scope || !scope.conds.length) return rows
    return rows.filter(r => scope.conds.every(c => evalNode(r, c, embedsFor ? embedsFor(r) : null) === true))
  }

  /**
   * Shapes `rows` of `table` by `fields`; drops a row whose !inner embed came back empty,
   * or whose top-level filter on an embed (`embed=not.is.null`) fails.
   */
  shape(table, rows, fields, scopes, path) {
    const out = []
    for (const r of rows) {
      const o = {}
      let keep = true
      const embedValues = new Map()
      for (const f of fields) {
        if (f.kind === 'star') Object.assign(o, structuredClone(r))
        else if (f.kind === 'col') o[f.alias] = structuredClone(readColumn(r, f.col))
        else if (f.kind === 'embed') {
          const rel = this.relation(table, f.table, f.hint)
          const childPath = path ? `${path}.${f.alias}` : f.alias
          const scope = scopes.get(childPath)
          let related = []
          if (rel.local && rel.foreign) {
            const key = r[rel.local]
            related = key === null || key === undefined ? [] : this.rows(rel.table).filter(x => compare(x[rel.foreign], key) === 0)
          }
          related = this.filtered(rel.table, related, scope)
          if (scope && scope.order) related = sortRows(related, scope.order, (x, t) => readColumn(x, t.col))
          if (scope && (scope.offset || scope.limit != null)) related = related.slice(scope.offset || 0, scope.limit != null ? (scope.offset || 0) + scope.limit : undefined)
          const shaped = this.shape(rel.table, related, f.fields, scopes, childPath)
          const value = rel.kind === 'one' ? shaped[0] ?? null : shaped
          if (f.inner && (value === null || (Array.isArray(value) && value.length === 0))) { keep = false; break }
          embedValues.set(f.alias, value)
          if (f.spread && value && !Array.isArray(value)) Object.assign(o, value)
          else if (!f.spread) o[f.alias] = value
        }
      }
      if (!keep) continue
      // A top-level filter that names an embed (`.not('embed', 'is', null)`).
      const top = scopes.get(path || '')
      if (top && top.conds.some(c => c.type === 'cond' && embedValues.has(c.col.name))) {
        const conds = top.conds.filter(c => c.type === 'cond' && embedValues.has(c.col.name))
        if (!conds.every(c => evalNode(r, c, embedValues) === true)) continue
      }
      out.push(o)
    }
    return out
  }

  /** A read: rows, the total before limit/offset, and the shaped page. */
  select(table, url) {
    const plan = planFor(url)
    const top = plan.scopes.get('')
    const embedNames = new Set(plan.fields.filter(f => f.kind === 'embed').map(f => f.alias))
    const rowConds = { ...top, conds: top.conds.filter(c => !(c.type === 'cond' && embedNames.has(c.col.name))) }
    let rows = this.filtered(table, this.rows(table), rowConds)
    rows = sortRows(rows, top.order, (x, t) => {
      if (!t.embed) return readColumn(x, t.col)
      const rel = this.relation(table, t.embed, null)
      const hit = rel.local ? this.rows(rel.table).find(y => compare(y[rel.foreign], x[rel.local]) === 0) : null
      return hit ? readColumn(hit, t.col) : null
    })
    // Shape first (an !inner embed can drop rows), then page.
    let shaped = this.shape(table, rows, plan.fields, plan.scopes, '')
    if (plan.fields.some(f => f.kind === 'agg')) shaped = aggregate(rows, plan.fields)
    const total = shaped.length
    const offset = top.offset || 0
    const page = shaped.slice(offset, top.limit != null ? offset + top.limit : undefined)
    return { rows: page, total, offset }
  }

  matching(table, url) {
    const plan = planFor(url)
    return this.filtered(table, this.rows(table), plan.scopes.get(''))
  }

  newId(table) {
    const rows = this.rows(table)
    if (rows.length && typeof rows[0].id === 'number') return Math.max(...rows.map(r => Number(r.id) || 0)) + 1
    return crypto.randomUUID()
  }

  /**
   * Fills what the database would: id, user_id, created_at / updated_at, and a
   * default for the table's other known columns — false for a flag, [] for an
   * array (what this schema's defaults are), else NULL.
   */
  complete(table, row) {
    const now = new Date().toISOString()
    const known = this.columns(table)
    const out = {}
    for (const c of known) {
      const sample = this.rows(table).find(r => r[c] !== null && r[c] !== undefined)?.[c]
      out[c] = typeof sample === 'boolean' ? false : Array.isArray(sample) ? [] : null
    }
    if (known.has('id') || !known.size) out.id = this.newId(table)
    if (known.has('user_id') || !known.size) out.user_id = this.ownerId
    if (known.has('created_at') || !known.size) out.created_at = now
    if (known.has('updated_at')) out.updated_at = now
    for (const [k, v] of Object.entries(row)) if (v !== undefined) out[k] = v
    if (out.id === null || out.id === undefined) out.id = this.newId(table)
    return out
  }

  insert(table, body, { onConflict, resolution }) {
    this._relations = null // a new row can bring a new column
    if (!this.tables[table]) this.tables[table] = []
    const list = this.tables[table]
    const written = []
    for (const raw of Array.isArray(body) ? body : [body]) {
      if (resolution) {
        const keys = (onConflict || 'id').split(',').map(s => s.trim()).filter(Boolean)
        const existing = keys.every(k => raw[k] !== undefined)
          ? list.find(r => keys.every(k => compare(r[k], coerce(r[k], raw[k])) === 0))
          : null
        if (existing) {
          if (resolution === 'merge') { Object.assign(existing, raw); written.push(existing) }
          continue
        }
      }
      const row = this.complete(table, raw)
      list.push(row)
      written.push(row)
    }
    return written
  }

  update(table, url, patch) {
    const rows = this.matching(table, url)
    for (const r of rows) Object.assign(r, patch)
    return rows
  }

  delete(table, url) {
    const rows = this.matching(table, url)
    const gone = new Set(rows)
    this.tables[table] = this.rows(table).filter(r => !gone.has(r))
    return rows
  }
}

/** select=…count() / sum() / … grouped by the plain columns next to them. */
function aggregate(rows, fields) {
  const groupCols = fields.filter(f => f.kind === 'col')
  const groups = new Map()
  for (const r of rows) {
    const key = JSON.stringify(groupCols.map(f => readColumn(r, f.col)))
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(r)
  }
  if (!groups.size && !groupCols.length) groups.set('[]', [])
  return [...groups.values()].map(list => {
    const o = {}
    for (const f of groupCols) o[f.alias] = list.length ? readColumn(list[0], f.col) : null
    for (const f of fields.filter(x => x.kind === 'agg')) {
      const vals = f.col ? list.map(r => readColumn(r, f.col)).filter(v => v !== null && v !== undefined) : list
      if (f.fn === 'count') o[f.alias] = vals.length
      else if (f.fn === 'sum') o[f.alias] = vals.reduce((s, v) => s + Number(v), 0)
      else if (f.fn === 'avg') o[f.alias] = vals.length ? vals.reduce((s, v) => s + Number(v), 0) / vals.length : null
      else if (f.fn === 'min') o[f.alias] = vals.length ? vals.reduce((m, v) => (compare(v, m) < 0 ? v : m)) : null
      else if (f.fn === 'max') o[f.alias] = vals.length ? vals.reduce((m, v) => (compare(v, m) > 0 ? v : m)) : null
    }
    return o
  })
}

// ── HTTP: one request → { status, headers, body } ────────────────────────────

const json = (status, body, headers = {}) => ({ status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers }, body: body === undefined ? '' : JSON.stringify(body) })

function wantsObject(headers) { return /application\/vnd\.pgrst\.object\+json/.test(headers.accept || '') }

function preferences(headers) {
  const p = {}
  for (const part of String(headers.prefer || '').split(/\s*,\s*/)) {
    const [k, v] = part.split('=')
    if (k) p[k.trim()] = (v || '').trim()
  }
  return p
}

function contentRange(offset, count, total) {
  const span = count > 0 ? `${offset}-${offset + count - 1}` : '*'
  return `${span}/${total ?? '*'}`
}

/** Answers rows: an array, or one object for Accept: …pgrst.object+json (406 unless exactly one). */
function answerRows(method, headers, rows, { status = 200, total = null, offset = 0 } = {}) {
  const prefer = preferences(headers)
  const count = prefer.count ? total ?? rows.length : null
  const extra = { 'content-range': contentRange(offset, rows.length, count) }
  if (wantsObject(headers)) {
    if (rows.length !== 1) {
      return json(406, { code: 'PGRST116', details: `The result contains ${rows.length} rows`, hint: null, message: 'JSON object requested, multiple (or no) rows returned' })
    }
    return json(status, method === 'HEAD' ? undefined : rows[0], extra)
  }
  return json(status, method === 'HEAD' ? undefined : rows, extra)
}

/**
 * Handles /rest/v1/<table> and /rest/v1/rpc/<fn>.
 * @param req { method, url: URL, headers: lower-cased object, body: parsed JSON or null }
 * @param rpcs { name: (args, store) => result } — an unknown function answers []
 */
function handleRest(store, req, rpcs = {}) {
  const { method, url, headers } = req
  const rest = url.pathname.replace(/^\/rest\/v1\/?/, '')
  const prefer = preferences(headers)
  const representation = prefer.return === 'representation'

  if (rest.startsWith('rpc/')) {
    const fn = rest.slice(4)
    const args = method === 'GET' || method === 'HEAD'
      ? Object.fromEntries([...url.searchParams.entries()].filter(([k]) => !RESERVED.has(k) && !k.includes('.') && !/^(eq|neq|gt|gte|lt|lte|like|ilike|in|is|not)\./.test(url.searchParams.get(k))))
      : (req.body || {})
    const handler = rpcs[fn]
    if (!handler) store.log(`rpc ${fn}: no answer defined, answered []`)
    let result
    try { result = handler ? handler(args, store) : [] } catch (err) {
      return json(400, { code: 'P0001', details: null, hint: null, message: String(err && err.message || err) })
    }
    if (Array.isArray(result) && result.every(x => x && typeof x === 'object' && !Array.isArray(x))) {
      // A set-returning function: filters, order and limit apply to its rows.
      const tmp = new Store({ tables: { __rpc: result }, relations: store.relations, log: store.log })
      const { rows, total, offset } = tmp.select('__rpc', url)
      return answerRows(method, headers, rows, { total, offset })
    }
    if (wantsObject(headers) && result && typeof result === 'object' && !Array.isArray(result)) return json(200, result)
    return json(200, method === 'HEAD' ? undefined : result ?? null)
  }

  const table = decodeURIComponent(rest.split('/')[0])
  if (!store.tables[table] && method !== 'POST') store.log(`table ${table}: no rows defined, answered []`)

  if (method === 'GET' || method === 'HEAD') {
    const { rows, total, offset } = store.select(table, url)
    return answerRows(method, headers, rows, { total, offset })
  }

  // The written rows, shaped by the request's select= (filters already chose them).
  const shapeWritten = (rows) => {
    const tmp = new Store({ tables: { ...store.tables, [table]: rows }, relations: store.relations, log: store.log })
    const u = new URL(url)
    for (const k of [...u.searchParams.keys()]) if (k !== 'select' && !k.includes('.')) u.searchParams.delete(k)
    return tmp.select(table, u).rows
  }

  if (method === 'POST') {
    const resolution = prefer.resolution === 'merge-duplicates' ? 'merge' : prefer.resolution === 'ignore-duplicates' ? 'ignore' : null
    const written = store.insert(table, req.body ?? {}, { onConflict: url.searchParams.get('on_conflict'), resolution })
    if (!representation) return json(201, undefined, { 'content-range': contentRange(0, 0, prefer.count ? written.length : null) })
    return answerRows(method, headers, shapeWritten(written), { status: 201, total: written.length })
  }
  if (method === 'PATCH' || method === 'PUT') {
    const updated = store.update(table, url, req.body || {})
    if (!representation) return json(204, undefined, { 'content-range': contentRange(0, 0, prefer.count ? updated.length : null) })
    return answerRows(method, headers, shapeWritten(updated), { total: updated.length })
  }
  if (method === 'DELETE') {
    const plan = planFor(url)
    const gone = store.delete(table, url)
    if (!representation) return json(204, undefined, { 'content-range': contentRange(0, 0, prefer.count ? gone.length : null) })
    const tmp = new Store({ tables: { ...store.tables, [table]: gone }, relations: store.relations, log: store.log })
    return answerRows(method, headers, tmp.shape(table, gone, plan.fields, new Map([['', { conds: [] }]]), ''), { total: gone.length })
  }
  return json(405, { message: `method ${method} not handled by the harness` })
}

module.exports = { Store, handleRest, parseSelect, planFor, compare, splitTop }
