#!/usr/bin/env node
/*
 * Verification — server-side fetches of a URL someone else supplied.
 *
 * 1. The private-address guard (isPrivateHost) in the three functions that
 *    fetch a page server-side: ai-proxy (fetchUrl), news-article and
 *    shop-price. Security audit 10.10.2026: the guard used to let IPv6 forms
 *    of internal addresses through, because the URL parser rewrites
 *    [::ffff:127.0.0.1] as [::ffff:7f00:1] and the guard only knew the first
 *    form. Runs each copy's real text (TypeScript stripped by sucrase) on the
 *    hostname the URL parser produces, exactly as the functions call it.
 *
 * 2. news-proxy, the one function with no caller check (security review
 *    26.10.2026): its allow-lists held only for the first URL and fetch
 *    followed redirects, so an open redirect on a listed site made it an open
 *    proxy. Loads the REAL handler with a scripted fetch (no network) and
 *    checks every redirect hop is re-checked against the same list (≤ 3), an
 *    image must be image/*, and both answers are size-capped.
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
const check = (name, cond, detail) => {
  if (cond) { passed++; console.log(`  ✓ ${name}`) } else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}
const fnSource = (fn) => fs.readFileSync(path.join(__dirname, '..', 'supabase/functions', fn, 'index.ts'), 'utf8')

console.log('isPrivateHost')
for (const fn of ['ai-proxy', 'news-article', 'shop-price']) {
  const src = fnSource(fn)
  const start = src.indexOf('function isPrivateIPv4')
  const end = src.indexOf('\n}\n', src.indexOf('function isPrivateHost')) + 3
  const isPrivateHost = new Function(transform(src.slice(start, end), { transforms: ['typescript'] }).code + '; return isPrivateHost')()
  let ok = true
  for (const u of BLOCK) {
    if (isPrivateHost(new URL(u).hostname)) passed++
    else { ok = false; failed++; console.log(`  ✗ ${fn} lets ${u} through (hostname ${new URL(u).hostname})`) }
  }
  for (const u of ALLOW) {
    if (!isPrivateHost(new URL(u).hostname)) passed++
    else { ok = false; failed++; console.log(`  ✗ ${fn} blocks the public ${u}`) }
  }
  if (ok) console.log(`  ✓ ${fn}: ${BLOCK.length} internal addresses refused, ${ALLOW.length} public ones allowed`)
}

// ── news-proxy ────────────────────────────────────────────────────────────────
const MB = 1024 * 1024
let routes = {}
let calls = []
function fakeFetch(url, init) {
  calls.push({ url: String(url), init })
  const route = routes[String(url)]
  if (!route) return Promise.reject(new TypeError(`unexpected fetch ${url}`))
  const { status = 200, headers = {}, body = '' } = typeof route === 'function' ? route() : route
  return Promise.resolve(new Response(status >= 300 && status < 400 ? null : body, { status, headers }))
}
function loadNewsProxy() {
  const code = transform(fnSource('news-proxy'), { transforms: ['typescript'] }).code
  let handler
  new Function('Deno', 'fetch', code)({ serve: (f) => { handler = f } }, fakeFetch)
  return handler
}
const handler = loadNewsProxy()
const PROXY = 'https://project.supabase.co/functions/v1/news-proxy'
async function getImage(url, r) {
  routes = r; calls = []
  return handler(new Request(`${PROXY}?url=${encodeURIComponent(url)}`))
}
async function postFeed(url, r) {
  routes = r; calls = []
  return handler(new Request(PROXY, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }) }))
}
const img = (bytes = 10, type = 'image/jpeg', extra = {}) => ({ status: 200, headers: { 'content-type': type, ...extra }, body: new Uint8Array(bytes) })
const redirect = (location, status = 302) => ({ status, headers: { location } })
const fetched = (url) => calls.some(c => c.url === url)
const errorOf = async (res) => { try { return (await res.json()).error } catch { return '' } }

;(async () => {
  console.log('\nnews-proxy — images')
  const BBC = 'https://ichef.bbci.co.uk/ace/standard/240/a.jpg'
  const EVIL = 'https://evil.example/steal'

  let res = await getImage(BBC, { [BBC]: img(1234) })
  const body = new Uint8Array(await res.arrayBuffer())
  check('an allowed image comes through, bytes and type intact', res.status === 200 && body.length === 1234 && res.headers.get('content-type') === 'image/jpeg')
  check('every fetch follows no redirect by itself (redirect: manual)', calls.length === 1 && calls.every(c => c.init?.redirect === 'manual'), JSON.stringify(calls.map(c => c.init?.redirect)))
  check('the image answer carries nosniff and a sandbox CSP', res.headers.get('x-content-type-options') === 'nosniff' && /sandbox/.test(res.headers.get('content-security-policy') ?? ''))

  res = await getImage(BBC, { [BBC]: redirect(EVIL), [EVIL]: img() })
  check('a redirect to a domain off the list is refused (403) and never fetched', res.status === 403 && !fetched(EVIL), `${res.status} ${await errorOf(res)}`)

  for (const target of ['https://169.254.169.254/latest/meta-data/', 'https://localhost/x', 'https://ichef.bbci.co.uk.evil.example/x', 'https://user:pw@ichef.bbci.co.uk/b.jpg']) {
    res = await getImage(BBC, { [BBC]: redirect(target), [target]: img() })
    check(`a redirect to ${target} is refused`, res.status === 403 && !fetched(target), String(res.status))
  }

  const HTTP_BBC = 'http://ichef.bbci.co.uk/ace/b.jpg'
  res = await getImage(BBC, { [BBC]: redirect(HTTP_BBC), [HTTP_BBC]: img() })
  check('a redirect down to http is refused', res.status === 403 && !fetched(HTTP_BBC), String(res.status))

  const SUB = 'https://akamai.vgc.no/v2/images/b.webp'
  res = await getImage(BBC, { [BBC]: redirect(SUB, 301), [SUB]: img(50, 'image/webp') })
  check('a redirect to another listed image host is followed', res.status === 200 && fetched(SUB), String(res.status))

  const REL = 'https://ichef.bbci.co.uk/ace/standard/480/a.jpg'
  res = await getImage(BBC, { [BBC]: redirect('/ace/standard/480/a.jpg'), [REL]: img() })
  check('a relative Location resolves against the hop it came from', res.status === 200 && fetched(REL), String(res.status))

  const hop = (n) => `https://ichef.bbci.co.uk/hop${n}.jpg`
  const chain = (redirects) => {
    const r = {}
    for (let i = 0; i < redirects; i++) r[i === 0 ? BBC : hop(i)] = redirect(hop(i + 1))
    r[redirects === 0 ? BBC : hop(redirects)] = img()
    return r
  }
  res = await getImage(BBC, chain(3))
  check('three redirects are followed', res.status === 200 && calls.length === 4, `${res.status} after ${calls.length} fetches`)
  res = await getImage(BBC, chain(4))
  check('a fourth redirect is refused (502 Too many redirects)', res.status === 502 && calls.length === 4 && /Too many redirects/.test(await errorOf(res)), `${res.status} after ${calls.length} fetches`)

  res = await getImage(BBC, { [BBC]: { status: 200, headers: { 'content-type': 'text/html' }, body: '<script>alert(1)</script>' } })
  check('a non-image answer is refused with 415', res.status === 415, String(res.status))
  res = await getImage(BBC, { [BBC]: { status: 200, headers: {}, body: 'x' } })
  check('an answer without a Content-Type is refused with 415', res.status === 415, String(res.status))
  res = await getImage(BBC, { [BBC]: { status: 200, headers: { 'content-type': 'application/octet-stream' }, body: 'x' } })
  check('application/octet-stream is refused with 415', res.status === 415, String(res.status))

  res = await getImage(BBC, { [BBC]: img(10, 'image/jpeg', { 'content-length': String(6 * MB) }) })
  check('an image that declares more than 5 MB is refused', res.status === 502, String(res.status))
  res = await getImage(BBC, { [BBC]: img(5 * MB + 1) })
  check('an image body over 5 MB (no length declared) is refused', res.status === 502, String(res.status))
  res = await getImage(BBC, { [BBC]: img(5 * MB) })
  check('an image of exactly 5 MB comes through', res.status === 200 && (await res.arrayBuffer()).byteLength === 5 * MB, String(res.status))

  res = await getImage(EVIL, { [EVIL]: img() })
  check('a first URL off the list is refused without a fetch', res.status === 403 && calls.length === 0, String(res.status))
  res = await getImage('http://ichef.bbci.co.uk/a.jpg', {})
  check('a first URL over http is refused', res.status === 400 && calls.length === 0, String(res.status))
  res = await getImage(BBC, { [BBC]: { status: 404, headers: {}, body: 'nope' } })
  check('an upstream error answers 502', res.status === 502, String(res.status))

  console.log('\nnews-proxy — feeds')
  const FEED = 'https://feeds.bbci.co.uk/news/world/rss.xml'
  const XML = '<?xml version="1.0"?><rss><channel><title>Världen · Dünya · Verden æøå</title></channel></rss>'
  res = await postFeed(FEED, { [FEED]: { status: 200, headers: { 'content-type': 'text/xml' }, body: XML } })
  check('an allowed feed comes through, text intact (UTF-8)', res.status === 200 && (await res.text()) === XML)
  check('the feed fetch follows no redirect by itself', calls.length === 1 && calls[0].init?.redirect === 'manual')

  res = await postFeed(FEED, { [FEED]: redirect(EVIL, 301), [EVIL]: { status: 200, body: 'secret' } })
  check('a feed redirect to a domain off the list is refused and never fetched', res.status === 403 && !fetched(EVIL), String(res.status))
  const FEED_IMG_HOST = 'https://ichef.bbci.co.uk/feed.xml'
  res = await postFeed(FEED, { [FEED]: redirect(FEED_IMG_HOST), [FEED_IMG_HOST]: { status: 200, body: XML } })
  check('a feed redirect uses the feed list, not the image list', res.status === 403 && !fetched(FEED_IMG_HOST), String(res.status))
  const HTTPS_FEED = 'https://www.vg.no/rss/feed/?categories=1'
  res = await postFeed('http://www.vg.no/rss/feed/?categories=1', { 'http://www.vg.no/rss/feed/?categories=1': redirect(HTTPS_FEED, 301), [HTTPS_FEED]: { status: 200, body: XML } })
  check('a feed redirect from http to https on a listed host is followed', res.status === 200 && fetched(HTTPS_FEED), String(res.status))

  res = await postFeed(FEED, { [FEED]: { status: 200, headers: { 'content-length': String(3 * MB) }, body: 'x' } })
  check('a feed that declares more than 2 MB is refused', res.status === 502, String(res.status))
  res = await postFeed(FEED, { [FEED]: { status: 200, body: new Uint8Array(2 * MB + 1) } })
  check('a feed body over 2 MB is refused', res.status === 502, String(res.status))
  res = await postFeed(EVIL, { [EVIL]: { status: 200, body: XML } })
  check('a first feed URL off the list is refused without a fetch', res.status === 403 && calls.length === 0, String(res.status))
  res = await postFeed('file:///etc/passwd', {})
  check('a non-http(s) feed URL is refused without a fetch', res.status >= 400 && res.status < 500 && calls.length === 0, String(res.status))

  const src = fnSource('news-proxy')
  const fetches = src.match(/\bfetch\(/g)?.length ?? 0
  check('news-proxy calls fetch in one place, with redirect: manual', fetches === 1 && /fetch\(url\.toString\(\), \{ headers, redirect: 'manual' \}\)/.test(src), `${fetches} fetch calls`)

  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
})().catch((e) => { console.log(`  ✗ crashed: ${e.stack}`); process.exit(1) })
