import { useEffect, useState } from 'react'

// On iOS/Android the on-screen keyboard shrinks the VISUAL viewport but not the
// LAYOUT viewport, so a bottom-anchored input/sheet stays pinned behind the
// keyboard unless something measures the overlap and lifts it. The only reliable
// signal is window.visualViewport (the layout viewport gives nothing here): its
// height + offsetTop describe the currently-visible slice, and the difference
// against the layout height is exactly how many px the keyboard is covering.
// SSR / older browsers (no VisualViewport) are safe — the hook just reports 0.
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0)

  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : undefined
    if (!vv) return

    const update = () => {
      const covered = window.innerHeight - (vv.height + vv.offsetTop)
      setInset(Math.max(0, Math.round(covered)))
    }

    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])

  return inset
}

// Blur the focused text control so the keyboard retracts — e.g. tapping a
// sheet backdrop should dismiss the keyboard, not (only) close the sheet.
export function dismissKeyboard(): void {
  if (typeof document === 'undefined') return
  const el = document.activeElement
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.blur()
}
