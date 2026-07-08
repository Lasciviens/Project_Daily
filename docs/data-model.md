# Data Model

> ⚠️ **Stale / partial.** This file only documents a handful of early tables and
> has not been kept in sync with `supabase/migrations/` (currently 40+
> migrations covering dozens of tables — recipes, shop, projects, hevy_*,
> health_*, and more). Do not treat this as a complete schema reference.
> For the current, actively-maintained schema:
> - `supabase/migrations/*.sql` — the actual source of truth, one file per change.
> - `supabase/functions/ai-proxy/index.ts`'s `DB_CATALOG` — a curated table-by-table
>   reference (columns, enums, access rules) kept up to date because the AI
>   assistant depends on it being correct.
> - `CLAUDE.md`'s per-feature "DB:" bullets — high-level table names and purpose per feature.

All tables require RLS enabled and a `user_id` column. See `supabase/migrations/` for SQL.

---

## `tasks`

Single source of truth for all tasks across every domain and page.

```sql
CREATE TABLE tasks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title        text NOT NULL,
  description  text,
  domain       text NOT NULL CHECK (domain IN ('personal', 'work', 'media')),
  section      text NOT NULL DEFAULT 'inbox'
               CHECK (section IN ('inbox', 'today', 'tomorrow', 'this_week', 'backlog')),
  status       text NOT NULL DEFAULT 'open'
               CHECK (status IN ('open', 'in_progress', 'done', 'cancelled')),
  priority     text NOT NULL DEFAULT 'medium'
               CHECK (priority IN ('low', 'medium', 'high')),
  due_date     date,
  due_time     time,
  source_type  text DEFAULT 'manual'
               CHECK (source_type IN ('manual', 'media', 'calendar', 'ai')),
  source_id    uuid,  -- media_items.id when source_type = 'media'
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY tasks_owner ON tasks USING (auth.uid() = user_id);
```

**Query patterns:**
- Work page: `WHERE domain = 'work' AND status != 'cancelled'`
- Today view: `WHERE section = 'today' OR (due_date = current_date AND status = 'open')`
- Media plans: `WHERE domain = 'media' AND source_type = 'media'`
- To-Do Inbox: `WHERE section = 'inbox' AND status = 'open'`

---

## `media_items`

Canonical record for a film, show, or game. Source of truth comes from TMDB or RP5 DB; manual entries allowed.

```sql
CREATE TABLE media_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type            text NOT NULL CHECK (type IN ('movie', 'show', 'game')),
  external_source text NOT NULL CHECK (external_source IN ('tmdb', 'rp5', 'manual')),
  external_id     text,
  title           text NOT NULL,
  original_title  text,
  runtime         integer,         -- minutes (movie) or episode length (show)
  release_date    date,
  poster_url      text,
  metadata_json   jsonb,           -- raw TMDB/RP5 response, do not query directly
  created_at      timestamptz DEFAULT now()
);

-- No RLS needed — media_items are not user-specific.
-- Access controlled at user_media_entries level.
ALTER TABLE media_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY media_items_read_all ON media_items FOR SELECT USING (true);
CREATE POLICY media_items_insert_auth ON media_items FOR INSERT WITH CHECK (auth.role() = 'authenticated');
```

---

## `user_media_entries`

Your personal relationship with a media item. One row per user per media item.

```sql
CREATE TABLE user_media_entries (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  media_item_id    uuid REFERENCES media_items(id) ON DELETE CASCADE NOT NULL,
  status           text NOT NULL
                   CHECK (status IN ('watching', 'playing', 'wishlist', 'completed', 'dropped', 'paused')),
  priority         text DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  personal_note    text,
  planned_date     date,
  rating           smallint CHECK (rating BETWEEN 1 AND 10),
  current_episode  integer,
  current_season   integer,
  repeat_count     integer DEFAULT 0,
  started_at       date,
  finished_at      date,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now(),
  UNIQUE (user_id, media_item_id)
);

ALTER TABLE user_media_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY entries_owner ON user_media_entries USING (auth.uid() = user_id);
```

**Status → UI section mapping:**
| Status | Media Page Section |
|---|---|
| `watching` | Currently Watching |
| `playing` | Currently Playing |
| `wishlist` | Wishlist — General |
| `wishlist` + `planned_date` | Want to Watch / Planned |
| `completed` | History |
| `dropped` | Dropped |

---

## `activity_log`

Immutable append-only event log. Never update or delete rows.

```sql
CREATE TABLE activity_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  event_type   text NOT NULL,
  entity_type  text,             -- 'task' | 'media_entry' | 'ai_action'
  entity_id    uuid,
  payload_json jsonb,
  created_at   timestamptz DEFAULT now()
);

ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY log_owner_read ON activity_log FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY log_owner_insert ON activity_log FOR INSERT WITH CHECK (auth.uid() = user_id);
-- No UPDATE or DELETE policies — log is append-only.
```

**Event types:**
```
task_created          task_updated          task_completed
task_cancelled        media_added           media_status_changed
media_planned         media_completed       media_dropped
ai_action_proposed    ai_action_confirmed   ai_action_cancelled
calendar_event_synced
```

---

## `work_notes` (future)

Optional. Rich-text notes attached to a work task. Not in MVP.

---

## Relationship Diagram

```
auth.users
  │
  ├── tasks (domain: personal | work | media)
  │     └── source_id → media_items.id  (when source_type = 'media')
  │
  ├── user_media_entries
  │     └── media_item_id → media_items.id
  │
  └── activity_log

media_items  (shared, not user-specific)
```
