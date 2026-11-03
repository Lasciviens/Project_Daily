// What a save says about its item's Apple Calendar copy (2b-2). The server writes that copy from the queue after the
// save answered (icloud-calendar's drain), so the save names its rows: the drain sends them first and answers what
// happened to each (03.11.2026 — the owner: "the task did not come over to apple calendar"; it came, minutes later,
// and nothing said why). A warning is one short line: the item's own reason, then where the owner has to act — or,
// only when a retry can help, when it comes. Pure, so verify-calendar-areas runs it.
import { formatDate, formatTime } from '../../../shared/utils/dateFormat'

/** One queued row a save names: its slot or its repeating plan (the queue's own kinds, by the row's id). */
export interface DrainItemRef { entity: 'slot' | 'plan'; id: string }

/** The most rows a save names (the server refuses more): a "This day" edit's plan and its day, or a replaced row and
 *  the new one. The item itself is always the last. */
export const MAX_DRAIN_ITEMS = 3

/**
 * The rows a save queued for Apple Calendar, in the order they must arrive, the item itself last: what goes away
 * before what comes, so a day never shows twice for minutes — a "This day" edit's series (its EXDATE) before the
 * day's own event, a repeat turned into a one-off's old series before the new event, a one-off turned into a
 * repeat's old event (the slot the screen opened with) before the new series. The server sends only rows already
 * queued for this account; a row named that isn't queued only reads "not-queued".
 */
export function appleRowsOf(answer: { occurrence: boolean; scheduleBlockId: string | null; replacedScheduleBlockId: string | null },
  main: DrainItemRef, editedBlockId: string | null): DrainItemRef[] {
  const before: DrainItemRef[] = []
  if (main.entity === 'slot' && answer.occurrence && answer.scheduleBlockId) before.push({ entity: 'plan', id: answer.scheduleBlockId })
  if (main.entity === 'slot' && answer.replacedScheduleBlockId) before.push({ entity: 'plan', id: answer.replacedScheduleBlockId })
  if (main.entity === 'plan' && editedBlockId) before.push({ entity: 'slot', id: editedBlockId })
  const rows: DrainItemRef[] = []
  for (const r of [...before, main]) if (!rows.some(x => x.entity === r.entity && x.id === r.id)) rows.push(r)
  return rows.slice(-MAX_DRAIN_ITEMS)
}

export const DRAIN_ITEM_STATUSES = ['sent', 'kept', 'removed', 'none', 'failed', 'waiting', 'not-queued'] as const
/**
 * What the drain did with a named row: sent (in Apple Calendar), kept (its Apple copy waits for the copy that
 * replaces it), removed, none (it doesn't go to Apple Calendar now), failed (tried now), waiting (tried moments ago by
 * another run: it waits for its retry) or not-queued (nothing waited to be sent for it). The same list as the
 * server's (verify-calendar-areas compares them).
 */
export type DrainItemStatus = typeof DRAIN_ITEM_STATUSES[number]

export interface DrainItemOutcome {
  status: DrainItemStatus
  /** Its own problem (failed, waiting). */
  error: string | null
  /** When its row is tried again (failed, waiting). */
  retryAt: string | null
}

/** One row's answer from the server, checked where it enters: null when it isn't one this app knows. */
export function drainItemOutcome(raw: unknown): DrainItemOutcome | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!(DRAIN_ITEM_STATUSES as readonly unknown[]).includes(r.status)) return null
  const error = typeof r.error === 'string' && r.error.trim() ? r.error.trim().slice(0, 300) : null
  const retryAt = typeof r.retryAt === 'string' && Number.isFinite(Date.parse(r.retryAt)) ? r.retryAt : null
  return { status: r.status as DrainItemStatus, error, retryAt }
}

/** The answer for one named row among the server's `items` (matched by kind and id): null when there is none. */
export function outcomeFor(items: unknown, ref: DrainItemRef): DrainItemOutcome | null {
  if (!Array.isArray(items)) return null
  const hit = items.find(x => !!x && typeof x === 'object' && (x as Record<string, unknown>).entity === ref.entity && (x as Record<string, unknown>).id === ref.id)
  return drainItemOutcome(hit)
}

/** What the save's send to Apple Calendar came back with (appleAreas.drainICloudNow). */
export interface AppleSend {
  item: DrainItemOutcome | null
  /** The call itself failed (not connected, the password refused, iCloud's limit): why. */
  problem: string | null
  /** Another run was sending the queue every time the save asked. */
  busy: boolean
}

/** How long these warnings stay: a reason and a time need reading (a plain warning goes after 3 s). */
export const APPLE_WARNING_MS = 8000

