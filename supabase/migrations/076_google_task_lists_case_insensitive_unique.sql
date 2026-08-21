-- ═══════════════════════════════════════════════════════════════════════════
-- Fix a real duplicate-list bug: "Work" vs "work" (or any case variant) could
-- create TWO Google Task lists instead of reusing one.
--
-- resolveOrCreateGoogleTaskListId (the task-creation flow's list field) only
-- did a JS-side "read existing, compare case-insensitively, then create if no
-- match" — a plain TOCTOU race (two near-simultaneous calls both see no
-- match, both create) with no database-level backstop. Worse,
-- useCreateGoogleTaskList (the "📋 Lists" sheet's manual "Add" button) had NO
-- dedup check AT ALL, not even exact-match — typing "work" there when "Work"
-- already existed always created a second list, no race required.
--
-- A case-insensitive UNIQUE index closes the race: two concurrent creates for
-- the same name (any case) now can't both succeed — the loser gets a real
-- 23505 unique-violation, which the app code (see the paired code fix) turns
-- into "return the winner's id" instead of a duplicate.
-- ═══════════════════════════════════════════════════════════════════════════

-- Dedup existing case-variant duplicates FIRST — this repo's own user hit
-- this exact bug before this migration existed, so CREATE UNIQUE INDEX
-- would fail outright on any database that already carries one. Survivor =
-- the oldest row (first created); tasks pointing at a loser are re-pointed
-- to the survivor (not left to fall through ON DELETE SET NULL, which would
-- silently drop the list assignment back to @default instead of preserving
-- it) before the loser rows are removed.
--
-- This only cleans up the LOCAL mirror. If a genuine case-variant duplicate
-- also exists as two real lists on Google's own side, delete the unwanted
-- one there too (Google Tasks app, or this app's "📋 Lists" sheet).
DO $$
DECLARE
  dup RECORD;
  survivor_id UUID;
BEGIN
  FOR dup IN
    SELECT user_id, lower(title) AS lname
      FROM public.google_task_lists
     GROUP BY user_id, lower(title)
    HAVING count(*) > 1
  LOOP
    SELECT id INTO survivor_id FROM public.google_task_lists
     WHERE user_id = dup.user_id AND lower(title) = dup.lname
     ORDER BY created_at ASC LIMIT 1;

    UPDATE public.tasks SET google_tasklist_id = survivor_id
     WHERE google_tasklist_id IN (
       SELECT id FROM public.google_task_lists
        WHERE user_id = dup.user_id AND lower(title) = dup.lname AND id <> survivor_id
     );

    DELETE FROM public.google_task_lists
     WHERE user_id = dup.user_id AND lower(title) = dup.lname AND id <> survivor_id;
  END LOOP;
END $$;

CREATE UNIQUE INDEX google_task_lists_user_lower_title
  ON public.google_task_lists (user_id, lower(title));
