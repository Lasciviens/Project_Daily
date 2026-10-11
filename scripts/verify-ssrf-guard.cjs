#!/usr/bin/env node
/*
 * Verification — the private-address guard (isPrivateHost) in the three
 * functions that fetch a page server-side: ai-proxy (fetchUrl), news-article
 * and shop-price. Security audit 10.10.2026: the guard used to let IPv6 forms
 * of internal addresses through, because the URL parser rewrites
 * [::ffff:127.0.0.1] as [::ffff:7f00:1] and the guard only knew the first form.
 *
 * Runs each copy's real text (TypeScript stripped by sucrase) on the hostname
 * the URL parser produces, exactly as the functions call it.
 *
 *   Run:  node scripts/verify-ssrf-guard.cjs
 */
const fs = require('fs')
const path = require('path')
const { transform } = require('sucrase')

const BLOCK = [
  'http://[::ffff:127.0.0.1]/', 'http://[::ffff:7f00:1]/', 'http://[::ffff:a9fe:a9fe]/',
  'http://[::127.0.0.1]/', 'http://[64:ff9b::7f00:1]/', 'http://[::1]/', 'http://[fd00::1]/',
  'http://[2001:db8::1]/', 'http://127.1/', 'http://0x7f000001/', 'http://2130706433/',
  'http://169.254.169.254/', 'http://10.0.0.1/', 'http://172.16.0.1/', 'http://192.168.1.1/',
  'http://100.64.0.1/', 'http://localhost/', 'http://a.localhost/', 'http://224.0.0.1/',
  'http://255.255.255.255/', 'http://0.0.0.0/',
]
const ALLOW = ['https://www.vg.no/', 'https://example.com/a?b=1', 'http://8.8.8.8/', 'https://www.prisjakt.no/product.php?p=1']

let passed = 0
let failed = 0
for (const fn of ['ai-proxy', 'news-article', 'shop-price']) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'supabase/functions', fn, 'index.ts'), 'utf8')
  const start = src.indexOf('function isPrivateIPv4')
  const end = src.indexOf('\n}\n', src.indexOf('function isPrivateHost')) + 3
  const isPrivateHost = new Function(transform(src.slice(start, end), { transforms: ['typescript'] }).code + '; return isPrivateHost')()
  for (const u of BLOCK) {
    if (isPrivateHost(new URL(u).hostname)) passed++
    else { failed++; console.log(`  ✗ ${fn} lets ${u} through (hostname ${new URL(u).hostname})`) }
  }
  for (const u of ALLOW) {
    if (!isPrivateHost(new URL(u).hostname)) passed++
    else { failed++; console.log(`  ✗ ${fn} blocks the public ${u}`) }
  }
  console.log(`  ✓ ${fn}: ${BLOCK.length} internal addresses refused, ${ALLOW.length} public ones allowed`)
}
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
