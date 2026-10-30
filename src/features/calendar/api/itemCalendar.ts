import { toast, useCalendarStore } from '../../../app/store'
import { logError } from '../../../shared/utils/logError'
import { todayStr } from '../../../shared/utils/dateUtils'
import { LOCAL_TZ } from '../../../shared/components/plan-modal/planModal.config'
import {
  clearTimeBlockCalendarLinkIfMatches, fetchScheduleBlock, fetchTimeBlockByTaskId, fetchTimeBlockWithTask, updateTimeBlock,
} from '../../daily/api/scheduleApi'
import { classifyCalendarPushFailure, type TimeBlockCalendarStatus } from '../../daily/api/scheduleSyncRules'
import { fetchTaskById, updateTask } from '../../todo/api/tasksApi'
import { drainGoogleTasksOutbox } from '../../todo/api/googleTasksOutbox'
import type { RepeatDayAnswer, SaveItemAnswer } from '../../items/itemApi'
import { dropItemBlock, setRepeatDaysGoogleTasks } from '../../items/itemApi'
import type { GoogleTarget } from '../../items/itemTypes'
import { blockEventBody, eventPatchFor, type EventPushFields } from '../calendarEventRules'
import { updateCalendarEvent } from './calendarApi'
import { ensureLinkedCalendarEventRemoved, ensureValidCalendarToken } from './calendarTokenSync'
import { linkBlockCalendarEvent } from './linkBlockCalendarEvent'
import {
  carryOccurrenceToCalendar, putSkippedDayBackOnCalendar, syncScheduleSeriesAfterSave, takeSkippedDayOffCalendar,
} from './scheduleSeriesCalendar'
import { anyAreaOnAppleNow, appleAreaNow, appleAreaOf, drainICloudNow, drainICloudSoon, slotAreaInput } from '../areas/appleAreas'
import type { AreaKey } from '../areas/calendarAreas'

// ─────────────────────────────────────────────────────────────────────────────
//  One item on Google (migration 155) — what the browser does after the
//  database saved it (app_save_item writes rows only; a trigger has no
//  Google token). The same rules as every other Calendar call: a token from
//  ensureValidCalendarToken(), the typed 'linked' | 'not_linked' | 'unknown'
//  status from Google's real HTTP status, a failure never undoes the save.
//
//  Moving an item between Google Tasks and Google Calendar: the NEW copy is
//  made and confirmed first, only then the old one goes; an 'unknown' answer
//  removes nothing (the item shows in both until the next save finishes it).
//    → Calendar: the event is linked; on 'linked' Google Tasks is turned off
//      (the outbox deletes the Google Task).
//    → Tasks: the database turned Google Tasks on (the outbox creates it);
//      the outbox is drained now and the task read again — only with its
//      Google Task id there does the event go (and an all-day presence slot
//      after it).
//  A done item's event has "✓ " in front (calendarEventRules.calendarTitle);
//  reopening takes it off. A day of a repeat on its series gets no "✓ " when
//  its day's task (156) is ticked: that would need a PATCH of the series'
//  instance, which docs/integrations/google-calendar.md hasn't confirmed —
//  the series keeps the day as it is (a day split off, 142, has its own event
//  and gets the "✓ ").
//
//  A repeat (156) lives on Google as its series (calendar), as its days'
//  Google Tasks ("one per day": each day's task, made on its day, through
//  the outbox), both, or neither. Moving between them is the same rule: the
//  new copy first — the series confirmed 'linked', or today's day task's
//  Google Task id there — then the old one goes.
//
//  An item whose area is on Apple Calendar (2b-2) gets no Google Calendar
//  event: the save queued it (173–175's triggers) and the server writes its
//  Apple event — sent here at once, confirmed by the row's icloud_area. The
//  same rule holds: Google Tasks goes only once the Apple copy is there, and
//  the server keeps an Apple copy until its Google Task exists (the Google
//  Tasks outbox is drained first).
// ─────────────────────────────────────────────────────────────────────────────

const message = (err: unknown) => (err as Error)?.message ?? String(err)
const connected = () => !!useCalendarStore.getState().accessToken

/** Delivers the Google Tasks outbox now (best effort); false when it couldn't. */
async function drainTasks(): Promise<boolean> {
  if (!connected()) return false
  try {
    const token = await ensureValidCalendarToken()
    if (!token) return false
    const { failed } = await drainGoogleTasksOutbox(token)
    return failed === 0
  } catch (err) {
    logError(`Google Tasks outbox drain failed: ${message(err)}`, { action: 'item_google' })
    return false
  }
}

