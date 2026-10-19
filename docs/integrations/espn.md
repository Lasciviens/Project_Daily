# ESPN (football)

Checked: 19.10.2026 against live answers, saved trimmed as test samples in `scripts/fixtures/espn/`
(Galatasaray's fixtures and results, the Champions League and Süper Lig tables, a month of the Champions
League, Galatasaray's squad and club, one match summary, team and league search). `verify-football-model`
reads them through the real parsers.

**Not an official API.** ESPN closed its public developer API in 2014. These are the undocumented endpoints
espn.com's own pages use: free, no key, current data — and unsupported: a field or a whole endpoint can change
or go without warning. So every answer is checked where it enters (`footballModel.ts` parsers turn anything
odd into "nothing", never a crash), the page renders inside `ErrorBoundary`, and a failed read says "Football
data isn't available right now". Private, read-only, low volume (a person's page) — never anything public or
commercial.

## How we authenticate

None. The browser calls ESPN directly: every answer carries `access-control-allow-origin: *`, there is no key
or secret, and nothing is sent but the ids in the URL. No edge function.

## Endpoints we call

Base `https://site.api.espn.com`; search on `https://site.web.api.espn.com`.

| Endpoint | Called by | When | Limits |
|---|---|---|---|
| `GET /apis/site/v2/sports/soccer/all/teams/{teamId}/schedule?fixture=true` | `espnApi.fetchTeamFixtures` | a followed team's next matches, **every competition in one call** (Süper Lig + Champions League for Galatasaray); the subscription's sync | the whole season ahead |
| `GET /apis/site/v2/sports/soccer/all/teams/{teamId}/schedule` | `espnApi.fetchTeamResults` | a followed team's results this season | newest first |
| `GET /apis/site/v2/sports/soccer/{league}/scoreboard?dates=YYYYMM` | `espnApi.fetchLeagueMonth` | a followed tournament's matches: this month and next | **a day range (`YYYYMMDD-YYYYMMDD`) answers 400 for the Champions League** — a month (`YYYYMM`) or one day works |
| `GET /apis/v2/sports/soccer/{league}/standings` | `espnApi.fetchStandings` | tables | one table per group (`children[]`) |
| `GET /apis/site/v2/sports/soccer/{league}/teams/{teamId}` | `espnApi.fetchTeam` | the club popup | `all` as the league works and gives the club's own (`defaultLeague`) |
| `GET /apis/site/v2/sports/soccer/{league}/teams/{teamId}/roster` | `espnApi.fetchRoster` | the club popup's squad, the player popup | needs a real league: under `all` it answers an empty squad |
| `GET /apis/site/v2/sports/soccer/{league}/summary?event={eventId}` | `espnApi.fetchMatch` | the match popup; a planned match outside the subscription is re-checked by it | ~200 KB; we read `header`, `gameInfo`, `rosters` |
| `GET /apis/search/v2?query=…&limit=10` (site.web.api) | `espnApi.search` | "+ Follow": teams and tournaments | mixed sports — only `sport: "soccer"` kept |

`cache-control: max-age` is 1–9 seconds; we cache in the app instead (TanStack Query: tables and squads
`STALE.long`, fixtures `STALE.default`, a match being played `STALE.live` with a refetch every minute only
while one is live).

## Fields we read

