#!/usr/bin/env node
/*
 * Verification — Supabase's new API keys (26.10.2026; the legacy anon /
 * service_role JWT keys go away "by the end of 2026").
 *
 * 1. Every edge function that talks to the database carries the same
 *    <supabase-keys> block and reads keys only through it: no function reads
 *    SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY by itself (ai-proxy's
 *    hideSecrets list names the legacy one so its value stays hidden too).
 * 2. The block itself (TypeScript stripped by sucrase, a fake Deno.env): the
 *    new key from SUPABASE_SECRET_KEYS / SUPABASE_PUBLISHABLE_KEYS ("default"
 *    first, else the first one), else the legacy key, never a crash.
 * 3. The website prefers VITE_SUPABASE_PUBLISHABLE_KEY and falls back to the
 *    anon key; the deploy passes both and requires one of them.
 *
 *   Run:  node scripts/verify-supabase-keys.cjs
 */
const fs = require('fs')
const path = require('path')
const { transform } = require('sucrase')

const ROOT = path.join(__dirname, '..')
const FUNCTIONS = path.join(ROOT, 'supabase/functions')
let passed = 0
let failed = 0
const check = (name, cond, detail) => {
  if (cond) { passed++; console.log(`  ✓ ${name}`) } else { failed++; console.log(`  ✗ ${name}${detail !== undefined ? ' — ' + JSON.stringify(detail) : ''}`) }
}
const block = (src) => {
  const a = src.indexOf('// <supabase-keys>')
  const b = src.indexOf('// </supabase-keys>')
  return a >= 0 && b > a ? src.slice(a, b + '// </supabase-keys>'.length) : null
}
// Whole-line comments go; code stays.
const code = (src) => src.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')

console.log('1 · every function reads its keys through one block')
const fns = fs.readdirSync(FUNCTIONS).filter(f => fs.existsSync(path.join(FUNCTIONS, f, 'index.ts'))).sort()
const sources = Object.fromEntries(fns.map(f => [f, fs.readFileSync(path.join(FUNCTIONS, f, 'index.ts'), 'utf8')]))
const users = fns.filter(f => /createClient\(/.test(sources[f]) || /serviceKey\(\)|publishableKey\(\)/.test(sources[f]))
const reference = block(sources['phone-gateway'])
check('phone-gateway carries the block (the reference copy)', !!reference)
for (const f of users) {
  const b = block(sources[f])
  check(`${f}: the same <supabase-keys> block`, b === reference)
  const outside = code(sources[f].replace(b ?? '', '')).split('\n')
    .filter(l => /SUPABASE_SERVICE_ROLE_KEY|SUPABASE_ANON_KEY/.test(l) && !l.includes("['GEMINI_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'PHONE_GATEWAY_SECRET']"))
  check(`${f}: no legacy key read outside it`, outside.length === 0, outside.map(l => l.trim()))
  const before = code(sources[f].slice(0, Math.max(0, sources[f].indexOf('// <supabase-keys>'))))
  check(`${f}: nothing uses a key before the block defines it`, sources[f].includes('// <supabase-keys>') && !/serviceKey\(\)|publishableKey\(\)/.test(before))
}
check('every function that creates a client is covered (≥ 29)', users.length >= 29, users.length)
const fromEsm = fns.filter(f => /from ['"]https:\/\/esm\.sh\//.test(sources[f]))
check('no function imports from esm.sh (npm: only — an esm.sh outage stopped the 26.10.2026 deploy)', fromEsm.length === 0, fromEsm)

console.log('\n2 · the block picks the right key')
{
  const js = transform(reference, { transforms: ['typescript'] }).code
  const make = (env) => new Function('Deno', `${js}\nreturn { serviceKey, publishableKey }`)({ env: { get: (k) => env[k] } })
  const legacy = { SUPABASE_SERVICE_ROLE_KEY: 'eyJ-service', SUPABASE_ANON_KEY: 'eyJ-anon' }
  let k = make(legacy)
  check('only legacy keys: the legacy ones', k.serviceKey() === 'eyJ-service' && k.publishableKey() === 'eyJ-anon')
  k = make({ ...legacy, SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'sb_secret_x' }), SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: 'sb_publishable_y' }) })
  check('new keys present: the new ones', k.serviceKey() === 'sb_secret_x' && k.publishableKey() === 'sb_publishable_y')
  k = make({ SUPABASE_SECRET_KEYS: JSON.stringify({ other: 'sb_secret_o', default: 'sb_secret_d' }) })
  check('"default" wins when there are several', k.serviceKey() === 'sb_secret_d')
  k = make({ SUPABASE_SECRET_KEYS: JSON.stringify({ deploy: 'sb_secret_only' }) })
  check('else the first one', k.serviceKey() === 'sb_secret_only')
  k = make({ ...legacy, SUPABASE_SECRET_KEYS: 'not json', SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: '' }) })
  check('broken or empty new value: the legacy key, no crash', k.serviceKey() === 'eyJ-service' && k.publishableKey() === 'eyJ-anon')
  k = make({})
  check('nothing set: an empty string (the caller fails closed)', k.serviceKey() === '' && k.publishableKey() === '')
}

console.log('\n3 · the website and the deploy')
{
  const client = fs.readFileSync(path.join(ROOT, 'src/integrations/supabase/client.ts'), 'utf8')
  check('the website reads the publishable key first, the anon key as fallback',
    /VITE_SUPABASE_PUBLISHABLE_KEY\s*\|\|\s*import\.meta\.env\.VITE_SUPABASE_ANON_KEY/.test(client))
  const deploy = fs.readFileSync(path.join(ROOT, '.github/workflows/deploy.yml'), 'utf8')
  check('the deploy passes the publishable key to both the check and the build', (deploy.match(/VITE_SUPABASE_PUBLISHABLE_KEY: \$\{\{ secrets\.VITE_SUPABASE_PUBLISHABLE_KEY/g) ?? []).length === 2)
  check('the deploy requires one of the two keys', deploy.includes('[ -n "$VITE_SUPABASE_PUBLISHABLE_KEY$VITE_SUPABASE_ANON_KEY" ]'))
  check('the deploy refuses anything but an sb_publishable_ key there (the site is public)', /''\|sb_publishable_\*\) ;;/.test(deploy) && deploy.includes('never put the secret key here'))
  check('the deploy reads the key from a secret only', !/vars\.VITE_SUPABASE_PUBLISHABLE_KEY/.test(deploy))
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
