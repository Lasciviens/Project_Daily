#!/usr/bin/env node
/*
 * Verification — the phone's brief is Home's brief (owner, 22.11.2026): phone-gateway carries a GENERATED copy of
 * src/features/home/briefRules.ts between its `// <brief-shared>` markers (scripts/sync-brief-shared.mjs). This
 * script checks that the copy is current, that the gateway's `brief` action never calls the model, and that the copy
 * and the source write the same brief for the same inputs.
 *
 *   node scripts/verify-brief-shared.cjs
 */
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const sucrase = require('sucrase')

const root = path.join(__dirname, '..')
let ok = 0, bad = 0
const check = (name, cond, detail) => { if (cond) { ok++; console.log('  ✓', name) } else { bad++; console.log('  ✗', name, detail === undefined ? '' : String(JSON.stringify(detail)).slice(0, 400)) } }

let current = true, out = ''
try { out = execFileSync('node', ['scripts/sync-brief-shared.mjs', '--check'], { cwd: root, encoding: 'utf8' }) } catch (e) { current = false; out = String(e.stderr || e.message) }
check('the generated region of phone-gateway is current (sync-brief-shared.mjs --check)', current, out)

const gateway = fs.readFileSync(path.join(root, 'supabase/functions/phone-gateway/index.ts'), 'utf8')
const region = gateway.slice(gateway.search(/^\/\/ <brief-shared>$/m), gateway.search(/^\/\/ <\/brief-shared>$/m))
check('the region says it is GENERATED and names its source', /GENERATED from src\/features\/home\/briefRules\.ts/.test(region))
const brief = gateway.slice(gateway.indexOf("case 'brief': {"), gateway.indexOf("case 'brief': {") + 700)
check('the brief action builds its text with buildPhoneBrief and never calls askClaude (no AI, no cost)', /buildPhoneBrief\(userId\)/.test(brief) && !/askClaude/.test(brief.split('}')[0]))
check('askClaude takes only the job phone_ask', /async function askClaude\(job: 'phone_ask',/.test(gateway) && !/phone_brief/.test(gateway))

const load = (code) => {
  const js = sucrase.transform(code, { transforms: ['typescript'] }).code
  return new Function(`${js}\nreturn { buildDailyBrief }`)()
}
const source = fs.readFileSync(path.join(root, 'src/features/home/briefRules.ts'), 'utf8').replace(/^export /gm, '')
const fromSource = load(source)
const fromCopy = load(region)
const inputs = [
  { hour: 8, today: '2026-11-23' },
  { hour: 8.5, today: '2026-11-23', tasks: { open: [{ title: 'Pay rent', priority: 'high', overdue: true, dueTime: null }, { title: 'Call Ola', priority: 'low', overdue: false, dueTime: '14:00' }], doneToday: 2 } },
  { hour: 15, today: '2026-11-23', schedule: { next: { title: 'Dentist', startLabel: '16:00', startHour: 16, inProgress: false }, remainingCount: 2 }, training: { today: { title: 'Push', startTime: '18:00' }, next: null } },
  { hour: 22.5, today: '2026-11-23', failedReads: ['tasks'], nutrition: { kcal: 1800, kcalTarget: 2200, proteinG: 90, proteinTarget: 150, waterMl: 900, waterTarget: 2500 } },
]
check('the copy writes the same brief as the source for four inputs', inputs.every(i => JSON.stringify(fromSource.buildDailyBrief(i)) === JSON.stringify(fromCopy.buildDailyBrief(i))))
console.log(`\n${ok} passed, ${bad} failed`)
process.exit(bad ? 1 : 0)
