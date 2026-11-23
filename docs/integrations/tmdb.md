# TMDB (The Movie Database)

Checked: 23.11.2026 against TMDB's own documentation (https://developer.themoviedb.org/docs/authentication-application and
https://developer.themoviedb.org/reference/intro/authentication: an application can send the **API Read Access Token** as
`Authorization: Bearer <token>` on every v3 endpoint, or the v3 **API Key** as the `api_key` query parameter). **No live call was made
from a development session** (no token there): the Bearer header is as TMDB documents it, and the browser path was exercised against the
harness's made-up TMDB answers only — the first real deploy is the live check (`docs/deploy-checklist.md`, "TMDB read token").

Media's feature description: `docs/features/media.md`; the Trakt sync that also calls TMDB: `docs/integrations/trakt.md`.

## How we authenticate

- **Since 23.11.2026: the v4 "API Read Access Token" as `Authorization: Bearer`**, never in a URL (AGENTS.md → Security: a key never
  travels in a URL when the API takes a header). Before, the v3 key went in `?api_key=` from both places below, so it was in every request
  URL (browser history, a proxy's log, an error message).
- **Browser** (`src/integrations/tmdb/client.ts`, `tmdbFetch`): `VITE_TMDB_READ_TOKEN`, a GitHub Actions secret baked into the website at
  build time. A browser has no place to hide it, so it is in the public bundle: it is a read-only token, which is why it is "client-safe", and
  the header only stops it from leaking through URLs. The real fix for the bundle would be a TMDB proxy behind the owner's login (an edge
  function that holds the token) — a bigger change with its own plan, not done here.
- **Function** (`trakt-api`: `tmdb()` and `tmdbQ()`): `TMDB_READ_TOKEN`, an Edge Function secret. Same token, set in its own place so each can
  be rotated alone.
- **Fail closed:** a missing value, or one that is not shaped like the token (three dot-separated parts — the 32-character v3 key is not),
  stops the call before anything is sent, with a plain message naming the secret (`TMDB_READ_TOKEN is not set …` /
  `VITE_TMDB_READ_TOKEN is not set …`). There is no fallback to the old key in the URL. `verify-secret-errors` checks the header, the empty
  URL and the refusals.
- Where to get it and where to set it: `docs/deploy-checklist.md`, "TMDB read token".

## Endpoints we call

| Endpoint | Called by | When |
|---|---|---|
| `GET /3/search/movie`, `/3/search/tv` | Media search, and the Trakt match picker (`TraktMatchSheet`) | typing a title (the picker: title + year, 400 ms after the last key) |
| `GET /3/movie/{id}`, `/3/tv/{id}` (+ `append_to_response`), `/3/tv/{id}/season/{n}`, `/3/collection/{id}`, `/3/trending/…`, `/3/discover/…`, `/3/watch/providers/…` | the Media pages (`tmdbApi.ts`) | opening a title, discovery lists |
| `GET /3/movie/{id}`, `/3/tv/{id}` | `trakt-api` (`tmdb()`) | adding a title that came from Trakt; telling Completed from Watching |
| discover / collection / person / company / keyword reads | `trakt-api` Follows (`tmdbQ()`) | the daily follow check, Check now |
| `https://image.tmdb.org/t/p/{size}{path}` | Media screens | pictures (no key) |

## Fields we read

The ones the Media code types in `src/features/media/types.ts`. The Trakt match picker reads only `id`, `title` / `name`,
`release_date` / `first_air_date`, `poster_path` and `overview` of a search result, shows them as text, and keeps only the `id` (a positive
integer) when a pick is saved.

## Traps

- TMDB's search is by title and returns many titles of the same name: the picker lists the year Trakt gave first and shows the overview.
- A TMDB id of the wrong kind (a show's id for a movie) is a different title, not an error: a saved pick shows the title TMDB reports for it.
- A 401 means the token itself is refused: the run stops with that message instead of trying every title.
