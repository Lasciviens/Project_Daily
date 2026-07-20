export type HapticKind = 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error'

const PATTERNS: Record<HapticKind, number | number[]> = {
  light: 8,
  medium: 15,
  heavy: 25,
  success: [10, 40, 10],
  warning: [15, 60, 15],
  error: [20, 80, 20],
}

/** Fire a short device vibration, silently no-op when the Vibration API is unavailable. */
export function haptic(kind: HapticKind = 'light'): void {
  if (typeof navigator === 'undefined' || !('vibrate' in navigator)) return
  try {
    navigator.vibrate(PATTERNS[kind])
  } catch {
    // Vibration API can throw in some embedded/insecure contexts — feedback is best-effort.
  }
}
