// KOReader's book id, computed in the browser before a file is sent, so the
// row prepared here is the one the Kobo's next sync matches (books.koreader_md5).
// Pure and import-free; verified by scripts/verify-epub-tools.cjs against
// node's crypto and the algorithm in KOReader's frontend/util.lua (partialMD5).

/** Plain MD5 (RFC 1321) of a byte array, as 32 lowercase hex characters. */
export function md5(data: Uint8Array): string {
  const s = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21]
  const K = new Int32Array(64)
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) | 0
  const len = data.length
  const padded = new Uint8Array(((len + 8) >> 6) * 64 + 64)
  padded.set(data)
  padded[len] = 0x80
  const bits = len * 8
  const view = new DataView(padded.buffer)
  view.setUint32(padded.length - 8, bits >>> 0, true)
  view.setUint32(padded.length - 4, Math.floor(bits / 2 ** 32), true)
  let a0 = 0x67452301, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476
  const M = new Int32Array(16)
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) M[i] = view.getInt32(off + i * 4, true)
    let A = a0, B = b0, C = c0, D = d0
    for (let i = 0; i < 64; i++) {
      let F: number, g: number
      if (i < 16) { F = (B & C) | (~B & D); g = i }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16 }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16 }
      else { F = C ^ (B | ~D); g = (7 * i) % 16 }
      const r = s[(i >> 4) * 4 + (i % 4)]
      const sum = (A + F + K[i] + M[g]) | 0
      A = D; D = C; C = B
      B = (B + ((sum << r) | (sum >>> (32 - r)))) | 0
    }
    a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0
  }
  const out = new DataView(new ArrayBuffer(16))
  ;[a0, b0, c0, d0].forEach((v, i) => out.setInt32(i * 4, v, true))
  return [...new Uint8Array(out.buffer)].map(x => x.toString(16).padStart(2, '0')).join('')
}

/**
 * KOReader's util.partialMD5: 1 KB read at 0, 1 KB, 4 KB, 16 KB … 1 GB
 * (1024 << 2i for i = -1…10, where LuaJIT's bit.lshift wraps the i = -1 shift
 * to 0), stopping at the first offset past the end; a short last read counts.
 */
export function partialMd5(file: Uint8Array): string {
  const parts: Uint8Array[] = []
  for (let i = -1; i <= 10; i++) {
    const at = i < 0 ? 0 : 1024 * 4 ** i
    if (at >= file.length) break
    parts.push(file.subarray(at, Math.min(at + 1024, file.length)))
  }
  const all = new Uint8Array(parts.reduce((t, p) => t + p.length, 0))
  let p = 0
  for (const part of parts) { all.set(part, p); p += part.length }
  return md5(all)
}