/**
 * Brings a slot's event up to date from the slot as it is (day, time, length,
 * Busy/Free, title with "✓ " when its task is done). `fields: 'title'`
 * sends ONLY the title (a done tick, a reopen): it never pushes the slot's
 * day back over a move made in Google Calendar. A confirmed 404/410 forgets
 * the link ('not_linked'); anything else unconfirmed is 'unknown'.
 */
export async function pushBlockCalendarEvent(blockId: string, fields: EventPushFields = 'all'): Promise<TimeBlockCalendarStatus> {
  const block = await fetchTimeBlockWithTask(blockId)
  const eventId = block?.google_calendar_event_id
  if (!block || !eventId) return 'not_linked'
  const token = await ensureValidCalendarToken()
  if (!token) return 'unknown'
  const body = blockEventBody(block, { done: block.task_status === 'done', timeZone: LOCAL_TZ })
  if (!body) return 'linked'
  try {
    await updateCalendarEvent(token, 'primary', eventId, { ...eventPatchFor(body, fields) })
    return 'linked'
  } catch (err) {
    if (classifyCalendarPushFailure(err) === 'not_linked') {
      try {
        await clearTimeBlockCalendarLinkIfMatches(blockId, eventId)
        return 'not_linked'
      } catch (clearErr) {
        logError(`Calendar: a stale event link not cleared: ${message(clearErr)}`, { blockId })
        return 'unknown'
      }
    }
    logError(`Calendar event update failed: ${message(err)}`, { blockId })
    return 'unknown'
  }
}

/** A task ticked done or reopened: its slot's event gains or loses "✓ " —
 *  the title ONLY. In the background (the calendar outbox's upsert is the
 *  safety net; an Apple Calendar event follows through its queue). */
export function refreshTaskEventSoon(taskId: string): void {
  drainICloudSoon()
  if (!connected()) return
  void (async () => {
    const block = await fetchTimeBlockByTaskId(taskId)
    if (block?.google_calendar_event_id) await pushBlockCalendarEvent(block.id, 'title')
  })().catch(err => logError(`Calendar: the done mark not updated: ${message(err)}`, { taskId }))
}

/** A plan's series brought up to date after one of its days changed — only
 *  when it is on Google already (never makes a series). In the background. */
export function refreshSeriesSoon(planId: string): void {
  if (!connected()) return
  void (async () => {
    const row = await fetchScheduleBlock(planId)
    if (row.google_calendar_event_id) await syncScheduleSeriesAfterSave(row, undefined)
  })().catch(err => logError(`Calendar series: not brought up to date: ${message(err)}`, { planId }))
}

/** True once the item's Google Task exists (its id is stored). */
async function googleTaskConfirmed(taskId: string): Promise<boolean> {
  await drainTasks()
  const task = await fetchTaskById(taskId)
  return !!task?.google_task_id
}

/** Removes a slot's event now (Google first, then the link). 'unknown' leaves both. */
async function unlinkBlockEvent(blockId: string): Promise<TimeBlockCalendarStatus> {
  try {
    const { calendarStatus } = await updateTimeBlock(blockId, { google_calendar_event_id: null })
    return calendarStatus
  } catch (err) {
    logError(`Calendar: an item's event not removed: ${message(err)}`, { blockId })
    return 'unknown'
  }
}

export interface ItemGoogleOutcome {
  /** The Calendar side after the save ('off' = not on Calendar, by choice). */
  calendar: TimeBlockCalendarStatus | 'off'
  /** Google Tasks sync on after the settle. */
  tasks: boolean
}

/** The area whose Apple calendar a saved item belongs in (null: Google Calendar), and its row there. */
async function appleSideOf(answer: SaveItemAnswer): Promise<{ area: AreaKey; table: 'time_blocks' | 'schedule_blocks'; id: string } | null> {
  if (!(await anyAreaOnAppleNow())) return null
  if (answer.scheduleBlockId && !answer.occurrence) {
    const row = await fetchScheduleBlock(answer.scheduleBlockId)
    const area = await appleAreaOf({ category: row.category, domain: row.domain })
    return area ? { area, table: 'schedule_blocks', id: row.id } : null
  }
  if (!answer.blockId) return null
  const block = await fetchTimeBlockWithTask(answer.blockId)
  const area = block ? await appleAreaOf(slotAreaInput(block)) : null
  return area && block ? { area, table: 'time_blocks', id: block.id } : null
}

/**
 * An item in an area on Apple Calendar, after its save: the queue goes to Apple now (Google Tasks first, so a
 * move to Tasks finds its Google Task), then the item's row says where its Apple copy is. A confirmed copy lets
 * the old Google Task go, exactly like a confirmed Google Calendar event.
 */
