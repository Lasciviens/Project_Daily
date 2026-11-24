#!/usr/bin/env node
/* Verification — short buttons (owner, 24.11.2026: "Button names should be short!!!! An icon, a symbol, an image, a small
 * text but not the whole description … If you need the description; show it when mouse is on it"):
 *   1. Every <Button> and <PhotoButton> in the Shop shows at most 2 words (an icon, a symbol or 1–2 words; a count after
 *      "·" is a symbol); the full description goes in its `tip` (title + accessible name). A conditional label counts its
 *      longest branch.
 *   2. The touch fallback: app/longPressTips.ts explains a control with a title or data-tip on a long press, in its own words.
 *   3. Self-test: a long label fails.
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

/** Where the rule is checked: the whole Shop page, its sheets and the thing's screen. */
const SCOPE = ['src/features/shop']
const TAGS = ['Button', 'PhotoButton']

/** Each button's children in a source: scans `<Tag` to its `>` with brace depth (props hold arrows), then to `</Tag>`. */
export function buttonsOf(src) {
  const out = []
  for (const tag of TAGS) {
    const re = new RegExp(`<${tag}\\b`, 'g')
    let m
    while ((m = re.exec(src))) {
      let i = m.index + tag.length + 1, depth = 0, quote = null
      for (; i < src.length; i++) {
        const ch = src[i]
        if (quote) { if (ch === quote && src[i - 1] !== '\\') quote = null; continue }
        if (ch === '"' || ch === "'" || ch === '`') { if (depth > 0 || ch === '"') quote = ch; continue }
        if (ch === '{') depth++
        else if (ch === '}') depth--
        else if (ch === '>' && depth === 0) break
      }
      if (src[i - 1] === '/') continue
      const end = src.indexOf(`</${tag}>`, i)
      if (end < 0) continue
      out.push({ at: src.slice(0, m.index).split('\n').length, children: src.slice(i + 1, end) })
    }
  }
  return out
}

const wordsIn = s => (s.replace(/&\w+;/g, ' ').match(/[\p{L}\p{N}'’–-]+/gu) ?? []).filter(w => /[\p{L}]/u.test(w)).length

/** The most words a button can show: its plain text, plus the longest string literal of each `{…}` (a non-text expression counts 0: a number or a name). */
export function shownWords(children) {
  let plain = '', most = 0, i = 0
  while (i < children.length) {
    if (children[i] === '{') {
      let depth = 1, j = i + 1
      for (; j < children.length && depth; j++) { if (children[j] === '{') depth++; else if (children[j] === '}') depth-- }
      const expr = children.slice(i + 1, j - 1)
      const literals = [...expr.matchAll(/'([^']*)'|`([^`]*)`/g)].map(x => (x[1] ?? x[2]).replace(/\$\{[^}]*\}/g, ''))
      most += literals.length ? Math.max(...literals.map(wordsIn)) : 0
      i = j
    } else if (children[i] === '<') {
      // A nested element's own text counts (a span around the words); its tag does not.
      const close = children.indexOf('>', i)
      i = close < 0 ? children.length : close + 1
    } else { plain += children[i]; i++ }
  }
  return wordsIn(plain) + most
}

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (name.endsWith('.tsx')) acc.push(p)
  }
  return acc
}

console.log('1. Short buttons in the Shop')
const long = []
let count = 0
for (const dir of SCOPE) {
  for (const file of walk(join(root, dir))) {
    const src = readFileSync(file, 'utf8')
    for (const b of buttonsOf(src)) {
      count++
      const n = shownWords(b.children)
      if (n > 2) long.push(`${relative(root, file)}:${b.at} (${n} words: ${b.children.replace(/\s+/g, ' ').trim().slice(0, 60)})`)
    }
  }
}
check(`every Shop button shows at most 2 words (${count} buttons read)`, long.length === 0, long.join('\n      '))
check('the scan finds the buttons (a broken scanner would pass everything)', count > 80, String(count))

console.log('2. The touch fallback')
const T = require('../src/app/longPressTips.ts')
const el = attrs => ({ getAttribute: k => attrs[k] ?? null })
check('a long press explains a control by its data-tip, else its title, else its accessible name', T.tipOf(el({ 'data-tip': 'A', title: 'B' })) === 'A' && T.tipOf(el({ title: 'B', 'aria-label': 'C' })) === 'B' && T.tipOf(el({ 'aria-label': 'C' })) === 'C' && T.tipOf(el({})) === null)
check('it covers buttons, links and labels with a title and anything marked data-tip', ['button[title]', 'a[title]', 'label[title]', '[data-tip]'].every(s => T.TIP_TARGET.includes(s)))
const tips = readFileSync(join(root, 'src/app/longPressTips.ts'), 'utf8')
check('a press that showed the words is not a tap (the click is stopped, in the capture phase), and a mouse never gets the bubble',
  /e\.preventDefault\(\); e\.stopPropagation\(\)/.test(tips) && /addEventListener\('click', click, true\)/.test(tips) && /pointerType === 'mouse'\) return/.test(tips))
const main = readFileSync(join(root, 'src/main.tsx'), 'utf8')
check('installed in idle time, outside the first download', /import\('\.\/app\/longPressTips'\)/.test(main) && /requestIdleCallback/.test(main))
const button = readFileSync(join(root, 'src/shared/ui/Button.tsx'), 'utf8')
check('Button\'s tip and IconButton\'s label are the title and the accessible name', /aria-label=\{tip\}/.test(button) && /title=\{tip\}/.test(button) && /aria-label=\{label\}/.test(button) && /title=\{label\}/.test(button))

console.log('3. Self-test')
check('a three-word label fails', shownWords('Add something I own') > 2 && shownWords("{x ? 'Open the chain' : 'Chain'}") > 2)
check('an icon, a word, a count and a two-word label pass', shownWords('') === 0 && shownWords('Sell') === 1 && shownWords('Read · {queue.waiting}') === 1 && shownWords("{gone ? 'Close' : 'Later'}") === 1 && shownWords('Quick list') === 2)
check('the scanner reads props with arrows and a multi-line label', buttonsOf('<Button onClick={() => go(a > b)} tip="x">\n  Save it now\n</Button>')[0]?.children.trim() === 'Save it now')

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
