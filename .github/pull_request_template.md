## What changed

<!-- What and why, in a few lines. Link the dev_request / issue if there is one. -->

## Deploy and manual steps

<!-- A merge deploys, in order: new migrations (numbered above 140), every edge
     function, then the website (.github/workflows/deploy.yml, once the deploy
     secrets exist — docs/deploy-setup.md). List what it cannot do: secrets,
     dashboard switches, devices. Delete the lines that don't apply. -->

- [ ] Migration(s) that run on merge: `supabase/migrations/NNN_*.sql` (numbered above 140)
- [ ] Edge function(s) changed: `<name>` — a caller without a Supabase JWT needs `verify_jwt = false` in `supabase/config.toml`
- [ ] Edge Function / Vault secret(s) to add or rotate: `<NAME>`
- [ ] Actions secret / variable to add: `<NAME>`
- [ ] Dashboard or device step: …
- [ ] None — ships itself on merge

## Verification

<!-- What was actually run, and the real result. A green build is not
     verification of a behaviour change. -->

- [ ] `npm run build` green
- [ ] UI change checked at 393 / 1469 / 2450px
- [ ] Real-data / E2E check — what was run and what it returned:

## Docs

- [ ] `CLAUDE.md` updated (feature or architecture state changed) — or N/A
- [ ] `AGENTS.md` updated (new DB / RLS / edge-function convention) — or N/A

## Scope

Owner: Claude / Codex
<!-- Codex PRs touch scripts/iphone-shortcuts/** only — docs/codex-shortcuts.md rule 1. -->
