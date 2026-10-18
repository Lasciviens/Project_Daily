# Lasci's Board — Theme & UI System

> The single reference for how every screen looks, moves and talks to the database.
> Read it before building or restyling any UI. When something new comes up, it follows this document;
> when this document doesn't cover it, extend the document in the same change.

**Where it lives in code**

| Concern | File |
|---|---|
| Colour, shadow, geometry and z-index tokens (light + dark) | `src/index.css` (`:root`, `:root.dark`) |
| Tailwind names for the tokens | `tailwind.config.js` |
| Accent presets (full 50–950 scales) | `src/shared/theme/accent.ts` |
| Chart colours for SVG | `src/shared/theme/useChartColors.ts` |
| React UI primitives | `src/shared/ui/` (`import { Card, Button, … } from '<relative>/shared/ui'`) |
| Popup chrome + the shared popup system | `src/shared/modals/` |
| Query keys, stale times, invalidation groups | `src/shared/query/` |
| Mutation primitive | `src/shared/hooks/useMutationWithFeedback.ts` |
| App shell (sidebar, top bar, phone header, tab bar) | `src/app/shell/`, nav registry `src/app/navigation.ts` |

---

## 1. Principles

1. **Calm, cool, precise.** Cool slate surfaces, one blue accent, hairline borders, soft long shadows.
   Colour is information, not decoration: the accent marks *what you can act on / what is selected*,
   tones mark *status*. Everything else is neutral.
2. **Tokens, never literals.** A component never writes a hex, `rgb()`, `amber-*`, `gray-*`, `red-500`
   or `bg-white`. It uses a token class (`bg-surface`, `text-fg-muted`, `border-line`, `bg-accent-500`,
   `data-tone="danger"`). Both themes then work with zero per-component branching.
3. **One way to do each thing.** One card surface, one button family, one popup chrome, one way to
   open an entity popup, one mutation primitive, one place for query keys. If you need a variant,
   add it to the primitive — don't fork it.
4. **Elements content-sized; pages fill width with columns.** A card never stretches because the
   screen is wide; the page adds columns (`PageBoard`, §6.3, §6.6 W7).
5. **Mobile-first and compact.** Check the phone layout: no extra lines, nothing overlapping or squashed, the space used. No minimum button size (owner, 13.10.2026); the primitives keep touch targets comfortable.
   Hover is an enhancement (`@media (hover: hover)`), never the only way to reach an action.
6. **UI → hook → api → Supabase.** Components never import the Supabase client. Popups load their
   own data by id. Mutations own their feedback and their cache invalidation (§10).

---

## 2. Colour

All tokens are RGB triplets (`--ink-900: 15 23 42`) so Tailwind's `/alpha` modifiers work
(`bg-scrim/45`, `border-accent-500/30`). `:root.dark` redefines the same names; the `.dark` class on
`<html>` is set by the theme store (Light / Dark / System in Settings).

### 2.1 Surfaces

| Semantic class | Legacy alias | Light | Dark | Use |
|---|---|---|---|---|
| `bg-canvas` | — | `#F3F5F9` | `#06090F` | Page background behind everything |
| `bg-surface` | `bg-cream-50` | `#FFFFFF` | `#0D121C` | Cards, panels, menus, sheets, sidebar |
| `bg-surface-2` | `bg-cream-100` | `#F3F5F9` | `#141B27` | Recessed fills: inputs, selects, secondary buttons, badges, thumbnails |
| `bg-surface-hover` | `bg-cream-200` | `#EEF2F8` | `#171F2D` | Hover / press tint of rows and buttons |
| `bg-scrim` | `bg-ink-950` | `#020617` | same | Always-dark: modal backdrop, text shade over photos |

### 2.2 Lines and text

| Semantic | Legacy | Light | Dark | Use |
|---|---|---|---|---|
| `border-line` | `border-ink-200` | `#E3E7EE` | `#1F2735` | The 1px hairline: cards, inputs, dividers |
| `border-line-strong` | `border-ink-300` | `#CFD6E1` | `#303A4B` | Floating surfaces, hovered selects, scrollbar thumbs |
| `text-fg` | `text-ink-900` | `#0F172A` | `#EEF2F7` | Headings, primary values |
| `text-fg-2` | `text-ink-700` | `#334155` | `#C6CEDB` | Body text, nav labels, menu items |
| `text-fg-muted` | `text-ink-500` | `#6B7280` | `#8A94A6` | Meta, subtitles, section labels |
| `text-fg-faint` | `text-ink-400` | `#949CAA` | `#697385` | Placeholders, chevrons, decoration only — never essential text |

The legacy names (`cream-*`, `ink-*`, `canvas`) are kept because thousands of existing classes use
them; they resolve to the same variables. **New code uses the semantic names.** Never use
`text-white` for text on a filled accent — use `text-on-accent` (a yellow accent needs dark text).
Text on a filled `bg-danger` (the danger button, `.btn-danger`) is `text-on-danger` (`--on-danger`):
white on the light theme's red, near-black on the dark theme's lighter red, where white is only
2.6:1. `text-white` is still correct over a photo.

### 2.3 Accent

The accent is the only saturated brand colour. Default **Blue** (`#2563EB` light / `#2F6BFF` dark);
the user can pick Orange, Red, Purple, Yellow or Slate in Settings. Every preset defines a full
`accent-50 … accent-950` scale per theme plus `--on-accent`, applied inline on `<html>` by
`applyAccent()`. Rules:

- `bg-accent-500 text-on-accent` — primary buttons, the active pill tab. (The phone tab bar is flat: its active tab is `text-accent-600` icon + label, no filled chip.)
- `hover:bg-accent-600` — hover of a filled accent control. (In dark, 600 is *lighter* — intended.)
- `bg-accent-50 text-accent-600` (or `-700`) — selected rows, active nav item, icon chips, soft badges.
- `text-accent-600` — text links and "Clear filters"-style actions.
- `ring/border-accent-500` — focus halo, dragged-over targets.
- **Never** use the accent for a data series, a status, or decoration (the one exception: the dimmed header art, §6.5). If everything is blue, nothing is.

### 2.4 Status tones

Status (priority, sync state, health, due/overdue, done…) always goes through a **tone**, never a
literal colour. Tones: `success · warn · danger · info · neutral · highlight · upcoming · star · accent`, each with
a `-soft` background.

```tsx
<ToneDot tone="success" />                     // 8px dot (.tone-dot)
<TonePill tone="warn">Due today</TonePill>      // soft pill with tinted label (.tone-pill)
<span data-tone="danger" className="tone-text">Overdue</span>
<span data-tone="info" className="tone-soft">…</span> // soft tint only
<div className="bg-danger-soft text-danger">…</div>   // Tailwind classes work too (not for `accent`)
```

`.tone-pill`'s display and box limits (`inline-flex`, `max-width:100%`, `min-width:0`, `overflow:hidden`)
sit in a zero-specificity `:where(.tone-pill)` rule, so utilities on a pill (`hidden sm:inline-flex`,
`max-w-[10rem]`) win.

`data-tone` sets `--tone` / `--tone-soft` / `--tone-fg`; `neutral` labels use the darker
`--neutral-fg`, since the dot colour is too faint for words. `accent` has no `-soft` Tailwind class —
use `data-tone="accent"`.

Map a domain enum to tones **once**, next to the enum (e.g. `PRIORITY_TONE: Record<TaskPriority, Tone>`),
and import that map everywhere. No per-component colour maps.

| Tone | Means |
|---|---|
| `success` | done, healthy, on track, connected |
| `warn` | due soon, needs attention, expiring |
| `danger` | overdue, failed, destructive, disconnected |
| `info` | informational, in progress — cyan, deliberately never the accent hue so a status can't read as a link |
| `neutral` | idle, unknown, cancelled, not started |
| `highlight` | a special category the user flagged (wish, favourite) |
| `star` | ratings, streaks |
| `accent` | the *current* item (Today, "N open", the default list) and in-flight work (the loading toast) — never good/bad || `upcoming` | not out yet (Coming soon) — indigo |

