# AI phase 1 — paused on 20.11.2026 (owner: "pause")

The work is on branch `claude/charming-newton-yhk8i-ai-foundation` (draft PR #619). It is **unfinished and unchecked**: do not merge.

Three helpers were stopped mid-work. Their code is on the branch as work-in-progress snapshots.

## To pick it up

1. Read `docs/features/ai-plan.md` (the approved plan; §8 is the "AI last" discovery plan, for later phases).
2. Read `docs/features/ai-phase1-contract.md` (the exact tables, the function's request and answer shapes, who owns which file).
3. Read the three notes here — `database.md`, `function.md`, `app.md`: what is done, what is written but unchecked, what is left, the decisions made and the commands. They were written a few minutes before the pause, so compare them with the files on the branch first.
4. Finish what each note lists as left. Nothing new goes into this phase (owner, 20.11.2026).
5. Run every check (`npx tsc --noEmit -p tsconfig.app.json`, `npx eslint .`, `npm run build`, `node scripts/verify-bundle-budget.mjs`, `node scripts/run-all-verify.mjs` with `DEPLOY_TEST_DB_URL`), the Deno check of `supabase/functions/claude/index.ts`, and look at the five views in the phone layout.
6. Run the guardian review (a new table, a new edge function, an API key).
7. Delete this folder and `docs/features/ai-phase1-contract.md` in the PR that finishes phase 1.

## Owner's wishes for the rest of the build

- Nothing new in this phase.
- Save progress often.
- Routine building may run on a cheaper model; the design and the security review stay on the strong one.
