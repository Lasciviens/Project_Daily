# External APIs

Every **new** external API gets its own file here, `<service>.md`, written before its code ships (rule in `AGENTS.md` → Workflow). APIs added before 13.10.2026 get a file only when they are next worked on; until then their notes are in the feature docs (`docs/features/`) and `docs/backend/edge-functions.md`.

Copy this outline:

```markdown
# <Service>

Checked: DD.MM.YYYY against <the provider's docs page / one live sample>.

## How we authenticate
Key, OAuth or device secret; where the secret is set (never its value); which edge function holds it.

## Endpoints we call
| Endpoint | Called by | When | Limits |

## Fields we read and write
| Field | Shape seen | Where it goes |

## Fields we deliberately don't use
And why.

## Traps
Real surprises: odd shapes, rate limits, error bodies, time zones.

## Log
### DD.MM.YYYY — what changed
What this change added, fixed or re-checked against the provider (newest first).
```

Every service page keeps that dated **Log** at its end (owner, 14.10.2026): each change to the integration adds
an entry on top, so the page says what was checked or changed and when.
