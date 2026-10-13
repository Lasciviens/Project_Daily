#!/usr/bin/env node
// Keeps the AI guide small and its links true (rules agreed with the owner 13.10.2026):
//   - CLAUDE.md starts with the `@AGENTS.md` import;
//   - CLAUDE.md + AGENTS.md together stay ≤ 350 lines and ≤ 40,000 characters,
//     and AGENTS.md ≤ 32,000 bytes (Codex reads at most 32 KiB);
//   - the guide and the rule files are English (no Turkish-only letters);
//   - every .claude/rules/*.md has a `paths:` frontmatter list, and each glob
//     matches at least one tracked file;
//   - every repo path the guide or a rule file names in backticks exists.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = f => readFileSync(join(root, f), 'utf8')
let passed = 0
const failures = []
const check = (ok, what) => { if (ok) passed++; else failures.push(what) }

const claude = read('CLAUDE.md')
const agents = read('AGENTS.md')
const lines = s => s.replace(/\n$/, '').split('\n').length

check(claude.split('\n')[0].trim() === '@AGENTS.md', 'CLAUDE.md must start with the line "@AGENTS.md"')
const totalLines = lines(claude) + lines(agents)
const totalChars = [...claude].length + [...agents].length
check(totalLines <= 350, `CLAUDE.md + AGENTS.md have ${totalLines} lines (limit 350) — move detail to docs/ or .claude/rules/`)
check(totalChars <= 40000, `CLAUDE.md + AGENTS.md have ${totalChars} characters (limit 40,000)`)
const agentsBytes = Buffer.byteLength(agents, 'utf8')
check(agentsBytes <= 32000, `AGENTS.md is ${agentsBytes} bytes (limit 32,000 — Codex reads at most 32 KiB)`)

const ruleDir = '.claude/rules'
const ruleFiles = readdirSync(join(root, ruleDir)).filter(f => f.endsWith('.md')).sort()
check(ruleFiles.length > 0, 'no .claude/rules/*.md files found')

const tracked = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { cwd: root, encoding: 'utf8' })
  .split('\n').filter(Boolean)

// Glob → RegExp for the patterns Claude Code's `paths:` uses: **, *, ?, {a,b}.
function globRe(glob) {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*' && glob[i + 1] === '*') {
      i++
      if (glob[i + 1] === '/') { i++; re += '(?:.*/)?' } else re += '.*'
    } else if (c === '*') re += '[^/]*'
    else if (c === '?') re += '[^/]'
    else if (c === '{') {
      const end = glob.indexOf('}', i)
      re += '(?:' + glob.slice(i + 1, end).split(',').map(p => p.replace(/[.+^$()|[\]\\]/g, '\\$&')).join('|') + ')'
      i = end
    } else re += c.replace(/[.+^$()|[\]\\]/g, '\\$&')
  }
  return new RegExp('^' + re + '$')
}

const TURKISH = /[ğĞşŞıİ]/
const docs = [['CLAUDE.md', claude], ['AGENTS.md', agents]]
for (const f of ruleFiles) {
  const path = `${ruleDir}/${f}`
  const text = read(path)
  docs.push([path, text])
  const fm = text.match(/^---\n([\s\S]*?)\n---\n/)
  check(!!fm, `${path}: needs a frontmatter block (--- … ---) at the top`)
  if (!fm) continue
  const globs = [...fm[1].matchAll(/^\s+-\s+"?([^"\n]+?)"?\s*$/gm)].map(m => m[1])
  check(/^paths:\s*$/m.test(fm[1]) && globs.length > 0, `${path}: frontmatter needs a "paths:" list`)
  for (const g of globs) {
    const re = globRe(g)
    check(tracked.some(t => re.test(t)), `${path}: glob "${g}" matches no file`)
  }
}

for (const [path, text] of docs) {
  const bad = text.split('\n').findIndex(l => TURKISH.test(l))
  check(bad < 0, `${path}:${bad + 1}: Turkish letters — the guide is English`)
}

// Repo paths named in backticks must exist. Placeholders (<x>), globs and
// line references (file.ts:12) are skipped or trimmed.
const PATH_RE = /`((?:src|docs|scripts|supabase|public|\.claude|\.github)\/[^`\s]*)`/g
for (const [path, text] of docs) {
  for (const m of text.matchAll(PATH_RE)) {
    let p = m[1].replace(/:\d+$/, '').replace(/#.*$/, '')
    if (/[<*{]/.test(p)) continue
    check(existsSync(join(root, p)), `${path}: names \`${p}\`, which does not exist`)
  }
}

if (failures.length) {
  console.log(failures.map(f => '✗ ' + f).join('\n'))
  console.log(`\n${failures.length} failed, ${passed} passed`)
  process.exit(1)
}
console.log(`CLAUDE.md + AGENTS.md: ${totalLines} lines, ${totalChars} characters; AGENTS.md ${agentsBytes} bytes; ${ruleFiles.length} rule files`)
console.log(`${passed} passed`)
