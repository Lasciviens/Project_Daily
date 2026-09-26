// The media proxy's contract, shared by the browser (which builds URLs), the
// `screenscraper-media` function (which checks and serves them) and
// `screenscraper-sync` (which signs them). Import-free; copied into both
// functions by scripts/sync-screenscraper-shared.mjs.
//
// Why a proxy: every ScreenScraper media URL carries the developer and member
// credentials, so the browser can never be handed one. The proxy takes a game
// id, a system id and their media token, adds the credentials server-side and
// streams the file back — nothing stored, nothing leaked.
//
// Why signed: the function has to run without JWT verification (an <img> tag
// cannot send a header), and an open proxy would let anyone spend this
// account's daily allowance. The signature binds ONE game on ONE system until
// an expiry, and only a few fixed widths are served — so a leaked link fetches
// that game's own media, a handful of variants, for a week at most.
// Signatures are minted on demand by screenscraper-sync (owner only) and never
// stored, so rotating the signing key breaks nothing permanently.

import type { MediaEndpoint, SsMediaEntry } from './ssTypes'
import { MEDIA_TOKEN } from './ssRules'

export const PROXY_PATH = '/functions/v1/screenscraper-media'

/** The exact bytes that get signed. Versioned so the scheme can change. */
export const sigPayload = (jeuId: string, systemId: number | string, exp: number) => `ssm2|${jeuId}|${systemId}|${exp}`

export interface ProxyRef { jeuId: string; systemId: number; sig: string; exp: number }

/** The only widths served. Few distinct URLs per file keep both the browser
 *  cache and ScreenScraper's allowance intact. */
export const PROXY_WIDTHS = [120, 200, 360, 640, 1280] as const
/** The smallest served width at least as large as asked (or the largest). */
export function snapWidth(w: number | null | undefined): number | null {
  if (w == null || !Number.isFinite(w) || w <= 0) return null
  return PROXY_WIDTHS.find(x => x >= w) ?? PROXY_WIDTHS[PROXY_WIDTHS.length - 1]
}

const WEEK = 7 * 24 * 3600
/** A signature's expiry: the end of NEXT week (unix seconds). The same value
 *  all week long, so proxy URLs — and the browser's cache of them — stay
 *  stable, while no link outlives two weeks. */
export const mediaExpiry = (nowMs: number) => (Math.floor(nowMs / 1000 / WEEK) + 2) * WEEK
/** Longest validity a request may claim — refuses a forged far-future expiry. */
export const MAX_EXPIRY_AHEAD = 2 * WEEK + 60

export interface ProxyRequest {
  jeuId: string
  systemId: number
  ep: MediaEndpoint
  token: string
  /** maxwidth / outputformat — images only. */
  width: number | null
  format: 'png' | 'jpg' | null
  sig: string
  exp: number
}

const EP: MediaEndpoint[] = ['img', 'video', 'manual']

/** Validates a proxy query string. Everything is whitelisted: anything outside
 *  these shapes is refused before a request is spent on it. */
export function parseProxyQuery(q: URLSearchParams): ProxyRequest | { error: string } {
  const j = q.get('j') ?? ''
  const s = q.get('s') ?? ''
  const ep = (q.get('e') ?? 'img') as MediaEndpoint
  const token = q.get('m') ?? ''
  const w = q.get('w')
  const f = q.get('f')
  const sig = q.get('k') ?? ''
  const x = q.get('x') ?? ''
  if (!/^\d{1,10}$/.test(j)) return { error: 'bad game id' }
  if (!/^\d{9,11}$/.test(x)) return { error: 'bad expiry' }
  if (!/^\d{1,6}$/.test(s)) return { error: 'bad system id' }
  if (!EP.includes(ep)) return { error: 'bad endpoint' }
  if (!MEDIA_TOKEN.test(token)) return { error: 'bad media token' }
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(sig)) return { error: 'bad signature' }
  let width: number | null = null
  if (w != null && w !== '') {
    const n = Number(w)
    if (!(PROXY_WIDTHS as readonly number[]).includes(n)) return { error: 'bad width' }
    width = n
  }
  const format = f === 'png' || f === 'jpg' ? f : null
  if (f != null && f !== '' && !format) return { error: 'bad format' }
  return { jeuId: j, systemId: Number(s), ep, token, width: ep === 'img' ? width : null, format: ep === 'img' ? format : null, sig, exp: Number(x) }
}

/** The query string for one file. Order is fixed so equal requests are equal
 *  URLs — which is what lets the browser cache them. */