| Field | Shape seen | Where it goes |
|---|---|---|
| `events[].id`, `date` (UTC `2026-10-21T16:45Z`), `timeValid` | string, ISO without seconds, boolean | match id, kick-off (shown in Europe/Oslo), whether the time is fixed |
| `events[].league.slug`, `.name` (schedule only) | `uefa.champions`, `UEFA Champions League` | the competition |
| `competitions[0].competitors[]`: `homeAway`, `team.id`, `.displayName`, `.shortDisplayName`, `.abbreviation`, logo | logo is `team.logos[0].href` in a schedule, `team.logo` (string) in a scoreboard | the two sides |
| `competitors[].score` | **an object `{ value, displayValue }` in a schedule, a string `"2"` in a scoreboard**, absent before kick-off | the score |
| `competitors[].winner` | boolean | W / D / L |
| `status.type.state` / `.name` / `.shortDetail`, `status.displayClock` | `pre` / `in` / `post`; `STATUS_POSTPONED`, `STATUS_CANCELED`; `"FT"`; `"67'"` | live, done, postponed |
| `competitions[0].venue.fullName`, `.address.city` | text | stadium |
| `seasonType.name` | `"League Phase"` | the round |
| `competitions[0].details[]` (scoreboard): `type.text`, `clock.displayValue`, `athletesInvolved[0].displayName`, `team.id` | `"Goal"`, `"22'"` | goals in a match row |
| standings `name` (the tournament), `children[].name`, `.standings.entries[]`: `team`, `note.{color,description}`, `stats[]` by `name` | `rank`, `gamesPlayed`, `wins`, `ties`, `losses`, `pointsFor`, `pointsAgainst`, `pointDifferential`, `points` | tables; the note's colour marks qualification places |
| roster `athletes[]`: `displayName`, `jersey`, `position.name`, `age`, `dateOfBirth`, `citizenship`, `flag.href`, `height` (inches), `weight` (lbs) | **imperial** — shown as cm / kg | squad, player popup |
| team: `logos[0].href`, `color`, `standingSummary`, `record.items[0].summary`, `nextEvent[0]`, `defaultLeague.slug` | `"1st in Turkish Super Lig"`, `"6-1-1"` (W-D-L) | club popup |
| summary `rosters[]`: `homeAway`, `formation`, `roster[]`: `starter`, `jersey`, `athlete.displayName`, `position.abbreviation` | `"4-4-2"` | line-ups |
| summary `gameInfo.venue.fullName`, `.attendance` | text, number | match popup |
| search `results[]` of type `team` / `league`: `contents[].displayName`, `uid` (`s:600~t:432`), `defaultLeagueSlug`, `subtitle`, `image.default`, `sport` | | "+ Follow" |

## Fields we deliberately don't use

- **Odds, pick center, betting** (`odds`, `pickcenter`): not wanted.
- **Broadcasts**: US channels only (`Paramount+`), wrong for Norway.
- **News, videos, articles** in search and summary: a lot of data for little use; links go to espn.com instead.
- **Headshots**: rarely present for football players.

## Traps

- **Score shape differs** between endpoints (object vs string) — `footballModel.scoreOf` reads both.
- **A scoreboard says `"0"` before kick-off** — a score is read only once a match is live or over.
- **A squad needs a real league**: `all/teams/{id}/roster` answers an empty list; the club's own league comes from `all/teams/{id}` (`defaultLeague.slug`).
- **A scoreboard's events have no `seasonType`** (no round name); a summary's `header` has no venue — it is in `gameInfo.venue`; `attendance` is `0` when unknown.
- **A day range fails** on some leagues' scoreboard (400 "Failed to get events endpoint."); a month works.
- **`timeValid: false`**: far-ahead fixtures carry a placeholder time. They show as "time not set" and are never put
  in your day with a time until ESPN fixes it (the subscription waits for it).
- **Times are UTC** (`Z`) with no seconds; `status.type.detail` is in US Eastern time — never shown.
- **Names**: `name` reads "Galatasaray at Lille" (away first, American style); titles are built home first
  ("Lille – Galatasaray").
- **Imperial units** in rosters.
- **Results are newest first**, fixtures oldest first.
- **Mixed sports in search** (golf, rugby…); filter `sport === 'soccer'`.
- **Compressed answers**: some scoreboard answers come gzip-encoded (browsers handle it; `curl` needs `--compressed`).
- The World Cup 2026 has ended and the Euro's last edition is 2024: following them (`fifa.world`, `uefa.euro` — both checked
  live 19.10.2026) shows their next edition when ESPN lists it; the qualifiers (`fifa.worldq.uefa`, `uefa.euroq`) are
  tournaments of their own.

## Log

### 19.10.2026 — first use

The Football page under Media (`docs/features/football.md`): followed teams and tournaments, fixtures,
results, tables, club, squad and match popups, "Plan it" and subscribing to a team. Every endpoint above was
read live once; the samples are in `scripts/fixtures/espn/`.
