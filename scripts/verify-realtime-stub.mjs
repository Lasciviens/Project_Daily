// The stand-in for @supabase/realtime-js (src/integrations/supabase/realtimeStub.ts, aliased in vite.config.ts)
// keeps every method the installed supabase-js calls on its Realtime client. An upgrade that calls a new one,
// or reads a property, fails here instead of breaking the app's start. The app itself never asks for Realtime:
// a channel would throw.
//
//   node scripts/verify-realtime-stub.mjs
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
let passed = 0, failed = 0
function check(name, ok, detail) {
  if (ok) { passed++; console.log(`  ✓ ${name}`) } else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}

const stub = readFileSync(join(root, 'src/integrations/supabase/realtimeStub.ts'), 'utf8')
const stubMethods = new Set([...stub.matchAll(/^ {2}(\w+)\(\)/gm)].map(m => m[1]))
check('the stub exports a class RealtimeClient', /^export class RealtimeClient \{/m.test(stub))

const vite = readFileSync(join(root, 'vite.config.ts'), 'utf8')
check('vite.config.ts aliases exactly @supabase/realtime-js to the stub',
  vite.includes("find: /^@supabase\\/realtime-js$/") && vite.includes("'./src/integrations/supabase/realtimeStub.ts'"))

const distFile = join(root, 'node_modules/@supabase/supabase-js/dist/index.mjs')
if (!existsSync(distFile)) {
  check('supabase-js is installed (npm ci)', false, distFile)
} else {
  const dist = readFileSync(distFile, 'utf8')
  const imported = [...dist.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']@supabase\/realtime-js["']/g)]
    .flatMap(m => m[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0]).filter(Boolean))
  check('supabase-js imports only RealtimeClient from realtime-js (any other value would be missing)',
    imported.length === 1 && imported[0] === 'RealtimeClient', imported.join(', ') || 'none found')
  const uses = [...dist.matchAll(/\brealtime\.(\w+)(\s*\()?/g)]
  const called = new Set(uses.filter(m => m[2]).map(m => m[1]))
  const read = [...new Set(uses.filter(m => !m[2]).map(m => m[1]))]
  check('the pattern still finds the client\'s Realtime calls (supabase-js changed shape otherwise)', called.has('setAuth'), [...called].join(', '))
  check('supabase-js reads no Realtime property, only calls methods', read.length === 0, read.join(', '))
  for (const m of [...called].sort()) check(`the stub has ${m}()`, stubMethods.has(m))
}

// The app's own code never opens a channel: with the stub it would throw.
const files = []
const walk = dir => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p)
    else if (/\.(ts|tsx)$/.test(name) && !p.endsWith('realtimeStub.ts')) files.push(p)
  }
}
walk(join(root, 'src'))
const channelUse = files.filter(f => /\.(channel|getChannels|removeChannel|removeAllChannels)\(/.test(readFileSync(f, 'utf8')))
check('no file in src opens or lists a Realtime channel', channelUse.length === 0, channelUse.map(f => f.slice(root.length + 1)).join(', '))

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
