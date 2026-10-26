#!/usr/bin/env node
/*
 * Verification — no personal contact data in the repo (owner, 26.10.2026).
 * The repository is public: a real email address, phone number or street
 * address in any tracked file is published. AI sessions once wrote the
 * owner's work email (as a "contact" in a User-Agent and a push subject), a
 * name and a street address into it; this check fails a PR that does it again.
 *
 * 1. Every tracked text file (git ls-files), minus lockfiles and third-party
 *    skill docs, is searched for:
 *    - an email address (URLs are left out first, so user:pw@host in a test
 *      URL is not one) — placeholders pass: example.com/.org/.net, the
 *      .example/.test/.invalid/.localhost names, GitHub's noreply addresses
 *      and noreply@anthropic.com;
 *    - an international phone number (+47 or 0047 and the digits, grouped or not);
 *    - a street address: a Norwegian street name (…gata, …veien) with a
 *      house number, an English/Turkish one, or an Oslo postcode with the city.
 * 2. The patterns themselves are checked on made-up samples, so a pattern
 *    that silently stopped matching fails here too.
 *
 * Commit messages and PR texts can't be checked from here: AGENTS.md's rule
 * covers them. Use made-up data (Ola Nordmann, Jernbanetorget, example.com).
 *
 *   Run:  node scripts/verify-no-personal-data.cjs
 */
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const ROOT = path.join(__dirname, '..')
let passed = 0
let failed = 0
const check = (name, cond, detail) => {
  if (cond) { passed++; console.log(`  ✓ ${name}`) } else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

const SKIP = [/^package-lock\.json$/, /^deno\.lock$/, /^\.claude\/skills\//, /^\.claude\/worktrees\//]
const URL_RE = /[a-z][a-z0-9+.-]*:\/\/\S+/gi
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g
const PLACEHOLDER_EMAIL = /@(?:example\.(?:com|org|net)|(?:[A-Za-z0-9-]+\.)*(?:example|test|invalid|localhost)|users\.noreply\.github\.com|noreply\.github\.com)$|^noreply@anthropic\.com$/i
// Grouped after +CC or 00CC, or a bare + and 8–14 digits; a bare 00… with no groups is a barcode.
const PHONE_RE = /(?<![\w.+-])(?:(?:\+|00(?=[1-9]))\d{1,3}[ -]\d{2,4}(?:[ -]\d{2,4}){2,4}|\+\d{8,14})(?![\w.-])/g
const STREET_RE = /\b[A-ZÆØÅ][a-zæøå]+(?:veien|vegen|vei|veg|gata|gaten|gate|allé|alle|plass|bakken|stien|ringen|svingen)\s+\d{1,4}[A-Za-z]?\b|\b[A-Z][a-z]+ (?:Street|Road|Avenue|Lane|Sokak|Sokağı|Caddesi) \d{1,4}\b|\b\d{1,5} [A-Z][a-z]+ (?:Street|St\.|Road|Rd\.|Avenue|Ave\.)|\b0\d{3} Oslo\b/g

/** The personal-data hits in one text: [{ kind, text }]. */
function findPersonal(text) {
  const hits = []
  const noUrls = text.replace(URL_RE, ' ')
  for (const m of noUrls.matchAll(EMAIL_RE)) if (!PLACEHOLDER_EMAIL.test(m[0])) hits.push({ kind: 'email', text: m[0] })
  for (const m of noUrls.matchAll(PHONE_RE)) hits.push({ kind: 'phone', text: m[0] })
  for (const m of text.matchAll(STREET_RE)) hits.push({ kind: 'address', text: m[0] })
  return hits
}

console.log('1 · the patterns, on made-up samples')
// Built from parts so this file never holds a matching string itself.
const at = '@'
const samples = {
  catches: [
    ['email', `ola.nordmann${at}firma.no`],
    ['email', `kari${at}mail.example-company.co.uk`],
    ['phone', '+' + '47 912 34 567'],
    ['phone', '00' + '47 912 34 567'],
    ['phone', '+' + '4791234567'],
    ['address', 'Stor' + 'gata 12B'],
    ['address', 'Eksempel' + 'veien 4'],
    ['address', '01' + '23 Oslo'],
    ['address', 'Baker ' + 'Street 221'],
  ],
  passes: [
    `name${at}example.com`, `boss${at}example.org`, `x${at}host.test`,
    `12345+someone${at}users.noreply.github.com`, `noreply${at}anthropic.com`,
    'https://user:pw' + at + 'ichef.bbci.co.uk/b.jpg', 'npm:web-push' + at + '3.6.7',
    'https://esm.sh/@supabase/supabase-js' + at + '2.118.0', 'Jernbanetorget', 'NSR:StopPlace:58366',
    'version 1.2.3', 'EAN 0012345678905', '00000000-0000-4000-8000-000000000001', 'Week 44', 'price 1 234 kr', '2026-10-26 08:23', 'Promise<void>',
  ],
}
for (const [kind, s] of samples.catches) {
  const hits = findPersonal(s)
  check(`finds the ${kind} in "${s}"`, hits.some(h => h.kind === kind), JSON.stringify(hits))
}
for (const s of samples.passes) check(`lets "${s}" pass`, findPersonal(s).length === 0, JSON.stringify(findPersonal(s)))

console.log('\n2 · every tracked text file')
let files
try {
  files = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\0').filter(Boolean)
} catch (e) {
  files = null
  check('git ls-files works here', false, String(e.message || e).slice(0, 200))
}
if (files) {
  let scanned = 0
  const found = []
  for (const rel of files) {
    if (SKIP.some(re => re.test(rel))) continue
    let buf
    try { buf = fs.readFileSync(path.join(ROOT, rel)) } catch { continue }
    if (buf.includes(0)) continue // binary
    scanned++
    const lines = buf.toString('utf8').split('\n')
    lines.forEach((line, i) => {
      for (const h of findPersonal(line)) found.push(`${rel}:${i + 1} ${h.kind} "${h.text}"`)
    })
  }
  check(`no email, phone number or street address in ${scanned} files`, found.length === 0,
    found.length ? `\n      ${found.slice(0, 25).join('\n      ')}${found.length > 25 ? `\n      … ${found.length - 25} more` : ''}\n      Use made-up data (example.com, Ola Nordmann, Jernbanetorget).` : '')
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