**Status stages — one meaning, one colour, on every page** (`src/shared/theme/stage.ts`, owner
02.10.2026). A feature's status enum maps onto a `Stage` first (`stageTones({...})`), never straight
to a tone, so the same meaning reads the same everywhere — media covers and the title popup, Games
(`[data-status]` in `testGame.css` reads the same tokens), Work, Projects, tasks, Dev Requests:

| Stage | Tone | Statuses |
|---|---|---|
| `idle` | neutral (grey) | Unwatched, Backlog, To-do, Open, Pending, Archived |
| `planned` | highlight (purple) | Wishlist, Planned |
| `upcoming` | upcoming (indigo) | Coming soon |
| `active` | info (cyan) | Watching, Playing, In progress, Active |
| `paused` | warn (amber) | Paused, On hold, Waiting |
| `done` | success (green) | Completed, Done |
| `dropped` | danger (red) | Dropped, Cancelled, Dismissed |

A status picker uses `.stage-option` (one button per status, `data-tone` from its stage; the
picked one fills with its soft tone). Checked by `scripts/verify-status-stages.cjs`.

### 2.5 Charts

SVG attributes can't read CSS variables, so charts call `useChartColors()`:

```tsx
const c = useChartColors()
<Bar fill={c.series[0]} /> <CartesianGrid stroke={c.grid} /> <XAxis tick={{ fill: c.axis }} />
```

- `c.series[0..5]` — teal, violet, plum, rose, lime, slate (`--chart-1…6` in `index.css`):
  categorical, colour-blind distinct, **never the accent hue**, and no series shares a status tone's
  hue (series 3 was amber = `--warn` / `--star` until 2026-09-29). Series 3 (plum) is darker than the
  violet in both themes, so the two stay apart in every colour-vision type (ΔE ≥ 34 against series
  1/2/4/5 under normal, protan, deutan and tritan simulation). Use them in order. Food's macros use
  all six: calories 2, protein 1, carbs 3, fat 4, fiber 5, sugar 6.
- `c.success / c.warn / c.danger / c.info / c.neutral` — only when the series *is* a status (e.g.
  over/under a target). `c.accent` exists for a selected point, never a series.
- Grid lines `c.grid`, axis ticks `c.axis`, tooltip surface `c.tooltipBg`.
- Shared kit in `src/shared/components/charts/`: `BarLineChart` (the canonical translucent bar + dotted
  line, deduped tooltip, `rangeKey`, `yDomain`), `chartKit.ts` (`TOOLTIP_BOX` for custom tooltip
  content, `useTooltipStyle()` for recharts' built-in one), and
  `compactAxisTick` (`axisFormat.ts`). Reuse them before styling a chart by hand.
- **Identity colours stay literal**: third-party brand colours (a transit operator's line colour, a
  fitness service's brand orange) and physiological categories that users know by colour (sleep
  stages) are data, not chrome. Keep them in one constant per feature.
- Bars start at zero; trend lines may zoom (see `docs/features/training.md`). Tooltips dedupe series.

---

> **DATE FORMAT (owner rule, absolute): `DD.MM.YYYY` for every visible date — `29.09.2026`.** No month names, no slashes, no ISO strings, no locale output, no time on a date-only field or picker. Details below.

## 3. Typography

**Inter Variable** (bundled with `@fontsource-variable/inter`, works offline), `cv11` + `ss01`
features, antialiased. **Tabular numbers** (`tabular-nums`) on every count, KPI, date, time and
duration. **The ONLY visible date format is `DD.MM.YYYY`** (`15.09.2026`, owner rule): times are
`HH:MM` (24h), a weekday may lead (`Tue 15.09.2026`), ranges read `21.09.2026 – 27.09.2026`, and
relative words (today, yesterday, 5 days ago) stay where they are used. Always go through
`src/shared/utils/dateFormat.ts` (`formatDate`, `formatDateTime`, `formatDateRange`,
`formatWeekdayDate`, `formatWeekRange`) — never `toLocaleDateString`, `Intl.DateTimeFormat` or a
date-fns pattern with month names. Two exceptions: chart axis ticks may drop the year
(`formatDayMonth` → `15.09`), and Health's range bar (`healthDateLabels.numericSpanLabel`,
`21.09 – 27.09`). A calendar's month heading (`September 2026`, `formatMonthYear`) names a month,
not a date. Typed dates use `DateInput` (DD.MM.YYYY), not a native `<input type="date">` or `datetime-local` (a "when did you watch it" style picker asks for a day, never a time).
On touch screens `DateInput` opens a month calendar (`DateCalendar`, no keyboard — typing made iOS
draw the caret where the sheet was before it animated in); with a mouse you type into a fixed
`__.__.____` mask (a key writes or clears one digit and nothing shifts; `07122026`, `071226`,
`7.12.26`, `7-12-2026`, `7/12/26` and pasted dates are taken; a two-digit year is 20yy; an
impossible or out-of-range date shows red and isn't saved — `dateMask.ts`, `verify-date-mask`) or
open the calendar from its icon. The calendar's heading opens a year list (opened on the shown
year; ↑/↓, Page Up/Down, Home/End) beside a Jan–Dec grid, in the same box: a year moves the view
at once, a month goes back to the days, the arrows step a year meanwhile and Escape returns to the
days — ten years back is three taps, not 120 (`dateCalendarMath.ts`, `verify-date-calendar`).
A chart's month bars may name the month ("January", no year when the year is already picked); a
date never does.

**Poster covers** (Media): one `PosterTile`. Status is a belt across the top-left corner using `.poster-belt` + `data-tone` — fixed dark colours, not theme tones, because it sits on artwork in both themes and must keep white text ≥ 4.5:1; its size is in `cqw` of the cover. A score banner runs along the bottom. The user's own rating is never drawn on a cover.

| Class | Size / line | Weight | Role |
|---|---|---|---|
| `text-page` | 24 / 30 | 700, `tracking-tight` | Page title (≥ `sm`) |
| `text-head` | 19 / 26 | 700 | Page title on phones, phone header |
| `text-title` | 17 / 24 | 600 | Popup / sheet / drawer title, the top bar's route name, hero card title |
| `text-lead` | 15 / 22 | 600 | Card title; sheet rows on phones |
| `text-ui` | 14 / 20 | 600 | Buttons, emphasised rows |
| `text-body` | 13 / 20 | 400–500 | Body text, controls, list rows (the default UI size) |
| `text-meta` | 12 / 16 | 400–500 | Subtitles, timestamps, secondary values |
| `text-micro` | 11 / 16 | 600 uppercase `tracking-[0.09em]` | Eyebrow labels (`.section-label`, `.field-label`), badges |
| `text-kpi` | 26 / 30 | 700 `tracking-tight` | Big numbers |

Rules: weights are 400/500/600/700 only; bold is for titles and numbers. Do not invent in-between
sizes (`text-[12.5px]`) in new code. Cut text with `<Truncate>` (never a bare `truncate` /
`line-clamp-*` on user data): one line truncates, `lines={2|3}` clamps notes and descriptions (§5).
Balance headings. Text inputs render at 16px on touch automatically (iOS zoom guard).

---

## 4. Space, shape, elevation

**Spacing scale:** 4 · 6 · 8 · 10 · 12 · 16 · 20 · 24 px (`1 · 1.5 · 2 · 2.5 · 3 · 4 · 5 · 6`).
Siblings are spaced with `gap-*` on a flex/grid parent, not margins.

