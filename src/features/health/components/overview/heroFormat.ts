import type { Tone } from '../../../../shared/ui'

// Signed-number formatting for the Health page's change lines. A real minus
// sign (−), en-GB thousands separators.

export function signed(v: number, decimals = 0): string {
  const r = Number(v.toFixed(decimals))
  const abs = Math.abs(r).toLocaleString('en-GB', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  return r > 0 ? `+${abs}` : r < 0 ? `−${abs}` : `±${abs}`
}

export function num(v: number | null | undefined, decimals = 0): string {
  return v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('en-GB', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

/** "7h 05m" — hours as h + zero-padded minutes. */
export function hm(hours: number | null | undefined): string {
  if (hours == null || !Number.isFinite(hours)) return '—'
  const total = Math.round(hours * 60)
  return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, '0')}m`
}

/** "+25m" / "−1h 10m" for a change in hours. */
export function signedHm(hours: number): string {
  const total = Math.round(hours * 60)
  const abs = Math.abs(total)
  const body = abs >= 60 ? `${Math.floor(abs / 60)}h ${String(abs % 60).padStart(2, '0')}m` : `${abs}m`
  return `${total > 0 ? '+' : total < 0 ? '−' : '±'}${body}`
}

/** Tone for a change: success when it moves the good way by at least
 *  `threshold`, warn the other way, neutral inside the noise. Direction null
 *  (a range is best) is always neutral. */
export function changeTone(delta: number | null, good: 'up' | 'down' | null, threshold: number): Tone {
  if (delta == null || good == null || Math.abs(delta) < threshold) return 'neutral'
  return (delta > 0) === (good === 'up') ? 'success' : 'warn'
}
