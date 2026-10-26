---
paths:
  - "src/features/football/**"
  - "supabase/migrations/*football*"
  - "scripts/db-tests/football/**"
  - "scripts/fixtures/espn/**"
---
# Football rules

Background: `docs/features/football.md`; ESPN's endpoints, fields and traps: `docs/integrations/espn.md`.

- ESPN is called only from `api/espnApi.ts` (verify-football-model checks it), never through an edge function, and its data is never stored — only `football_follows` and `football_plans` are.
- A favourite is a team only (168 checks it, as for `subscribed`); several may be. The Personal page's card reads only `useFavouriteTeamsGlance` — the page's own queries (`espnQueries`), never a read of its own — and shows what `footballGlance.teamGlance` gives (verify-football-model).
- Every ESPN answer goes through `footballModel.ts`'s parsers (take `unknown`, return "nothing" on anything odd); a new field gets a real sample in `scripts/fixtures/espn/` and a check before code reads it. Surfaces render inside `ErrorBoundary`.
- An id or slug goes into an ESPN URL only after `isTeamId` / `isLeagueSlug` (163 checks the same on the stored refs).
- Kick-offs are UTC from ESPN, shown and planned in Norway's time through `osloParts`; dates through `dateFormat` (DD.MM.YYYY).
- A match goes into the day only through the item save: Plan it opens the Add sheet (`usePlanIt`), the subscription calls `app_football_plan` (item + record in one transaction) via `saveItemVia` — never a task insert of its own.
- What the subscription adds or moves is `footballModel.syncPlan`'s alone (checked in verify-football-model); a match whose item was deleted (`task_id` null) is never added again.
- Unsubscribe and Unfollow of a subscribed team take out only what `footballModel.subscriptionLeavers` names (the subscription's coming, still-to-do matches of that team — never Plan it's, a done one, or another subscribed team's), through THE task delete with their records, asking first and with Undo (`useStopSubscription`); a kick-off move never moves an item the owner moved (`itemAtKickoff`).
- Plan it opens a match already in the day instead of a second item, and `recordPlan` never moves a record whose item still exists.
- A followed team's match is never folded or cut away on the page (`footballView.byDayAndLeague`; checked on a real Champions League month).
- Zone colours are THEME tones (`footballView.noteTones`), never ESPN's hex.