/** The server's own texts that a retry can't fix, or that say one comes — exact copies of icloud-calendar's
 *  (verify-calendar-areas compares them), each said here in a few words. */
export const SERVER_TEXT = {
  auth: 'Apple did not accept the Apple ID or app-specific password',
  noCalendars: 'Make the area calendars first: Settings → Calendar → Create in Apple Calendar',
  appFault: 'The app could not build this event — a fault in the app, not in iCloud',
  appStep: 'Something went wrong in the app, not in iCloud',
  busy: 'iCloud asked the app to wait (too many requests) — tried again in a few minutes',
} as const

/** A reason in a few words, and where the owner has to act first (null: a retry can help, so it says when). */
export function reasonOf(text: string): { words: string; act: string | null } {
  if (text === SERVER_TEXT.auth) return { words: 'Apple refused the password', act: 'Settings → Subscriptions' }
  if (text === SERVER_TEXT.noCalendars) return { words: 'its area calendars are missing', act: 'Settings → Calendar' }
  if (text === SERVER_TEXT.appFault || text === SERVER_TEXT.appStep) return { words: 'a fault in the app, not iCloud', act: 'needs a fix' }
  if (text === SERVER_TEXT.busy) return { words: 'iCloud asked the app to wait', act: null }
  // One of the event rules' guards ("An event line holds a control character — not written"): the item's own text.
  const guard = /^(.+) — not written$/.exec(text)
  if (guard) return { words: guard[1].charAt(0).toLowerCase() + guard[1].slice(1), act: 'change the item' }
  if (/failed to fetch|load failed|networkerror|network request failed/i.test(text)) return { words: 'no connection to the server', act: null }
  // "iCloud answered 500 when an event was written" → "iCloud error 500": the code is what matters on a phone.
  const status = /^iCloud answered (\d{3})\b/.exec(text)
  if (status) return { words: `iCloud error ${status[1]}`, act: null }
  return { words: text.length > 48 ? `${text.slice(0, 47)}…` : text, act: null }
}

/** When it is tried again: its row's own retry time ("next try 14:34", another day with its date), else the next
 *  send (a save, the app's opening, the 5-minute timer). */
export function retryWhen(retryAt: string | null, now: Date): string {
  const at = retryAt ? new Date(retryAt) : null
  if (!at || Number.isNaN(at.getTime()) || at.getTime() <= now.getTime()) return 'next try within minutes'
  return `next try ${formatDate(at) === formatDate(now) ? '' : `${formatDate(at)} `}${formatTime(at)}`
}

/** "<lead>: <reason> · <where to act | next try …>": one reason, and one retry phrase only where a retry can help. */
function withReason(lead: string, s: AppleSend, now: Date): string {
  const text = s.item?.error ?? s.problem ?? (s.busy ? 'another send was running' : null)
  if (!text) return `${lead} yet · ${retryWhen(s.item?.retryAt ?? null, now)}`
  const r = reasonOf(text)
  return `${lead}: ${r.words} · ${r.act ?? retryWhen(s.item?.retryAt ?? null, now)}`
}

/**
 * The warning after a save whose item wants a calendar but isn't confirmed in Apple Calendar. `keepsGoogleTask`: it
 * moved from Google Tasks to Calendar, and its Google Task stays until the Apple copy is confirmed (a later save
 * finishes the move).
 */
export function notInAppleText(s: AppleSend & { keepsGoogleTask: boolean; now: Date }): string {
  const task = s.keepsGoogleTask ? ' · Google Task kept' : ''
  const st = s.item?.status
  if (st === 'none' || st === 'removed') return `Not sent to Apple Calendar: its calendar doesn't go there · Settings → Calendar${task}`
  if (st === 'not-queued') return `Not in Apple Calendar: nothing is queued for it · save it again${task}`
  if (st === 'sent' || st === 'kept') return `Sent to Apple Calendar · not confirmed yet${task}`
  return `${withReason('Not in Apple Calendar', s, s.now)}${task}`
}

/**
 * The warning after a save whose item no longer wants a calendar but whose Apple Calendar copy is still there.
 * `toTasks`: it moved to Google Tasks, and the Apple copy stays until the Google Task exists.
 */
export function stillInAppleText(s: AppleSend & { toTasks: boolean; now: Date }): string {
  if (s.toTasks && (!s.item || s.item.status === 'kept')) return 'Apple Calendar event stays until Google Tasks has its copy'
  if (s.item?.status === 'not-queued') return 'Apple Calendar event not removed: nothing is queued · save it again'
  if (s.item?.status === 'removed') return 'Apple Calendar event removed · not confirmed yet'
  return withReason('Apple Calendar event not removed', s, s.now)
}
