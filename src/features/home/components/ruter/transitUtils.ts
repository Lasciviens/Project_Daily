// Shared display helpers for transit widgets.
// Keep pure — no React, no API calls, no side effects.
import type React from 'react'
import type { Departure, Situation } from '../../api/ruterApi'
import { formatDurationSeconds } from '../../../../shared/utils/formatDuration'

// Converts EnTur presentation colour (hex without #) to inline CSS style object.
// Falls back to null when no presentation data is available.
export function lineStyle(colour?: string, textColour?: string): React.CSSProperties | null {
  if (!colour) return null
  return {
    backgroundColor: `#${colour}`,
    color:           textColour ? `#${textColour}` : LINE_BADGE_TEXT,
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

// Identity colours (THEME.md §2.5): the operator's own line colours, used
// when EnTur sends no presentation colour for a line.
export const MODE_FALLBACK_BG: Record<string, string> = {
  bus:   '#E8112D',   // Ruter red
  tram:  '#E8112D',
  metro: '#E8112D',
  rail:  '#4A4A4A',
  ferry: '#0066CC',
}
const UNKNOWN_MODE_BG = '#555555'
const LINE_BADGE_TEXT = '#ffffff'

export function modeFallbackStyle(mode: string): React.CSSProperties {
  return { backgroundColor: MODE_FALLBACK_BG[mode] ?? UNKNOWN_MODE_BG, color: LINE_BADGE_TEXT }
}

export function fmtDistance(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`
}

// Returns "HH:mm" for the last-updated timestamp shown near the refresh button
export function fmtLastUpdated(timestamp: number): string {
  return fmtTime(new Date(timestamp).toISOString())
}

// "just now" / "Xm ago" — used where a cached value's age matters (e.g. reused
// geolocation) so the user can judge whether to force a fresh read instead.
export function fmtMinsAgo(timestamp: number, now: number): string {
  const mins = Math.max(0, Math.round((now - timestamp) / 60_000))
  return mins < 1 ? 'just now' : `${mins}m ago`
}

export interface LineGroup {
  line:            string
  destination:     string
  transport:       string
  lineColour?:     string
  lineTextColour?: string
  realtime:        boolean
  aimed:           string
  expected:        string
  situations:      Situation[]
  departures:      Departure[]
}

export function buildLineGroups(deps: Departure[]): LineGroup[] {
  const map = new Map<string, LineGroup>()
  for (const dep of deps) {
    const key = `${dep.line}::${dep.destination}`
    if (!map.has(key)) {
      map.set(key, {
        line:          dep.line,
        destination:   dep.destination,
        transport:     dep.transport,
        lineColour:    dep.lineColour,
        lineTextColour:dep.lineTextColour,
        realtime:      dep.realtime,
        aimed:         dep.aimed,
        expected:      dep.expected,
        situations:    dep.situations,
        departures:    [dep],
      })
    } else {
      map.get(key)!.departures.push(dep)
    }
  }
  return Array.from(map.values())
}

// EnTur's Severity enum → tone: severe = danger, slight/normal = warn, else neutral.
export function situationTone(severity: string): 'danger' | 'warn' | 'neutral' {
  if (severity === 'severe' || severity === 'verySevere') return 'danger'
  if (severity === 'slight' || severity === 'normal') return 'warn'
  return 'neutral'
}
