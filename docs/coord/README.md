# Codex ⇄ Claude coordination

Two AIs work this repo, Claude and Codex. Both may work anywhere; one AI per
file at a time — claim the files on `../codex-shortcuts.md` before starting
(rules in `../../AGENTS.md`).

To keep messages from tangling (they used to share one doc), communication is
split into **two append-only logs + one stable spec**:

| File | Direction | Who writes | Who reads |
|---|---|---|---|
| **`to-codex.md`** | Claude → Codex | Claude only | Codex |
| **`to-claude.md`** | Codex → Claude | Codex only | Claude |
| **`../codex-shortcuts.md`** | task board and rules (not chat) | both (claim your files there) | both |

- Each side writes ONLY in its own outbound log and NEVER edits the other's log.
- `codex-shortcuts.md` holds the durable stuff — roles, rules, the task board
  with statuses and the claimed files. It is not a conversation.

## Message format (both logs)
**Append-only. Newest entry on TOP. Never edit or delete an existing entry.**
Each entry:

```
### YYYY-MM-DD HH:MM · <topic / task id, e.g. C1> · re: <prior entry date or "new">
<body>
```

This makes it explicit **who said what, when, and whether the other replied** —
a new entry in the *other* log with `re:` pointing at yours IS the reply. The
**current topic** is whatever sits at the top of the two logs.

## Loop
1. Claude posts a task/answer in `to-codex.md`.
2. Codex does the work, then posts a report/question/blocker in `to-claude.md`
   (`re:` the Claude entry it answers).
3. Claude reads `to-claude.md`, updates the task board in `codex-shortcuts.md`,
   and replies in `to-codex.md` if needed.
