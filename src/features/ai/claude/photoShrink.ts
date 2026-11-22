import { fitWithin, photoFromDataUrl, PHOTO_LONG_SIDE, PHOTO_MAX_BYTES, PHOTO_QUALITY, type PhotoInput } from './featureRules'

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

/** The file as the job's input, or an Error with a sentence for the owner. */
export async function shrinkPhoto(file: File): Promise<PhotoInput> {
  if (!file.type.startsWith('image/')) throw new Error('Pick a photo (a picture file)')
  let bmp
  try { bmp = await bitmapOf(file) } catch { throw new Error("That photo couldn't be opened — try another") }
  try {
    const { width, height } = fitWithin(bmp.width, bmp.height, PHOTO_LONG_SIDE)
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
      if (photo && photo.data.length * 0.75 <= PHOTO_MAX_BYTES) return photo
    }
    throw new Error('That photo is too detailed to send — take it a bit further away')
  } finally {
    bmp.close()
  }
}
