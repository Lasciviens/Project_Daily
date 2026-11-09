-- The bugs the database review of 09.11.2026 found in 137/138, one check each. Every check asks for the
-- RIGHT behaviour and says `bug <id> ok` or `bug <id> WRONG` (a NOTICE, so a rolled-back check still
-- reports). scripts/verify-db-shop-rules.mjs runs this file twice: on the chain without 187, where every
-- check must come out WRONG (the bug is real there), and with 187, where every one must be ok. Writes run
-- as the owner through `authenticated` (row level security and the owner lock apply); each check uses
-- its own rows. Deferred checks are made to fire inside each block (set constraints all immediate).
create or replace function public.t_bug(p_id text, p_ok boolean, p_what text) returns void language plpgsql as $$
begin
  raise notice 'bug %  %  %', p_id, case when coalesce(p_ok, false) then 'ok' else 'WRONG' end, p_what;
end $$;
grant execute on function public.t_bug(text, boolean, text) to authenticated;
-- Norges Bank's EUR rates (written by shop-price as the service role).
insert into public.fx_rates_nok (day, currency, nok_per_unit, rate_day) values
  ('2026-01-15', 'EUR', 11.40, '2026-01-15'), ('2026-03-02', 'EUR', 11.60, '2026-03-02'),
  ('2026-10-01', 'EUR', 11.50, '2026-10-01'), ('2026-10-05', 'EUR', 11.55, '2026-10-05')
on conflict do nothing;

set role authenticated;

-- 1 · Delete's Undo of a phone model and the case moved under it: the case was bought first (January), the
--     phone in March. 137 put "parents first" back by date — the case before its phone — and lost both.
do $$
declare s jsonb;
begin
  insert into public.shop_items (id, user_id, title, kind, status) values ('b1000000-0000-0000-0000-00000000000a', auth.uid(), 'Any phone', 'general', 'wishlist');
  insert into public.shop_items (id, user_id, title, price, status, bought_at, created_at)
    values ('b1000000-0000-0000-0000-00000000000c', auth.uid(), 'Case', 200, 'bought', '2026-01-15 12:00+01', '2026-01-15 12:00+01');
  insert into public.shop_items (id, user_id, title, price, status, option_for, bought_at, created_at)
    values ('b1000000-0000-0000-0000-00000000000b', auth.uid(), 'Phone', 9000, 'bought', 'b1000000-0000-0000-0000-00000000000a', '2026-03-02 12:00+01', '2026-03-02 12:00+01');
  update public.shop_items set accessory_of = 'b1000000-0000-0000-0000-00000000000b' where id = 'b1000000-0000-0000-0000-00000000000c';
  s := public.shop_delete_items(array['b1000000-0000-0000-0000-00000000000b', 'b1000000-0000-0000-0000-00000000000c']::uuid[]);
  begin
    perform public.shop_restore_items(s);
    set constraints all immediate;
    perform public.t_bug('1', (select count(*) = 2 from public.shop_items where id in ('b1000000-0000-0000-0000-00000000000b', 'b1000000-0000-0000-0000-00000000000c'))
                         and (select accessory_of from public.shop_items where id = 'b1000000-0000-0000-0000-00000000000c') = 'b1000000-0000-0000-0000-00000000000b'
                         and (select status from public.shop_items where id = 'b1000000-0000-0000-0000-00000000000a') = 'fulfilled',
      'Undo brings back a phone model and the older case under it (the wish fulfilled again)');
  exception when others then
    perform public.t_bug('1', false, 'Undo of a phone model and its older case failed: ' || sqlerrm);
  end;
end $$;

-- 2 · Delete + Undo keeps the price watch and its history.
reset role;
insert into public.shop_items (id, user_id, title, price, status, url)
  values ('b2000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000001', 'Console', 6000, 'wishlist', 'https://www.prisjakt.no/product.php?p=1');
insert into public.shop_price_watch (item_id, user_id, url, status, low, source)
  values ('b2000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000001', 'https://www.prisjakt.no/product.php?p=1', 'ok', 5990, 'prisjakt');
