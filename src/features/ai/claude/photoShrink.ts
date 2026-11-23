import { fitWithin, pdfFromBytes, photoFromDataUrl, PHOTO_LONG_SIDE, PHOTO_MAX_BYTES, PHOTO_QUALITY, type PhotoInput } from './featureRules'
import type { ReceiptInput } from './featureJobs'

// A photo for an AI job is shrunk and re-encoded here, in the browser, before it is sent: at most 1280 px on the long
// side, JPEG (85 %, lower while it is over 1 MB), so a request stays small and nothing else (EXIF, location) travels.
// The photo is held in memory for the one call; it is never stored.

async function bitmapOf(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const b = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return { source: b, width: b.width, height: b.height, close: () => b.close() }
    } catch { /* fall back to an <img> */ }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.decoding = 'async'
    img.src = url
    await img.decode()
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => undefined }
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * The file as the job's input, or an Error with a sentence for the owner. A caller with a tighter limit (the chat keeps
 * every photo in the stored conversation: `maxBytes`) also gets smaller sizes tried, longest side first.
 */
export async function shrinkPhoto(file: File, limits: { maxBytes?: number } = {}): Promise<PhotoInput> {
  const maxBytes = limits.maxBytes ?? PHOTO_MAX_BYTES
  if (!file.type.startsWith('image/')) throw new Error('Pick a photo (a picture file)')
  let bmp
  try { bmp = await bitmapOf(file) } catch { throw new Error("That photo couldn't be opened — try another") }
  try {
    // The usual size first; a tighter limit also tries 80 % and 60 % of it.
    for (const scale of limits.maxBytes === undefined ? [1] : [1, 0.8, 0.6]) {
      const { width, height } = fitWithin(bmp.width, bmp.height, Math.round(PHOTO_LONG_SIDE * scale))
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error("This browser can't shrink photos")
      // A white ground: a transparent PNG would turn black in a JPEG.
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, width, height)
      ctx.drawImage(bmp.source, 0, 0, width, height)
      for (const quality of [PHOTO_QUALITY, 0.7, 0.55]) {
        const url = canvas.toDataURL('image/jpeg', quality)
        const photo = photoFromDataUrl(url)
        if (photo && photo.data.length * 0.75 <= maxBytes) return photo
      }
    }
    throw new Error('That photo is too detailed to send — take it a bit further away')
  } finally {
    bmp.close()
  }
}

/** Whether a picked file is a PDF (its own type, or its name when the system gives none). */
export const isPdfFile = (file: File): boolean => file.type === 'application/pdf' || (file.type === '' && /\.pdf$/i.test(file.name))

/** A picked file as a receipt job's input: a PDF as it is (checked), a photo shrunk first. Nothing is kept. */
export async function receiptInputOf(file: File): Promise<ReceiptInput> {
  if (isPdfFile(file)) return { document: pdfFromBytes(new Uint8Array(await file.arrayBuffer())) }
  return { image: await shrinkPhoto(file) }
}
