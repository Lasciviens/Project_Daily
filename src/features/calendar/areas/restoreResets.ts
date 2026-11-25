import type { RowOverrides } from '../../../shared/utils/deletedRows'

// What Undo of a delete puts back without (2c): a slot or repeat brought back gets a fresh Apple Calendar event
// (its triggers queue it), never a link to the one its delete removed. A link to a Google Calendar event (retired,
// 208) never comes back either: an old snapshot may still hold one, and it would read as "on a calendar".

export const BLOCK_EVENT_RESET: RowOverrides = { time_blocks: { google_calendar_event_id: null, icloud_area: null, icloud_etag: null } }

/** A repeat's start in Apple Calendar (icloud_from) stays, so the series put back keeps its past days. */
export const SERIES_EVENT_RESET: RowOverrides = {
  schedule_blocks: {
    google_calendar_event_id: null, google_calendar_horizon: null, google_calendar_from: null, icloud_area: null, icloud_etag: null, icloud_horizon: null,
  },
}