insert into public.shop_price_points (user_id, item_id, checked_at, low)
  select '00000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-00000000000a', now() - g * interval '1 day', 6000 - g from generate_series(1, 5) g;
set role authenticated;
do $$
declare s jsonb;
begin
  s := public.shop_delete_items(array['b2000000-0000-0000-0000-00000000000a']::uuid[]);
  begin
    perform public.shop_restore_items(s);
    set constraints all immediate;
    perform public.t_bug('2', (select count(*) = 1 from public.shop_price_watch where item_id = 'b2000000-0000-0000-0000-00000000000a' and low = 5990)
                         and (select count(*) = 5 from public.shop_price_points where item_id = 'b2000000-0000-0000-0000-00000000000a'),
      'Undo of a delete brings back the price watch and its 5 points');
  exception when others then
    perform public.t_bug('2', false, 'Undo of a delete failed: ' || sqlerrm);
  end;
end $$;

-- 3 · A forged rate never reads "Norges Bank": purchase, money back and an extra cost.
do $$
begin
  insert into public.shop_items (id, user_id, title, price, currency, status, bought_at)
    values ('b3000000-0000-0000-0000-00000000000a', auth.uid(), 'Lens', 100, 'EUR', 'bought', '2026-10-01 12:00+02');
  update public.shop_items set fx_nok = 99, fx_source = 'norges_bank' where id = 'b3000000-0000-0000-0000-00000000000a';
  perform public.t_bug('3a', (select not (fx_nok = 99 and fx_source = 'norges_bank') from public.shop_items where id = 'b3000000-0000-0000-0000-00000000000a'),
    'a purchase rate of 99 sent as "norges_bank" is not stored as Norges Bank''s');
exception when others then
  perform public.t_bug('3a', false, 'the purchase check failed: ' || sqlerrm);
end $$;
do $$
begin
  insert into public.shop_items (id, user_id, title, price, currency, status, bought_at)
    values ('b3000000-0000-0000-0000-00000000000b', auth.uid(), 'Camera', 300, 'EUR', 'bought', '2026-03-02 12:00+01');
  update public.shop_items set disposal = 'sold', disposed_on = '2026-10-05', sale_price = 200, sale_currency = 'EUR'
   where id = 'b3000000-0000-0000-0000-00000000000b';
  update public.shop_items set sale_fx_nok = 50, sale_fx_source = 'norges_bank' where id = 'b3000000-0000-0000-0000-00000000000b';
  perform public.t_bug('3b', (select not (sale_fx_nok = 50 and sale_fx_source = 'norges_bank') from public.shop_items where id = 'b3000000-0000-0000-0000-00000000000b'),
    'a sale rate of 50 sent as "norges_bank" is not stored as Norges Bank''s');
exception when others then
  perform public.t_bug('3b', false, 'the sale check failed: ' || sqlerrm);
end $$;
do $$
begin
  insert into public.shop_item_costs (id, item_id, label, amount, currency, spent_on)
    values ('b3000000-0000-0000-0000-0000000000c1', 'b3000000-0000-0000-0000-00000000000a', 'Repair', 40, 'EUR', '2026-10-05');
  update public.shop_item_costs set fx_nok = 7, fx_source = 'norges_bank' where id = 'b3000000-0000-0000-0000-0000000000c1';
  perform public.t_bug('3c', (select not (fx_nok = 7 and fx_source = 'norges_bank') from public.shop_item_costs where id = 'b3000000-0000-0000-0000-0000000000c1'),
    'a cost rate of 7 sent as "norges_bank" is not stored as Norges Bank''s');
exception when others then
  perform public.t_bug('3c', false, 'the cost check failed: ' || sqlerrm);
end $$;

