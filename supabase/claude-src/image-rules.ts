// ─────────────────────────────────────────────────────────────────────────────
//  The `claude` function · photos
//
//  A job that reads a photo (a quick guess, a receipt) takes it as
//  `{ media_type, data }`: the type and the bytes as base64. The browser has
//  already shrunk it (at most 1280 px on the long side, JPEG), so a request
//  stays small. Nothing from the browser is trusted all the same: this part
//  checks that the type is one of three, that the bytes really are that kind of
//  image (its own header), reads its width and height from that header, and
//  refuses what is too big. A photo is never stored: it goes to the model in
//  this one call and only the checked words that come back are kept.
//
//  Cost: Anthropic counts an image as about ⌈width/28⌉ × ⌈height/28⌉ tokens
//  (docs/integrations/anthropic.md, trap 15), worked out here from the header
//  and added to the reservation.
// ─────────────────────────────────────────────────────────────────────────────

import type { RequestImage } from './types.ts'

export const IMAGE_TYPES: readonly RequestImage['mediaType'][] = ['image/jpeg', 'image/png', 'image/webp']
/** The photo as base64 text: about 1 MB of image. The browser's 1280 px JPEG is usually 150–400 KB. */
export const IMAGE_BASE64_MAX_CHARS = 1_400_000
/** The long side the function accepts; the browser sends at most 1280, the rest is slack for another encoder. */
export const IMAGE_LONG_SIDE_MAX = 1600
export const IMAGE_SIDE_MIN = 16
/** The side of the square of pixels that costs one token. */
const IMAGE_TOKEN_SIDE = 28

export type CheckedImage = { ok: true; image: RequestImage; width: number; height: number; tokens: number } | { ok: false; problem: string }

/** The tokens Anthropic counts for a photo of this size. */
export function imageTokens(width: number, height: number): number {
  return Math.ceil(width / IMAGE_TOKEN_SIDE) * Math.ceil(height / IMAGE_TOKEN_SIDE)
}

const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1]
const u16le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8)
const u32be = (b: Uint8Array, i: number) => (b[i] * 2 ** 24) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3]
const ascii = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.slice(i, i + n))

/** The size a JPEG's first "start of frame" marker names, or null. Walks the markers; never reads past the end. */
function jpegSize(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff) return null
  let i = 2
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null
    while (b[i] === 0xff && i < b.length) i++
    const marker = b[i]
    i++
    if (marker === 0xd9 || marker === 0xda) return null // the end, or the picture's data, with no frame header before it
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue // markers that carry no length
    if (i + 2 > b.length) return null
    const length = u16be(b, i)
    if (length < 2) return null
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isFrame) return i + 7 <= b.length ? { height: u16be(b, i + 3), width: u16be(b, i + 5) } : null
    i += length
  }
  return null
}

function pngSize(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 24 || b[0] !== 0x89 || ascii(b, 1, 3) !== 'PNG' || ascii(b, 12, 4) !== 'IHDR') return null
  return { width: u32be(b, 16), height: u32be(b, 20) }
}

function webpSize(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 30 || ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 4) !== 'WEBP') return null
  const kind = ascii(b, 12, 4)
  if (kind === 'VP8 ') return b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a ? { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff } : null
  if (kind === 'VP8L') {
    if (b[20] !== 0x2f) return null
    return { width: 1 + (b[21] | ((b[22] & 0x3f) << 8)), height: 1 + ((b[22] >> 6) | (b[23] << 2) | ((b[24] & 0x0f) << 10)) }
  }
  if (kind === 'VP8X') return { width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) }
  return null
}

const SIZE_OF: Record<RequestImage['mediaType'], (b: Uint8Array) => { width: number; height: number } | null> = {
  'image/jpeg': jpegSize, 'image/png': pngSize, 'image/webp': webpSize,
}

/**
 * The photo of a request's input, checked: `{ media_type, data }` with one of the three types, base64 that decodes,
 * bytes that are that kind of image, a size from its own header inside the limits. Anything else says why in one
 * plain sentence that never holds any of the input.
 */
export function checkedImage(raw: unknown, maxChars: number = IMAGE_BASE64_MAX_CHARS): CheckedImage {
  const own = (key: string): unknown => (raw !== null && typeof raw === 'object' && Object.prototype.hasOwnProperty.call(raw, key) ? (raw as Record<string, unknown>)[key] : undefined)
  const mediaType = IMAGE_TYPES.find(t => t === own('media_type'))
  if (!mediaType) return { ok: false, problem: 'The photo must be a JPEG, PNG or WebP picture.' }
  const data = own('data')
  if (typeof data !== 'string' || data.length < 100) return { ok: false, problem: 'The photo is empty.' }
  if (data.length > maxChars) return { ok: false, problem: maxChars === IMAGE_BASE64_MAX_CHARS ? 'The photo is too large: take it smaller (at most about 1 MB).' : `The photo is too large: take it smaller (at most about ${Math.round(maxChars * 0.75 / 1000)} KB).` }
  if (data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return { ok: false, problem: 'The photo could not be read.' }
  let bytes: Uint8Array
  try {
    const binary = atob(data)
    bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  } catch {
    return { ok: false, problem: 'The photo could not be read.' }
  }
  const size = SIZE_OF[mediaType](bytes)
  if (!size) return { ok: false, problem: 'The photo is not a picture of the kind it says.' }
  const { width, height } = size
  if (!(width >= IMAGE_SIDE_MIN && height >= IMAGE_SIDE_MIN)) return { ok: false, problem: 'The photo is too small to read.' }
  if (Math.max(width, height) > IMAGE_LONG_SIDE_MAX) return { ok: false, problem: `The photo is too big: at most ${IMAGE_LONG_SIDE_MAX} pixels on its long side.` }
  return { ok: true, image: { mediaType, base64: data }, width, height, tokens: imageTokens(width, height) }
}
