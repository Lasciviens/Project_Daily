# Project skills

Skills Claude Code loads by itself in every session of this repo (owner, 18.10.2026: "add those as skill"). Both are third-party copies. They are not the repo's own rules: where one disagrees with `AGENTS.md` or `docs/design/THEME.md`, the repo wins (see `CLAUDE.md`).

| Skill | What it is for | Source | Licence |
|---|---|---|---|
| `swiftui-pro/` | Writing and reviewing SwiftUI code (an iOS app, widgets) | [twostraws/swiftui-agent-skill](https://github.com/twostraws/swiftui-agent-skill) at `ce32af1` (16.10.2026), folder `swiftui-pro/` | MIT, Paul Hudson (`swiftui-pro/LICENSE`) |
| `apple-design/` | Design reviews against Apple's Human Interface Guidelines, for native and web UIs | [dickwu/apple-design-skill](https://github.com/dickwu/apple-design-skill) at `914b6a3` (15.10.2026) | None given. The guideline text is Apple's, reproduced from developer.apple.com; copied at the owner's choice (18.10.2026) |

Left out on purpose: the plugin and marketplace files, icons and Codex/Cursor/Gemini files of both repos, and `apple-design`'s `scripts/pull-hig.mjs`. Its `SKILL.md` still names that script; reviews don't need it.

Both were read before they were added: no hidden instructions, no commands; the only links go to Apple, the author's other skills and Apple-related pages.

## Updating one

Copy the new version over the old folder, read what changed (`git diff`) before committing, and update the commit and date in the table above. Never point a skill at a moving branch: a skill is text every session follows.
