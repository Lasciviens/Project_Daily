// ─────────────────────────────────────────────────────────────────────────────
//  The `claude` function · reading an outside page
//
//  A job that reads a page the owner pasted a link to (recipe_from_link) fetches
//  it HERE, with code, before any model is asked. The link is input from the
//  outside, so this part is the SSRF wall (server-side request forgery: making
//  our server fetch something inside our own network, such as a cloud's
//  address for secrets):
//    · https only, no user name in the link, no port but the default;
//    · the host is refused when it is a private address in any spelling
//      (isPrivateHost) or when its NAME resolves to one (resolvesToPrivate);
//    · redirects are followed by hand, at most 4, and EVERY hop goes through
//      the same checks again;
//    · the whole read has a time limit (10 s) and the page a size limit (2 MB);
//    · only a web page (text/html) is read, and only fixed headers are sent:
//      no key, no token, nothing of the owner's.
//  The address checks are the same code as news-article's and shop-price's
//  (scripts/verify-ssrf-guard.cjs compares them); the DNS question is handed
//  in by main.ts, because only main.ts touches Deno.
// ─────────────────────────────────────────────────────────────────────────────

import type { DnsLookup, PageEnv } from './types.ts'

// True for a dotted-quad that lands in a loopback/private/link-local range.
// 169.254.0.0/16 covers cloud metadata (169.254.169.254) too. A malformed
// dotted-numeric string is treated as suspicious (blocked) rather than allowed.
function isPrivateIPv4(ip: string): boolean {
  const p = ip.split('.').map(Number)
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true
  const [a, b] = p
  if (a === 0 || a === 127 || a === 10) return true
  if (a === 192 && b === 168) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 169 && b === 254) return true
  if (a === 198 && (b === 18 || b === 19)) return true    // benchmarking
  if (a >= 224) return true                                // multicast, reserved, broadcast
  if (a === 100 && b >= 64 && b <= 127) return true   // carrier-grade NAT
  return false
}

// Blocks SSRF targets (localhost/loopback/link-local/private ranges) — this
// fetches whatever URL the user pastes, server-side. Beyond the obvious
// dotted-quad ranges this also blocks the encodings that trivially bypass a
// naive string check: numeric-encoded IPv4 (decimal 2130706433, 0x-hex, octal),
// and every IPv6 literal. A name that resolves to a private address is
// refused by resolvesToPrivate below, on every redirect hop.
function isPrivateHost(hostname: string): boolean {
  let h = hostname.toLowerCase().trim()
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1)
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local')) return true
  // IPv6 literal: refused outright. These fetchers read web pages by name, so an
  // IPv6 literal is never a real target — and the URL parser rewrites embedded
  // IPv4 ([::ffff:127.0.0.1] → [::ffff:7f00:1]), which a pattern check misses.
  if (h.includes(':')) return true
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return isPrivateIPv4(h)
  if (/^(0x[0-9a-f]+|\d+)$/.test(h)) return true
  return false
}

// An IPv6 address as its eight 16-bit groups (an embedded IPv4 tail too), or null.
function ipv6Groups(ip: string): number[] | null {
  let s = ip.toLowerCase().split('%')[0]
  const tail = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s)
  if (tail) {
    const q = tail.slice(1).map(Number)
    if (q.some(n => n > 255)) return null
    s = s.slice(0, tail.index) + `${((q[0] << 8) | q[1]).toString(16)}:${((q[2] << 8) | q[3]).toString(16)}`
  }
  const halves = s.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0
  const groups = [...head, ...Array(Math.max(fill, 0)).fill('0'), ...rest]
  if (fill < 0 || groups.length !== 8 || groups.some(g => !/^[0-9a-f]{1,4}$/.test(g))) return null
  return groups.map(g => parseInt(g, 16))
}