async function settleItemApple(answer: SaveItemAnswer, google: GoogleTarget, side: { area: AreaKey; table: 'time_blocks' | 'schedule_blocks'; id: string }): Promise<ItemGoogleOutcome> {
  const wantsCal = google === 'calendar' || google === 'both'
  const wantsTasks = google === 'tasks' || google === 'both'
  const outcome: ItemGoogleOutcome = { calendar: wantsCal ? 'unknown' : 'off', tasks: answer.googleSync }
  if (answer.googleSync || wantsTasks) await drainTasks()
  let sent = await drainICloudNow()
  // Another run is sending the queue (often the app's own opening): once more when it is done.
  if (sent.busy) { await new Promise(res => setTimeout(res, 3000)); sent = await drainICloudNow() }
  const why = sent.problem ? ` (${sent.problem})` : ''
  const now = await appleAreaNow(side.table, side.id)
  if (wantsCal) {
    outcome.calendar = now === side.area ? 'linked' : 'unknown'
    if (outcome.calendar === 'linked' && google === 'calendar') {
      if (side.table === 'schedule_blocks') {
        // A repeat on Calendar only: its days' Google Tasks go now its series is confirmed.
        await setRepeatDaysGoogleTasks(side.id, todayStr(), false)
        void drainTasks()
      } else if (answer.googleSync && answer.taskId && !answer.occurrence) {
        // (One day of a repeat leaves its Google Task as it is — as on Google Calendar.)
        await updateTask(answer.taskId, { google_sync_enabled: false })
        outcome.tasks = false
        void drainTasks()
      }
    } else if (outcome.calendar === 'unknown' && google === 'calendar' && answer.googleSync) {
      toast.warning(`Apple Calendar hasn't confirmed the event yet${why}, so the Google Task stays for now — save the item again to finish the move.`)
    } else if (outcome.calendar === 'unknown') {
      toast.warning(`Saved · not in Apple Calendar yet${why} — it is tried again within minutes.`)
    }
    return outcome
  }
  if (now) {
    // The server keeps the Apple copy until the Google Task is there; it goes on its own once it is.
    outcome.calendar = 'unknown'
    toast.warning(wantsTasks ? 'Google Tasks hasn\'t confirmed its copy yet, so the Apple Calendar event stays until it has.'
      : `Saved · its Apple Calendar event isn't removed yet${why} — it is tried again within minutes.`)
    return outcome
  }
  if (answer.blockToDrop && answer.blockToDrop === answer.blockId) {
    await dropItemBlock(answer.blockToDrop).catch(err => logError(`Item: a presence slot not dropped: ${message(err)}`, { blockId: answer.blockToDrop }))
  }
  return outcome
}

/**
 * After app_save_item: the item's Google Calendar side follows its Google
 * choice (Google Tasks follows through the outbox the database filled) — or,
 * in an area on Apple Calendar, its Apple side (settleItemApple).
 * Never throws; a failure is said once and logged.
 */
