# Mobile Review

Date: 2026-06-12

Branch: `flex/mobile-latest-pass`

Agent used: Flex (`.claude/agents/flex.md`)

## Scope

Mobile and responsive-only pass for the latest merged app state.

No API, Supabase, Edge Function, migration, data model, or feature behavior changes were made.

## Files changed

- `src/app/layout.tsx`
- `src/features/home/pages/HomePage.tsx`
- `src/features/home/components/RuterWidget.tsx`
- `src/features/todo/components/ToDoDrawer.tsx`
- `src/features/projects/pages/ProjectsPage.tsx`
- `docs/mobile-review.md`

## Issues found

### Navigation

- Top navigation could overflow on phone widths because all section links were forced into one horizontal row with fixed desktop spacing.
- Navigation/action buttons were below the 44px mobile tap-target standard.

### Home page

- Quick nav cards used a three-column base grid, which was too tight on narrow phones.
- Global home padding was desktop-biased for small screens.
- Task widget header and rows needed better wrapping/min-width handling.

### Transit widget

- Transit tabs, stop chips, search inputs, and route controls were too small for mobile touch.
- Search dropdowns could grow without a viewport cap.
- Trip rows needed smaller mobile spacing and safer wrapping.

### To-Do drawer

- Mobile drawer height was too short for real phone use.
- Close and sync buttons were below the 44px tap-target standard.
- Drawer header could crowd when sync feedback text appeared.

### Projects page

- Projects used a fixed two-panel layout at all widths.
- On mobile this squeezed the project list and detail panel side-by-side.

## Fixes applied

### Navigation

- Mobile nav now wraps into a second row and horizontally scrolls if needed.
- Nav links and action buttons now meet 44px touch target.
- Desktop nav remains inline from `sm:` upward.

### Home page

- Base padding reduced for mobile, desktop spacing preserved at larger breakpoints.
- Quick nav cards now use two columns on phones, three on small screens, five on desktop.
- Cards have a minimum height and safer truncation.
- Today task rows use mobile-safe min-width and truncation.

### Transit widget

- Tabs, chips, edit/remove buttons, refresh, route controls, and search controls now meet 44px tap target.
- Stop search input is 44px high.
- Stop search dropdown has a max viewport height and scrolls internally.
- Transit rows and trip rows use mobile-safe spacing/wrapping.

### To-Do drawer

- Mobile drawer height increased to `85vh` / `85dvh`.
- Safe-area bottom padding added for mobile browser chrome.
- Close and sync buttons now meet 44px tap target.
- Header layout wraps better when toast text appears.

### Projects page

- Projects page collapses to single-column on mobile/tablet.
- Project list becomes a top panel with max height and vertical scroll.
- Desktop two-panel layout remains from `lg:` upward.

## Breakpoints reviewed

- 375px: mobile nav wraps/scrolls, home cards are two-column, Projects is single-column.
- 390px: To-Do drawer buttons and close target remain tappable.
- 430px: Transit controls wrap without forcing horizontal overflow.
- 768px: Home remains readable; Projects still avoids squeezed side-by-side layout.

## Explicit confirmation

Desktop behavior intentionally unchanged where practical. Desktop-specific layouts are preserved at `lg:` / `xl:` breakpoints. Changes were scoped to base/mobile styles and responsive transitions.

## Known limitations

- This pass did not redesign mobile navigation into a bottom tab bar; it made the existing top navigation safe and usable.
- This pass did not change modals outside the touched files.
- Build was not executed inside this review environment; GitHub CI should confirm TypeScript/build status after merge.
