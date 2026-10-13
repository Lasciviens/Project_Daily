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
- [ ] UI change checked at 402 / 1469 / 2450px
- [ ] Visible dates are DD.MM.YYYY
- [ ] Every user action shows its result; deletes ask and offer Undo
- [ ] Real-data / E2E check — what was run and what it returned:

## Docs

- [ ] `docs/features/<feature>.md` and `.claude/rules/<area>.md` updated — or N/A
- [ ] `AGENTS.md` updated (a rule or the map changed) — or N/A
- [ ] A step only the owner can do is in `docs/deploy-checklist.md` — or N/A

## Scope

Owner: Claude / Codex
<!-- One AI per file: the files this PR changes are claimed on docs/codex-shortcuts.md. -->
