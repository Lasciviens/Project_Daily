// Copies training/plan/nextRule.ts's <training-next-rule> block into the edge functions that say "next" on the
// server (phone-gateway's brief, push-send's morning push) — edge functions are self-contained (AGENTS.md). Edit the
// source, then run: node scripts/sync-training-next-shared.mjs. verify-training-next-mirror compares them.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const START = '// <training-next-rule>'
const END = '// </training-next-rule>'
export const TARGETS = ['supabase/functions/phone-gateway/index.ts', 'supabase/functions/push-send/index.ts']
export const blockOf = text => {
  const a = text.indexOf(START), b = text.indexOf(END)
  if (a < 0 || b < a) throw new Error('no <training-next-rule> block')
  return text.slice(a, b + END.length)
}
const source = blockOf(readFileSync(join(root, 'src/features/training/plan/nextRule.ts'), 'utf8'))
const generated = source.replace(START, `${START}\n// GENERATED from src/features/training/plan/nextRule.ts by scripts/sync-training-next-shared.mjs — edit the source.`)
for (const f of TARGETS) {
  const p = join(root, f)
  const text = readFileSync(p, 'utf8')
  writeFileSync(p, text.replace(blockOf(text), generated))
  console.log(`sync-training-next-shared: wrote ${f}`)
}