| Where | Value |
|---|---|
| Page gutter | 16px phone · 24px `sm` · 32px `lg` (`PageContainer`) |
| Card padding | `p-4` phone, `sm:p-5` |
| Gap between cards | `gap-3` phone, `sm:gap-4`, `2xl:gap-5` |
| Gap between page sections | `gap-5` / `space-y-5` (`sm:gap-6`) |
| Card header → body | `mb-3` |
| Row padding | `px-3`, min height 44px (40px dense lists with a mouse) |

**Radii** (Tailwind names): `rounded-control` 10 (buttons, selects, nav items, icon buttons) ·
`rounded-input` 11 · `rounded-row` 12 (list rows, sheet rows) · `rounded-menu` 14 · `rounded-card` 18
(cards, panels, dialogs) · `rounded-sheet` 22 (phone sheet top corners) · `rounded-full` (pills, chips,
badges, avatars, tabs). Thumbnails 6–8px.

**Elevation:** `shadow-card` (resting cards) · `shadow-card-hover` (interactive card hover) ·
`shadow-menu` (menus, popups, drawers) · `shadow-float` (small floating controls). Dark mode uses
deeper, darker shadows automatically. Never stack border + heavy shadow + tinted background on one element.

**Layers** (`z-*` classes / CSS vars): `chrome` 40 (phone header, tab bar, the phone's docked request
composer) · `drawer` 50 (side drawers) · `sheet` 60 (the Games page's own sheets and dialogs;
`ModalShell` sheets sit on the modal layer) · `popover` 70 (`.menu`, popovers) · `modal` 100 (+10 per
stacked popup, from the host's depth) · `float` 150 (the floating request composer and its pick
highlight: above popups so it stays usable while one is open) · `confirm` 200 · `toast` 300 (toasts,
the offline banner). Never hard-code `z-[999]`.

---

## 5. Components

Use the React primitive when one exists; the CSS class is for places a component can't be used.

| Need | Use |
|---|---|
| A panel | `<Card>` (`.card`, renders a `<section>`, `p-4 sm:p-5` unless `padded={false}`), interactive `<Card as="button" interactive>` (`.card-interactive`) |
| Card heading | `<CardHeader title icon subtitle action />`, dense: `variant="label"`; `wrap` lets a long title/subtitle wrap (and the action drop below it on a phone) instead of being cut off — use it wherever the text is user data (a routine name) or a sentence that must be read |
| Eyebrow label | `<SectionLabel>` (`.section-label`) |
| Buttons | `<Button variant="primary|secondary|ghost|danger" size="md|sm" icon loading block>` — default `secondary`; `sm` is 36px with a mouse, 44px on touch (`.btn-*`, `.btn-sm`) |
| Icon-only button | `<IconButton label="…" bordered?>` (label is required: it's the accessible name; `.icon-btn`, `.icon-btn-bordered`) |
| KPI tile | `<StatTile label value unit hint icon tone onClick />` |
| Page frame | `<PageContainer width="narrow|wide|full">` (caps `max-w-3xl` · `max-w-[135rem]`, the default = the widest board · none; `@container/page`) + `<PageHeader title subtitle actions showTitle>{tabs}</PageHeader>` |
| Page layout | `<PageBoard sections layout />` (§6.3) |
| Page header art | `<PageHeader art={<XHeroArt />}>` — the page's drawing behind its header band; Home: `<PageHeroArt>` in its first card (§6.5) |
| Status | `<ToneDot>` / `<TonePill>` / `data-tone` |
| Empty state | `<EmptyState icon title description action bordered />` |
| Loading | `<Skeleton>` / `<SkeletonText>` / `<SkeletonCard>` copying the real geometry |
| List row | `<ListRow leading title subtitle meta trailing onClick />` (`.row`, `.row-interactive`) |
| Text tabs (2–5 views) | `<SegmentedControl>` (`.seg` / `.seg-btn`); `size="xs"` is a 28px pill row for a compact popup header (This day \| All days) |
| Sub-views of a tab | `SegmentedControl size="sm"` at the right end of the page's tab row (own row with the page actions below `lg`), value in `?view=` — Training Log / Library |
| Filter tabs with counts | `.pill-tab` + `.count-badge`, horizontally scrollable row (`.scroll-x`) |
| Inputs | `.input`, `.select`, `.field-label` above; focus = accent border + soft halo, no outline. `.input-sm` (with `.input`/`.select`): 32px on every pointer, for a compact sheet's rows. `.input-bare`: a field whose text is the content (the Add sheet's title) — no box, an accent underline only while focused |
| Chips / tags | `.chip`; counts `.count-badge`. `.chip` / `.tone-pill` never grow past their box (put the label in `<Truncate>`) |
| Text that may not fit | `<Truncate lines as reveal fullText>` (`lines` 1–3, `reveal` auto\|popover\|more\|none) — cuts only when needed; adds a `title` and a mouse tooltip after 400ms. Outside a tappable element a tap, click or Enter opens a bubble (one line) or an in-place More / Less (2–3 lines); inside a tappable row only the hover tooltip. Text that fits costs one render and no listeners. The bubble (`TruncateBubble`) exists only while open and renders through Headless UI's `Portal`, so inside a popup it counts as part of the dialog; Esc and a press elsewhere close only the bubble. On `h2`–`h4` the button role goes on an inner span. `useIsTruncated` / `useTruncatedElement(ref, lines, textKey, nodeKey)` share one ResizeObserver; `node scripts/audit-text-overflow.mjs --static` lists bare `truncate` / `line-clamp` sites |
| "a · b · c" meta lines | `<MetaLine items={[…]} />` — each fact (and its dot) is unbreakable, so a phone wraps between facts ("518 kcal · 50g protein ·" / "4g fiber"), never inside one ("4g" / "fiber"). Falsy items are skipped; items are short facts, never free user text. Prefer it over `.join(' · ')` for any macro / stats / "last done" line |
| Counting number | `<AnimatedNumber value decimals format ready>` (tabular; counts on first appearance and on a real change) |
| Progress ring | `<ProgressRing value size stroke color ready>` (sweeps with "More") |
| Menus | Headless UI `Menu` with `.menu` / `.menu-item` / `.menu-sep` / `.menu-label` |
| Explain a term | `<InfoBubble label>` (`shared/components`) — the ⓘ popover; never a hand-rolled tooltip. `<HelpTip label>` is the "?" that also opens on hover |
| Detail on demand (W5 peek) | `<HoverPeek trigger label? panelClassName>` (`shared/components`) — a button whose panel opens on hover with a mouse (and stays while the pointer moves into it), on tap, click or Enter; Esc or a press elsewhere closes. The panel renders only while open, through Headless UI's `Portal`. A value that opens one wears a dotted underline (Food's macro totals) |
| Contain a render crash | `<ErrorBoundary label action>` around surfaces whose data shape isn't guaranteed |
| Dates | `DateInput`, `DateNav` (prev / next / pick), `WindowChips` (season chips) in `shared/components` |
| Scrolling strips | `.scroll-x` (no scrollbar) / `.scroll-y` (thin), `.scrollbar-none`, `.snap-x-mandatory` + `snap-start` children |
| Press feedback on a custom tappable | `.press-feedback` |
| Keyboard hint | `.kbd` (`⌘K`) |
| Popups | §8 |

`.scroll-fade-x` is a deliberate no-op (the edge fade was removed on request); don't add new uses.

**Button rules.** One primary per view (the action the screen exists for). Secondary for everything
else; ghost for tertiary/inline actions; danger only for the final destructive step (inside a
confirm). Label = verb + object ("Log food", "Save target"), never "OK"/"Submit". A button that
starts async work shows `loading` and its hook shows the result toast (§10).

