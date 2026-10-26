@AGENTS.md

# Claude Code notes

The rules above are shared with Codex; this part is for Claude only. If the import above did not load, read `AGENTS.md` now.

- `.claude/rules/<area>.md` load by themselves when a matching file is read or edited (their `paths:` frontmatter). Keep each one short — rules and their one-line reasons; the long story goes to `docs/features/`.
- The built-in Explore and Plan subagents don't read this file: when briefing a subagent, name the rule and doc files it must follow.
- A change that spans several features or adds a migration gets an `owner-critic` review (`.claude/agents/owner-critic.md`) before it is reported done.
- Don't narrate routine PR housekeeping (subscriptions, "checking CI", "no comments yet"); speak up when the owner must decide something or something notable happened (merged, a real CI failure, a review comment needing a decision).
- Runs on Claude Code on the web: each session is a fresh container, so anything worth keeping is committed and pushed.
- `.claude/skills/` holds third-party skills (`swiftui-pro`, `apple-design`; sources in `.claude/skills/README.md`). Where one disagrees with `AGENTS.md` or `docs/design/THEME.md` — a 44 pt minimum control, Title Case labels, no in-app theme switch — this repo's rules win.
- **Major upgrades waiting (owner, 26.10.2026: later, one at a time — each is its own project with a plan):** Tailwind CSS 4 (also clears the last 3 `npm audit` warnings, which come from Tailwind 3's build tools), TypeScript 7, vite-plugin-pwa 2. Don't fold them into other work; mention them when the owner plans new work.