-- 4 · A thing you have keeps its purchase day (and so its rate).
do $$
begin
  insert into public.shop_items (id, user_id, title, price, currency, status, bought_at)
    values ('b4000000-0000-0000-0000-00000000000a', auth.uid(), 'Drone', 500, 'EUR', 'bought', '2026-10-01 12:00+02');
  update public.shop_items set bought_at = null where id = 'b4000000-0000-0000-0000-00000000000a';
  perform public.t_bug('4', (select bought_at = '2026-10-01 12:00+02' and fx_nok = 11.50 from public.shop_items where id = 'b4000000-0000-0000-0000-00000000000a'),
    'a write of bought_at = null on a bought row keeps its day and rate');
exception when others then
  perform public.t_bug('4', (select bought_at = '2026-10-01 12:00+02' from public.shop_items where id = 'b4000000-0000-0000-0000-00000000000a'),
    'clearing the purchase day was refused: ' || sqlerrm);
end $$;

-- 5 · "Undo the sale first" holds whatever the write sends, and things sold together go back together.
do $$
begin
  insert into public.shop_items (id, user_id, title, price, status, bought_at) values
    ('b5000000-0000-0000-0000-00000000000a', auth.uid(), 'Laptop', 10000, 'bought', '2026-02-01 12:00+01'),
    ('b5000000-0000-0000-0000-00000000000c', auth.uid(), 'Charger', 500, 'bought', '2026-02-01 12:00+01');
  update public.shop_items set accessory_of = 'b5000000-0000-0000-0000-00000000000a' where id = 'b5000000-0000-0000-0000-00000000000c';
  perform public.shop_record_sale('[{"id": "b5000000-0000-0000-0000-00000000000a", "sale_price": "6000"}, {"id": "b5000000-0000-0000-0000-00000000000c", "sale_price": "300"}]',
    'sold', '2026-10-01', 'NOK', 'Ola Nordmann');
end $$;
do $$
begin
  update public.shop_items set status = 'wishlist', disposal = null where id = 'b5000000-0000-0000-0000-00000000000a';
  set constraints all immediate;
  perform public.t_bug('5a', false, 'status wishlist + disposal null took a sold laptop back to the wishlist, its charger left sold alone');
exception when others then
  perform public.t_bug('5a', sqlstate = '23514', 'status wishlist + disposal null on a sold thing is refused (' || sqlerrm || ')');
end $$;
do $$
begin
  update public.shop_items set disposal = null where id = 'b5000000-0000-0000-0000-00000000000a';
  set constraints all immediate;
  perform public.t_bug('5b', false, 'the laptop''s sale was undone alone, its charger left sold in their sale group');
exception when others then
  perform public.t_bug('5b', sqlstate = '23514', 'undoing one of two things sold together is refused (' || sqlerrm || ')');
end $$;

-- 6 · Undo of a sale puts back the accessory it moved and the link amount it overwrote.
do $$
begin
  insert into public.shop_items (id, user_id, title, price, status, bought_at) values
    ('b6000000-0000-0000-0000-00000000000a', auth.uid(), 'Console', 5000, 'bought', '2026-01-01 12:00+01'),
    ('b6000000-0000-0000-0000-00000000000b', auth.uid(), 'Controller', 700, 'bought', '2026-01-01 12:00+01');
  insert into public.shop_items (id, user_id, title, price, status) values ('b6000000-0000-0000-0000-00000000000c', auth.uid(), 'Next console', 6000, 'wishlist');
  update public.shop_items set accessory_of = 'b6000000-0000-0000-0000-00000000000a' where id = 'b6000000-0000-0000-0000-00000000000b';
  insert into public.shop_item_links (from_id, to_id, amount) values ('b6000000-0000-0000-0000-00000000000a', 'b6000000-0000-0000-0000-00000000000c', 1000);
  perform public.shop_record_sale('[{"id": "b6000000-0000-0000-0000-00000000000a", "sale_price": "3000"}]', 'sold', '2026-10-01', 'NOK', null,
    '[{"id": "b6000000-0000-0000-0000-00000000000b", "move_to": null}]', 'b6000000-0000-0000-0000-00000000000c', 2500);
  perform public.shop_undo_sale('b6000000-0000-0000-0000-00000000000a');
  set constraints all immediate;
  perform public.t_bug('6', (select disposal is null from public.shop_items where id = 'b6000000-0000-0000-0000-00000000000a')
                       and (select accessory_of from public.shop_items where id = 'b6000000-0000-0000-0000-00000000000b') = 'b6000000-0000-0000-0000-00000000000a'
                       and (select amount from public.shop_item_links where from_id = 'b6000000-0000-0000-0000-00000000000a') = 1000,
    'Undo of a sale moves the kept controller back and puts the link''s 1 000 back');
