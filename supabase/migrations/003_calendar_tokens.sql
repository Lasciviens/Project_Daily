create table if not exists user_calendar_tokens (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  refresh_token text not null,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  constraint user_calendar_tokens_user_id_unique unique (user_id)
);

alter table user_calendar_tokens enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='user_calendar_tokens' and policyname='user owns their calendar token') then
    create policy "user owns their calendar token"
      on user_calendar_tokens for all
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end $$;
