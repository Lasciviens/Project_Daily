export interface CalendarEvent {
  id: string
  summary: string
  description?: string
  location?: string
  start: { dateTime?: string; date?: string; timeZone?: string }
  end:   { dateTime?: string; date?: string; timeZone?: string }
  colorId?: string
  htmlLink: string
  calendarId?: string  // attached client-side after fetch
}

export interface CalendarListEntry {
  id: string
  summary: string
  primary?: boolean
  backgroundColor?: string
}
