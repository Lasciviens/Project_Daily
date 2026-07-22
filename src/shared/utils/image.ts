// Downscale a picked image File to a compact JPEG data URL before sending it to
// the AI. A raw phone photo is several MB of base64 — needless tokens/payload;
// ~1024px long edge at q0.8 is plenty for the model to read a plate or a label,
// and keeps a request well under a cent. Falls back to the original data URL if
// canvas decoding fails for any reason.
export async function fileToCompactDataUrl(file: File, maxDim = 1024, quality = 0.8): Promise<string> {
  const original = await readAsDataUrl(file)
  try {
    const img = await loadImage(original)
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
    if (scale >= 1) return original   // already small enough
    const canvas = document.createElement('canvas')
    canvas.width  = Math.round(img.width * scale)
    canvas.height = Math.round(img.height * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) return original
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', quality)
  } catch {
    return original
  }
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}
