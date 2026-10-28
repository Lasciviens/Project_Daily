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
 *    Audit 28.10.2026: a public NAME can point at a private address
 *    (127.0.0.1.nip.io, localtest.me), so each copy also resolves the name of
 *    every hop (resolvesToPrivate, Deno.resolveDns stubbed here — no network)
 *    and refuses any private A/AAAA answer, failing closed. Checked on the
 *    helper and through each REAL handler, redirects included.
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

// ── Names that resolve to a private address (audit 28.10.2026) ────────────────
class NotFound extends Error { constructor(m) { super(m); this.name = 'NotFound' } }
// name → { A, AAAA }: an array answers, NotFound = "no record of this type", any other Error = resolver failure.
const NX = new NotFound('no record found')
const DNS = {
  '127.0.0.1.nip.io': { A: ['127.0.0.1'], AAAA: NX },
  '169.254.169.254.nip.io': { A: ['169.254.169.254'], AAAA: NX },
  'localtest.me': { A: ['127.0.0.1'], AAAA: ['::1'] },
  'metadata.google.internal.example': { A: ['169.254.169.254'], AAAA: NX },
  'cgnat.example': { A: ['100.64.0.1'], AAAA: NX },
  'ten.example': { A: ['93.184.216.34', '10.0.0.5'], AAAA: NX },
  'v6-loopback.example': { A: NX, AAAA: ['::1'] },
  'aws-metadata-v6.example': { A: NX, AAAA: ['fd00:ec2::254'] },
  'mapped-metadata.example': { A: NX, AAAA: ['::ffff:a9fe:a9fe'] },
  'mapped-dotted.example': { A: NX, AAAA: ['::ffff:192.168.1.1'] },
  'link-local-v6.example': { A: ['93.184.216.34'], AAAA: ['fe80::1'] },
  'nat64.example': { A: NX, AAAA: ['64:ff9b::7f00:1'] },
  'sixtofour.example': { A: NX, AAAA: ['2002:c0a8:101::1'] },
  'multicast-v6.example': { A: NX, AAAA: ['ff02::1'] },
  'nxdomain.example': { A: NX, AAAA: NX },
  'servfail.example': { A: new Error('SERVFAIL'), AAAA: NX },
  'aaaa-fails.example': { A: ['93.184.216.34'], AAAA: new Error('timed out') },
  'www.vg.no': { A: ['195.88.54.16'], AAAA: ['2001:67c:21e0::16'] },
  'v4only.example': { A: ['93.184.216.34'], AAAA: NX },
  'v6only.example': { A: NX, AAAA: ['2a00:1450:4001:80b::200e'] },
  'public.example': { A: ['93.184.216.34'], AAAA: NX },
  'other-public.example': { A: ['93.184.216.35'], AAAA: NX },
  'shop.example': { A: ['93.184.216.36'], AAAA: NX },
  'shop2.example': { A: ['93.184.216.37'], AAAA: NX },
}
const DNS_BLOCK = Object.keys(DNS).filter(n => !['www.vg.no', 'v4only.example', 'v6only.example', 'public.example', 'other-public.example', 'shop.example', 'shop2.example'].includes(n))
const DNS_ALLOW = ['www.vg.no', 'v4only.example', 'v6only.example']
let lookups = []
const resolveDns = async (name, type, opts) => {
  lookups.push(`${name} ${type}`)
  if (opts?.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' })
  const answer = DNS[name]?.[type] ?? NX
  if (answer instanceof Error) throw answer
  return answer
}
const fakeDeno = (env, extra = {}) => ({ env: { get: (k) => env[k] }, errors: { NotFound }, resolveDns, ...extra })

function guardOf(fn, deno) {
  const src = fnSource(fn)
  const start = src.indexOf('function isPrivateIPv4')
  const end = src.indexOf('\n}\n', src.indexOf('async function resolvesToPrivate')) + 3
  const code = transform(src.slice(start, end), { transforms: ['typescript'] }).code
  return new Function('Deno', code + '; return { isPrivateHost, resolvesToPrivate, isPrivateIPv6 }')(deno)
}

// The REAL handler, every outside call scripted: the caller is the owner, fetch answers from `pages`.
const OWNER_ENV = { SUPABASE_URL: 'u', SUPABASE_SERVICE_ROLE_KEY: 's', SUPABASE_ANON_KEY: 'a', HEVY_USER_ID: 'owner', GEMINI_API_KEY: 'g' }
function realHandler(fn, pages, fetched) {
  const src = fnSource(fn).replace(/^import .*createClient.*$/m, '').replace(/^export /gm, '')
  const code = transform(src, { transforms: ['typescript'] }).code
  const q = { select: () => q, eq: () => q, in: () => q, gte: () => q, lte: () => q, order: () => q, limit: () => q, maybeSingle: () => q, single: () => q,
    insert: () => q, upsert: () => q, update: () => q, delete: () => q, then: (res) => res({ data: null, error: null }) }
  const db = { from: () => q, rpc: async () => ({ data: null, error: null }), auth: { getUser: async () => ({ data: { user: { id: 'owner' } }, error: null }) } }
  const fetchStub = async (url) => {
    fetched.push(String(url))
    const page = pages[String(url)]
    if (!page) throw new TypeError(`unexpected fetch ${url}`)
    return new Response(page.status >= 300 && page.status < 400 ? null : (page.body ?? '<html><title>t</title><p>x</p></html>'),
      { status: page.status ?? 200, headers: page.headers ?? { 'content-type': 'text/html; charset=utf-8' } })
  }
  let handler
  const quiet = { ...console, log: () => {}, warn: () => {}, error: () => {} }   // the refusals are logged by the function
  new Function('Deno', 'createClient', 'fetch', 'console', code)(fakeDeno(OWNER_ENV, { serve: (f) => { handler = f } }), () => db, fetchStub, quiet)
  return handler
}
const askFor = { 'ai-proxy': (url) => ({ fetchUrl: url }), 'news-article': (url) => ({ url }), 'shop-price': (url) => ({ action: 'read', url }) }
// Refused = no 2xx with content: ai-proxy throws (an error answer), news-article answers 400, shop-price answers 200 { error, code: 'not_allowed' }.
const refusedAnswer = async (res) => { const body = await res.json().catch(() => ({})); return res.status >= 400 || body.code === 'not_allowed' ? body : null }

async function dnsChecks() {
  console.log('\nresolvesToPrivate — names that resolve to a private address')
  for (const fn of ['ai-proxy', 'news-article', 'shop-price']) {
    const g = guardOf(fn, fakeDeno({}))
    const letThrough = []
    for (const name of DNS_BLOCK) if (!(await g.resolvesToPrivate(name))) letThrough.push(name)
    const blocked = []
    for (const name of DNS_ALLOW) if (await g.resolvesToPrivate(name)) blocked.push(name)
    check(`${fn}: ${DNS_BLOCK.length} names with a private (or no, or failing) answer refused, ${DNS_ALLOW.length} public ones allowed`,
      letThrough.length === 0 && blocked.length === 0, `let through ${letThrough.join(', ')}; blocked ${blocked.join(', ')}`)
    lookups = []
    check(`${fn}: a public IPv4 literal needs no lookup`, (await g.resolvesToPrivate('8.8.8.8')) === false && lookups.length === 0, lookups.join(', '))
    const without = guardOf(fn, { errors: { NotFound } })
    check(`${fn}: a runtime without Deno.resolveDns keeps the hostname check alone (never refuses every link)`, (await without.resolvesToPrivate('www.vg.no')) === false)
    const denied = guardOf(fn, fakeDeno({}, { resolveDns: async () => { throw Object.assign(new Error('Requires net access'), { name: 'PermissionDenied' }) } }))
    check(`${fn}: a runtime that doesn't allow the lookup keeps the hostname check alone`, (await denied.resolvesToPrivate('www.vg.no')) === false)
    const notCapable = guardOf(fn, fakeDeno({}, { resolveDns: async () => { throw Object.assign(new Error('Requires net access'), { name: 'NotCapable' }) } }))
    const stub = guardOf(fn, fakeDeno({}, { resolveDns: async () => { throw new TypeError('not implemented') } }))
    check(`${fn}: Deno 2's NotCapable and a stub's TypeError keep the hostname check alone too`,
      (await notCapable.resolvesToPrivate('www.vg.no')) === false && (await stub.resolvesToPrivate('www.vg.no')) === false)
    const failing = guardOf(fn, fakeDeno({}, { resolveDns: async () => { throw Object.assign(new Error('server failure'), { name: 'Error' }) } }))
    check(`${fn}: a resolver error still refuses (fails closed on the answer)`, (await failing.resolvesToPrivate('www.vg.no')) === true)
    const ctl = new AbortController(); ctl.abort()
    const aborted = await g.resolvesToPrivate('www.vg.no', ctl.signal).then(() => 'answered', (e) => e.name)
    check(`${fn}: a timeout is passed on, not read as a verdict`, aborted === 'AbortError', aborted)
    const v6 = ['::1', '::', 'fd12::1', 'fe80::1', 'fec0::1', 'ff02::1', '2001:db8::1', '2001::1', '64:ff9b::808:808', '::ffff:7f00:1', '::ffff:10.1.2.3', '2002:a00:1::1', '100::1', 'not-an-ip', '1::2::3']
      .filter(ip => !g.isPrivateIPv6(ip))
    const v6ok = ['2001:67c:21e0::16', '2a00:1450:4001:80b::200e', '2606:4700::6810:84e5', '::ffff:8.8.8.8', '2002:808:808::1'].filter(ip => g.isPrivateIPv6(ip))
    check(`${fn}: isPrivateIPv6 sorts private and public addresses`, v6.length === 0 && v6ok.length === 0, `missed ${v6.join(', ')}; wrongly refused ${v6ok.join(', ')}`)
  }

  const dnsBlock = (fn) => { const src = fnSource(fn), a = src.indexOf('// An IPv6 address as its eight'); return src.slice(a, src.indexOf('\n}\n', src.indexOf('async function resolvesToPrivate')) + 3) }
  check('the DNS check is one block, identical in ai-proxy, news-article and shop-price',
    dnsBlock('ai-proxy').length > 1000 && dnsBlock('news-article') === dnsBlock('ai-proxy') && dnsBlock('shop-price') === dnsBlock('ai-proxy'))

  console.log('\nThe real fetchers refuse such names on every hop')
  for (const fn of ['ai-proxy', 'news-article', 'shop-price']) {
    const ask = async (url, pages) => {
      const fetched = []
      const handler = realHandler(fn, pages, fetched)
      const res = await handler(new Request('http://x', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer owner-jwt' }, body: JSON.stringify(askFor[fn](url)) }))
      return { res, fetched }
    }
    for (const url of ['http://127.0.0.1.nip.io/', 'http://169.254.169.254.nip.io/latest/meta-data/', 'http://localtest.me/', 'https://nxdomain.example/']) {
      const { res, fetched } = await ask(url, { [url]: { status: 200 } })
      check(`${fn}: ${url} is refused without a fetch`, (await refusedAnswer(res)) && fetched.length === 0, `${res.status}, fetched ${fetched.join(' ')}`)
    }
    const first = fn === 'shop-price' ? 'https://shop.example/p' : 'https://public.example/a'
    const internal = 'http://127.0.0.1.nip.io/admin'
    let r = await ask(first, { [first]: { status: 302, headers: { location: internal } }, [internal]: { status: 200 } })
    check(`${fn}: a redirect to a name that resolves privately is refused and never fetched`,
      (await refusedAnswer(r.res)) && r.fetched.length === 1 && !r.fetched.includes(internal), `${r.res.status}, fetched ${r.fetched.join(' ')}`)
    const ok = fn === 'shop-price' ? 'https://shop2.example/p' : 'https://other-public.example/a'
    r = await ask(ok, { [ok]: { status: 200 } })
    check(`${fn}: a page on a public name is still read`, r.res.status === 200 && !(await refusedAnswer(r.res)) && r.fetched.length === 1, `${r.res.status}, fetched ${r.fetched.join(' ')}`)
  }
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
  await dnsChecks()
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
