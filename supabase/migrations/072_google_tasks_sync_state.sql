-- ═══════════════════════════════════════════════════════════════════════════
-- Google Tasks — Phase 3: background poller state + the service-role write
-- path it needs. Mirrors google_health_sync_state (migration 063) and
-- push-send's cron pattern (migration 068).
--
-- Real gap this migration closes: apply_google_task_snapshot,
-- upsert_task_from_google and set_task_parent_from_google (migration 071)
-- all scope their write with `user_id = (SELECT auth.uid())` — correct for
-- the BROWSER path (a real user JWT), but auth.uid() returns NULL when the
-- caller is the service-role key (no user JWT on that connection at all),
-- which is exactly how a cron-triggered edge function must call them. Every
-- one of those calls would silently match zero rows. Fixed by accepting an
-- explicit p_user_id, honored ONLY when the caller is genuinely the service
-- role (auth.role() = 'service_role' — a claim only the platform's own
-- service key can present, never forgeable by an authenticated/anon caller)
-- via the new effective_user_id() helper. Zero behavior change for every
-- existing browser call site: they don't pass p_user_id, and a
-- browser-authenticated role never satisfies the service_role check anyway.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── A. google_tasks_sync_state ──────────────────────────────────────────────
CREATE TABLE public.google_tasks_sync_state (
  user_id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  last_success_at TIMESTAMPTZ,
  last_error      TEXT,
  last_error_at   TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.google_tasks_sync_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY google_tasks_sync_state_owner_read ON public.google_tasks_sync_state
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
-- No write policy — only the service-role poller writes this, which bypasses
-- RLS entirely; a future stale-data banner reads it read-only.

-- ── B. effective_user_id ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.effective_user_id(p_user_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
  SELECT CASE WHEN auth.role() = 'service_role' THEN p_user_id ELSE auth.uid() END
$$;

-- ── C. Re-scope the three migration-071 RPCs to accept the cron path ──────
-- Each gains ONE new trailing p_user_id UUID DEFAULT NULL parameter (a valid
-- CREATE OR REPLACE — same name, same leading signature, appended optional
-- param) and swaps its `(SELECT auth.uid())` scoping for
-- effective_user_id(p_user_id). Bodies are otherwise byte-identical to 071.

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

-- ── D. Cron — every 20 minutes, mirrors migration 068's push-send pattern.
-- The secret is read from Vault INSIDE the cron body, never written into the
-- SQL text itself (same rule 068 follows for PUSH_CRON_SECRET).
select cron.schedule('lascis-google-tasks-sync', '*/20 * * * *', $cron$
  select net.http_post(
    url := 'https://hsaedwwqpcjizeozjbch.supabase.co/functions/v1/google-tasks-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'GOOGLE_TASKS_SYNC_SECRET'), '')
    ),
    body := '{}'::jsonb
  );
$cron$);
