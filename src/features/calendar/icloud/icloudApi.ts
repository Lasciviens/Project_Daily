// iCloud Calendar, Phase 1 — the Apple check (docs/integrations/icloud-caldav.md).
// Every call goes through the `icloud-calendar` function: the app-specific
// password is sent once (connect) and is never read back.
import { supabase } from '../../../integrations/supabase/client'
import { parseFunctionErrorBody } from '../../../shared/utils/functionError'
import type { AreaKey } from '../areas/calendarAreas'

export interface ICloudStatus {
  connected:    boolean
  /** "o…@example.com" */
  appleId?:     string
  connectedAt?: string
  lastError?:   string | null
  hasTest?:     boolean
  /** The test calendar is the one the app made (Remove deletes it whole), not one the owner made. */
  testIsApps?:  boolean
  /** The last Apple check, kept on the server so the card still shows it after a trip to the Calendar app. */
  lastCheck?:   ICloudCheck | null
  /** Which areas have their calendar in iCloud (Settings → Calendar, 172). */
  areas?:       Partial<Record<AreaKey, { ready: boolean }>>
  /** The stored app-specific password is sealed (AES-GCM). */
  passwordSealed?: boolean
}

/** Create in Apple Calendar: what happened to each area's calendar. */
export interface ICloudSetup {
  areas: { area: AreaKey; name: string; state: 'created' | 'updated' | 'found' | 'off' | 'failed'; detail?: string }[]
}

/** One drain of the queue (2b): what happened to each item; busy = another run is sending it right now. */
export type ICloudDrain = { busy: true } | {
  /** Written to Apple Calendar. */
  put: number
  /** Written there, and its Google Calendar copy handed to Google's delete queue (2b-2). */
  moved: number
  /** Written there, but its Google Calendar copy has an id the app didn't make: it stays there (remove it by hand). */
  foreign: number
  /** Its Apple copy waits for the copy that replaces it (a Google Calendar event, or a Google Task). */
  kept: number
  removed: number
  none: number
  failed: number
  /** Still queued (failed ones wait for their retry, the rest for the next run). */
  waiting: number
  /** Changes made in Apple Calendar read back first (2c): how many the app took, and calendars renamed there. */
  readBack?: { applied: number; ignored: number; failed: number; calendars: number; calendarsRenamed: number; problem: string | null }
}

/** An area's items for Apple Calendar: counted (dryRun) or queued. partial = more than one call reads. */
export interface ICloudMove { slots: number; plans: number; queued: boolean; partial: boolean }

export interface ICloudStep { step: string; ok: boolean; detail: string }

export interface ICloudCheckEvent {
  key:     string
  label:   string
  written: boolean
  status:  number
  /** What iCloud kept of the features this event carries (null: not read back). */
  kept:    Record<string, boolean> | null
}

export interface ICloudCheck {
  steps:          ICloudStep[]
  calendar?:      string
  /** yyyy-MM-dd: the day the test events are on. */
  day?:           string
  needsCalendar?: boolean
  message?:       string
  events?:        ICloudCheckEvent[]
}

export interface ICloudChanges {
  tokenWorked: boolean
  message?:    string
  changes:     { kind: 'changed' | 'removed'; title: string; starts: string }[]
}

export interface ICloudReadRow {
  calendar:   string
  /** The calendar's own colour (#RRGGBB) as Apple Calendar shows it. */
  color:      string | null
  /** HH:MM on the Oslo clock; null = all day. */
  time:       string | null
  title:      string
  repeats:    boolean
  invitation: boolean
  /** A zone the server didn't know: the time is as written there. */
  zone:       string | null
  /** yyyy-MM-dd: began before this day (a trip), or where a series began. */
  since:      string | null
}

/** Read my calendars: the owner's own iCloud calendars, today and the next 6 days. Shown, never stored. */
export interface ICloudRead {
  fromDay:   string
  toDay:     string
  /** iCloud split repeating events into their days; null = nothing repeats this week. */
  expanded:  boolean | null
  calendars: { name: string; color: string | null; count: number; problem: string | null }[]
  /** Calendars past the read limit. */
  skipped:   number
  /** No calendar found: what iCloud listed, by kind only ("collection calendar [VTODO]"). */
  listing?:  string[] | null
  days:      { day: string; events: ICloudReadRow[]; more: number }[]
  /** Repeating events iCloud gave as one series (their days not worked out). */
  series:    ICloudReadRow[]
}

async function call<T>(action: string, extra: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke('icloud-calendar', { body: { action, ...extra } })
  if (error) {
    const body = await parseFunctionErrorBody(error)
    throw new Error(typeof body?.error === 'string' ? body.error : 'iCloud could not be reached')
  }
  return data as T
}

export const fetchICloudStatus = () => call<ICloudStatus>('status')
export const connectICloud = (appleId: string, appPassword: string) => call<ICloudStatus>('connect', { appleId, appPassword })
export const disconnectICloud = () => call<ICloudStatus>('disconnect')
export const runICloudCheck = () => call<ICloudCheck>('check')
export const fetchICloudChanges = () => call<ICloudChanges>('changes')
export const readICloudCalendars = () => call<ICloudRead>('read')
export const setupICloudCalendars = () => call<ICloudSetup>('setup')
/** `look`: also bring calendar names and colours back from the iPhone (the app's opening; a save skips it, for speed). */
export const drainICloudQueue = (look = false) => call<ICloudDrain>('drain', { look })
/** Where the items come from: today on, or every day they have. */
export const moveAreaToApple = (area: AreaKey, from: 'today' | 'all', dryRun: boolean) => call<ICloudMove>('move', { area, from, dryRun })
/** What Remove took: the whole calendar the app made, or only the check's events from one the owner made. */
export const removeICloudTest = () => call<{ removed: 'calendar' | 'events' | null; message?: string }>('remove')
