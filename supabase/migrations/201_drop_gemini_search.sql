-- 201 · AI phase 5: the last of Gemini in the database (owner, 23.11.2026).
-- Drops the search-by-meaning copies (`ai_embeddings` with its 768 Gemini numbers and `ai_semantic_search()`), the
-- triggers 140 put on seven tables to keep those copies in step, and the unused `ai_reviews`. Nothing reads or writes
-- any of it any more: the old assistant (ai-proxy) was the only user and is retired in the same change; Ask AI finds
-- text with the database's own text search. `ai_memory` and every source table stay as they are; so does the `vector`
-- extension (Supabase's, harmless; dropping it is not needed).
-- Safe to re-run: every drop is `if exists`. No data in any other table is touched.

-- 140's triggers first (the function they call goes next). Each table is optional.
do $$
declare
  t text;
begin
  foreach t in array array['recipes', 'dev_requests', 'pt_assessments', 'work_notes', 'ai_memory', 'wish_items', 'books'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists trg_ai_embeddings_follow on public.%I', t);
    end if;
  end loop;
end $$;

drop function if exists public.ai_embeddings_follow_source();
drop function if exists public.ai_semantic_search(text, int);
-- The table's policy, its two indexes and its foreign key go with it.
drop table if exists public.ai_embeddings;
drop table if exists public.ai_reviews;
