-- Scenarios for migration 143 (a closed task leaves Work's focus).
-- Each `ok` raises on a mismatch; the runner fails on the first one.
create or replace function ok(label text, got text, want text) returns void language plpgsql as $$
begin
  if got is distinct from want then raise exception 'FAIL %: got %, want %', label, got, want; end if;
  raise notice 'ok  %', label;
end $$;

select ok('F0 an open focused task keeps its focus', (select is_focused::text from tasks where id='00000000-0000-4000-8000-000000000001'), 'true');
select ok('F0 a task done before 143 left the focus once', (select is_focused::text from tasks where id='00000000-0000-4000-8000-000000000002'), 'false');
select ok('F0 a task cancelled before 143 too', (select is_focused::text from tasks where id='00000000-0000-4000-8000-000000000003'), 'false');

-- F1 ticked off anywhere (Daily, Home, a Google pull): out of the focus
update tasks set status='done' where id='00000000-0000-4000-8000-000000000001';
select ok('F1 done clears the focus', (select is_focused::text from tasks where id='00000000-0000-4000-8000-000000000001'), 'false');
-- F2 reopening does not bring it back
update tasks set status='open' where id='00000000-0000-4000-8000-000000000001';
select ok('F2 reopened stays unfocused', (select is_focused::text from tasks where id='00000000-0000-4000-8000-000000000001'), 'false');
-- F3 focusing again works; cancelling clears it
update tasks set is_focused=true, status='in_progress' where id='00000000-0000-4000-8000-000000000001';
select ok('F3 an open task can be focused', (select is_focused::text from tasks where id='00000000-0000-4000-8000-000000000001'), 'true');
update tasks set status='cancelled' where id='00000000-0000-4000-8000-000000000001';
select ok('F3 cancelled clears the focus', (select is_focused::text from tasks where id='00000000-0000-4000-8000-000000000001'), 'false');
-- F4 a closed task cannot be focused
update tasks set is_focused=true where id='00000000-0000-4000-8000-000000000002';
select ok('F4 a done task refuses the focus', (select is_focused::text from tasks where id='00000000-0000-4000-8000-000000000002'), 'false');
insert into tasks (id, title, status, is_focused) values ('00000000-0000-4000-8000-000000000004', 'Imported done', 'done', true);
select ok('F4 nor is a done task inserted focused', (select is_focused::text from tasks where id='00000000-0000-4000-8000-000000000004'), 'false');
-- F5 other edits leave the focus alone
insert into tasks (id, title, status, is_focused) values ('00000000-0000-4000-8000-000000000005', 'Working on it', 'waiting', true);
update tasks set title='Still working on it' where id='00000000-0000-4000-8000-000000000005';
select ok('F5 a waiting focused task keeps its focus through edits', (select is_focused::text from tasks where id='00000000-0000-4000-8000-000000000005'), 'true');
