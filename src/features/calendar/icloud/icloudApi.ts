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
  /** Changes from Apple Calendar (2c), per area calendar read so far: when last read, and its last problem. */
  readBack?: Partial<Record<AreaKey, { syncedAt: string | null; problem: string | null }>>
  /** Events that couldn't be sent yet (each item's own problem, tried again later): how many, and the newest reason. */
  notSent?: { count: number; reason: string | null } | null
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
/** A new app-specific password for the Apple ID already connected (the server keeps the Apple ID). */
export const renewICloudPassword = (appPassword: string) => call<ICloudStatus>('connect', { renew: true, appPassword })

/** Connecting needs a password sign-in this recent (the server checks the same: icloud-calendar FRESH_SIGN_IN_MS). */
export const FRESH_SIGN_IN_MS = 10 * 60_000

/** Whether this session signed in with the password recently enough to connect: read from the token's `amr` claim, as
 *  the server does — so the owner signs in again BEFORE making an Apple password (Apple shows it only once). */
export async function signedInFreshly(): Promise<boolean> {
  const { data } = await supabase.auth.getSession()
  const part = data.session?.access_token.split('.')[1]
  if (!part) return false
  try {
    const claims = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=')))
    const at = (Array.isArray(claims.amr) ? claims.amr : [])
      .filter((m: { method?: unknown }) => m?.method === 'password')
      .map((m: { timestamp?: unknown }) => Number(m?.timestamp) * 1000).filter(Number.isFinite)
    return at.length > 0 && Date.now() - Math.max(...at) < FRESH_SIGN_IN_MS
  } catch {
    return false
  }
}
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
