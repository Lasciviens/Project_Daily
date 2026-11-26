# Strava

Checked: 26.11.2026 against Strava's own docs (developers.strava.com/docs/authentication and /docs/reference → Fault, Error).
Older notes on the Strava connection are in `docs/backend/edge-functions.md` (`strava-auth` / `strava-activities` /
`strava-disconnect`) and `docs/features/training.md`; this file starts with the 212 change (notifications).

## How we authenticate
OAuth 2 (Settings → Subscriptions → Strava). `STRAVA_CLIENT_ID` and `STRAVA_CLIENT_SECRET` are edge-function secrets; the
access and refresh tokens are in `strava_tokens` (service role only). `strava-activities` refreshes an access token that
ends within 5 minutes.

## Endpoints we call
| Endpoint | Called by | When | Limits |
|---|---|---|---|
| `POST https://www.strava.com/oauth/token` (`grant_type=refresh_token`) | `strava-activities` | an access token that ends within 5 minutes | — |
| `GET https://www.strava.com/api/v3/athlete/activities` | `strava-activities` | the app's Strava sync | Strava's app rate limits |
| `POST https://www.strava.com/oauth/revoke` | `strava-disconnect` | Disconnect | — |

## Fields we read and write
| Field | Shape seen | Where it goes |
|---|---|---|
| `access_token`, `refresh_token`, `expires_at` (token answer) | strings; `expires_at` Unix seconds | `strava_tokens` |

## Fields we deliberately don't use
The error body of a refused refresh (see Traps): not read until its shape is confirmed.

## Traps
- **Refresh tokens rotate.** "The refresh token may or may not be the same refresh token used to make the request", and
  "once a new refresh token is returned, the older refresh token is invalidated immediately". The function stores the
  newest one on every refresh (212's settle trigger reads that write as "the sign-in works again").
- **A refused refresh token's answer is not documented.** The docs say tokens invalidated by deauthorization get
  "401 Unauthorized"; an error answer is a `Fault` (`message`, `errors[]` of `{resource, field, code}`), but no example
  for a bad `refresh_token` is given (26.11.2026). A 400 with `errors[].field = 'refresh_token'`, `code = 'invalid'` is
  reported elsewhere but not confirmed here, so since 212 only a **401** makes the "Strava needs you to sign in again"
  notice. Confirm a live 400 body before reading it.

## Log
### 26.11.2026 — notifications (212)
A refused refresh (401) calls `notify_service_problem(user, 'strava')`; a stored refresh token (connect or a refresh that
worked) settles that notice. Rechecked the token and Fault docs.