exception when others then
  perform public.t_bug('6', false, 'the sale or its Undo failed: ' || sqlerrm);
end $$;

-- 7 · A money link stays valid after its things change, and a loop through a fulfilled wish is refused.
do $$
begin
  insert into public.shop_items (id, user_id, title, price, status, bought_at) values
    ('b7000000-0000-0000-0000-00000000000a', auth.uid(), 'Old camera', 3000, 'bought', '2026-01-01 12:00+01'),
    ('b7000000-0000-0000-0000-00000000000f', auth.uid(), 'Tripod', 800, 'bought', '2026-01-01 12:00+01'),
    ('b7000000-0000-0000-0000-0000000000a2', auth.uid(), 'Old lens', 1500, 'bought', '2026-01-01 12:00+01'),
    ('b7000000-0000-0000-0000-0000000000a3', auth.uid(), 'Old flash', 900, 'bought', '2026-01-01 12:00+01'),
    ('b7000000-0000-0000-0000-0000000000a4', auth.uid(), 'Old bag', 400, 'bought', '2026-01-01 12:00+01');
  insert into public.shop_items (id, user_id, title, price, status) values ('b7000000-0000-0000-0000-00000000000b', auth.uid(), 'New camera', 9000, 'wishlist');
  insert into public.shop_item_links (from_id, to_id) values
    ('b7000000-0000-0000-0000-00000000000a', 'b7000000-0000-0000-0000-00000000000b'),
    ('b7000000-0000-0000-0000-0000000000a2', 'b7000000-0000-0000-0000-00000000000b'),
    ('b7000000-0000-0000-0000-0000000000a3', 'b7000000-0000-0000-0000-00000000000b'),
    ('b7000000-0000-0000-0000-0000000000a4', 'b7000000-0000-0000-0000-00000000000b');
end $$;
do $$
begin
  update public.shop_items set accessory_of = 'b7000000-0000-0000-0000-00000000000f' where id = 'b7000000-0000-0000-0000-00000000000a';
  set constraints all immediate;
  perform public.t_bug('7a', false, 'a thing whose money paid for another became an accessory');
exception when others then
  perform public.t_bug('7a', sqlstate = '23514', 'a thing whose money paid for another can''t become an accessory (' || sqlerrm || ')');
end $$;
do $$
begin
  update public.shop_items set kept = false where id = 'b7000000-0000-0000-0000-0000000000a2';
  set constraints all immediate;
  perform public.t_bug('7b', false, 'a thing whose money paid for another became "not mine to keep"');
exception when others then
  perform public.t_bug('7b', sqlstate = '23514', 'a thing whose money paid for another can''t become "not mine to keep" (' || sqlerrm || ')');
end $$;
do $$
begin
  update public.shop_items set list = 'quick' where id = 'b7000000-0000-0000-0000-0000000000a3';
  set constraints all immediate;
  perform public.t_bug('7c', false, 'a thing whose money paid for another moved to the quick list');
exception when others then
  perform public.t_bug('7c', sqlstate = '23514', 'a thing whose money paid for another can''t move to the quick list (' || sqlerrm || ')');
end $$;
do $$
begin
  update public.shop_items set status = 'wishlist' where id = 'b7000000-0000-0000-0000-0000000000a4';
  set constraints all immediate;
  perform public.t_bug('7d', false, 'a thing whose money paid for another went back to the wishlist');
exception when others then
  perform public.t_bug('7d', sqlstate = '23514', 'a thing whose money paid for another can''t go back to the wishlist (' || sqlerrm || ')');
