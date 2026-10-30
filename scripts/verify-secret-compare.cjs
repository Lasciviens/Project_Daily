#!/usr/bin/env node
/*
 * Verification — header secrets are compared in constant time (security
 * review 26.10.2026). A plain === / !== stops at the first character that
 * differs, so the answer time tells a guesser how much of a guess was right.
 *
 * 1. No edge function compares a secret it reads from its environment (a name
 *    with SECRET or TOKEN in it) with === or !== (comments ignored).
 * 2. The functions that take a device, cron or webhook secret carry the same
 *    sameSecret helper, verbatim, and call it.
 * 3. The helper itself (its real text, TypeScript stripped by sucrase):
 *    the same value → true; a different, longer, shorter, prefix or empty
 *    value → false.
 *
 *   Run:  node scripts/verify-secret-compare.cjs
 */
const fs = require('fs')
const path = require('path')
const { transform } = require('sucrase')

const FUNCTIONS = path.join(__dirname, '..', 'supabase/functions')
const USES_SAME_SECRET = ['ai-proxy', 'esde-sync', 'google-tasks-sync', 'health-export-webhook', 'hevy-sync', 'icloud-calendar', 'kobo-sync', 'phone-gateway', 'push-send', 'shop-price', 'trakt-api']

let passed = 0
let failed = 0
const check = (name, cond, detail) => {
  if (cond) { passed++; console.log(`  ✓ ${name}`) } else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}
const read = (fn) => fs.readFileSync(path.join(FUNCTIONS, fn, 'index.ts'), 'utf8')
// Whole-line comments and trailing " // …" comments go; a "//" inside a URL stays.
const code = (src) => src.split('\n').map(l => (/^\s*(\/\/|\*|\/\*)/.test(l) ? '' : l.replace(/\s\/\/\s.*$/, ''))).join('\n')

console.log('1 · no plain comparison with an environment secret')
const fns = fs.readdirSync(FUNCTIONS).filter(f => fs.existsSync(path.join(FUNCTIONS, f, 'index.ts'))).sort()
for (const fn of fns) {
  const src = code(read(fn))
  const secretVars = [...src.matchAll(/(?:const|let)\s+(\w+)\s*=\s*Deno\.env\.get\('([A-Z0-9_]*(?:SECRET|TOKEN)[A-Z0-9_]*)'\)/g)].map(m => m[1])
  const hits = []
  for (const name of new Set(secretVars)) {
    const re = new RegExp(`(?:===|!==)\\s*\`?(?:Bearer \\$\\{)?${name}\\b|\\b${name}\\s*(?:===|!==)`, 'g')
    for (const m of src.matchAll(re)) hits.push(`line ${src.slice(0, m.index).split('\n').length}`)
  }
  for (const m of src.matchAll(/(?:===|!==)\s*Deno\.env\.get\('[A-Z0-9_]*(?:SECRET|TOKEN)[A-Z0-9_]*'\)|Deno\.env\.get\('[A-Z0-9_]*(?:SECRET|TOKEN)[A-Z0-9_]*'\)\s*(?:===|!==)/g)) {
    hits.push(`line ${src.slice(0, m.index).split('\n').length}`)
  }
  if (secretVars.length || hits.length) check(`${fn}: no === / !== on a secret`, hits.length === 0, hits.join(', '))
}

console.log('\n2 · one sameSecret helper, verbatim, used')
const helperOf = (src) => {
  const start = src.indexOf('async function sameSecret(')
  return start < 0 ? '' : src.slice(start, src.indexOf('\n}\n', start) + 2)
}
const reference = helperOf(read(USES_SAME_SECRET[0]))
check('the reference copy exists', reference.length > 0, USES_SAME_SECRET[0])
for (const fn of USES_SAME_SECRET) {
  const src = read(fn)
  check(`${fn}: the same sameSecret copy`, helperOf(src) === reference)
  const calls = (code(src).match(/\bsameSecret\(/g) ?? []).length - 1
  check(`${fn}: calls it`, calls >= 1, `${calls} calls`)
}

console.log('\n3 · the helper\'s behaviour')
;(async () => {
  const sameSecret = new Function(`${transform(reference, { transforms: ['typescript'] }).code}; return sameSecret`)()
  const secret = 'f3a9c1d2e4b5a6978877665544332211'
  const cases = [
    [secret, secret, true, 'the same value'],
    [`Bearer ${secret}`, `Bearer ${secret}`, true, 'the same Bearer header'],
    ['', secret, false, 'an empty value'],
    [secret.slice(0, 31), secret, false, 'a prefix (one character short)'],
    [`${secret}x`, secret, false, 'one character longer'],
    [secret.replace(/1$/, '2'), secret, false, 'the last character different'],
    [secret.toUpperCase(), secret, false, 'another case'],
    ['ÿ'.repeat(4), 'Ã¿'.repeat(4), false, 'text that differs only after encoding'],
  ]
  for (const [given, expected, want, what] of cases) {
    check(`${what} → ${want}`, (await sameSecret(given, expected)) === want)
  }
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
})().catch((e) => { console.log(`  ✗ crashed: ${e.stack}`); process.exit(1) })
