# PlayStation Network

Checked: 27.11.2026 against the source of the community `psn-api` package 2.18.1 (`src/authenticate/*.ts`, from its
published source map). Sony publishes no API documentation at all; the wider PlayStation notes (the npsso flow, the
two id systems, the playtime library) are in `docs/features/games.md`. This file starts with the 214 change
(notifications: "PlayStation needs you to sign in again").

## How we authenticate
The owner pastes an npsso (Settings → Subscriptions → PlayStation, `PsnNpssoForm`); `psn-api` (edge function) exchanges
it for an access token (about an hour) and a refresh token, kept in `psn_tokens` (service role only, 140). The function
refreshes the access token when it ends within 5 minutes. The client id and secret in the token requests are the
package's own constants (Sony's mobile app), not ours.

## Endpoints we call
| Endpoint | Called by | When | Limits |
|---|---|---|---|
| `GET https://ca.account.sony.com/api/authz/v3/oauth/authorize` (npsso cookie → access code) | `psn-api` `connect` | the owner pastes an npsso | — |
| `POST https://ca.account.sony.com/api/authz/v3/oauth/token` (`grant_type=authorization_code` / `refresh_token`) | `psn-api` | connect; an access token that ends within 5 minutes | unknown |
| Trophy, played-games and purchased-games calls | `psn-api` | the Games page | see `docs/features/games.md` |

## Fields we read and write
| Field | Shape seen | Where it goes |
|---|---|---|
| `access_token`, `refresh_token`, `expires_in` (token answer, through the package's `accessToken`, `refreshToken`, `expiresIn`) | strings; seconds | `psn_tokens` |
| the pasted `npsso` and `expires_in` (Sony's ssocookie answer) | string; seconds | `psn_tokens.npsso`, `npsso_expires_at` |

## Fields we deliberately don't use
The token endpoint's error body (`error`, `error_description`): the package never hands it back, and Sony documents it
nowhere, so the function can't tell one refusal from another.

## Traps
- **The package never checks the token answer.** `exchangeRefreshTokenForAuthTokens` reads `raw.access_token` from
  whatever came back, whatever the HTTP status. A refused refresh token therefore arrives as an answer **without an
  access token**, not as an error — that is what `psn-api` reads as "the sign-in is gone": it calls
  `notify_service_problem(user, 'psn')`, answers `reauth_required` and writes nothing to `psn_tokens`.
- **False alarm:** *any* JSON answer without an access token counts — a 429 (rate limit) or a 5xx with a JSON body too.
  The owner may then see "PlayStation needs you to sign in again" while the sign-in is fine. It heals by itself: the
  next refresh that works writes a refresh token, and 214's trigger on `psn_tokens` reads the notice. A network failure
  or an answer that isn't JSON throws and makes no notice. At most one notice per Oslo day (212's dedupe).
- Before 214 a refused refresh was written back: the dead access token kept and its expiry moved an hour on.

## Log
### 27.11.2026 — the refused sign-in tells the bell (migration 214)
The refresh point checks the access token, tells the bell through `notify_service_problem` (best effort, in try/catch:
a failed notice never changes the answer) and writes nothing on a refusal; a fresh sign-in written to `psn_tokens`
settles the notice. Re-read the package's authenticate source for 2.18.1.
