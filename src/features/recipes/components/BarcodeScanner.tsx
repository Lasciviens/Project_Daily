import { useEffect, useRef, useState } from 'react'
import { Dialog, DialogPanel, DialogBackdrop } from '@headlessui/react'

// Camera barcode scanner. iOS Safari has NO native BarcodeDetector, so we try
// the native API first (Android/desktop Chrome) and fall back to @zxing/browser
// — dynamically imported so the ~200KB decoder is code-split out of the main
// bundle and only loads when the scanner is actually opened. A manual number
// entry is always available (some cameras/lighting just won't read a code).

interface Props {
  open:       boolean
  onClose:    () => void
  onDetected: (code: string) => void
}

// Minimal shape of the native BarcodeDetector (not in TS lib DOM yet).
interface NativeDetector { detect(src: CanvasImageSource): Promise<{ rawValue: string }[]> }
type DetectorCtor = new (opts?: { formats?: string[] }) => NativeDetector

export function BarcodeScanner({ open, onClose, onDetected }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [status, setStatus] = useState<'idle' | 'starting' | 'scanning' | 'error'>('idle')
  const [manual, setManual] = useState('')
  const stopRef = useRef<() => void>(() => {})

  useEffect(() => {
    if (!open) return
    let cancelled = false

    async function start() {
      setStatus('starting'); setManual('')
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return }
        const video = videoRef.current
        if (!video) return
        video.srcObject = stream
        await video.play()
        setStatus('scanning')

        const Native = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector
        if (Native) {
          const detector = new Native({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'] })
          let raf = 0
          const tick = async () => {
            if (cancelled) return
            try {
              const found = await detector.detect(video)
              if (found[0]?.rawValue) { hit(found[0].rawValue); return }
            } catch { /* transient decode miss */ }
            raf = requestAnimationFrame(tick)
          }
          raf = requestAnimationFrame(tick)
          stopRef.current = () => { cancelAnimationFrame(raf); stream.getTracks().forEach(t => t.stop()) }
        } else {
          // iOS / no native support → ZXing from the live stream.
          const { BrowserMultiFormatReader } = await import('@zxing/browser')
          const reader = new BrowserMultiFormatReader()
          const controls = await reader.decodeFromVideoElement(video, (result) => {
            if (result) hit(result.getText())
          })
          stopRef.current = () => { controls.stop(); stream.getTracks().forEach(t => t.stop()) }
        }
      } catch {
        if (!cancelled) setStatus('error')
      }
    }

    function hit(code: string) {
      const clean = code.replace(/\D/g, '')
      if (clean.length < 6) return
      stopRef.current()
      if (!cancelled) onDetected(clean)
    }

    start()
    return () => { cancelled = true; stopRef.current() }
  }, [open, onDetected])

  return (
    <Dialog open={open} onClose={onClose} className="relative z-[70]">
      <DialogBackdrop transition className="fixed inset-0 bg-ink-950/60 backdrop-blur-sm transition duration-200 data-[closed]:opacity-0" />
      <div className="fixed inset-0 flex items-end sm:items-center justify-center p-0 sm:p-4">
        <DialogPanel transition className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl bg-cream-50 border border-ink-200 overflow-hidden transition duration-200 data-[closed]:opacity-0 data-[closed]:translate-y-4">
          <div className="px-5 pt-4 pb-3 flex items-center justify-between border-b border-ink-100">
            <h2 className="text-base font-bold text-ink-900">📷 Scan barcode</h2>
            <button type="button" onClick={onClose} className="min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-400 hover:text-ink-700 text-xl leading-none">×</button>
          </div>

          <div className="relative bg-ink-950 aspect-[4/3] flex items-center justify-center">
            <video ref={videoRef} playsInline muted className="w-full h-full object-cover" />
            {status === 'scanning' && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="w-3/4 h-24 border-2 border-accent-400/80 rounded-lg shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
              </div>
            )}
            {status === 'starting' && <p className="absolute text-cream-50 text-sm">Starting camera…</p>}
            {status === 'error' && <p className="absolute text-cream-50 text-sm px-6 text-center">Camera unavailable. Enter the barcode number below instead.</p>}
          </div>

          {/* Manual fallback — always available */}
          <div className="px-5 py-4 flex items-center gap-2">
            <input
              value={manual}
              onChange={e => setManual(e.target.value.replace(/\D/g, ''))}
              inputMode="numeric"
              placeholder="Or type the barcode number"
              className="flex-1 min-h-[44px] px-3 text-sm border border-ink-200 rounded-lg bg-cream-50 focus:outline-none focus:ring-2 focus:ring-accent-400 tabular-nums"
              onKeyDown={e => { if (e.key === 'Enter' && manual.length >= 6) { stopRef.current(); onDetected(manual) } }}
            />
            <button type="button" disabled={manual.length < 6}
              onClick={() => { stopRef.current(); onDetected(manual) }}
              className="min-h-[44px] px-4 rounded-lg text-sm font-semibold bg-accent-500 text-white hover:bg-accent-600 disabled:opacity-50">
              Look up
            </button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  )
}
