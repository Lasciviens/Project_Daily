-- Before 190 (scripts/verify-db-shop-rules.mjs runs it after 188, before 190's first run): rows that already cross
-- accounts, which a foreign key let in because it ignores row level security — account 5's subcategory under the
-- owner's category, and account 5's thing in the owner's category. 190 must cut both links (signals.sql Q9 checks)
-- and refuse new ones. Made-up names; written as the superuser, as an old write would have landed.
insert into auth.users values ('00000000-0000-0000-0000-000000000005') on conflict do nothing;
insert into public.app_allowed_users values ('00000000-0000-0000-0000-000000000005') on conflict do nothing;
insert into public.shop_categories (id, user_id, name, parent_id) values
  ('ca900000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Owner top', null),
  ('ca900000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Owner sub', 'ca900000-0000-0000-0000-000000000001'),
  ('ca900000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000005', 'Planted sub', 'ca900000-0000-0000-0000-000000000001'),
  ('ca900000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000005', 'Their own top', null);
insert into public.shop_items (id, user_id, title, status, category_id) values
  ('ca900000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-000000000005', 'Planted thing', 'wishlist', 'ca900000-0000-0000-0000-000000000002'),
  ('ca900000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-000000000005', 'Their own thing', 'wishlist', 'ca900000-0000-0000-0000-000000000006'),
  ('ca900000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', 'Owner thing', 'wishlist', 'ca900000-0000-0000-0000-000000000002');
