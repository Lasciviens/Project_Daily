/** A picked image scaled to fit `maxW`×`maxH` (never enlarged), as JPEG. */
export async function resizeImage(file: Blob, maxW: number, maxH: number, quality = 0.85): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxW / bitmap.width, maxH / bitmap.height)
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This browser cannot resize images.')
  // White under transparent PNGs (JPEG has no transparency).
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality))
  if (!blob) throw new Error('Could not read that image.')
  return { blob, width, height }
}
