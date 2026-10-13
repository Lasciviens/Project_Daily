---
paths:
  - "src/features/devRequests/**"
---
# Dev Requests rules

Background: `docs/features/dev-requests.md`.

- Nothing typed is ever lost: drafts live in `devRequestDraftStore.ts` (persisted on this device), never only in component state.
- The floating composer is never a Dialog: it is a direct child of `<body>`, so it stays usable over popups.
- The outline is stored as plain text in `description` (`outline.ts`): a blank line between points, two spaces start a sub-point; old formats still read and `descriptionForSave` rewrites them.
- Picks are links in the text (`[[@id]]` + one hidden `[[pick …]]` line); deleting the link drops the pick on save.
- Drag reorder writes only the rows whose order changed.
