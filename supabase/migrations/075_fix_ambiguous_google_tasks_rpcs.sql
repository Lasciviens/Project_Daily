-- ═══════════════════════════════════════════════════════════════════════════
-- Fix a real production bug: migration 072 added p_user_id to three
-- migration-071 functions via CREATE OR REPLACE FUNCTION — but Postgres only
-- treats that as a true REPLACE when the parameter list is unchanged.
-- Appending a new parameter instead created a SECOND overload, leaving the
-- original (071-shaped) signature registered alongside it.
--
-- Every browser call site (googleTasksSync.ts's upsertOne/parent-resolution,
-- googleTasksOutbox.ts's applySnapshot) calls these via PostgREST's named-
-- argument RPC style and never passes p_user_id. With two overloads whose
-- only difference is one trailing defaulted parameter, Postgres cannot rank
-- them — "Could not choose the best candidate function" — so EVERY browser-
-- side call to any of these three functions has been failing since 072 was
-- deployed: Import (upsert_task_from_google), and — more seriously — every
-- outbox drain's post-create/update/delete snapshot write and parent
-- resolution (apply_google_task_snapshot, set_task_parent_from_google).
-- A failed post-create snapshot is a real correctness risk on top of the
-- error itself: the local row never got its google_task_id written back,
-- so the NEXT retry's processCreate guard (`if (task.google_task_id) return`)
-- doesn't trip and a second Google task can get created for the same row.
--
-- Fix: explicitly DROP each function's exact pre-072 signature, leaving only
-- the p_user_id-carrying version from 072 registered.
-- ═══════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.apply_google_task_snapshot(
  UUID, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, JSONB, BOOLEAN, BOOLEAN, JSONB, BOOLEAN
);

DROP FUNCTION IF EXISTS public.upsert_task_from_google(
  TEXT, TEXT, TEXT, DATE, TEXT, TIMESTAMPTZ, UUID, UUID, TIMESTAMPTZ, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN
);

DROP FUNCTION IF EXISTS public.set_task_parent_from_google(UUID, UUID);

-- Re-affirm the canonical (p_user_id-carrying) signatures — a no-op if 072
-- already applied cleanly on this database, but guarantees exactly ONE
-- overload of each exists regardless of what state this database was in.
-- Bodies are byte-identical to migration 072's.

CREATE OR REPLACE FUNCTION public.apply_google_task_snapshot(
  p_task_id            UUID,
  p_google_task_id     TEXT,
  p_google_updated_at  TIMESTAMPTZ,
  p_google_etag        TEXT        DEFAULT NULL,
  p_google_position    TEXT        DEFAULT NULL,
  p_google_web_view_link TEXT      DEFAULT NULL,
  p_google_links       JSONB       DEFAULT NULL,
  p_google_hidden      BOOLEAN     DEFAULT NULL,
  p_google_deleted     BOOLEAN     DEFAULT NULL,
  p_content            JSONB       DEFAULT NULL,
  p_clear_google_task_id BOOLEAN   DEFAULT false,
  p_user_id            UUID        DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_pending BOOLEAN;
  v_user_id     UUID := public.effective_user_id(p_user_id);
BEGIN
  PERFORM set_config('app.google_sync_write', 'true', true);

  SELECT EXISTS (
    SELECT 1 FROM public.google_tasks_outbox
     WHERE task_id = p_task_id AND user_id = v_user_id
  ) INTO v_has_pending;

  UPDATE public.tasks SET
    google_task_id       = CASE WHEN p_clear_google_task_id THEN NULL
                                 ELSE COALESCE(p_google_task_id, google_task_id) END,
    google_updated_at    = p_google_updated_at,
    google_etag          = COALESCE(p_google_etag, google_etag),
    google_position      = COALESCE(p_google_position, google_position),
    google_web_view_link = COALESCE(p_google_web_view_link, google_web_view_link),
    google_links         = COALESCE(p_google_links, google_links),
    google_hidden        = COALESCE(p_google_hidden, google_hidden),
    status = CASE
      WHEN p_google_deleted IS TRUE AND status <> 'cancelled' THEN 'cancelled'
      WHEN NOT v_has_pending AND p_content IS NOT NULL AND p_content ? 'status'
        THEN p_content ->> 'status'
      ELSE status
    END,
    google_deleted = COALESCE(p_google_deleted, google_deleted),
    title       = CASE WHEN NOT v_has_pending AND p_content IS NOT NULL AND p_content ? 'title'
                        THEN p_content ->> 'title' ELSE title END,
    description = CASE WHEN NOT v_has_pending AND p_content IS NOT NULL AND p_content ? 'notes'
                        THEN p_content ->> 'notes' ELSE description END,
    due_date    = CASE WHEN NOT v_has_pending AND p_content IS NOT NULL AND p_content ? 'due_date'
                        THEN (p_content ->> 'due_date')::date ELSE due_date END,
    completed_at = CASE WHEN NOT v_has_pending AND p_content IS NOT NULL AND p_content ? 'completed_at'
                        THEN (p_content ->> 'completed_at')::timestamptz ELSE completed_at END,
    parent_task_id = CASE WHEN NOT v_has_pending AND p_content IS NOT NULL AND p_content ? 'parent_task_id'
                        THEN (p_content ->> 'parent_task_id')::uuid ELSE parent_task_id END
  WHERE id = p_task_id AND user_id = v_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_task_from_google(
  p_google_task_id       TEXT,
  p_title                TEXT,
  p_notes                TEXT,
  p_due_date             DATE,
  p_status               TEXT,
  p_google_updated_at    TIMESTAMPTZ,
  p_google_tasklist_id   UUID        DEFAULT NULL,
  p_parent_task_id       UUID        DEFAULT NULL,
  p_completed_at         TIMESTAMPTZ DEFAULT NULL,
  p_google_etag          TEXT        DEFAULT NULL,
  p_google_position      TEXT        DEFAULT NULL,
  p_google_web_view_link TEXT        DEFAULT NULL,
  p_google_hidden        BOOLEAN     DEFAULT false,
  p_google_deleted       BOOLEAN     DEFAULT false,
  p_user_id              UUID        DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := public.effective_user_id(p_user_id);
  v_id      UUID;
  v_has_pending BOOLEAN;
BEGIN
  PERFORM set_config('app.google_sync_write', 'true', true);

  SELECT id INTO v_id FROM public.tasks
   WHERE user_id = v_user_id AND google_task_id = p_google_task_id;

  IF v_id IS NOT NULL THEN
    SELECT EXISTS (SELECT 1 FROM public.google_tasks_outbox WHERE task_id = v_id)
      INTO v_has_pending;

    UPDATE public.tasks SET
      title              = CASE WHEN NOT v_has_pending THEN p_title ELSE title END,
      description        = CASE WHEN NOT v_has_pending THEN p_notes ELSE description END,
      due_date           = CASE WHEN NOT v_has_pending THEN p_due_date ELSE due_date END,
      status             = CASE
                              WHEN p_google_deleted AND status <> 'cancelled' THEN 'cancelled'
                              WHEN NOT v_has_pending THEN
                                CASE WHEN p_status = 'completed' THEN 'done' ELSE
                                  CASE WHEN status = 'done' THEN 'open' ELSE status END
                                END
                              ELSE status
                            END,
      completed_at       = CASE WHEN NOT v_has_pending THEN p_completed_at ELSE completed_at END,
      parent_task_id     = CASE WHEN NOT v_has_pending THEN p_parent_task_id ELSE parent_task_id END,
      google_tasklist_id = COALESCE(p_google_tasklist_id, google_tasklist_id),
      google_updated_at  = p_google_updated_at,
      google_etag        = COALESCE(p_google_etag, google_etag),
      google_position    = COALESCE(p_google_position, google_position),
      google_web_view_link = COALESCE(p_google_web_view_link, google_web_view_link),
      google_hidden      = p_google_hidden,
      google_deleted     = p_google_deleted,
      google_sync_enabled = true
    WHERE id = v_id;

    RETURN v_id;
  END IF;

  IF p_google_deleted OR p_google_hidden THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.tasks (
    user_id, title, description, domain, section, priority, status,
    due_date, source_type, parent_task_id, google_task_id, google_tasklist_id,
    google_updated_at, google_etag, google_position, google_web_view_link,
    google_hidden, google_deleted, google_sync_enabled, completed_at, sort_order
  ) VALUES (
    v_user_id, p_title, p_notes, 'personal', 'inbox', 'medium',
    CASE WHEN p_status = 'completed' THEN 'done' ELSE 'open' END,
    p_due_date, 'manual', p_parent_task_id, p_google_task_id, p_google_tasklist_id,
    p_google_updated_at, p_google_etag, p_google_position, p_google_web_view_link,
    p_google_hidden, p_google_deleted, true, p_completed_at, 0
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_task_parent_from_google(
  p_task_id UUID, p_parent_task_id UUID, p_user_id UUID DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('app.google_sync_write', 'true', true);
  UPDATE public.tasks SET parent_task_id = p_parent_task_id
   WHERE id = p_task_id AND user_id = public.effective_user_id(p_user_id);
END;
$$;
