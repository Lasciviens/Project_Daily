# Features

One file per feature: what it does, how it works and why it is built that way, including the bugs that shaped it. The rules to follow while changing a feature are short and live in `.claude/rules/<area>.md`; read both before a change, and update both in the same PR.

| Feature | Route | File | Rules |
|---|---|---|---|
| Home (brief, glance tiles, transit, news) | `/#/home` | [home.md](home.md) | `home.md` |
| Daily (day, week, month, tasks; glance board) | `/#/daily` | [daily.md](daily.md) | `tasks.md` |
| Tasks — one table, one model, one action hook | — | [tasks.md](tasks.md) | `tasks.md` |
| Planning, schedule, Google Calendar and Tasks | — | [planning-calendar.md](planning-calendar.md) | `planning.md` |
| One delete, with Undo | — | [delete-undo.md](delete-undo.md) | `database.md`, `ui.md` |
| Wishes | `/#/wishes` | [wishes.md](wishes.md) | `wishes.md` |
| Food (diary, plan, recipes, foods, insights) | `/#/recipes` | [food.md](food.md) | `food.md` |
| Shop (wishlist, quick list, owned, money chains) | `/#/shop` | [shop.md](shop.md) | `shop.md` |
| Media (films, TV, Trakt sync, lists) | `/#/media` | [media.md](media.md) | `media.md` |
| Games (library, Analytics, ScreenScraper, IGDB, Steam, PlayStation) | `/#/games` | [games.md](games.md) | `games.md` |
| Books and Kobo | `/#/books` | [books.md](books.md) | `books.md` |
| Training (Hevy, Strava, progress engine, coach) | `/#/training` | [training.md](training.md) | `training.md` |
| Health (Apple Health, scale, goal progress) | `/#/health` | [health.md](health.md) | `health.md` |
| Work | `/#/work` | [work.md](work.md) | `tasks.md` |
| Projects | `/#/projects` | [projects.md](projects.md) | — |
| AI assistant (`ai-proxy`) | Ask AI panel | [ai.md](ai.md) | `ai.md` |
| iPhone (Shortcuts, Scriptable, Web Push) | — | [iphone.md](iphone.md) | `iphone.md` |
| Dev Requests (the backlog drawer) | Requests button | [dev-requests.md](dev-requests.md) | `dev-requests.md` |
| Developer page (activity, errors, memory) | `/#/developer` | [developer.md](developer.md) | — |
| Settings, connections and subscriptions | `/#/settings` | [settings.md](settings.md) | — |

The shell, routes and iOS platform notes are in `docs/platform-shell.md`; edge functions and secrets in `docs/backend/`.

These files were moved out of CLAUDE.md on 13.10.2026 word for word, so older parts still tell their story in the order it happened ("real bug, fixed", "round 3"). When a feature changes, rewrite its section to describe how it works now; history belongs in git and the PR.