export async function settleItemGoogle(answer: SaveItemAnswer, google: GoogleTarget): Promise<ItemGoogleOutcome> {
  const wantsCal = google === 'calendar' || google === 'both'
  const wantsTasks = google === 'tasks' || google === 'both'
  const outcome: ItemGoogleOutcome = { calendar: wantsCal ? 'unknown' : 'off', tasks: answer.googleSync }
  try {
    // The row this save replaced: its event goes now (the calendar outbox
    // queued it as well — whichever comes first, the other reads "gone").
    if (answer.replacedEventId && connected()) {
      await ensureLinkedCalendarEventRemoved(answer.replacedEventId).catch(err =>
        logError(`Calendar: a replaced item's event not removed yet (the calendar outbox retries): ${message(err)}`, { eventId: answer.replacedEventId }))
    }
    const apple = await appleSideOf(answer)
    if (apple) return await settleItemApple(answer, google, apple)
    // A replaced row may have had an Apple copy (its delete queued it): sent soon, quietly.
    drainICloudSoon()
    if (!connected()) return outcome

    // A repeating item's rule: its ONE series (calendarSeries.ts), and its
    // days on Google Tasks (156: the database turned them on for tasks / both).
    if (answer.scheduleBlockId && !answer.occurrence) {
      const row = await fetchScheduleBlock(answer.scheduleBlockId)
      if (wantsCal) {
        outcome.calendar = await syncScheduleSeriesAfterSave(row, true)
        // → Calendar only: the series is confirmed — now its days' Google Tasks go.
        if (outcome.calendar === 'linked' && !wantsTasks) {
          await setRepeatDaysGoogleTasks(row.id, todayStr(), false)
          void drainTasks()
        }
        if (wantsTasks) void drainTasks()
        return outcome
      }
      // Off Calendar: its series goes — when the repeat moves to Google Tasks,
      // only once today's Google Task is there (no day today: nothing to wait for).
      if (row.google_calendar_event_id && wantsTasks && answer.dayTaskId && !(await googleTaskConfirmed(answer.dayTaskId))) {
        toast.warning('Google Tasks hasn\'t confirmed today\'s task yet, so the Google Calendar series stays for now — save the repeat again to finish the move.')
        outcome.calendar = 'unknown'
        return outcome
      }
      outcome.calendar = await syncScheduleSeriesAfterSave(row, false)
      if (outcome.calendar === 'not_linked') outcome.calendar = 'off'
      if (wantsTasks) void drainTasks()
      return outcome
    }

    if (!answer.blockId) {
      if (answer.googleSync) void drainTasks()
      return outcome
    }
    const block = await fetchTimeBlockWithTask(answer.blockId)
    if (!block) return outcome

    // One day of a repeat: the series leaves the day out first, then the day
    // gets its own event (142's carry); a day that has one is just pushed.
    if (answer.occurrence && answer.scheduleBlockId) {
      if (block.google_calendar_event_id) {
        outcome.calendar = wantsCal ? await pushBlockCalendarEvent(block.id) : await unlinkBlockEvent(block.id)
      } else if (wantsCal) {
        carryOccurrenceToCalendar(answer.scheduleBlockId, block.id)
      }
      return outcome
    }

    if (wantsCal) {
      let status: TimeBlockCalendarStatus = block.google_calendar_event_id ? await pushBlockCalendarEvent(block.id) : 'not_linked'
      if (status === 'not_linked') status = await linkBlockCalendarEvent(block.id)
      outcome.calendar = status
      // The new copy is confirmed: now the old Google Task may go.
      if (status === 'linked' && google === 'calendar' && answer.googleSync) {
        await updateTask(answer.taskId!, { google_sync_enabled: false })
        outcome.tasks = false
        void drainTasks()
      } else if (status === 'unknown' && google === 'calendar' && answer.googleSync) {
        toast.warning('Google Calendar didn\'t confirm the event yet, so the Google Task stays for now — save the item again to finish the move.')
      }
      if (wantsTasks) void drainTasks()
      return outcome
    }

    // Not on Calendar any more: the event goes — after the Google Task is
    // confirmed when the item moves there.
    if (block.google_calendar_event_id) {
      if (wantsTasks && !(await googleTaskConfirmed(answer.taskId!))) {
        toast.warning('Google Tasks hasn\'t confirmed its copy yet, so the Google Calendar event stays for now — save the item again to finish the move.')
        outcome.calendar = 'unknown'
        return outcome
      }
      const status = await unlinkBlockEvent(block.id)
      outcome.calendar = status === 'not_linked' ? 'off' : status
      if (status === 'not_linked' && answer.blockToDrop === block.id) {
        await dropItemBlock(block.id).catch(err => logError(`Item: a presence slot not dropped: ${message(err)}`, { blockId: block.id }))
      }
    } else if (answer.googleSync) {
      void drainTasks()
    }
    return outcome
  } catch (err) {
    logError(`Item: Google follow-up failed: ${message(err)}`, { taskId: answer.taskId, blockId: answer.blockId, planId: answer.scheduleBlockId })
    toast.error(`Saved locally, Google sync failed: ${message(err)}`)
    return outcome
  }
}

/**
 * After app_repeat_day: one day of a repeat on Google. Done → the day leaves
 * the series and gets its own event with "✓ "; skip → off Google; undo →
 * back as it was. Runs in the background — a tick never waits for Google.
 */
export function settleRepeatDayGoogle(answer: RepeatDayAnswer): void {
  // A repeat in Apple Calendar: the day's change (its EXDATE, its own event) follows through the queue.
  drainICloudSoon()
  if (!connected()) return
  const planId = answer.scheduleBlockId
  void (async () => {
    if (answer.action === 'remove' || answer.action === 'restore') {
      refreshSeriesSoon(planId)
      return
    }
    if (!answer.blockId) return
    // A done / reopen push is the title only ("✓ "): never the day back over a move made in Google.
    if (answer.action === 'done') {
      if (answer.blockEventId) await pushBlockCalendarEvent(answer.blockId, 'title')
      else if (answer.seriesEventId) carryOccurrenceToCalendar(planId, answer.blockId)
    } else if (answer.action === 'skip') {
      if (answer.blockEventId) takeSkippedDayOffCalendar(answer.blockId)
      else if (answer.seriesEventId && answer.created) carryOccurrenceToCalendar(planId, answer.blockId)
    } else if (answer.action === 'undo' && answer.changed) {
      if (answer.previousStatus === 'cancelled' && answer.taskId) putSkippedDayBackOnCalendar(answer.taskId)
      else if (answer.blockEventId) await pushBlockCalendarEvent(answer.blockId, 'title')
    }
  })().catch(err => logError(`Calendar: a repeat's day not carried to Google: ${message(err)}`, { planId, date: answer.date }))
}
