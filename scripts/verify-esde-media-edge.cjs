// Execute the actual Edge handler with isolated auth/database/storage fixtures.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { stripTypeScriptTypes } = require('node:module')
const source = fs.readFileSync('supabase/functions/esde-media-sync/index.ts', 'utf8')
  .replace(/^import .*createClient.*$/m, '')
let handler, calls = 0
const fakeDB = { from() { calls++; throw new Error('Unexpected database access') } }
const env = { SUPABASE_URL: 'https://test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'server-only', ESDE_SYNC_SECRET: 'test-secret', HEVY_USER_ID: '00000000-0000-0000-0000-000000000001' }
new Function('Deno', 'createClient', stripTypeScriptTypes(source))(
  { env: { get: name => env[name] }, serve: fn => { handler = fn } }, () => fakeDB)
async function post(body, secret = 'test-secret') {
  return handler(new Request('https://test.invalid', { method: 'POST', headers: { 'x-esde-secret': secret }, body: JSON.stringify(body) }))
}
;(async () => {
  assert.equal((await post({ action: 'inventory' }, 'wrong')).status, 401)
  assert.equal((await post({ action: 'delete_variants', entries: [] })).status, 400)
  assert.equal((await post({ action: 'delete_variants', entries: [{ id: '../../elsewhere' }] })).status, 400)
  assert.equal((await post({ action: 'inventory', page: -1 })).status, 400)
  assert.equal((await post({ action: 'upload_cover', system: 'nes', path: './x', sha256: 'a'.repeat(64), image_base64: Buffer.from('<script>no</script>').toString('base64') })).status, 400)
  assert.equal((await post({ action: 'unknown' })).status, 400)
  assert.equal((await post({ action: 'inventory', padding: 'a'.repeat(1500001) })).status, 400)
  assert.equal(calls, 0, 'Unauthenticated or malformed requests reached DB')
  let observedOwner
  fakeDB.from = () => {
    const chain = { select() { return chain }, eq(k,v) { if(k === 'user_id') observedOwner=v; return chain }, order() { return chain }, range() { return Promise.resolve({ data: [], error: null }) } }
    return chain
  }
  const response = await post({ action: 'inventory', user_id: 'attacker-selected-owner' })
  assert.equal(response.status, 200)
  assert.equal(observedOwner, env.HEVY_USER_ID)
  assert.deepEqual((await response.json()).variants, [])
  const webp = Buffer.alloc(24)
  webp.write('RIFF', 0); webp.write('WEBP', 8)
  webp[4] = 0xc3; webp[5] = 0xa0 // binary RIFF size must never be decoded as UTF-8 text
  fakeDB.from = () => {
    const chain = { select() { return chain }, eq() { return chain }, maybeSingle() { return Promise.resolve({ data: { id: 'variant', cover_url: null }, error: null }) } }
    return chain
  }
  fakeDB.storage = { from: () => ({ upload: async () => ({ error: null }) }) }
  fakeDB.rpc = async () => ({ data: { linked: true }, error: null })
  const upload = await post({ action: 'upload_cover', system: 'nes', path: './game.nes', sha256: require('node:crypto').createHash('sha256').update(webp).digest('hex'), image_base64: webp.toString('base64') })
  assert.equal(upload.status, 200)
  assert.equal((await upload.json()).linked, true)
  console.log('Edge authentication, owner scoping, body limits and validation checks passed')
})().catch(error => { console.error(error); process.exitCode = 1 })
