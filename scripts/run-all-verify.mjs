#!/usr/bin/env node
// Runs every scripts/verify-*.cjs|mjs, several at a time, and reports each
// one's result and time (PR check job "All verify scripts").
//
//   node scripts/run-all-verify.mjs            all of them
//   node scripts/run-all-verify.mjs --jobs 1   one at a time
import { spawn } from 'node:child_process'
import { appendFileSync, readdirSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const arg = process.argv.indexOf('--jobs')
const jobs = arg > 0 ? Number(process.argv[arg + 1]) : Math.max(2, availableParallelism())
const TIMEOUT_MS = 180_000
if (!Number.isInteger(jobs) || jobs < 1) {
  console.log('--jobs needs a whole number of 1 or more')
  process.exit(1)
}

const scripts = readdirSync(join(root, 'scripts')).filter(f => /^verify-.*\.(cjs|mjs)$/.test(f)).sort()
if (!scripts.length) {
  console.log('No scripts/verify-*.cjs|mjs found')
  process.exit(1)
}

function runOne(file) {
  return new Promise(resolve => {
    const started = Date.now()
    const child = spawn(process.execPath, [join('scripts', file)], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', d => { out += d })
    child.stderr.on('data', d => { out += d })
    const timer = setTimeout(() => child.kill('SIGKILL'), TIMEOUT_MS)
    child.on('close', code => {
      clearTimeout(timer)
      const lines = out.trim().split('\n')
      const counted = [...out.matchAll(/(\d+)\s+passed/g)].pop()
      resolve({
        file, ok: code === 0, ms: Date.now() - started,
        checks: counted ? Number(counted[1]) : null,
        tail: code === 0 ? '' : lines.slice(-8).join('\n'),
      })
    })
  })
}

const started = Date.now()
const results = []
let next = 0
await Promise.all(Array.from({ length: Math.min(jobs, scripts.length) }, async () => {
  while (next < scripts.length) results.push(await runOne(scripts[next++]))
}))
const wall = Date.now() - started

results.sort((a, b) => b.ms - a.ms)
const failed = results.filter(r => !r.ok)
const sum = results.reduce((s, r) => s + r.ms, 0)
const checks = results.reduce((s, r) => s + (r.checks ?? 0), 0)
const sec = ms => (ms / 1000).toFixed(1)

for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${sec(r.ms).padStart(6)} s  ${r.file}${r.checks != null ? `  (${r.checks})` : ''}`)
for (const r of failed) console.log(`\n✗ ${r.file}\n${r.tail}`)
const line = `${results.length} scripts, ${results.length - failed.length} passed, ${failed.length} failed · ` +
  `${checks} counted checks · ${sec(wall)} s wall time with ${jobs} at a time (${sec(sum)} s one after another)`
console.log(`\n${line}`)

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
    `### All verify scripts`, '', line, '',
    '| Script | Result | Time |', '| --- | --- | --- |',
    ...results.map(r => `| ${r.file} | ${r.ok ? 'passed' : '**failed**'} | ${sec(r.ms)} s |`), '',
  ].join('\n'))
}
process.exit(failed.length ? 1 : 0)
