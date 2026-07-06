// Shared display helpers for transit widgets.
// Keep pure — no React, no API calls, no side effects.
import type React from 'react'
import { formatDurationSeconds } from '../../../../shared/utils/formatDuration'

// Converts EnTur presentation colour (hex without #) to inline CSS style object.
// Falls back to null when no presentation data is available.
export function lineStyle(colour?: string, textColour?: string): React.CSSProperties | null {
  if (!colour) return null
  return {
    backgroundColor: `#${colour}`,
    color:           textColour ? `#${textColour}` : '#ffffff',
  }
}

export function minsUntil(iso: string, now: number): number {
  return Math.round((new Date(iso).getTime() - now) / 60_000)
}

export function fmtTime(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export const fmtDuration = formatDurationSeconds

export const MODE_FALLBACK_BG: Record<string, string> = {
  bus:   '#E8112D',   // Ruter red
  tram:  '#E8112D',
  metro: '#E8112D',
  rail:  '#4A4A4A',
  ferry: '#0066CC',
}

export function fmtDistance(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`
}

// Returns "HH:mm" for the last-updated timestamp shown near the refresh button
export function fmtLastUpdated(timestamp: number): string {
  return fmtTime(new Date(timestamp).toISOString())
}

