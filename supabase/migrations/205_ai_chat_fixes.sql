-- 205 · Ask AI fixes (owner, 24.11.2026: the chat guessed a food's fat, could not fix what it had saved, and left several
-- Confirm cards for one thing). Two CHECKs widen; no table, no column, no grant changes.
--
--   · ai_chat_proposals.tool: two new kinds of proposal, both CHANGES of one existing row, each still held for the owner's
--     Confirm: `update_food` (one eaten one-off food line of the last 60 days: its title and/or its four figures) and `update_task` (one
--     task's title). The `claude` function checks every stored argument again at Confirm and writes with the owner's own
--     token (chat-tools.ts `applyChange`); the browser still cannot write this table (197's grants are unchanged).
--   · ai_chat_proposals.status: `replaced` — a newer proposal for the same thing took a pending one's place. Like the other
--     decided states it needs `decided_at` (197's ai_chat_proposals_decided); a replaced proposal can never be confirmed
--     (the function only claims a row that is still `pending`).
--   · ai_tool_settings: the two new write tools can never be `on` (198's rule for every write tool): ask first or off only.
--     A stray "on" row for them (198's CHECK did not know their names) becomes "ask" first.
--
-- Idempotent: each constraint is dropped if it exists and made again. No BEGIN/COMMIT (the deploy runs the file as one
-- transaction). The old rows all pass the wider checks.

alter table public.ai_chat_proposals drop constraint if exists ai_chat_proposals_tool_check;
alter table public.ai_chat_proposals add constraint ai_chat_proposals_tool_check
  check (tool in ('add_task', 'log_food', 'update_food', 'update_task'));

alter table public.ai_chat_proposals drop constraint if exists ai_chat_proposals_status_check;
alter table public.ai_chat_proposals add constraint ai_chat_proposals_status_check
  check (status in ('pending', 'confirmed', 'cancelled', 'failed', 'replaced'));

-- A row saved before this ran could already say "on" for a new write tool (198's CHECK did not know their names): it
-- becomes "ask", the safe side, so the new CHECK can be added and no write tool is ever on.
update public.ai_tool_settings set mode = 'ask' where tool in ('propose_update_food', 'propose_update_task') and mode = 'on';

alter table public.ai_tool_settings drop constraint if exists ai_tool_settings_write_never_on;
alter table public.ai_tool_settings add constraint ai_tool_settings_write_never_on
  check (not (tool in ('propose_add_task', 'propose_log_food', 'propose_update_food', 'propose_update_task') and mode = 'on'));
