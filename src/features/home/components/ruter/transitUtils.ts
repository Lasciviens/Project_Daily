// Shared display helpers for transit widgets.
// Keep pure — no React, no API calls, no side effects.
import type React from 'react'

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

export function fmtDuration(seconds: number): string {
  const m = Math.round(seconds / 60)
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`
}

export function fmtDistance(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`
}

// Returns "HH:mm" for the last-updated timestamp shown near the refresh button
export function fmtLastUpdated(timestamp: number): string {
  return fmtTime(new Date(timestamp).toISOString())
}

const DAYS   = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Smart departure label for TripCard header.
// < 90 min: "Leave in X min" / "Departing now"
// Same day: "Leave at HH:MM"
// Tomorrow: "Leave tomorrow HH:MM"
// Further:  "Leave Tue 9 Jun HH:MM"
export function fmtTripDeparture(iso: string, now: number): string {
  const depMs   = new Date(iso).getTime()
  const diffMin = Math.round((depMs - now) / 60_000)

  if (diffMin <= 0)  return 'Departing now'
  if (diffMin <= 90) return `Leave in ${diffMin} min`

  const dep     = new Date(iso)
  const nowDate = new Date(now)
  const time    = fmtTime(iso)

  if (dep.toDateString() === nowDate.toDateString()) return `Leave at ${time}`

  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  if (dep.toDateString() === tomorrow.toDateString()) return `Leave tomorrow ${time}`

  return `Leave ${DAYS[dep.getDay()]} ${dep.getDate()} ${MONTHS[dep.getMonth()]} ${time}`
}
