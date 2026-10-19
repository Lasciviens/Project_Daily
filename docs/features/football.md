# Football

> Built 19.10.2026 (migration 163). Owner: "is ESPN data free? can we pull and create a football page? readonly", then "Under Media. One page … mostly Galatasaray, Champions League, World Cup, Euro … possible to enter new teams or new tournaments … It don't need to be a fancy SofaScore or FotMob app… Just simply showing games, tables, fixtures in a modern way. If possible; players information, club information … to be able to plan these things to my daily day life". Planning: "Subscribe on a team + plan it. So both".

Football had been dropped on 07.10.2026 because no free source covered current fixtures (API-Football's free tier stops at 2024). ESPN's site endpoints do, free and without a key — but unofficially: `docs/integrations/espn.md` has every endpoint, field and trap.

## What is stored, what isn't

- **ESPN's data is never stored.** The browser reads it (`api/espnApi.ts`, the only file that calls ESPN) and TanStack Query caches it: tables and squads 10 minutes, fixtures 5, a match being played is read again every minute. Every answer goes through `footballModel.ts`'s parsers, which take `unknown` and turn anything odd into "nothing"; the page and each popup render inside an `ErrorBoundary`, and a failed read says what couldn't be read with a Try again.
- **The owner's choices are** (migration 163):
  - `football_follows` — a team (ESPN's number) or a tournament (its slug, `uefa.champions`), its name and logo as seen when following, a team's own league, and `subscribed`. A tournament can't be subscribed.
  - `football_plans` — a match put in the day: ESPN's match id, its tournament, the **task** it became (the one `tasks` table), the kick-off and whether ESPN had fixed it when planned, and its origin (subscription or Plan it). Deleting the task leaves the row with no task (`ON DELETE SET NULL`), so the subscription never adds that match again; Undo links it back.

## The page (`/football`, Media & play)

- **Header:** Follow (primary), and once two things are followed, a filter row — All, then each team and tournament (`?f=team:432`).
- **Live** (only while something is played), **Coming up** (the next 30 days, by Norwegian day — "Today", "Tomorrow", "Wed 21.10.2026" — and inside a day by competition), **Results** (the last 10 days, newest first). A match is one line: home | time or score | away, as football writes it; a small calendar mark under the time means it is in your day. Its details wait behind a tap.
- **Tables:** each followed tournament's, then each followed team's league. A long table shows the top four and two rows either side of each followed team (`tableSlice`), with "Show all"; a group stage shows the groups with a followed team ("Show all · 11 more groups"). Zones are a dot in a theme tone (relegation red), their meaning behind "Key"; ESPN's own colours aren't used.
- **Following:** each team with Subscribe / Subscribed, and ⋯ → Unfollow (asks, then "Galatasaray unfollowed · Undo"). A team opens its club popup; a tournament sets the filter.
- **Nothing followed yet:** the four the owner named — Galatasaray, Champions League, World Cup, Euro — one tap each, and Search others.
- Layout (`footballBoard.ts`, `verify-feature-boards`): one column on a phone; from the laptop the matches in main and tables + Following beside; Results gets its own track at 1920 and Following one at 2450. A match list is at most 40rem wide (W2).

## The popups

- `football-follow` — search ESPN (football only: teams and tournaments, the qualifiers are tournaments of their own), Follow per row; suggestions before anything is typed.
- `football-team` — the club's logo and name, where it stands ("1st in Turkish Super Lig · W-D-L 6-1-1"), Follow or Subscribe, On ESPN, its form (the last five results as W / D / L — each opens its match), its next match and its squad by position (number, name, flag, age). ESPN reads a club under any league (`all` gives its own league), a squad only under a real one.
- `football-player` — number, position, age and birthday (DD.MM.YYYY), nationality, height in cm and weight in kg (ESPN gives inches and pounds).
- `football-match` — both clubs (each opens its popup), the score or kick-off, Full time / the live minute / Postponed, the goals by minute, the stadium and crowd, both line-ups with their formation (the bench behind a tap) — "Line-ups come about an hour before kick-off" until then — and **Plan it**, or **In your day** once planned (opens the item).

## Into the day

- **Plan it** opens the one Add sheet (`useEntityModal` → `task`) prefilled: "⚽ Lille – Galatasaray" (home first), Norway's day and kick-off, two hours, the competition, round and stadium as notes, Personal. The owner can change anything before Add; once saved, the match's record is written (`useRecordPlan`). A match with no fixed kick-off yet is prefilled with its day only.
- **Subscribe** on a team: its coming matches go into the day by themselves — every match with a fixed kick-off in the next 45 days, once (`footballModel.syncPlan`). Each one is saved through `app_football_plan`, which calls the item save (`app_save_item`) and writes the record in the **same transaction**, so a match is never added twice or without its record; Google follows as for any item (a time → Google Calendar). Turning Subscribe off adds nothing new; matches already in the day stay ("…the ones there stay"), and so does Unfollow.
- **A moved kick-off** (TV schedules move matches, ESPN fixes far-ahead times late): a planned match — subscribed or planned by hand — whose kick-off ESPN changed moves its item to the new day and time; the owner's own title, notes, priority, length and Google choice stay. A closed item, or a repeat's day, is left alone. Postponed and cancelled matches are left as they are.
- **When it runs:** when the app opens or comes back to the front (at most every 30 minutes, `useAppBootstrap`), when the Football page opens, and right after Subscribe is turned on. It says what it did once ("Football: 2 matches added to your day · 1 moved to a new kick-off"); nothing to do says nothing; a failure is logged once (Developer → Errors), never a toast on every open. While the app is closed nothing runs (iOS allows no background work) — the next open catches up.

## Decisions

- **Not stored, not server-side.** No edge function: ESPN answers any origin and needs no key, and keeping matches out of the database means nothing goes stale there.
- **A tournament can't be subscribed** — a whole Champions League in the day is never wanted; plan its matches one by one.
- **Unsubscribe and Unfollow keep what is in the day** — those are the owner's tasks now; deleting them is a task delete, with its own question and Undo.
- **The assistant reads the two tables, never writes them** (`DB_CATALOG`: `ro`): it can't reach ESPN, so it couldn't follow or plan correctly.

## Not tested against

The real ESPN from the deployed site and the iPhone: the browser test runs the real app against the saved ESPN samples and an in-memory database.
