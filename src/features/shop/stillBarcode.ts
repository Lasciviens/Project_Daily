// AI last for Shop's 📷✨ (25.11.2026): a barcode in the owner's still photos is read by the app's own readers before any AI
// call — the browser's native BarcodeDetector where there is one, else ZXing (the same two the camera's Scan uses,
// `BarcodeScanner`), imported only now so neither rides in a page's first download. Nothing leaves the device here: the
// photos are read in memory and the code goes to the barcode lookup (the owner's things, then Kassalapp).

interface NativeDetector { detect(src: ImageBitmapSource): Promise<{ rawValue: string }[]> }
type DetectorCtor = new (opts?: { formats?: string[] }) => NativeDetector

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e']

/** The first product barcode (digits only, 8–14) in the photos, or null. A photo that cannot be read is passed over. */
export async function barcodeInPhotos(files: readonly File[]): Promise<string | null> {
  const Native = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector
  for (const file of files) {
    try {
      let raw: string | null = null
      if (Native) {
        const bitmap = await createImageBitmap(file)
        try { raw = (await new Native({ formats: FORMATS }).detect(bitmap))[0]?.rawValue ?? null } finally { bitmap.close() }
      } else {
        const { BrowserMultiFormatReader } = await import('@zxing/browser')
        const url = URL.createObjectURL(file)
        try { raw = (await new BrowserMultiFormatReader().decodeFromImageUrl(url)).getText() } catch { raw = null } finally { URL.revokeObjectURL(url) }
      }
      const digits = raw ? raw.replace(/\D/g, '') : ''
      if (/^\d{8,14}$/.test(digits)) return digits
    } catch { /* this photo could not be read: the next one */ }
  }
  return null
}
