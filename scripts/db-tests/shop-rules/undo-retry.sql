-- Undo of a Shop delete of a thing with an extra cost and a snoozed Needs-a-look row (scripts/verify-db-shop-rules.mjs).
-- Run twice: on a copy of the chain before 192 — each Activity case must answer WRONG (187's shop_item_costs_rules and
-- 190's shop_signal_states_rules refused those rows with 23514 while their thing was not back yet, and Activity's
-- Undo retries only a foreign key's or a unique key's refusal) — and after 192 and every other scenario file, where
-- each must answer ok. Delete's Undo answers ok both times: shop_restore_items puts the thing back before its rows
-- (it guards the fix, it can't show the bug). Self-contained (its own helper and table, fresh ids each run), as
-- account 1. Names are made up.
create or replace function public.t_retry(p_id text, p_ok boolean, p_what text) returns void language plpgsql as $$
begin
  raise notice 'retry %  %  %', p_id, case when coalesce(p_ok, false) then 'ok' else 'WRONG' end, p_what;
end $$;
grant execute on function public.t_retry(text, boolean, text) to authenticated;
create table if not exists public.t_retry_ids (run integer not null, k text not null, id uuid not null default gen_random_uuid(), tx bigint,
                                               primary key (run, k));
grant all on public.t_retry_ids to authenticated;
insert into public.t_retry_ids (run, k)
select coalesce((select max(run) from public.t_retry_ids), 0) + 1, k from unnest(array['both', 'cost', 'signal', 'delete_undo']) k;
create or replace function public.t_retry_id(p_k text) returns uuid language sql stable as $$
  select id from public.t_retry_ids where k = p_k and run = (select max(run) from public.t_retry_ids)
$$;
grant execute on function public.t_retry_id(text) to authenticated;

set role authenticated;
-- Each thing: an extra cost, a snoozed row, or both.
do $$
declare r record;
begin
  for r in select k, public.t_retry_id(k) as id from unnest(array['both', 'cost', 'signal', 'delete_undo']) k loop
    insert into public.shop_items (id, title, price, status, bought_at) values (r.id, 'Lamp (' || r.k || ')', 300, 'bought', '2026-01-01 12:00+01');
    if r.k <> 'signal' then
      insert into public.shop_item_costs (item_id, label, amount, spent_on) values (r.id, 'Repair', 100, '2026-02-01');
    end if;
    if r.k <> 'cost' then
      perform public.shop_signal_snooze(r.id, 'old_value', '2026-12-01');
    end if;
  end loop;
end $$;
-- Each delete its own save (Activity's Undo takes back one save).
do $$ begin
  perform public.shop_delete_items(array[public.t_retry_id('both')]);
  update public.t_retry_ids set tx = txid_current() where id = public.t_retry_id('both');
end $$;
do $$ begin
  perform public.shop_delete_items(array[public.t_retry_id('cost')]);
  update public.t_retry_ids set tx = txid_current() where id = public.t_retry_id('cost');
end $$;
do $$ begin
  perform public.shop_delete_items(array[public.t_retry_id('signal')]);
  update public.t_retry_ids set tx = txid_current() where id = public.t_retry_id('signal');
end $$;

-- Activity's Undo of each delete: the thing, its cost and its snoozed row back.
do $$
declare
  r  record;
  p  jsonb;
  ok boolean;
  words constant jsonb := '{"both": "an extra cost and a snoozed Needs-a-look row", "cost": "an extra cost", "signal": "a snoozed Needs-a-look row"}';
begin
  for r in select x.k, x.id, x.tx from public.t_retry_ids x where x.run = (select max(run) from public.t_retry_ids) and x.k <> 'delete_undo' order by x.k loop
    begin
      p := public.app_undo_transaction(r.tx);
      if coalesce((p ->> 'can_apply')::boolean, false) then
        p := public.app_undo_transaction(r.tx, true, p ->> 'confirm');
      end if;
      ok := p -> 'error' = 'null'
            and exists (select 1 from public.shop_items where id = r.id)
            and (select count(*) from public.shop_item_costs where item_id = r.id and label = 'Repair') = case when r.k = 'signal' then 0 else 1 end
            and (select count(*) from public.shop_signal_states where item_id = r.id and snoozed_until = '2026-12-01') = case when r.k = 'cost' then 0 else 1 end;
    exception when others then
      ok := false;
    end;
    perform public.t_retry('activity_' || r.k, ok, 'Activity''s Undo of deleting a thing with ' || (words ->> r.k) || ' puts them all back');
  end loop;
end $$;

-- Delete's Undo of the same (the Shop's own toast): the thing first, then its rows — fine before and after 192.
do $$
declare
  w  constant uuid := public.t_retry_id('delete_undo');
  s  jsonb;
  ok boolean;
begin
  begin
    s := public.shop_delete_items(array[w]);
    perform public.shop_restore_items(s);
    ok := exists (select 1 from public.shop_items where id = w)
          and (select count(*) = 1 from public.shop_item_costs where item_id = w and label = 'Repair')
          and (select count(*) = 1 from public.shop_signal_states where item_id = w and snoozed_until = '2026-12-01');
  exception when others then
    ok := false;
  end;
  perform public.t_retry('delete_undo', ok, 'Delete''s Undo of deleting a thing with an extra cost and a snoozed Needs-a-look row puts them all back');
end $$;
reset role;
