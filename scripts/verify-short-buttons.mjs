#!/usr/bin/env node
/* Verification — short buttons, app-wide (owner, 24.11.2026: "Button names should be short!!!! An icon, a symbol, an image, a
 * small text but not the whole description … If you need the description; show it when mouse is on it"; AGENTS.md → Short
 * buttons):
 *   1. Every button in src shows at most 2 words — <Button>, <PhotoButton>, a plain <button> (menu lines too), a chip
 *      (<ChoiceChip>), a SegmentedControl's option labels (inline, or a constant of the same file) and the static labels of
 *      action objects ({ label: '…', onClick }) — an icon, a symbol or 1–2 words; a count after "·" is a symbol. A
 *      conditional label counts its longest branch; user data ({item.title}) counts nothing. The full words go in the tip.
 *      EXCEPTIONS lists the few that may be longer, each with its reason.
 *   2. A tip starts with the button's own first word (its accessible name begins with what the eye reads).
 *   3. The touch fallback: app/longPressTips.ts explains a control on a long press — never in a text field, a key ends a held
 *      press, the hold is longer than a tap — and the primitives carry their words (Button tip, IconButton label, a segment's
 *      and a chip's tip).
 *   4. Self-test: a long label, a tip that starts elsewhere and a long segment fail.
 * Run: node scripts/verify-short-buttons.mjs */
import { createRequire } from 'node:module'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
require('sucrase/register')
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
let passed = 0, failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) } else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

const SCOPE = ['src']
const TAGS = ['Button', 'PhotoButton', 'button', 'ChoiceChip']

/**
 * Labels that may be longer, by file and the label's start, each with its reason. Keep it short: a button that can be an
 * icon or 1–2 words is one.
 */
const EXCEPTIONS = {
  'src/features/ai/chat/ChatExtras.tsx::toolNames.length': 'a disclosure\'s summary line: it states what is folded (the chat, its tool count, your instructions) — content, not an action',
  'src/features/books/components/library/pieces.tsx::look like the same book': 'a warning that opens its own list: the sentence is the warning',
  'src/features/media/components/stats/MediaStatsView.tsx::with an unknown date': 'a link inside a sentence that explains a count: its words are the sentence',
  'src/features/shop/components/stats/MoneyChart.tsx::spent ·': 'a chip that is one month\'s figures (spent and got back): its words are the data it opens',
}

/** The end of an opening tag that starts at `from` (props hold arrows and nested braces), or -1. */
function tagEnd(src, from) {
  let depth = 0, quote = null
  for (let i = from; i < src.length; i++) {
    const ch = src[i]
    if (quote) { if (ch === quote && src[i - 1] !== '\\') quote = null; continue }
    if (ch === '"' || ch === "'" || ch === '`') { if (depth > 0 || ch === '"') quote = ch; continue }
    if (ch === '{') depth++
    else if (ch === '}') depth--
    else if (ch === '>' && depth === 0) return i
  }
  return -1
}

/** A static prop of an opening tag: `tip="…"` or `tip={'…'}`; null when absent or not a plain string. */
const propOf = (open, name) => {
  const m = open.match(new RegExp(`\\s${name}=(?:"([^"]*)"|\\{'([^']*)'\\}|\\{"([^"]*)"\\})`))
  return m ? (m[1] ?? m[2] ?? m[3]) : null
}

