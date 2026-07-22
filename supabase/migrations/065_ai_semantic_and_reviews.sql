-- 065_ai_semantic_and_reviews.sql  (Phase 4)  — MANUAL-APPLY (user), then
-- redeploy ai-proxy. Adds:
--   1. pgvector + ai_embeddings + ai_semantic_search() — fuzzy recall over the
--      user's own text (recipes, coach history, dev_requests, notes, memory).
--   2. ai_reviews — stored weekly training+nutrition+recovery reviews.
-- Both best-effort in code (no-op until this runs), so the client can ship first.

-- ── 1. Semantic search ──────────────────────────────────────────────────────
create extension if not exists vector;

create table if not exists public.ai_embeddings (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  source_table text not null,            -- e.g. 'recipes', 'pt_assessments'
  source_id    text not null,            -- the row's id
  content      text not null,            -- the embedded text (title + body)
  embedding    vector(768) not null,     -- gemini-embedding-001 @ 768 dims
  updated_at   timestamptz not null default now(),
  unique (user_id, source_table, source_id)
);
alter table public.ai_embeddings enable row level security;
drop policy if exists "own ai_embeddings" on public.ai_embeddings;
create policy "own ai_embeddings" on public.ai_embeddings
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
-- cosine index — cosine similarity is scale-invariant, so it is unaffected by
-- gemini-embedding-001's un-normalized <3072-dim output (no manual normalize needed).
create index if not exists idx_ai_embeddings_hnsw
  on public.ai_embeddings using hnsw (embedding vector_cosine_ops);
create index if not exists idx_ai_embeddings_lookup
  on public.ai_embeddings(user_id, source_table, source_id);

-- SECURITY INVOKER → RLS scopes the search to the caller's own rows. The query
-- vector arrives as a text literal ('[0.1,...]') and is cast to vector, because
-- PostgREST cannot bind a native vector parameter over rpc.
create or replace function public.ai_semantic_search(query_embedding text, match_count int default 8)
returns table (source_table text, source_id text, content text, similarity double precision)
language sql
stable
security invoker
as $$
  select e.source_table, e.source_id, e.content,
         1 - (e.embedding <=> query_embedding::vector) as similarity
  from public.ai_embeddings e
  order by e.embedding <=> query_embedding::vector
  limit greatest(1, least(match_count, 25));
$$;
revoke all     on function public.ai_semantic_search(text, int) from public, anon;
grant  execute on function public.ai_semantic_search(text, int) to authenticated;

-- ── 2. Stored AI reviews (weekly digest) ────────────────────────────────────
create table if not exists public.ai_reviews (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  kind         text not null default 'weekly',
  period_start date,
  period_end   date,
  content      text not null,
  model        text,
  created_at   timestamptz not null default now()
);
alter table public.ai_reviews enable row level security;
drop policy if exists "own ai_reviews" on public.ai_reviews;
create policy "own ai_reviews" on public.ai_reviews
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create index if not exists idx_ai_reviews_user_created
  on public.ai_reviews(user_id, kind, created_at desc);
