import { toast, useCalendarStore } from '../../../app/store'
import { logError } from '../../../shared/utils/logError'
import { todayStr } from '../../../shared/utils/dateUtils'
import { fetchScheduleBlock, fetchTimeBlockWithTask } from '../../daily/api/scheduleApi'
import type { TimeBlockCalendarStatus } from '../../daily/api/scheduleSyncRules'
import { updateTask } from '../../todo/api/tasksApi'
import { drainGoogleTasksOutbox } from '../../todo/api/googleTasksOutbox'
import type { SaveItemAnswer } from '../../items/itemApi'
import { dropItemBlock, setRepeatDaysGoogleTasks } from '../../items/itemApi'
import type { GoogleTarget } from '../../items/itemTypes'
import { ensureValidCalendarToken } from './calendarTokenSync'
import { appleAreaNow, appleAreaOf, drainICloudNow, drainICloudSoon, slotAreaInput } from '../areas/appleAreas'
import { APPLE_WARNING_MS, appleRowsOf, notInAppleText, stillInAppleText } from '../areas/appleSendRules'
import type { AreaKey } from '../areas/calendarAreas'

// ─────────────────────────────────────────────────────────────────────────────
//  One item after its save (migration 155; Google Calendar went in 208) — what the browser does after the database
//  saved it (app_save_item writes rows only). Its calendar is Apple Calendar: the save queued it (173–175's
//  triggers) and the server writes its Apple event — sent here at once, confirmed by the row's icloud_area. Google
//  Tasks follows through its outbox.
//
//  Moving an item between Google Tasks and Apple Calendar: the NEW copy is made and confirmed first, only then the
//  old one goes. → Calendar: once the Apple copy is there, Google Tasks is turned off (the outbox deletes the Google
//  Task). → Tasks: the server keeps the Apple copy until the Google Task exists (the Google Tasks outbox is drained
//  first). An item whose area has no calendar (not in use, Settings → Calendar) is only in this app.
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

export interface ItemGoogleOutcome {
  /** The Calendar side after the save ('off' = not on a calendar, by choice or because its area has none). */
  calendar: TimeBlockCalendarStatus | 'off'
  /** Google Tasks sync on after the settle. */
  tasks: boolean
}

/** The area whose Apple calendar a saved item belongs in (null: its area has no calendar), and its row there. */
async function appleSideOf(answer: SaveItemAnswer): Promise<{ area: AreaKey; table: 'time_blocks' | 'schedule_blocks'; id: string } | null> {
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

/** Another run is sending the queue (often the app's own opening, or the timer): the save asks again after these
 *  pauses (45 s in all — longer than a whole run of the app's opening), so its rows go first in the next run instead
 *  of waiting for the timer. */
const BUSY_WAITS_MS = [3000, 6000, 12000, 24000]

/**
 * An item in an area on Apple Calendar, after its save: the queue goes to Apple now (Google Tasks first, so a
 * move to Tasks finds its Google Task) with this item's row first, then the item's row says where its Apple copy
 * is. A confirmed copy lets the old Google Task go; one not
 * confirmed says why — the item's own reason from the server — and when it is tried again, or that it isn't.
 */
async function settleItemApple(answer: SaveItemAnswer, google: GoogleTarget, side: { area: AreaKey; table: 'time_blocks' | 'schedule_blocks'; id: string },
  editedBlockId: string | null): Promise<ItemGoogleOutcome> {
  const wantsCal = google === 'calendar' || google === 'both'
  const wantsTasks = google === 'tasks' || google === 'both'
  const outcome: ItemGoogleOutcome = { calendar: wantsCal ? 'unknown' : 'off', tasks: answer.googleSync }
  if (answer.googleSync || wantsTasks) await drainTasks()
  // The server sends only rows already queued for this account: the ids pick which go first, nothing else.
  const items = appleRowsOf(answer, { entity: side.table === 'time_blocks' ? 'slot' : 'plan', id: side.id }, editedBlockId)
  let sent = await drainICloudNow({ items })
  for (const wait of BUSY_WAITS_MS) {
    if (!sent.busy) break
    await new Promise(res => setTimeout(res, wait))
    sent = await drainICloudNow({ items })
  }
  const said = { item: sent.item, problem: sent.problem, busy: sent.busy, now: new Date() }
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
    } else if (outcome.calendar === 'unknown') {
      toast.warning(notInAppleText({ ...said, keepsGoogleTask: google === 'calendar' && answer.googleSync }), APPLE_WARNING_MS)
    }
    return outcome
  }
  if (now) {
    // The server keeps the Apple copy until the Google Task is there; it goes on its own once it is.
    outcome.calendar = 'unknown'
    toast.warning(stillInAppleText({ ...said, toTasks: wantsTasks }), APPLE_WARNING_MS)
    return outcome
  }
  if (answer.blockToDrop && answer.blockToDrop === answer.blockId) {
    await dropItemBlock(answer.blockToDrop).catch(err => logError(`Item: a presence slot not dropped: ${message(err)}`, { blockId: answer.blockToDrop }))
  }
  return outcome
}

/**
 * After app_save_item: the item's Apple side follows its choice (settleItemApple); Google Tasks follows through the
 * outbox the database filled. Never throws; a failure is said once and logged.
 */
export async function settleItemGoogle(answer: SaveItemAnswer, google: GoogleTarget, editedBlockId: string | null = null): Promise<ItemGoogleOutcome> {
  const wantsCal = google === 'calendar' || google === 'both'
  const outcome: ItemGoogleOutcome = { calendar: 'off', tasks: answer.googleSync }
  try {
    const apple = await appleSideOf(answer)
    if (apple) return await settleItemApple(answer, google, apple, editedBlockId)
    // A replaced row may have had an Apple copy (its delete queued it): sent soon, quietly.
    drainICloudSoon()
    if (answer.googleSync) void drainTasks()
    // No calendar for it: a slot kept only for a calendar presence goes now (no event has to go first).
    if (!wantsCal && answer.blockToDrop && answer.blockToDrop === answer.blockId) {
      await dropItemBlock(answer.blockToDrop).catch(err => logError(`Item: a presence slot not dropped: ${message(err)}`, { blockId: answer.blockToDrop }))
    }
    return outcome
  } catch (err) {
    logError(`Item: calendar follow-up failed: ${message(err)}`, { taskId: answer.taskId, blockId: answer.blockId, planId: answer.scheduleBlockId })
    toast.error(`Saved, but not sent on: ${message(err)}`)
    return outcome
  }
}
