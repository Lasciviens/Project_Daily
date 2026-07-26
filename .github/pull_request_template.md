## What changed

<!-- What and why, in a few lines. Link the dev_request / issue if there is one. -->

## Manual steps after merge

<!-- CI deploys the FRONTEND ONLY. Migrations, edge functions and Vault secrets
     are hand-applied — if it is not listed here it will be forgotten. Delete
     the lines that don't apply. -->

- [ ] Migration(s) to apply (Dashboard -> SQL Editor, or `supabase db push`): `supabase/migrations/NNN_*.sql`
- [ ] Edge function(s) to deploy: `<name>` — check its `verify_jwt` setting in `supabase/config.toml`
- [ ] Vault secret(s) to add or rotate: `<NAME>`
- [ ] Actions secret / variable to add: `<NAME>`
- [ ] None — frontend only, ships itself on merge

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
