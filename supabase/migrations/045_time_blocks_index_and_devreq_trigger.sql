-- ═══════════════════════════════════════════════════════════════════════════
-- Two small, purely-additive fixes (no behavior change, no client-code impact).
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. time_blocks is the app's most-queried table — every timeline/calendar view
--    (Daily, Home, Work, Training) filters `WHERE user_id = ? AND date [range]`.
--    Its only existing index is the partial (source_type, source_id) one, so the
--    primary access pattern was unindexed. This composite covers it.
CREATE INDEX IF NOT EXISTS time_blocks_user_date
  ON public.time_blocks (user_id, date);

-- 2. dev_requests has an `updated_at` column but was the only user-authored table
--    with no BEFORE UPDATE trigger to maintain it (every other table has one via
--    update_updated_at(), defined in 002_media.sql). The app sets updated_at by
--    hand on its own update path and sorts by sort_order (not updated_at), so
--    this changes nothing there — it just makes the column authoritative for any
--    other writer (AI generic db_update, reorder path) that doesn't set it.
DROP TRIGGER IF EXISTS trg_dev_requests_updated_at ON public.dev_requests;
CREATE TRIGGER trg_dev_requests_updated_at
  BEFORE UPDATE ON public.dev_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
