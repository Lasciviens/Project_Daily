// What a save says about its item's Apple Calendar copy (2b-2). The server writes that copy from the queue after the
// save answered (icloud-calendar's drain), so the save names its item: the drain sends that item's queued row first
// and answers what happened to it (03.11.2026 — the owner: "the task did not come over to apple calendar"; it came,
// minutes later, and nothing said why). A warning gives the item's own reason and promises a retry only when one
// comes. Pure, so verify-icloud-events runs it.
import { formatDate, formatTime } from '../../../shared/utils/dateFormat'

/** The item a save names for the drain: its slot or its repeating plan (the queue's own kinds, by the row's id). */
export interface DrainItemRef { entity: 'slot' | 'plan'; id: string }

export const DRAIN_ITEM_STATUSES = ['sent', 'kept', 'removed', 'none', 'failed', 'waiting', 'not-queued'] as const
/**
 * What the drain did with it: sent (in Apple Calendar), kept (its Apple copy waits for the copy that replaces it),
 * removed, none (it doesn't go to Apple Calendar now), failed (tried now), waiting (tried moments ago by another run:
 * it waits for its retry) or not-queued (nothing waited to be sent for it).
 */
export type DrainItemStatus = typeof DRAIN_ITEM_STATUSES[number]

export interface DrainItemOutcome {
  status: DrainItemStatus
  /** Its own problem (failed, waiting). */
  error: string | null
  /** When its row is tried again (failed, waiting). */
  retryAt: string | null
}

/** The server's answer for the item, checked where it enters: null when there is none (an older server) or it isn't
 *  one this app knows. */
export function drainItemOutcome(raw: unknown): DrainItemOutcome | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!(DRAIN_ITEM_STATUSES as readonly unknown[]).includes(r.status)) return null
  const error = typeof r.error === 'string' && r.error.trim() ? r.error.trim().slice(0, 300) : null
  const retryAt = typeof r.retryAt === 'string' && Number.isFinite(Date.parse(r.retryAt)) ? r.retryAt : null
  return { status: r.status as DrainItemStatus, error, retryAt }
}

/** What the save's send to Apple Calendar came back with (appleAreas.drainICloudNow). */
export interface AppleSend {
  item: DrainItemOutcome | null
  /** The call itself failed (not connected, the password refused, iCloud's limit): why. */
  problem: string | null
  /** Another run was sending the queue every time the save asked. */
  busy: boolean
}

/** Why, in brackets: the item's own reason, else the call's, else that another send was running. */
function why(s: AppleSend): string {
  const text = s.item?.error ?? s.problem ?? (s.busy ? 'another send was running' : null)
  return text ? ` (${text})` : ''
}

/** When it is tried again: after its row's own retry time ("after 14:34", another day with its date), else within
 *  minutes (the next send — a save, the app's opening, the 5-minute timer). */
export function retryWhen(retryAt: string | null, now: Date): string {
  const at = retryAt ? new Date(retryAt) : null
  if (!at || Number.isNaN(at.getTime()) || at.getTime() <= now.getTime()) return 'it is tried again within minutes'
  return `it is tried again after ${formatDate(at) === formatDate(now) ? '' : `${formatDate(at)} `}${formatTime(at)}`
}

/** The server says it doesn't go to Apple Calendar now: no retry will send it. */
const notForApple = (s: AppleSend) => s.item?.status === 'none' || s.item?.status === 'removed'

/**
 * The warning after a save whose item wants a calendar but isn't in Apple Calendar yet. `keepsGoogleTask`: it moved
 * from Google Tasks to Calendar, and its Google Task stays until the Apple copy is confirmed.
 */
export function notInAppleText(s: AppleSend & { keepsGoogleTask: boolean; now: Date }): string {
  const task = s.keepsGoogleTask ? ', so its Google Task stays' : ''
  if (notForApple(s)) return `Saved · not sent to Apple Calendar — its area (Settings → Calendar) or its calendar choice doesn't send it there now${task}.`
  if (s.item?.status === 'not-queued') return `Saved · not in Apple Calendar — nothing waits to be sent for it${task}; a change to it sends it.`
  if (s.keepsGoogleTask) return `Apple Calendar hasn't confirmed the event yet${why(s)}, so the Google Task stays for now — save the item again to finish the move.`
  return `Saved · not in Apple Calendar yet${why(s)} — ${retryWhen(s.item?.retryAt ?? null, s.now)}.`
}

/**
 * The warning after a save whose item no longer wants a calendar but whose Apple Calendar copy is still there.
 * `toTasks`: it moved to Google Tasks, and the Apple copy stays until the Google Task exists.
 */
export function stillInAppleText(s: AppleSend & { toTasks: boolean; now: Date }): string {
  if (s.toTasks && (!s.item || s.item.status === 'kept')) return 'Google Tasks hasn\'t confirmed its copy yet, so the Apple Calendar event stays until it has.'
  if (s.item?.status === 'not-queued') return 'Saved · its Apple Calendar event isn\'t removed — nothing waits to remove it; a change to it does.'
  return `Saved · its Apple Calendar event isn't removed yet${why(s)} — ${retryWhen(s.item?.retryAt ?? null, s.now)}.`
}