/** Each button in a source: its tag, line, opening tag and children. */
export function buttonsOf(src) {
  const out = []
  for (const tag of TAGS) {
    const re = new RegExp(`<${tag}\\b`, 'g')
    let m
    while ((m = re.exec(src))) {
      const i = tagEnd(src, m.index + tag.length + 1)
      if (i < 0 || src[i - 1] === '/') continue
      // The matching close, counting nested tags of the same name.
      let depth = 1, j = i + 1, end = -1
      const openRe = new RegExp(`<${tag}\\b`, 'g'), closeTag = `</${tag}>`
      while (depth > 0) {
        openRe.lastIndex = j
        const nextOpen = openRe.exec(src)
        const nextClose = src.indexOf(closeTag, j)
        if (nextClose < 0) break
        if (nextOpen && nextOpen.index < nextClose) { depth++; j = nextOpen.index + tag.length + 1; continue }
        depth--
        if (depth === 0) end = nextClose
        j = nextClose + closeTag.length
      }
      if (end < 0) continue
      out.push({ tag, at: src.slice(0, m.index).split('\n').length, open: src.slice(m.index, i + 1), children: src.slice(i + 1, end) })
    }
  }
  return out
}

const wordList = s => (s.replace(/&\w+;/g, ' ').match(/[\p{L}\p{N}'’–-]+/gu) ?? []).filter(w => /[\p{L}]/u.test(w))
const wordsIn = s => wordList(s).length

/**
 * The most words a label can show: its plain text, plus the longest string literal of each `{…}` (a name, a number or user
 * data counts nothing). Nested tags' own text counts; their props do not.
 */
export function shownWords(children, { nested = true } = {}) {
  let plain = '', most = 0, i = 0
  while (i < children.length) {
    if (children[i] === '{') {
      let depth = 1, j = i + 1
      for (; j < children.length && depth; j++) { if (children[j] === '{') depth++; else if (children[j] === '}') depth-- }
      const expr = children.slice(i + 1, j - 1)
      // A comment ({/* … */}) shows nothing.
      if (/^\s*\/\*[\s\S]*\*\/\s*$/.test(expr)) { i = j; continue }
      // A nested element inside an expression ({x && <span>words</span>}) counts as text too.
      const literals = [...expr.matchAll(nested ? /'([^']*)'|`([^`]*)`|>([^<>{}]+)</g : /'([^']*)'|`([^`]*)`/g)].map(x => (x[1] ?? x[2] ?? x[3]).replace(/\$\{[^}]*\}/g, ''))
      // A plain button's row or card content sits in nested elements: only its own text and its own words count.
      if (!nested && /<\w/.test(expr)) { i = j; continue }
      most += literals.length ? Math.max(...literals.map(wordsIn)) : 0
      i = j
    } else if (children[i] === '<') {
      const close = tagEnd(children, i + 1)
      const self = close > 0 && children[close - 1] === '/'
      const name = children.slice(i + 1).match(/^[\w.]+/)?.[0]
      // A plain button (a row, a card, a disclosure): the text inside its nested elements is content, not its label.
      if (!nested && name && !self) {
        const end = children.indexOf(`</${name}>`, close)
        i = end < 0 ? children.length : end + name.length + 3
      } else i = close < 0 ? children.length : close + 1
    } else { plain += children[i]; i++ }
  }
  return wordsIn(plain) + most
}

/** A label's text with every `{…}` (at any depth) and every tag taken out. */
function staticText(children) {
  let out = '', depth = 0
  for (const ch of children) {
    if (ch === '{') depth++
    else if (ch === '}') depth--
    else if (!depth) out += ch
  }
  return out.replace(/<[^>]*>/g, ' ')
}

/** The first word a label shows (static text only), lower case, or null. */
function firstWord(children) {
  const w = wordList(staticText(children))[0]
  return w ? w.toLowerCase() : null
}

/** Segment and chip option labels: `{ value: …, label: '…' }` inside the options given to a SegmentedControl / ChoiceChips. */
export function optionLabelsOf(src) {
  const out = []
  const consts = new Map()
  for (const m of src.matchAll(/const (\w+)\b[^=]*=\s*\[/g)) {
    const start = m.index + m[0].length - 1
    let depth = 0, k = start
    for (; k < src.length; k++) { if (src[k] === '[') depth++; else if (src[k] === ']') { depth--; if (!depth) break } }
    consts.set(m[1], src.slice(start, k + 1))
  }
  for (const m of src.matchAll(/<(SegmentedControl|ChoiceChips)\b/g)) {
    const end = tagEnd(src, m.index + m[1].length + 1)
    const open = src.slice(m.index, end + 1)
    const inline = open.match(/options=\{(\[[\s\S]*\])\}/)
    const named = open.match(/options=\{(\w+)(?:\.map|\s*\})/)
    const body = inline ? inline[1] : named ? consts.get(named[1]) ?? '' : ''
    for (const o of body.matchAll(/label:\s*'([^']*)'(?:[^}]*?tip:\s*'([^']*)')?/g)) {
      out.push({ at: src.slice(0, m.index).split('\n').length, label: o[1], tip: o[2] ?? null })
    }
  }
  return out
}

/** Action objects with a static label (a record's actions, a menu's entries): `{ …label: '…'… onClick … }` on one line. */
export function actionLabelsOf(src) {
  return [...src.matchAll(/\{[^{}\n]*\blabel:\s*'([^']*)'[^\n]*\bonClick\b/g)].map(m => ({ at: src.slice(0, m.index).split('\n').length, label: m[1] }))
}

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (name.endsWith('.tsx')) acc.push(p)
  }
  return acc
}

const excepted = (file, label) => Object.entries(EXCEPTIONS).some(([k, why]) => {
  const [f, part] = k.split('::')
  return why.length > 10 && file === f && label.replace(/\s+/g, ' ').includes(part)
})

function problemsIn(file, src) {
  const long = [], tips = []
  for (const b of buttonsOf(src)) {
    // A card or a navigation row that opens something: its words are its content (a title, figures), not a label.
    if (b.tag === 'button' && /className="[^"]*\b(card-interactive|tg-nav-item)\b/.test(b.open)) continue
    const n = shownWords(b.children, { nested: b.tag !== 'button' })
    const text = b.children.replace(/\s+/g, ' ').trim()
    if (n > 2 && !excepted(file, text)) long.push(`${file}:${b.at} <${b.tag}> (${n} words: ${text.slice(0, 70)})`)
    const tip = propOf(b.open, 'tip')
    const first = firstWord(b.children)
    if (tip && first && wordList(tip)[0]?.toLowerCase() !== first) tips.push(`${file}:${b.at} "${first}…" has the tip "${tip}"`)
  }
  for (const o of optionLabelsOf(src)) {
    if (wordsIn(o.label) > 2 && !excepted(file, o.label)) long.push(`${file}:${o.at} option "${o.label}"`)
    if (o.tip && wordList(o.label)[0] && wordList(o.tip)[0]?.toLowerCase() !== wordList(o.label)[0].toLowerCase()) tips.push(`${file}:${o.at} option "${o.label}" has the tip "${o.tip}"`)
  }
  for (const a of actionLabelsOf(src)) if (wordsIn(a.label) > 2 && !excepted(file, a.label)) long.push(`${file}:${a.at} action "${a.label}"`)
  return { long, tips }
}

console.log('1–2. Short buttons, app-wide; a tip starts with the button\'s own word')
const long = [], tips = []
let count = 0
for (const dir of SCOPE) {
  for (const file of walk(join(root, dir))) {
    const rel = relative(root, file).split('\\').join('/')
    const src = readFileSync(file, 'utf8')
    count += buttonsOf(src).length
    const p = problemsIn(rel, src)
    long.push(...p.long); tips.push(...p.tips)
  }
}
check(`every button in src shows at most 2 words (${count} buttons read, plus segment, chip and action labels)`, long.length === 0, `${long.length}\n      ${long.join('\n      ')}`)
check('every tip starts with its button\'s own first word', tips.length === 0, `${tips.length}\n      ${tips.join('\n      ')}`)
check('the scan reads the whole app (a broken scanner would pass everything)', count > 600, String(count))
check('every exception says why', Object.values(EXCEPTIONS).every(w => w.length > 10))

console.log('3. The touch fallback')
const T = require('../src/app/longPressTips.ts')
const el = attrs => ({ getAttribute: k => attrs[k] ?? null })
check('a long press shows a control\'s data-tip, else its title, else its accessible name', T.tipOf(el({ 'data-tip': 'A', title: 'B' })) === 'A' && T.tipOf(el({ title: 'B', 'aria-label': 'C' })) === 'B' && T.tipOf(el({ 'aria-label': 'C' })) === 'C' && T.tipOf(el({})) === null)
check('it explains buttons, links, labels, tabs, chips and menu lines — never a text field', ['button', 'a', 'label', '[role="tab"]', '[role="radio"]', '[role="menuitem"]', '.chip'].every(s => T.TIP_CONTROL.includes(s))
  && ['input', 'textarea', 'select', '[contenteditable]'].every(s => T.TIP_NEVER.includes(s)))
check('the hold is longer than a tap (550–600 ms)', T.HOLD_MS >= 550 && T.HOLD_MS <= 600)
const tipsSrc = readFileSync(join(root, 'src/app/longPressTips.ts'), 'utf8')
check('a press that showed the words is not a tap (stopped in the capture phase); a mouse never gets the bubble; a key ends a held press',
  /e\.preventDefault\(\); e\.stopPropagation\(\)/.test(tipsSrc) && /addEventListener\('click', click, true\)/.test(tipsSrc) && /pointerType === 'mouse'\) return/.test(tipsSrc)
  && /addEventListener\('keydown', key, true\)/.test(tipsSrc) && /const key = \(\) => \{ held = null/.test(tipsSrc))
const main = readFileSync(join(root, 'src/main.tsx'), 'utf8')
check('installed in idle time, outside the first download', /import\('\.\/app\/longPressTips'\)/.test(main) && /requestIdleCallback/.test(main))
const button = readFileSync(join(root, 'src/shared/ui/Button.tsx'), 'utf8')
const seg = readFileSync(join(root, 'src/shared/components/SegmentedControl.tsx'), 'utf8')
const chip = readFileSync(join(root, 'src/features/shop/components/shopPickers.tsx'), 'utf8')
check('the primitives carry their words: Button tip, IconButton label, a segment\'s and a chip\'s tip (title, accessible name, data-tip)',
  /aria-label=\{tip\}/.test(button) && /title=\{tip\}/.test(button) && /aria-label=\{label\}/.test(button) && /title=\{label\}/.test(button)
  && /title=\{option\.tip\}/.test(seg) && /data-tip=\{option\.tip\}/.test(seg) && /data-tip=\{tip\}/.test(chip))

console.log('4. Self-test')
check('a three-word label fails', shownWords('Add something I own') > 2 && shownWords("{x ? 'Open the chain' : 'Chain'}") > 2 && shownWords('{x && <span>Add it now</span>}') > 2)
check('an icon, a word, a count and a two-word label pass', shownWords('') === 0 && shownWords('Sell') === 1 && shownWords('Read · {queue.waiting}') === 1 && shownWords("{gone ? 'Close' : 'Later'}") === 1 && shownWords('Quick list') === 2 && shownWords('<Truncate>{item.title}</Truncate>') === 0)
check('the scanner reads props with arrows, a multi-line label and a plain button', buttonsOf('<Button onClick={() => go(a > b)} tip="x">\n  Save it now\n</Button>')[0]?.children.trim() === 'Save it now'
  && buttonsOf('<button type="button" onClick={() => f()}>Clear all the filters</button>')[0]?.children === 'Clear all the filters')
const probe = problemsIn('x.tsx', `const O = [{ value: 'a', label: 'Sold or gone' }]\n<SegmentedControl options={O} />\n<Button tip="Open the task">Task</Button>\n{ key: 'k', label: 'Off the errand list', onClick: f }`)
check('a long segment, a long action label and a tip that starts elsewhere fail', probe.long.length === 2 && probe.tips.length === 1, JSON.stringify(probe))

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
