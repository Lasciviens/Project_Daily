-- Store the linked Google Calendar event id on the time block itself, so a
-- block's calendar event can be updated when the block moves and deleted when
-- the block is deleted (previously the event id from createCalendarEvent was
-- discarded → orphaned/duplicate calendar events). tasks.google_calendar_event_id
-- already existed (migration 016) but was never used; the block is the natural
-- home since both task-linked and plain scheduled blocks create calendar events.

ALTER TABLE public.time_blocks
  ADD COLUMN IF NOT EXISTS google_calendar_event_id text;
