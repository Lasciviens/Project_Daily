import { useEffect, useRef, useState } from 'react'
import { ModalShell } from '../../../shared/modals/ModalShell'
import { Button } from '../../../shared/ui'

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

  const submitManual = () => { if (manual.length >= 6) { stopRef.current(); onDetected(manual) } }

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title="Scan barcode"
      size="sm"
      mobile="fullscreen"
      bodyClassName="p-0"
      footer={
        // Manual fallback — always available (some cameras/lighting just won't read a code).
        <div className="flex items-center gap-2">
          <input
            value={manual}
            onChange={e => setManual(e.target.value.replace(/\D/g, ''))}
            inputMode="numeric"
            aria-label="Barcode number"
            placeholder="Or type the barcode number"
            className="input flex-1 tabular-nums"
            onKeyDown={e => { if (e.key === 'Enter') submitManual() }}
          />
          <Button variant="primary" disabled={manual.length < 6} onClick={submitManual}>Look up</Button>
        </div>
      }
    >
      {/* Always-dark camera well: video reads best on black in both themes. */}
      <div className="relative flex aspect-[4/3] items-center justify-center bg-scrim">
        <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
        {status === 'scanning' && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-24 w-3/4 rounded-lg border-2 border-accent-400/80 shadow-[0_0_0_9999px_rgb(0_0_0/0.35)]" />
          </div>
        )}
        {status === 'starting' && <p className="absolute text-body text-white">Starting camera…</p>}
        {status === 'error' && <p className="absolute px-6 text-center text-body text-white">Camera unavailable. Enter the barcode number below instead.</p>}
      </div>
    </ModalShell>
  )
}
