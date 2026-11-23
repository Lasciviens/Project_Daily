-- What 201 needs, as small as it can be: the state migrations 065 and 140 left, with a plain text column where 065 has
-- vector(768) (the throwaway Postgres has no pgvector; 201 never touches the column's type). Roles, a caller, three of
-- the seven source tables and their follow triggers, and the old function 140 made.
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role service_role; exception when duplicate_object then null; end $$;
create schema if not exists auth;
create table auth.users (id uuid primary key);
insert into auth.users values ('00000000-0000-0000-0000-000000000001');
create or replace function auth.uid() returns uuid language sql stable as $$ select '00000000-0000-0000-0000-000000000001'::uuid $$;

create table public.ai_embeddings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_table text not null, source_id text not null, content text not null,
  embedding text not null,
  updated_at timestamptz not null default now(),
  unique (user_id, source_table, source_id)
);
alter table public.ai_embeddings enable row level security;
create policy "own ai_embeddings" on public.ai_embeddings for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create index idx_ai_embeddings_lookup on public.ai_embeddings(user_id, source_table, source_id);
create function public.ai_semantic_search(query_embedding text, match_count int default 8)
returns table (source_table text, source_id text, content text, similarity double precision)
language sql stable security invoker as $$ select e.source_table, e.source_id, e.content, 1.0::double precision from public.ai_embeddings e limit match_count $$;
create table public.ai_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'weekly', content text not null, created_at timestamptz not null default now()
);
alter table public.ai_reviews enable row level security;
create policy "own ai_reviews" on public.ai_reviews for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Three of the seven tables 140 put a trigger on (201 skips the ones that do not exist).
create table public.recipes (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id), title text, description text, instructions text);
create table public.ai_memory (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id), title text, content text);
create table public.books (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id), title text, author text, review text, notes text);
create function public.ai_embeddings_follow_source() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.ai_embeddings e where e.source_table = tg_table_name and e.source_id = old.id::text;
  return coalesce(new, old);
end $$;
create trigger trg_ai_embeddings_follow after delete or update on public.recipes for each row execute function public.ai_embeddings_follow_source('title,description,instructions');
create trigger trg_ai_embeddings_follow after delete or update on public.ai_memory for each row execute function public.ai_embeddings_follow_source('title,content');
create trigger trg_ai_embeddings_follow after delete or update on public.books for each row execute function public.ai_embeddings_follow_source('title,author,review,notes');

insert into public.recipes (id, user_id, title) values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', 'Soup');
insert into public.ai_memory (id, user_id, title, content) values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000001', 'Likes', 'tea');
insert into public.ai_embeddings (user_id, source_table, source_id, content, embedding) values ('00000000-0000-0000-0000-000000000001', 'recipes', '00000000-0000-0000-0000-0000000000a1', 'Soup', '[0.1]');
insert into public.ai_reviews (user_id, content) values ('00000000-0000-0000-0000-000000000001', 'old review');
