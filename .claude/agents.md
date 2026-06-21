# Lasci's Board — Agent Roster

> Reference for all specialized agents. Tells you which agent to invoke, when, and what each one owns.

---

## Agent Index

| Agent | File | One-liner |
|---|---|---|
| **Flex** | `.claude/agents/flex.md` | Mobile & responsive — breakpoints, touch targets, layout |
| **Guardian** | `.claude/agents/guardian.md` | Security — RLS, auth, API keys, Edge Function proxies |
| **Mira** | `.claude/agents/mira.md` | DB & migrations — schema, Supabase patterns, RLS templates |
| **Forge** | `.claude/agents/forge.md` | Feature scaffolding — types → api → hooks → component → page |
| **Deploy** | `.claude/agents/deploy.md` | CI/CD — GitHub Actions, Edge Functions, build config, env vars |
| **Debug** | `.claude/agents/debug.md` | Triage & fix — build errors, runtime crashes, TypeScript issues |

---

## When to Invoke Which Agent

```
New UI component or page layout change?
  → Always invoke Flex (responsive review)

New Supabase table, external API, or auth change?
  → Always invoke Guardian

Blank-page feature (new route + data layer)?
  → Forge to scaffold, then Guardian for RLS, then Flex for responsive pass

Database query wrong / migration needed?
  → Mira

Build failing / TypeScript error / runtime crash?
  → Debug

GitHub Actions broken / env var missing / Edge Function not deploying?
  → Deploy
```

## Mandatory Handoffs

| Trigger | Primary | Must also call |
|---|---|---|
| New Supabase table | Mira | Guardian (RLS policy) |
| New feature page | Forge | Flex (responsive) + Guardian (if new table) |
| New external API integration | Guardian | Deploy (new env var) |
| New Edge Function | Guardian | Deploy (deployment config) |
| Any new interactive component | (whoever builds it) | Flex (responsive review) |

---

## Agent Interaction Patterns

### Pattern A — New full feature
```
1. Forge: scaffold types + api + hooks + page shell
2. Mira: write migration for any new tables
3. Guardian: RLS policy review
4. (developer fills business logic)
5. Flex: responsive pass on every new component
6. Deploy: if new env vars or Edge Functions needed
```

### Pattern B — UI-only change
```
1. Developer builds the component
2. Flex: mandatory responsive review before commit
```

### Pattern C — Data model change
```
1. Mira: write migration + update TypeScript types
2. Guardian: verify RLS in new migration
3. Forge (optional): update api/hooks to match new schema
```

### Pattern D — Debug session
```
1. Debug: triage the error, identify root cause
2. Delegate to Mira/Flex/Deploy based on root cause domain
```

---

## What Lives Where

| Topic | Source of truth |
|---|---|
| Mobile/responsive rules | `CLAUDE.md` + `flex.md` |
| Security rules | `CLAUDE.md` + `guardian.md` |
| DB schema | `supabase/migrations/` (SQL) + `mira.md` (patterns) |
| Build/deploy config | `.github/workflows/deploy.yml` + `deploy.md` |
| Feature patterns | `CLAUDE.md` + `forge.md` |
| Toast/modal/headlessui patterns | `CLAUDE.md` |

**Rule:** CLAUDE.md is short-form. Agent files are long-form operational guides. When they conflict, CLAUDE.md wins.

---

## Maintenance

- New agent added → add row to Agent Index above
- Feature completed → update Features table in `CLAUDE.md`
- Table renamed or added → update `mira.md` schema section
- New env var → update `deploy.md` + `deploy.yml`