export function proxyQuery(ref: ProxyRef, entry: Pick<SsMediaEntry, 'ep' | 'token'>, opts: { width?: number | null; format?: 'png' | 'jpg' | null } = {}): string {
  const p = new URLSearchParams()
  p.set('j', ref.jeuId)
  p.set('s', String(ref.systemId))
  if (entry.ep !== 'img') p.set('e', entry.ep)
  p.set('m', entry.token)
  const w = entry.ep === 'img' ? snapWidth(opts.width) : null
  if (w) p.set('w', String(w))
  if (entry.ep === 'img' && opts.format) p.set('f', opts.format)
  p.set('x', String(ref.exp))
  p.set('k', ref.sig)
  return p.toString()
}

const UPSTREAM_FILE: Record<MediaEndpoint, string> = { img: 'mediaJeu.php', video: 'mediaVideoJeu.php', manual: 'mediaManuelJeu.php' }

/** The ScreenScraper endpoint and parameters for a proxy request (credentials
 *  are added by the caller and never pass through here). */
export function upstreamFor(req: ProxyRequest): { file: string; params: Record<string, string> } {
  const params: Record<string, string> = { systemeid: String(req.systemId), jeuid: req.jeuId, media: req.token }
  if (req.width) params.maxwidth = String(req.width)
  if (req.format) params.outputformat = req.format
  return { file: UPSTREAM_FILE[req.ep], params }
}

/**
 * Where a stored copy lives: under our own game id, with a per-upload stamp,
 * so a re-scrape never overwrites bytes an undo may point back at (a reused
 * path would serve the new picture under the restored URL).
 */
export const storedPath = (gameId: string, type: string, stamp: string, ext: string) => `${gameId}/${type}-${stamp}.${ext}`

/** Is this a stored ScreenScraper copy of THIS game — the only kind of object
 *  undo or cleanup may ever delete? */
export function isScrapeCopyOf(gameId: string, path: string): boolean {
  if (!/^[0-9a-f-]{36}$/i.test(gameId)) return false
  return path.startsWith(`${gameId}/`) && /^[0-9a-f-]{36}\/[A-Za-z0-9-]{1,60}\.(png|jpg|jpeg|webp|gif)$/i.test(path)
}

/** Image types that may be served or stored — never SVG (script) or HTML. */
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
/** The content types the proxy passes through; anything else (their plain-text
 *  errors included) is not a file. */
export function allowedContentType(ep: MediaEndpoint, contentType: string): boolean {
  const t = contentType.toLowerCase().split(';')[0].trim()
  if (ep === 'img') return IMAGE_TYPES.includes(t)
  if (ep === 'video') return t === 'video/mp4' || t === 'video/webm' || t === 'application/octet-stream'
  return t === 'application/pdf' || t === 'application/octet-stream'
}
/** The file extension for a stored image of this content type. */
export function imageExtension(contentType: string): 'png' | 'jpg' | 'webp' | 'gif' | null {
  const t = contentType.toLowerCase().split(';')[0].trim()
  return t === 'image/png' ? 'png' : t === 'image/jpeg' ? 'jpg' : t === 'image/webp' ? 'webp' : t === 'image/gif' ? 'gif' : null
}

/**
 * A redirect target that may be fetched: https, on a screenscraper.fr host.
 * Their credentials sit in the query string, so following a Location to an
 * arbitrary host (or plain http) would hand them over.
 */
export function safeRedirect(base: string, location: string | null): string | null {
  if (!location) return null
  let u: URL
  try { u = new URL(location, base) } catch { return null }
  if (u.protocol !== 'https:') return null
  const host = u.hostname.toLowerCase()
  return host === 'screenscraper.fr' || host.endsWith('.screenscraper.fr') ? u.toString() : null
}

/** Constant-time comparison for signatures. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Bytes → base64url, the signature's text form. */
export function base64url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * HMAC-SHA256 over `sigPayload`. The secret is SCREENSCRAPER_MEDIA_KEY when
 * set, else the service-role key (injected into every function, so the two
 * functions agree with no setup) — hashed with a label first so the signing
 * key is never the secret itself. 32 characters (192 bits).
 */
export async function signMedia(secret: string, jeuId: string, systemId: number | string, exp: number): Promise<string> {
  const enc = new TextEncoder()
  const raw = await crypto.subtle.digest('SHA-256', enc.encode(`screenscraper-media-v2:${secret}`))
  const key = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(sigPayload(jeuId, systemId, exp)))
  return base64url(new Uint8Array(mac)).slice(0, 32)
}