**Card anatomy.** `CardHeader` (icon chip · title · subtitle · right action) → body → optional footer
row separated by `border-t border-line pt-3`. Link-outs in a header are `text-accent-600 text-meta
font-semibold` with a `ChevronRight` 14px. A card that opens something is `interactive` and shows a
faint chevron.

**Empty / error / loading.** Every async surface renders all three. Loading copies the final
geometry (no spinners in content areas). Empty says what goes here and offers the one action that
fills it. Errors say what failed and offer a retry; render-time crashes are caught by `ErrorBoundary`.

**Icons.** `lucide-react` only. 16px inside buttons and rows, 18px in icon buttons, 20px in nav,
22px in the phone tab bar; `strokeWidth` 2 (1.8–1.9 in the phone chrome). Icons are `aria-hidden` next to a
text label. Emoji are allowed only as user-facing *content* (a meal slot, a season chip), never as
UI chrome or section markers.

---

## 6. Layout

### 6.1 Breakpoints and shells

| Layout | Width | Shell |
|---|---|---|
| **Phone** | < 768px, *or* a landscape phone (`(pointer: coarse) and (max-height: 499px)`) | Glass header, 56px (52px below 640px) — logo + title + search + AI + requests + avatar; hides on scroll-down — content, flat glass bottom tab bar (64px + safe area) with the primary tabs (at most 5) + More |
| **Tablet / laptop** | 768–1279px | Fixed 68px icon rail (not collapsible) + 64px top bar on the canvas + content |
| **Desktop** | ≥ 1280px | Full sidebar (232px) with labels and groups + top bar + content; a footer toggle folds it to the 68px rail (saved; a page flagged `collapseSidebar` opens folded) |

`useBreakpoint()` (`src/shared/hooks/useBreakpoint.ts`) returns `'phone' | 'tablet' | 'desktop'`.
Prefer CSS (`md:`, `xl:`, container queries) for styling; use the hook only when the *structure*
differs.

**Navigation** is defined once in `src/app/navigation.ts` — sidebar, shell titles, phone tab bar,
More sheet and the command bar all read that registry. Adding a page = one entry there (label, path,
icon, group, `tab` slot or `more`; optional `parent` for a sub-page with no row of its own, `match`,
`fullHeight`, `collapseSidebar`, `moreFirst`, `keywords`) plus its route in `router.tsx`. Never hand-write a nav list in a component.

