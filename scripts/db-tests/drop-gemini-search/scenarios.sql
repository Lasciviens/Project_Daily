-- 201's scenarios. Each prints "NOTICE:  ok  <name>" or raises.
create or replace function t_ok(c boolean, name text) returns void language plpgsql as $$
begin if c is not true then raise exception 'FAIL: %', name; end if; raise notice 'ok  %', name; end $$;

select t_ok(to_regclass('public.ai_embeddings') is null, 'D1 ai_embeddings is gone');
select t_ok(to_regclass('public.ai_reviews') is null, 'D2 ai_reviews is gone');
select t_ok(not exists (select 1 from pg_proc where proname in ('ai_semantic_search', 'ai_embeddings_follow_source') and pronamespace = 'public'::regnamespace), 'D3 both functions are gone');
select t_ok(not exists (select 1 from pg_trigger where tgname = 'trg_ai_embeddings_follow'), 'D4 no follow trigger is left on any table');
select t_ok((select count(*) from public.recipes) = 1 and (select count(*) from public.ai_memory) = 1, 'D5 the source rows and ai_memory are untouched');
-- The source tables still change and delete (the trigger that would have called a dropped function is gone).
update public.ai_memory set content = 'coffee' where title = 'Likes';
delete from public.recipes;
select t_ok((select content from public.ai_memory) = 'coffee' and (select count(*) from public.recipes) = 0, 'D6 an update and a delete on a source table work');
select t_ok(not exists (select 1 from pg_policy where polrelid in (select oid from pg_class where relname in ('ai_embeddings', 'ai_reviews'))), 'D7 no policy of the two tables is left');
