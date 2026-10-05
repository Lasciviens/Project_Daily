// A tiny ZIP reader/rewriter for EPUB files, in the browser — pure and
// import-free (Uint8Array in, Uint8Array out); verified by
// scripts/verify-epub-tools.cjs. Inflating is passed in (the browser uses
// DecompressionStream('deflate-raw'), the verify script node's zlib), so this
// file has no platform code. ZIP64 archives are refused (an EPUB never needs it).

export interface ZipEntry {
  name: string
  method: number // 0 stored, 8 deflate
  flags: number
  crc: number
  compressedSize: number
  size: number
  localOffset: number
  /** The whole central-directory record, for copying unchanged. */
  record: Uint8Array
}

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8)
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0
const decoder = new TextDecoder()

function findEnd(b: Uint8Array): number {
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) {
    if (u32(b, i) === 0x06054b50) return i
  }
  return -1
}

/** The archive's entries, in central-directory order; null when it is not a ZIP this reader handles. */
export function readEntries(b: Uint8Array): ZipEntry[] | null {
  const end = findEnd(b)
  if (end < 0) return null
  const count = u16(b, end + 10)
  const cdSize = u32(b, end + 12)
  const cdOffset = u32(b, end + 16)
  if (count === 0xffff || cdOffset === 0xffffffff || cdOffset + cdSize > b.length) return null
  const out: ZipEntry[] = []
  let p = cdOffset
  for (let i = 0; i < count; i++) {
    if (u32(b, p) !== 0x02014b50) return null
    const nameLen = u16(b, p + 28), extraLen = u16(b, p + 30), commentLen = u16(b, p + 32)
    const len = 46 + nameLen + extraLen + commentLen
    const e: ZipEntry = {
      name: decoder.decode(b.subarray(p + 46, p + 46 + nameLen)),
      flags: u16(b, p + 8), method: u16(b, p + 10), crc: u32(b, p + 16),
      compressedSize: u32(b, p + 20), size: u32(b, p + 24), localOffset: u32(b, p + 42),
      record: b.subarray(p, p + len),
    }
    if (e.compressedSize === 0xffffffff || e.size === 0xffffffff || e.localOffset === 0xffffffff) return null
    out.push(e)
    p += len
  }
  return out
}

/** Where an entry's data starts (after its local header). */
function dataStart(b: Uint8Array, e: ZipEntry): number {
  if (u32(b, e.localOffset) !== 0x04034b50) throw new Error(`Broken ZIP entry: ${e.name}`)
  return e.localOffset + 30 + u16(b, e.localOffset + 26) + u16(b, e.localOffset + 28)
}

/** An entry's bytes as stored (still compressed for method 8). */
export function rawData(b: Uint8Array, e: ZipEntry): Uint8Array {
  const s = dataStart(b, e)
  return b.subarray(s, s + e.compressedSize)
}

export type Inflate = (data: Uint8Array) => Promise<Uint8Array>

/** An entry's content; null when it is missing or uses a compression this reader does not know. */
export async function readFile(b: Uint8Array, entries: ZipEntry[], name: string, inflate: Inflate): Promise<Uint8Array | null> {
  const e = entries.find(x => x.name === name)
  if (!e) return null
  const raw = rawData(b, e)
  if (e.method === 0) return raw
  if (e.method === 8) return inflate(raw)
  return null
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const put16 = (b: Uint8Array, o: number, v: number) => { b[o] = v & 0xff; b[o + 1] = (v >>> 8) & 0xff }
const put32 = (b: Uint8Array, o: number, v: number) => { put16(b, o, v & 0xffff); put16(b, o + 2, (v >>> 16) & 0xffff) }

/** Bytes an entry occupies in the file: local header, data and its data descriptor if any. */
function localSpan(b: Uint8Array, e: ZipEntry): [number, number] {
  let end = dataStart(b, e) + e.compressedSize
  if (e.flags & 0x08) end += u32(b, end) === 0x08074b50 ? 16 : 12
  return [e.localOffset, end]
}

/**
 * The same archive with one file replaced (stored, uncompressed). Every other
 * entry is copied byte for byte in its original order, so the EPUB's first
 * entry (the uncompressed "mimetype") stays first.
 */
export function replaceFile(b: Uint8Array, entries: ZipEntry[], name: string, content: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = []
  const records: Uint8Array[] = []
  let offset = 0
  const nameBytes = new TextEncoder().encode(name)
  for (const e of entries) {
    if (e.name === name) {
      const crc = crc32(content)
      const local = new Uint8Array(30 + nameBytes.length)
      put32(local, 0, 0x04034b50); put16(local, 4, 20); put16(local, 6, e.flags & ~0x08 & 0x0800); put16(local, 8, 0)
      put16(local, 10, u16(e.record, 12)); put16(local, 12, u16(e.record, 14))
      put32(local, 14, crc); put32(local, 18, content.length); put32(local, 22, content.length)
      put16(local, 26, nameBytes.length); put16(local, 28, 0); local.set(nameBytes, 30)
      const rec = new Uint8Array(46 + nameBytes.length)
      rec.set(e.record.subarray(0, 46))
      put16(rec, 8, e.flags & ~0x08 & 0x0800); put16(rec, 10, 0)
      put32(rec, 16, crc); put32(rec, 20, content.length); put32(rec, 24, content.length)
      put16(rec, 28, nameBytes.length); put16(rec, 30, 0); put16(rec, 32, 0); put32(rec, 42, offset)
      rec.set(nameBytes, 46)
      parts.push(local, content)
      records.push(rec)
      offset += local.length + content.length
    } else {
      const [s, end] = localSpan(b, e)
      const rec = e.record.slice()
      put32(rec, 42, offset)
      parts.push(b.subarray(s, end))
      records.push(rec)
      offset += end - s
    }
  }
  const cdSize = records.reduce((t, r) => t + r.length, 0)
  const eocd = new Uint8Array(22)
  put32(eocd, 0, 0x06054b50)
  put16(eocd, 8, records.length); put16(eocd, 10, records.length)
  put32(eocd, 12, cdSize); put32(eocd, 16, offset)
  const out = new Uint8Array(offset + cdSize + 22)
  let p = 0
  for (const part of [...parts, ...records, eocd]) { out.set(part, p); p += part.length }
  return out
}
