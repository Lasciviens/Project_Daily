// The browser side of the Send to Kobo preview: open a picked file, read its
// details and cover, and (EPUB only) write edited details back into it.
// The pure parts live in zip.ts / opf.ts / partialMd5.ts.

import { opfPath, readOpf, writeOpf, type EpubMeta, type OpfEdit } from './opf'
import { partialMd5 } from './partialMd5'
import { readEntries, readFile, replaceFile, type Inflate, type ZipEntry } from './zip'

const inflate: Inflate = async data => {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

export interface OpenedFile {
  file: File
  bytes: Uint8Array
  isEpub: boolean
  meta: EpubMeta | null
  /** An object URL of the cover image (revoke it when done). */
  coverUrl: string | null
  /** Set when the file is an EPUB whose details can be rewritten. */
  epub: { entries: ZipEntry[]; opf: string; opfText: string } | null
  /** Why the details could not be read (the file can still be sent as it is). */
  problem: string | null
}

const IMAGE_TYPE: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' }

/** Reads a picked file. A PDF, or an EPUB this reader cannot open, comes back with meta null and a reason. */
export async function openBookFile(file: File): Promise<OpenedFile> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const isEpub = /\.epub$/i.test(file.name)
  const base: OpenedFile = { file, bytes, isEpub, meta: null, coverUrl: null, epub: null, problem: null }
  if (!isEpub) return { ...base, problem: 'A PDF keeps its own details; the ones you type here are saved in the app only.' }
  if (typeof DecompressionStream === 'undefined') return { ...base, problem: 'This browser cannot open EPUB files; the details you type are saved in the app only.' }
  try {
    const entries = readEntries(bytes)
    if (!entries) return { ...base, problem: 'This EPUB could not be opened; it can still be sent as it is.' }
    const container = await readFile(bytes, entries, 'META-INF/container.xml', inflate)
    const opf = container ? opfPath(new TextDecoder().decode(container)) : null
    const opfBytes = opf ? await readFile(bytes, entries, opf, inflate) : null
    if (!opf || !opfBytes) return { ...base, problem: 'This EPUB has no book details file; it can still be sent as it is.' }
    const opfText = new TextDecoder().decode(opfBytes)
    const meta = readOpf(opfText, opf)
    let coverUrl: string | null = null
    if (meta.coverPath) {
      const img = await readFile(bytes, entries, meta.coverPath, inflate).catch(() => null)
      const type = IMAGE_TYPE[meta.coverPath.split('.').pop()?.toLowerCase() ?? '']
      if (img && type) coverUrl = URL.createObjectURL(new Blob([img as BlobPart], { type }))
    }
    return { ...base, meta, coverUrl, epub: { entries, opf, opfText } }
  } catch {
    return { ...base, problem: 'This EPUB could not be read; it can still be sent as it is.' }
  }
}

/** The bytes to send: the EPUB with the edited details written in, or the file unchanged. */
export function finalBytes(f: OpenedFile, edit: OpfEdit | null): Uint8Array {
  if (!edit || !f.epub) return f.bytes
  const xml = writeOpf(f.epub.opfText, edit)
  if (xml === f.epub.opfText) return f.bytes
  return replaceFile(f.bytes, f.epub.entries, f.epub.opf, new TextEncoder().encode(xml))
}

export { partialMd5 }
