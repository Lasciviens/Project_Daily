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
  /** opaque = Busy (default), transparent = Free (155). */
  transparency?: 'opaque' | 'transparent'
  htmlLink: string
  calendarId?: string  // attached client-side after fetch
  /** "cannot be modified after the event is created": default, birthday, focusTime, fromGmail, outOfOffice, workingLocation. */
  eventType?: string
  /** `self`: "Whether the organizer corresponds to the calendar on which this copy of the event appears". */
  organizer?: { email?: string; self?: boolean }
  /** "Whether attendees other than the organizer can modify the event" (default false). */
  guestsCanModify?: boolean
  /** "a locked event copy where no changes can be made to the main event fields". */
  locked?: boolean
}

export interface CalendarListEntry {
  id: string
  summary: string
  primary?: boolean
  backgroundColor?: string
  /** "The effective access role that the authenticated user has on the calendar": freeBusyReader, reader, writerWithoutPrivateAccess, writer, owner. */
  accessRole?: string
}