**The document never scrolls.** `<main>` is the one scroll container (pull-to-refresh, scroll
restore and the glass chrome depend on it). Pages must not create their own full-height scroller;
the exception is a page flagged `fullHeight` in the registry (Shop's two panes, Games), whose wrapper
gets `h-full`. Header height `--app-header-h`, tab bar `--app-tabbar-h`, sidebar `--app-sidebar-w`
(also Tailwind spacing names: `h-header`, `h-tabbar`, `w-sidebar`) — offsets use the variables, with
safe areas composed in `calc()` (e.g. `pb-[calc(var(--app-tabbar-h)+env(safe-area-inset-bottom)+16px)]`
on `<main>`), never magic numbers. `--ios-viewport-gap` (`app/iosViewportFix.ts`) corrects the
installed iOS PWA's short viewport; phone tab bars sit at `bottom: calc(-1 * var(--ios-viewport-gap))`.

Games is a `fullHeight` page with its own token set (`testGame.css`, `.tg-root` / `.tg-portal`) and
its own left navigation panel; it uses the shell's `ModalHost` and `Toaster`. See `docs/features/games.md`.

### 6.2 Page anatomy

```tsx
<PageContainer>
  <PageHeader title="Food" subtitle="Tuesday 15.09.2026" actions={<Button variant="primary">Log food</Button>}>
    <SegmentedControl … />            {/* optional view switcher */}
  </PageHeader>
  <PageBoard sections={…} layout={…} />
</PageContainer>
```

The shell (top bar from 768px, phone header below) is the ONLY visible page name. `PageHeader`'s
`title` is a screen-reader-only h1 at every width; pass `showTitle` only when the title is content
rather than the route name (Daily's date nav). With no visible title or subtitle, children (left) and
actions (right) share the first row — no empty line. Don't add a tagline subtitle; it costs a line.
`cx` is a plain join (not tailwind-merge): override `mb-3 sm:mb-4` with both prefixes or `!mb-*`.

### 6.3 Grids

- **Pages (PageBoard):** main ≤ 56rem + fixed 24rem side tracks; steps on the page's own width
  (< 60 / 60–100 / 100–128 / ≥ 128rem → 1 / 2 / 3 / 4 tracks); per-step layout of stacks, `span` for
  wide items, `sticky` for short side columns, `rows` for cards that must line up across tracks;
  `useBoardStep()` inside a section. Tiles keep fixed positions because widths never depend on
  content. `PageContainer` is `@container/page` —
  `@[56rem]/page:` queries the page width.
  - `lead: n` puts side tracks before main (a left rail). Optional sections go in the last track.
  - A `sticky` column pins only while it fits the scroll area (`StickyStack` in `PageBoard.tsx`
    re-checks on resize); a taller one scrolls with the page.
  - `boardWidthRem(layouts, step)` gives a board's widest width at a step. A page header above a
    board that stops short of the container (e.g. a 40rem main track) caps itself to it, so its
    right-hand controls line up with the last card. `useElementWidthRem`
    (`src/shared/hooks/useElementWidth.ts`) measures a component's own width in rem via a callback ref.
  - Anything placed by PageBoard sizes its inner grids and rings on its own width (`@container` +
    `@[..rem]:`), never viewport `sm:/lg:` — a 24rem side track at 2450 is narrower than a
    phone-landscape viewport.
- **List + detail** (Developer Activity/Errors/Memory, `LIST_DETAIL_BOARD`): below 60rem rows open in
  place. From 60rem, toolbar + list keep main and the picked row's detail sits in a sticky pane beside
  them (`max-h-[calc(100dvh-7rem)] overflow-y-auto`), spanning two tracks from 100rem. The picked row is
  `bg-accent-50` + `aria-current`. The pane falls back to the first listed row (`paneSelection`) and is
  never empty while the list isn't.
- **Collections**: `grid-cols-[repeat(auto-fill,minmax(19rem,22rem))] justify-start` (column count
  follows width, cards keep their size); in a wide track use `repeat(auto-fill,minmax(MIN,1fr))`
  (auto-fill with a fixed maximum counts by the maximum). A section's own grid counts its columns by its
  own width (`@container`: Media's library groups, Work's rail, project phases), so a wider track shows
  more items, never wider ones. A grid that gains columns by steps declares its base track
  (`grid-cols-1`). Items that vary in height (phases, library groups) never use a row grid: deal them
  into column stacks by index (`dealByIndex` in `projectBoard.ts`, `PhaseColumns`) or wrap
  content-sized blocks. Alphabetical multi-column lists use `columns-*` with `break-inside-avoid` rows.
- **Widgets** adapt to their own box with container queries (`@container`, `@sm:` … `@4xl:`), not the
  viewport.
- **Glance tiles on phones**: 2 columns (`grid-cols-2 gap-3`), each tile opens its detail in a popup.

### 6.4 Width caps (measurable)

Single-line content ≤ 640px · text inputs ≤ `max-w-md` · auto-fill columns ≤ 384px · charts capped
by role (`max-w-2xl` small trend, `max-w-4xl` primary) and aspect-locked · no horizontal page
overflow at 402 / 1469 / 2450px, and at 1469/2450 at most one side track (24rem) left empty in the
default view (`scripts/audit-page-width.mjs`). Verify at those widths (§6.6 → W6).

### 6.5 Header art

Every page except Games has a **still, drawn picture of its subject** behind its top (owner,
12.10.2026: "a background image on the top for every page — a related image"): soft art in the
app's own colours, never a photo. One shared way, so every page behaves the same:

- **Where.** `<PageHeader art={<XHeroArt />}>` puts the header's visible content in one card band
  (`PageHeroBand`, `src/shared/ui/PageHeroArt.tsx`; thin — `py-1.5`, at least 3.25rem / 3.5rem from `sm`, close under the shell: owner, 16.10.2026, "moved a bit up and thinner") with the art behind it — at every width, phones
  included; with nothing visible the band shows the art alone. A page with no header controls puts
  `<PageHeroArt>` in its first card instead (`relative isolate` card, content `relative z-10`,
  placed with `useHeroArt`) — only Home's brief, measured against its greeting.
- **Placement** (`useHeroArt` measures, `heroArtPlace` in `heroArtRules.ts` decides —
  `scripts/verify-hero-art.cjs`). The art is as tall as its host (at most 6.5rem), anchored right,
  in the free stretch nearest the right edge (≥ 12rem wide, 12px of air from controls and text), so
  a switcher, a button or a line of text never sits on it; what reaches past the stretch's left
  fades out over 3rem. With no such stretch (a phone, a narrow header) it sits behind the controls.
- **Dimming.** Opacity 0.22 light / 0.26 dark in free space, plus a fade over its own left 40 %.
  Behind controls and text it drops to 0.04 light / 0.14 dark: the most the faintest body text
  (`fg-muted`) allows while keeping 4.5:1 with every accent preset (`verify-hero-art` works it out
  from the tokens; also measured on real pixels at 393 and 1469px in both themes).
  No animation, no timers, no network; `aria-hidden`, `pointer-events-none`.
- **Colours.** Only `HERO.accent` / `HERO.muted` (fills) and `HERO.hole` (the card surface, for cut-
  outs), plus their `…Line` strokes — tokens, so both themes and every accent work. This art (and
  the glance tiles' corner art below) is the one place the accent is decoration.
- **Home's glance tiles** carry a small corner version (owner, 13.10.2026): `GlanceCarousel`'s
  `art` takes a motif from `src/features/home/components/glanceMotifs.tsx` (192 × 88 canvas, the
  subject in its right half) and `GlanceArt` draws it in the tile's top-right corner, in the band
  above its first line (2.75rem tall, at most 6rem and a third of the tile wide) — right of the
  label, behind the chevron — so it is never under text, adds no height and always takes the
  free-space opacity (`scripts/verify-glance-art.cjs`).
- **A new page's art:** one `src/features/<feature>/components/<Feature>HeroArt.tsx` returning SVG
  content drawn on the 640 × 140 canvas (`HERO_ART_VIEWBOX`): a few dozen simple shapes, the subject
  in the right half (the left 40 % fades), something quieter on the left; pass it as `art`. A
  sideways-scrolling tab strip in the band bleeds to its edges with `HERO_BAND_BLEED`. Add the page
  to `scripts/verify-hero-art.cjs`.

### 6.6 Layout width rules (W1–W7)

Cards keep their own width caps; a page uses a wide screen by ADDING columns, never by stretching
cards. Pages use `PageBoard` (`src/shared/ui/PageBoard.tsx`, rules in `pageBoardRules.ts`).

- Page wrapper: `PageContainer` (`px-4 sm:px-6 lg:px-8`, left-aligned, `@container/page`). Default cap `max-w-[135rem]` = the widest board; beyond it the page stays left-aligned. `narrow` for forms, `full` only for a page with its own full-width layout. Page background `bg-canvas`, cards `bg-surface`.
- **W1 · Container-relative, not viewport.** Anything placed by PageBoard sizes its inner grids and rings on its own width (`@container` + `@[..rem]:`) or the page's (`@[61rem]/page:`), never viewport `sm:/lg:` — a 24rem side track at 2450 is narrower than a phone-landscape viewport.
- **W2 · Column flow.** Collections flow into content-width columns: `grid-cols-[repeat(auto-fill,minmax(MIN,MAX))]` + `justify-start`; caps: dense rows `15–18rem`, cards `19–22rem`, large cards `24–28rem`; a single content row never exceeds **40rem**. In a wide track use `minmax(MIN,1fr)` (a fixed maximum makes auto-fill count columns by the maximum and leaves a column's worth empty). A grid that gains columns by steps declares its base track (`grid-cols-1`) — an implicit `auto` track grows to a long title's min-content and a card's `overflow-hidden` hides it from the audit. Items of varying height (phases, library groups) never use a row grid: deal them into column stacks by index (`dealByIndex` in `projectBoard.ts`, `PhaseColumns`) or wrap content-sized blocks. Alphabetical multi-column lists use CSS `columns-*` with `break-inside-avoid` rows so the order reads down each column. (Exception: `TodaySummary` uses explicit column steps — positional stability outranks column flow there.)
- **W3 · Controls are content-sized.** Text/search inputs `≤ max-w-md`; info banners `w-fit`; a one-line control is never full-width.
- **W4 · Charts: aspect-locked + capped** by role (small trend `max-w-2xl`, primary `max-w-4xl` = 896px).
- **W5 · Detail on demand.** Secondary info lives in a hover/tap peek (desktop hover + mobile tap): `HoverPeek` (§5).
- **W6 · Measurable.** At 402 / 1469 / 2450: no horizontal overflow; no single-line content > 640px, no auto-fill column > 384px, no text input > 512px, no chart svg > 896px; and at 1469 and 2450 the default view leaves at most one side track (24rem) empty. A page with fewer sections than columns documents where it stops. Check with `node scripts/audit-page-width.mjs --harness <dir>` (`--glance` checks Daily's glance cells full vs empty day).
- **W7 · PageBoard.** One main track (≤ 56rem, a layout may lower it) + 0–3 fixed 24rem side tracks, 1rem gaps. The step is measured on the page's OWN width, never the viewport: < 60rem one stack (phones, tablets) · 60–100rem main + 1 side (1280/1469 laptops) · 100–128rem main + 2 (1920) · ≥ 128rem main + 3 (2450). Each step declares which section goes in which column (`{ top, columns: [[…], { stack, span, sticky }], bottom, main, lead }`) or row (`rows: [[[…], { stack, span }], …]` instead of `columns`); columns are stacks (no masonry, no dense packing), so positions never depend on content. A section that moves column at a step change remounts (desktop resize only). Rules:
  - `lead: n` puts side tracks before main: a rail that drives or sums up the main column (a calendar, a day's totals, an add form) reads first on the left.
  - A section that can be empty goes in the last track, so an empty track is only ever at the far right. A card whose content is bounded (≤ 2 metrics, a few short rows) never spans; the window stops early with empty trailing tracks, documented in its board file (Cardio, Coach, Goal at 2450).
  - A band (`top`/`bottom`) spans only the tracks its own step declares, so a full-width band is declared at every step. Never put a collection in a `bottom` band under a much taller column (it starts after the tallest column ends); give it a column.
  - A section that is its host card's block on a phone is **absent** from step 1; the host decides with `keysAt(layout, useBoardStep())` (Health Sleep breathing, Cardio recovery, the Goal blocks).
  - A `sticky` column pins only while it fits the scroll area (`StickyStack` re-checks on resize). A page header above a board that stops short caps itself to `boardWidthRem(layout, step)`; `useElementWidthRem` (`src/shared/hooks/useElementWidth.ts`) measures a component's own width in rem.
  - **Cards that must line up across tracks go in `rows`.** Independent column stacks line up only when their heights happen to match. A row is one grid row on the board's tracks (its cells' spans cover every track): each cell stretches to the row's tallest and grows its last section, content top-aligned, so the row's cards share one top and one bottom whatever their content — the grid does it, nothing is measured. A section that holds its own grid (Home's `pair`, the week | the tasks) passes the height on with `h-full`. A step has `columns` or `rows`, never both; a row cell is never `sticky`. A band that must line up with the tracks lays its own grid on `boardTemplate(tracks, main)` (Home's split laptop board: brief | transit, then week | tasks | weather as rows; the glance row under them on the same tracks).
  - Layouts live in `homeBoard.ts`, `dailyBoards.ts`, `foodBoards.ts`, `wishesBoard.ts`, `healthBoards.ts`, `trainingBoards.ts`, `mediaBoard.ts`, `workBoard.ts`, `projectBoard.ts`, `developerBoards.ts`, checked by `scripts/verify-page-board.cjs` (Home, Daily), `verify-life-boards.cjs` (Food, Wishes, Health, Training) and `verify-feature-boards.cjs` (Media, Work, Projects, Developer).
- **No density setting.** A Comfortable/Compact/Dense toggle was tried and rejected — don't reintroduce it.

Reference screens: phone 402×874 (iPhone 16/17 Pro) and the same phone sideways (874×402), laptop
1469×680, monitor 2450×1130. Read a browser's size with `window.innerWidth + 'x' + window.innerHeight`.

---

## 7. Motion

| Movement | Duration / curve |
|---|---|
| Hover, press, colour changes | 100–150ms ease |
| Press feedback | `scale(0.98)` buttons, `scale(0.99)` cards, `.press-feedback` `scale(0.96)` + 85% opacity on other tappables |
| Popup / sheet enter | 300ms `cubic-bezier(0.2,0.8,0.2,1)` (phone slides up), 200ms fade+scale (dialog) |
| Popup leave | 200ms (dialog, drawer); the phone sheet slides out on its 300ms curve |
| Route change | 180–220ms slide/crossfade (View Transitions), else the `.page-in` rise (300ms) |
| Phone content entrance | `.stagger-in` (≤ 639px): children cascade in 35ms steps from 25ms, capped at the 8th |
| Active tab icon | `animate-tabPop` (300ms overshoot) |
| Drag-to-close release | 220ms settle |

Count-ups (`AnimatedNumber`) keep the number on screen while a new value loads (`ready={false}`) and
always count from it. While counting, the box keeps the width of the wider end (`align="end"` next to
text, `center` in a ring), so neighbouring text doesn't move. `ProgressRing` sweeps from empty once,
then keeps the last real share while loading. `useNewIds` marks a row new for `FRESH_ROW_MS` (400ms)
only, so a remount never replays the rise-in.

**The motion set is always on** (the Animations setting was removed 2026-09-29): card hover lift of 2px (mouse only);
`AnimatedNumber` count-up (500ms ease-out); `ProgressRing` sweep (600ms); task check pop + strike
fade-in; newly added rows rise in (`useNewIds` → `.motion-row-in`, the first load in a scope marks
nothing); toasts fade out (150ms); the Truncate bubble fades in. CSS lives outside `@layer`;
JavaScript motion checks `useMotion()` (false only under reduced motion).
**`prefers-reduced-motion` always wins**: a global rule takes every animation and transition to ~0 (the
loading spinner excepted), including popup slides, `tabPop` and the toast entrance. No decorative
looping animation. View-transition and runtime-only selectors live **outside** `@layer` in `index.css`
(Tailwind purges them otherwise).

---

## 8. Popups (sheets and dialogs)

**`ModalShell`** (`src/shared/modals/ModalShell.tsx`) is the only popup chrome:

- Phone: bottom sheet, 22px top radius, grab handle, **drag down to close**, max 92dvh, footer
  safe-area padded. `mobile="fullscreen"` for flows that need the whole screen (camera, cook mode,
  large pickers).
- `sm:` and up: centered dialog, 18px radius, sizes `xs` (confirm, 24rem) · `sm` 28rem · `md` 32rem
  (default) · `lg` 42rem · `xl` 56rem.
- Backdrop `bg-scrim/45` with a 2px blur (`/70` in dark).
- Header: title (`text-title`) + optional subtitle + `headerActions` + a 44px close button (on phones
  the header is a drag handle too); or a `hero` (image/art) with the close button floating over it;
  no title → pass `ariaLabel`. Body padding defaults to `p-4 sm:p-5` (`bodyClassName` overrides).
  Sticky footer for actions: primary on the right, full-width buttons on phones.
- `compact` — a lighter chrome for a form sheet (the Add sheet): a `text-lead` title with no hairline
  under it, a 36px close button, tighter body and footer padding (the footer keeps its hairline). Its
  actions are `size="sm"` and content-sized on every width: the one primary on the right, Cancel as a
  ghost beside it, Delete (an icon on a phone) on the left.
- **Back closes only the top popup** (`useHistoryDismiss` is built in). Esc and backdrop close too;
  `dismissible={false}` while a save is in flight. A page that mirrors its state into the address
  writes it through `whenHistorySettled(fn)` (returns a cancel function); never replace the address
  while an overlay is open or closing. A link inside a popup can simply navigate: the route change
  closes the popup, and Back / Forward pass over the history entries it leaves behind (one Back
  returns to the page the popup was on). `replace: true` from a single-entry overlay (the ⌘K
  palette, the More sheet) stays the tidiest — it leaves no entry behind at all.
- Stacking is automatic: a popup opened from a popup sits above it; confirms use `layer="confirm"`.

Two ways to use it:

| | When | How |
|---|---|---|
| **Entity popup** | Viewing/editing a *thing with an id* (task, block, food entry, recipe, media title, workout, wish, memory…) that can be opened from more than one place | `useEntityModal().open({ kind, id })` (§9) |
| **Local sheet** | A UI sub-step owned by one screen: filters, a picker, a scanner, a portion chooser | `<ModalShell open={…} onClose={…}>` or the `Sheet` alias |
| **Ask first** | A few choices before a one-tap action (a Quick guess preset's options) | a bottom sheet on a phone (`ModalShell`, `useBreakpoint() === 'phone'`), a Headless UI `Popover` under the tapped chip elsewhere; one body for both (`recipes/components/QuickGuessAsk.tsx`) |

Never hand-roll a `Dialog` + backdrop + panel. Never use `window.confirm` / `alert` — use
`await modal.confirm({ title })` (it renders `ConfirmDialog`, which also exists as a controlled
component; prefer the promise form). **Every delete** goes through one flow (13.10.2026): it asks,
deletes, says what happened and offers Undo — `useRowsDelete({ table, … }).run(ids, { title, done })`
for rows in the app's database (Undo puts back the same rows and what went with them, migration
144), `confirmDelete({ title, remove, restore?, done })` for anything else (no `restore` = the
question says "This can't be undone."). Never a bare delete button that removes without asking;
the one exception is a switch turned off with nothing written in it (unticking "watched at a
cinema"): `ask: false`, and the Undo toast still comes.

Side drawers (assistant, requests backlog) use `SideDrawer` (right edge, full height, 28rem by
default via `widthClassName`, `headerExtra` for a filter row, Back/Esc aware) and become a
draggable bottom sheet on phones (`phoneHeight` 88dvh, `phoneStyle` to lift it above the keyboard).
It sits on `z-drawer`, below the modal layer, so a popup opened from a drawer stacks above it.

**Records** (Shop's item record, `features/shop/components/record/`) are an `xl` popup, full screen on
phones, for an object with a life and many optional facts: a state pill + ONE row of actions, a strip of
four numbers that answers the object's question for its state, then two columns by the popup's own width
(`@[46rem]`). Facts read as text and turn into their editor on tap (`Fact`, one at a time); empty facts wait
as "+" chips (`FactChips`) instead of empty inputs; edits gather in a draft and the footer shows
Discard / Save only when something changed (closing with changes asks first). Creating stays a small `md`
sheet — a record is for a row that already exists.

**The Add sheet** (one item, `shared/components/plan-modal/`) is the pattern for a create/edit form whose
facts are mostly optional. It is calm, light and compact (owner, 15.10.2026: "more polite, not big and
clunky") and renders `ModalShell compact`. Top down:

- **The title is the content**: borderless (`.input-bare`, `text-title` semibold, a normal-weight
  placeholder), growing with a long title. Text that fills the chips as it is typed says so on a **Read
  as** line with an undo ("Keep text", `features/items/components/ReadAsLine`).
- **One quiet row of chips** — date · time · length · repeat · Google — that wraps only when it must
  (a 402px phone fits three). Every chip, choice and text button of the sheet and its pickers comes from
  `fieldStyles.ts`: one height (32px on every pointer), `rounded-full`, 14px icons, so the rows line up.
  `chipClass('set')` holds a value ("Thu 15.10.2026", "17:30–18:30" — a soft fill) and opens its editor
  in a Headless UI `Popover` on tap (`CHIP_PANEL_CLASS`: above the sheet on `z-toast`, scrolls when the
  anchor leaves too little room); `chipClass('add')` offers one ("Time", "Repeat" — a hairline outline).
  A choice with consequences (where the item goes on Google) is one chip with a `Menu` whose items say
  what each does, disabled ones with the reason. A choice that must stay a native select (Repeat,
  `.claude/rules/planning.md`) is drawn as a chip (`ChipSelect`): the select lies invisible over it, so a
  phone opens its own picker and the chip keeps the chip's text size (a visible select is 16px on touch).
  `ChipSelect` is exported from `plan-modal/fields.tsx` for any compact sheet row (Food's amount unit,
  Edit entry's Meal and dish): a chip is as wide as its choice, a visible select as wide as its longest option.
- **The facts line**, small text: what every item has reads as an inline value that opens a `Menu`
  (`chipClass('value')`: "● Medium priority", "Personal"); rarely-used facts wait as text buttons
  (`chipClass('quiet')`: "+ Notes", "+ Deadline", "+ Google list") — never a row of empty pills, never a
  dashed box, never an uppercase label.
- **Opened rows** (`FactRow`): a short label beside a small field (`.input-sm`); a row with a value opens
  by itself.
- Pickers use the same pieces: `choiceClass(active, …, 'sm')` for Today / Tomorrow, the lengths and the
  seasons, `Time24Field size="sm"` (hour and minute as chip selects, then −30m / +30m), `DateCalendar
  compact` (36px days), and `chipClass('remove')` to take a value off ("No time", "Doesn't block").
- A mode of the whole form (This day | All days) is a `SegmentedControl size="xs"` in the header; its own
  question (delete one day or the whole repeat) is a compact confirm with its three actions in one footer
  row (`sm`: they don't fit the 24rem `xs`).

**Headless UI pieces** (`@headlessui/react` v2) — never hand-made open/close state for these. They
handle click-outside, Escape, focus trap, portal rendering and ARIA; anything portalled uses token
classes (and, on `/games`, the `tg-portal` class).

| Use case | Component | Notes |
|---|---|---|
| Modal / drawer | `ModalShell` / `SideDrawer`, never a raw `Dialog` | they wrap Headless UI `Dialog` with sheet, drag, Back and stacking built in |
| Search autocomplete | `Combobox` + `ComboboxInput` + `ComboboxOptions` + `ComboboxOption` | `immediate` goes on the root `<Combobox>` when options should show on focus; `data-[focus]:` styles the active option |
| Floating action panel | `Popover` + `PopoverButton` + `PopoverPanel` | `anchor="top start"` / `"bottom start"` (Floating UI) |
| Dropdown menu | `Menu` + `MenuButton` + `MenuItems` + `MenuItem` | `anchor="bottom end"`; keyboard navigation built in |

Reference files: `src/shared/modals/ModalShell.tsx` + `SideDrawer.tsx`,
`src/features/home/components/ruter/StopSearchInput.tsx` (Combobox),
`src/features/media/components/PlanThisButton.tsx` (Popover), `src/shared/components/SettingsMenu.tsx` (Menu).

**Render-time crashes.** One bad field shape turns into a TypeError during render, and without a
boundary React unmounts the whole tree — a blank page (how the PlayStation game popup once failed).
A `try/catch` around a fetch never sees it. Wrap any surface whose data shape isn't guaranteed (the
PlayStation and Steam tabs and popups, the Games detail blocks) in `ErrorBoundary`
(`src/shared/components/ErrorBoundary.tsx`): the failure stays inside its own card, is logged to
`app_error_logs` and offers Try again. Guard the fields too — the boundary is the backstop, not the
fix (e.g. treat a genres field as string-or-array, default missing counts).

**Non-modal floating windows** (the request composer) are not Dialogs: render them with `createPortal`
straight into `<body>` (outside `#root`), which Headless UI never marks inert and never treats as an
outside click. Drag with `useFloatingWindow` (`src/shared/hooks/`). Mark such UI with
`data-dev-request-ui` so page picking ignores it. A dropdown inside such a window is a `Listbox`
**without `anchor`** (an anchored list is always portalled into `#headlessui-portal-root`, onto the
menu layer — behind the window and any popup under it), `modal={false}`, placed `position: fixed` at
its button so the window's scroll area doesn't clip it (`PropertyPills` + `propertyPillsPlacement.ts`).

---

## 9. The shared popup system (entity modals)

One stack, one host, one hook. Any component, on any page, opens the same popup and it follows
the same path to the database.

```tsx
const modal = useEntityModal()
modal.open({ kind: 'task', id: task.id })                          // edit
modal.open({ kind: 'task', defaults: { title: 'Call dentist' } })   // create
modal.open({ kind: 'plan-block', blockId })                         // routes to its task or block
modal.open({ kind: 'food-log', date, slot: 'lunch' })
modal.open({ kind: 'training-session', workoutId })                 // the one popup for a workout…
modal.open({ kind: 'training-session', plan: { kind, id, date } })  // …or a planned session
modal.open({ kind: 'health-workout', id })                          // an Apple Watch workout
modal.open({ kind: 'body-measurement', date })                      // a Hevy body entry (date optional)
if (!(await modal.confirm({ title: 'Delete this entry?', confirmLabel: 'Delete' }))) return
```

- `<ModalHost/>` is mounted once, in `AppShell`. It renders the
  stack from `useModalStore`, each entry lazily loaded (one code chunk per kind, via `lazyWithReload`:
  a chunk missing after a deploy reloads once, then shows `ModalChunkFailed`), inside an
  `ErrorBoundary` and `Suspense`.
- The request union lives in `src/shared/modals/types.ts`; the kind → component map in `registry.ts`
  (a mapped type, so an unregistered kind is a compile error). Outside React, `entityModal` offers the
  same `open` / `close` / `confirm`.

**Contract (non-negotiable):**

1. **Requests carry ids and prefill, never rows.** The popup re-reads its data through the feature's
   query hook (`useTaskById(id)`, `useTimeBlock(id)` …), so a stale list row can never be saved back.
   Adapters use two helpers from `shared/modals`: `useFirstLoaded(row, query)` freezes the first
   *fresh* row (a background refetch never re-seeds a form under the user's fingers, and a stale
   cached row is never trusted), and `<EntityModalPending query what>` renders the popup's own
   loading / "couldn't load" (with retry) / "no longer exists" states until then.
2. **Writes go through the feature's mutation hooks** (built on `useMutationWithFeedback`). No
   `supabase` import and no raw api call inside a popup file.
3. **Invalidation lives in the hook** (`invalidates: ['taskGraph']`), so every screen showing that
   entity refreshes — whichever page opened the popup.
4. Callbacks in a request (`onSaved`) only for cross-entity follow-ups (e.g. marking the source
   record as planned).
5. **Adding a kind:** add the request shape to `types.ts`, write `features/<x>/modals/<Name>EntityModal.tsx`
   exporting a component that takes `EntityModalProps<'kind'>` and renders `ModalShell`, register it in
   `registry.ts`. Then replace every hand-mounted copy of that popup with `modal.open(...)`. (The
   planning kinds — `task`, `time-block`, `schedule-block`, `plan-block` — live together in
   `shared/components/plan-modal/PlanEntityModals.tsx`.)
6. A route change closes the stack (a popup opened on one page never lingers over another).
7. A detail popup is compact: one stats row, collapsed rows that expand in place, secondary sections
   (e.g. Apple Watch) collapsed, and editing of a related entity behind a header ⋯ that opens that
   entity's own kind stacked above.
8. A link from one popup to another opens it stacked, unless the popup right below already shows the
   target; then the link is Back (closes the top one).

---

## 10. Data & hooks

```
Component ──> feature hook (useX / useUpdateX) ──> feature api (xApi.ts) ──> Supabase / edge function
```

- **Components** render and call hooks. They never import `supabase`, never build query keys, never
  write `useQuery` inline for shared data, never toast a mutation's result themselves.
- **Hooks** (`features/<x>/hooks/`) wrap TanStack Query. Reads: `useQuery({ queryKey: qk.x.y(...),
  queryFn, staleTime: STALE.default })`. Writes: `useMutationWithFeedback`.
- **Api files** (`features/<x>/api/`) are the only place that talks to Supabase or an edge function.
  Pure logic (rules, aggregation) lives in import-free `*Rules.ts` / `*Aggregate.ts` modules that can be
  verified with a `scripts/verify-*.cjs` script.

**Query keys** come only from `qk` (`src/shared/query/keys.ts`). Entity namespaces have an `all`
root; grouping namespaces (`media`, `athlete`, `logs`, `external`) expose one root per entity instead
(`qk.media.watchedAll`, `qk.athlete.profile`). Adding a query = adding its builder there.

**Stale times** come only from `STALE` (`live` 30s · `short` 1m · `default` 5m · `long` 10m ·
`hour` · `day` · `never`). Rate-limited external APIs use `hour` and `refetchOnWindowFocus: false`.
A query whose widget is collapsed or hidden is `enabled: false`.

**Mutations** use `useMutationWithFeedback`:

```ts
return useMutationWithFeedback({
  action: 'update_task',                 // logError context (required)
  mutationFn: (p: Patch) => updateTask(p),
  successMessage: 'Task saved',          // the result — or silent: '<who reports it instead>'
                                         // (one of the two is required)
  loadingMessage: 'Saving…',             // optional; for slow writes
  invalidates: ['taskGraph'],            // domain groups or explicit qk keys
})
```

Errors are always toasted and logged to `app_error_logs`. **Callers never wrap `mutateAsync` in
their own `toast.error`** — use `try { await m.mutateAsync(v) } catch { return }` only to stop a
multi-step flow, or `withProgress(() => m.mutateAsync(v), { loading, success })` for per-call copy.
The mutation resolves when the write answers — its own answer is the result; `invalidates` refresh
in the background. A write that returns its row patches every cached list at once
(`shared/query/cachePatch.ts`); task tick/edit/focus are optimistic.

More on results (13.10.2026, owner: "after what the user does, a message by its outcome"):

- `silent: '<why>'` is for a write that something else reports (the delete flow, the plan editor's
  "Saved", a sheet's `withProgress`, an Undo toast) or that is not a user action (autosave while
  typing, a drag whose list shows the order, a lookup whose results are the answer). A hook used both
  alone and as a step of a bigger save takes `{ report: false }` (`useCreateTask`, `useUpdateTask`,
  `useUpdateTimeBlock`, `useUpdateProject`, `useUpdateItem`, `useCreateShopLink`).
- The message comes from the write's own answer and its input — never a second read. `refresh: 'wait'`
  only for a flow that reads the refreshed cache right after.
- Rollbacks use `snapshotCache` / `restoreCache` (`cachePatch.ts`); task writes apply the database's
  own rules before the answer (`todo/taskWrites.ts` → `applyTaskPatch`) and cancel in-flight reads.
  Google Tasks delivery and a task's Calendar title push run in the background; `requireUser()` reads
  the local session instead of asking the auth server before every save (RLS checks the id).
- An async action that is not a TanStack mutation at all (a button calling an api directly) uses the
  manual pattern: `const id = toast.loading('Saving…')`, then `toast.dismiss(id)` and
  `toast.success(…)` or `toast.error(err.message)`.

**Toasts** outside a mutation come from `toast` in `src/app/store.ts`: `success` · `error` ·
`warning` · `info` · `loading` (stays until `toast.dismiss(id)`) · `undo(message, onUndo)` (a
success with an Undo button). They last 3s (errors 5s, undo 6s); a plain toast with the same text
as one on screen replaces it, render through the shell's `<Toaster>` (above the tab bar on phones,
bottom-left of the content elsewhere) and take their colour from a tone. The toaster renders into
`<body>`, outside `#root` (like the request composer, §8): a toast's Undo works over an open popup and
a tap on it never closes that popup (in `#root` it counted as a press outside — Food's logger stays
open after a one-tap log and offers Undo there).

**Invalidation groups** (`src/shared/query/invalidate.ts`): `taskGraph`, `schedule`, `nutrition`,
`recipes`, `episodeWatched`, `media`, `training`, `aiWrite`, `saveUndone` (every query — an undone
save can have changed any table). Name what happened, not which keys.

**One action, one hook.** If two screens perform the same write (mark an episode watched, log a
food, toggle a task), they call the same hook — never two copies with different invalidation.

---

## 11. Writing

Sentence case everywhere ("Log food", not "Log Food"). Name things the way the user thinks of them.
Buttons are verbs; toasts confirm in past tense ("Saved", "Deleted", "Logged 420 kcal"); errors say
what failed and what to do. Numbers carry units. No exclamation marks, no apologies, no emoji in
chrome. English in the product (`AGENTS.md`).

---

## 12. Accessibility & touch

- Touch targets: the primitives grow on touch screens (`[@media(pointer:coarse)]:min-h-[44px]`); a custom control never grows if that pushes its row onto a new line — compact wins.
- Visible keyboard focus (`:focus-visible` accent outline following the control's radius); inputs use
  the accent halo instead.
- Icon-only buttons have a label; decorative icons are `aria-hidden`.
- Colour is never the only signal: a status also has a label or icon.
- Contrast: body text ≥ 4.5:1 on its surface in both themes (`fg-faint` is decoration only).
- Tab rows and segmented controls use proper roles (`tablist`/`tab`, `aria-selected` / `aria-pressed`).

---

## 13. Checklist for any new screen or component

- [ ] Only token classes (no hex, no `gray-*`/`amber-*`/`bg-white`, no `text-[13px]`-style sizes).
- [ ] Built from `src/shared/ui` primitives; status via tones; charts via `useChartColors`.
- [ ] Works at 402 / 1469 / 2450px, light and dark, with no horizontal overflow.
- [ ] Checked in the phone layout: compact, no extra lines, nothing squashed; hover-only actions have a touch path.
- [ ] Loading, empty and error states present.
- [ ] Entity popups opened with `useEntityModal`; local sheets use `ModalShell`; no native dialogs.
- [ ] Data through hooks → api; keys from `qk`; stale from `STALE`; writes via `useMutationWithFeedback`
      with `invalidates`; no caller-side mutation toasts.
- [ ] New nav entry added to `navigation.ts` only.
- [ ] Motion respects reduced-motion; runtime-only CSS lives outside `@layer`.
- [ ] Cut text uses `<Truncate>`; JS motion is gated by `useMotion()`.
- [ ] Page laid out with `PageBoard`; at 1469/2450 at most one side track empty.
- [ ] A new page passes its header art (§6.5).
