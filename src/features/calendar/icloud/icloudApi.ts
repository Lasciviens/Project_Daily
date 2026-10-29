// iCloud Calendar, Phase 1 — the Apple check (docs/integrations/icloud-caldav.md).
// Every call goes through the `icloud-calendar` function: the app-specific
// password is sent once (connect) and is never read back.
import { supabase } from '../../../integrations/supabase/client'
import { parseFunctionErrorBody } from '../../../shared/utils/functionError'

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
}

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
/** What Remove took: the whole calendar the app made, or only the check's events from one the owner made. */
export const removeICloudTest = () => call<{ removed: 'calendar' | 'events' | null; message?: string }>('remove')
