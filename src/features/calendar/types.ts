export interface CalendarEvent {
  id: string
  summary: string
  description?: string
  location?: string
  start: { dateTime?: string; date?: string; timeZone?: string }
  end:   { dateTime?: string; date?: string; timeZone?: string }
  colorId?: string
  /** 'cancelled' = deleted; Google keeps it under its id until it is purged. */
  status?: 'confirmed' | 'tentative' | 'cancelled'
  /** A repeating event's RRULE / RDATE / EXDATE lines (the series itself only). */
  recurrence?: string[]
  /** On an instance of a repeating event: the series' id (147 de-dupes by it). */
  recurringEventId?: string
  htmlLink: string
  calendarId?: string  // attached client-side after fetch
}

export interface CalendarListEntry {
  id: string
  summary: string
  primary?: boolean
  backgroundColor?: string
}
