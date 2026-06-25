-- Error log table for surfacing app errors in the Developer page.
-- Rows older than 2 days are irrelevant — cleaned up on each insert.

create table if not exists app_error_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  message     text not null,
  context     jsonb,
  created_at  timestamptz not null default now()
);

alter table app_error_logs enable row level security;

create policy "Users see own error logs"
  on app_error_logs for select
  using (auth.uid() = user_id);

create policy "Users insert own error logs"
  on app_error_logs for insert
  with check (auth.uid() = user_id);

create policy "Users delete own error logs"
  on app_error_logs for delete
  using (auth.uid() = user_id);

create index app_error_logs_user_created on app_error_logs (user_id, created_at desc);
