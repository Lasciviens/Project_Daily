-- Transit recent searches: max 6 per user, FIFO
create table transit_recent_searches (
  id             uuid default gen_random_uuid() primary key,
  user_id        uuid references auth.users(id) on delete cascade not null,
  from_stop_id   text not null,
  from_stop_name text not null,
  to_stop_id     text not null,
  to_stop_name   text not null,
  searched_at    timestamptz default now() not null
);

alter table transit_recent_searches enable row level security;

create policy "Users manage own transit recent searches"
  on transit_recent_searches for all
  using (auth.uid() = user_id);

create index transit_recent_searches_user_searched
  on transit_recent_searches (user_id, searched_at desc);