// True for an IPv6 address a public web page never has: unspecified, loopback,
// IPv4-compatible/-mapped (judged by the IPv4 inside), NAT64, unique local
// (fd00:ec2::254 is AWS's metadata), link-local, site-local, multicast,
// documentation, Teredo, 6to4 around a private IPv4, discard.
function isPrivateIPv6(ip: string): boolean {
  const g = ipv6Groups(ip)
  if (!g) return true
  const v4 = (a: number, b: number) => `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`
  if (g.slice(0, 5).every(x => x === 0) && g[5] === 0xffff) return isPrivateIPv4(v4(g[6], g[7]))
  if (g.slice(0, 6).every(x => x === 0)) return true
  if (g[0] === 0x64 && g[1] === 0xff9b) return true
  if ((g[0] & 0xfe00) === 0xfc00 || (g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0 || (g[0] & 0xff00) === 0xff00) return true
  if (g[0] === 0x2001 && (g[1] === 0x0db8 || g[1] === 0)) return true
  if (g[0] === 0x2002) return isPrivateIPv4(v4(g[1], g[2]))
  if (g[0] === 0x0100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true
  return false
}

// A public NAME can still point at a private address (127.0.0.1.nip.io, localtest.me, a record its owner points
// at 169.254.169.254), so every hop's name is resolved and refused when any A/AAAA answer is private (audit
// 28.10.2026). Fails closed on the answer: a name that doesn't resolve or a resolver error refuses the hop; "no
// record of this type" (an empty list) is not an error. A runtime with no lookup to give (main.ts hands in none,
// or the lookup says `NoLookup`) keeps the hostname check alone: refusing there would refuse every link. Only a
// timeout (the fetch's own signal) is passed on. fetch resolves the name again, so a rebinding name with a zero
// TTL can still change its answer in between: this closes the fixed names.
export async function resolvesToPrivate(hostname: string, lookup: DnsLookup | null, signal: AbortSignal): Promise<boolean> {
  const h = hostname.toLowerCase().trim()
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return isPrivateIPv4(h)
  if (h.startsWith('[') || h.includes(':')) return true
  if (!lookup) return false
  let unavailable = false
  const ask = async (type: 'A' | 'AAAA'): Promise<string[] | null> => {
    try {
      return await lookup(h, type, signal)
    } catch (e) {
      const name = (e as Error)?.name
      if (name === 'AbortError') throw e
      if (name === 'NoLookup') unavailable = true
      return null
    }
  }
  try {
    const [a, aaaa] = await Promise.all([ask('A'), ask('AAAA')])
    if (unavailable) return false
    if (!a || !aaaa || a.length + aaaa.length === 0) return true
    return a.some(ip => isPrivateIPv4(ip)) || aaaa.some(ip => isPrivateIPv6(ip))
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e
    return true
  }
}

export const PAGE_TIMEOUT_MS = 10_000
export const PAGE_MAX_BYTES = 2 * 1024 * 1024
const PAGE_MAX_REDIRECTS = 4
const PAGE_LINK_MAX = 2000

/** The page, or why it was not read (one plain sentence; `outcome` is how the ledger files it). */
export type PageResult =
  | { ok: true; html: string }
  | { ok: false; outcome: 'bad_input' | 'error'; message: string }

const pageRefused = (message: string): PageResult => ({ ok: false, outcome: 'bad_input', message })

/** Why a link cannot be read at all, or null. Checked before any request, and again on every redirect hop. */
export function linkProblem(link: string): string | null {
  if (link.length > PAGE_LINK_MAX) return `The link is longer than ${PAGE_LINK_MAX} characters.`
  let url: URL
  try { url = new URL(link) } catch { return 'That is not a link.' }
  if (url.protocol === 'http:') return 'Only secure links (https) can be read.'
  if (url.protocol !== 'https:') return 'That is not a web link.'
  if (url.username || url.password) return 'A link with a user name or password in it cannot be read.'
  if (url.port) return 'A link with its own port cannot be read.'
  return null
}

/** The body as text, or null when it is larger than `maxBytes` (reading stops there). */
async function readPageBody(res: Response, maxBytes: number): Promise<string | null> {
  const declared = Number(res.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) { await res.body?.cancel(); return null }
  if (!res.body) return ''
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maxBytes) { await reader.cancel(); return null }
    chunks.push(value)
  }
  const whole = new Uint8Array(size)
  let at = 0
  for (const chunk of chunks) { whole.set(chunk, at); at += chunk.byteLength }
  return new TextDecoder().decode(whole)
}

/** Fetches one web page by hand, as the notes at the top say. It never throws. */
export async function fetchPage(link: string, env: PageEnv): Promise<PageResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PAGE_TIMEOUT_MS)
  try {
    let current = link
    let res!: Response
    for (let hop = 0; ; hop++) {
      const problem = linkProblem(current)
      if (problem) return pageRefused(problem)
      const url = new URL(current)
      if (isPrivateHost(url.hostname) || await resolvesToPrivate(url.hostname, env.dnsLookup, controller.signal)) {
        return pageRefused('That link points somewhere this app may not read.')
      }
      res = await env.fetch(url.toString(), {
        method: 'GET', signal: controller.signal, redirect: 'manual',
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; LascisBoardRecipeBot/1.0)', accept: 'text/html,application/xhtml+xml' },
      })
      const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null
      if (!location) break
      await res.body?.cancel()
      if (hop >= PAGE_MAX_REDIRECTS) return pageRefused('The link sends you around too many times.')
      try { current = new URL(location, url).toString() } catch { return pageRefused('The link redirects to something that is not a link.') }
    }
    if (!res.ok) return { ok: false, outcome: 'error', message: `The page answered with an error (${res.status}).` }
    if (!/^(text\/html|application\/xhtml\+xml)\b/i.test(res.headers.get('content-type') ?? '')) {
      await res.body?.cancel()
      return pageRefused('That link is not a web page.')
    }
    const html = await readPageBody(res, PAGE_MAX_BYTES)
    if (html === null) return pageRefused(`The page is larger than ${PAGE_MAX_BYTES / (1024 * 1024)} MB, so it was not read.`)
    return { ok: true, html }
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') {
      return { ok: false, outcome: 'error', message: `The page did not answer within ${PAGE_TIMEOUT_MS / 1000} seconds.` }
    }
    return { ok: false, outcome: 'error', message: 'The page could not be reached.' }
  } finally {
    clearTimeout(timer)
  }
}