end $$;
do $$
begin
  insert into public.shop_items (id, user_id, title, price, status, bought_at) values ('b7000000-0000-0000-0000-0000000000e1', auth.uid(), 'Tablet', 4000, 'bought', '2026-01-01 12:00+01');
  insert into public.shop_items (id, user_id, title, kind, status) values ('b7000000-0000-0000-0000-0000000000e2', auth.uid(), 'Any e-reader', 'general', 'wishlist');
  insert into public.shop_items (id, user_id, title, price, status, option_for, bought_at)
    values ('b7000000-0000-0000-0000-0000000000e3', auth.uid(), 'Kobo', 2000, 'bought', 'b7000000-0000-0000-0000-0000000000e2', '2026-02-01 12:00+01');
  insert into public.shop_item_links (from_id, to_id) values ('b7000000-0000-0000-0000-0000000000e1', 'b7000000-0000-0000-0000-0000000000e2');
  begin
    insert into public.shop_item_links (from_id, to_id) values ('b7000000-0000-0000-0000-0000000000e3', 'b7000000-0000-0000-0000-0000000000e1');
    set constraints all immediate;
    perform public.t_bug('7e', false, 'tablet → e-reader wish + its Kobo → tablet: a loop through a fulfilled wish was accepted');
  exception when others then
    perform public.t_bug('7e', sqlstate = '23514', 'a loop through a fulfilled wish is refused (' || sqlerrm || ')');
  end;
end $$;

-- 8 · A general wish with models stays general (buying a model then fails).
do $$
begin
  insert into public.shop_items (id, user_id, title, kind, status) values ('b8000000-0000-0000-0000-00000000000e', auth.uid(), 'Any headphones', 'general', 'wishlist');
  insert into public.shop_items (id, user_id, title, price, status, option_for) values ('b8000000-0000-0000-0000-00000000000d', auth.uid(), 'Sony', 3000, 'wishlist', 'b8000000-0000-0000-0000-00000000000e');
  begin
    update public.shop_items set kind = 'item' where id = 'b8000000-0000-0000-0000-00000000000e';
    set constraints all immediate;
    perform public.t_bug('8', false, 'a general wish with a model became an item');
  exception when others then
    perform public.t_bug('8', sqlstate = '23514', 'a general wish with a model stays general (' || sqlerrm || ')');
  end;
end $$;

-- 9 · A row put back from a snapshot that lacks a key takes the column's default, and a generated column
--     added later doesn't break the restore.
do $$
begin
  perform public.shop_restore_items(jsonb_build_object('items', jsonb_build_array(jsonb_build_object(
    'id', 'b9000000-0000-0000-0000-00000000000a', 'user_id', '00000000-0000-0000-0000-000000000001', 'title', 'Mixer',
    'price', 900, 'currency', 'NOK', 'status', 'wishlist', 'list', 'wishlist'))));
  perform public.t_bug('9a', (select kept and kind = 'item' and errand = false from public.shop_items where id = 'b9000000-0000-0000-0000-00000000000a'),
    'a snapshot row without kept/kind/errand comes back with their defaults');
exception when others then
  perform public.t_bug('9a', false, 'a snapshot row without kept failed: ' || sqlerrm);
end $$;
reset role;
begin;
alter table public.shop_items add column complaint_until date generated always as (public.oslo_day(bought_at) + 730) stored;
set role authenticated;
do $$
declare s jsonb;
begin
  insert into public.shop_items (id, user_id, title, price, status, bought_at) values ('b9000000-0000-0000-0000-00000000000b', auth.uid(), 'Kettle', 400, 'bought', '2026-03-02 12:00+01');
  s := public.shop_delete_items(array['b9000000-0000-0000-0000-00000000000b']::uuid[]);
  perform public.shop_restore_items(s);
  perform public.t_bug('9b', (select complaint_until = '2028-03-01' from public.shop_items where id = 'b9000000-0000-0000-0000-00000000000b'),
    'a deleted row comes back with a generated column added since (computed again)');
exception when others then
  perform public.t_bug('9b', false, 'a restore with a generated column failed: ' || sqlerrm);
end $$;
reset role;
rollback;
