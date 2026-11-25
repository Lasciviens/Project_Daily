#!/usr/bin/env node
/**
 * verify-drag-reorder.cjs — the one shared drag to reorder (src/shared/ui/dragReorder,
 * built for the Media Queue in PR #651) and the lists that use it (owner, 25.11.2026:
 * "Yes, all lists" — every list the owner orders, one shared component).
 */
require('sucrase/register')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const read = f => readFileSync(join(__dirname, '..', f), 'utf8')
const has = (text, re, label) => ok(re.test(text), true, label)
let n = 0
const ok = (a, e, label) => { const x = JSON.stringify(a), y = JSON.stringify(e); if (x !== y) { console.error(`FAIL ${label}\n  expected ${y}\n  actual   ${x}`); process.exit(1) } n++ }

const R = require('../src/shared/ui/dragReorder/dragReorderModel.ts')
ok(R.moveItem(['a', 'b', 'c', 'd'], 0, 2), ['b', 'c', 'a', 'd'], 'moving down: the rows in between move up one')
ok(R.moveItem(['a', 'b', 'c', 'd'], 3, 1), ['a', 'd', 'b', 'c'], 'moving up: the rows in between move down one')
ok(R.moveItem(['a', 'b'], 0, 9), ['b', 'a'], 'past the end: the last place')
ok(R.moveItem(['a', 'b'], 5, 0), ['a', 'b'], 'an unknown row: nothing moves')
ok(R.dropTarget(0, 2, 4), 2, 'dragged down over row 3: lands in its place')
ok(R.dropTarget(3, 1, 4), 1, 'dragged up over row 2: lands in its place')
ok(R.dropTarget(1, 1, 4), null, 'over itself: stays (no save)')
ok(R.dropTarget(1, null, 4), null, 'over nothing: stays')
ok(R.dropTarget(1, 4, 4), null, 'over a row that is not there: stays')
ok(R.dropTarget(-1, 0, 4), null, 'an unknown dragged row: stays')
ok([0, 1, 2, 3, 4].map(n => R.stepAside(n, 1, 3)), [0, 0, -1, -1, 0], 'row 2 dragged over row 4: rows 3 and 4 step up to open the gap')
ok([0, 1, 2, 3, 4].map(n => R.stepAside(n, 3, 0)), [1, 1, 1, 0, 0], 'row 4 dragged over row 1: rows 1–3 step down')
ok([0, 1, 2].map(n => R.stepAside(n, 1, null)), [0, 0, 0], 'over nothing (or itself): nothing steps aside')
ok([0, 1, 2, 3].map(n => R.moveItem([0, 1, 2, 3], 1, 3).indexOf(n) - n), [0, 2, -1, -1], 'the drop lands where the gap was: every row that stepped aside moves one place that way')
// Review 3 · while dragging each row shows the number it gets
ok([0, 1, 2, 3, 4].map(n => R.shownPlace(n, 0, 2) + 1), [3, 1, 2, 4, 5], 'row 1 over row 3: it shows 3, rows 2–3 show 1–2')
ok([0, 1, 2, 3, 4].map(n => R.shownPlace(n, 3, 0) + 1), [2, 3, 4, 1, 5], 'row 4 over row 1: it shows 1, rows 1–3 show 2–4')
ok([0, 1, 2].map(n => R.shownPlace(n, 1, null) + 1), [1, 2, 3], 'over nothing: every row keeps its number')
ok([0, 1, 2].map(n => R.shownPlace(n, null, null) + 1), [1, 2, 3], 'no drag: the plain numbers')
const shown = (from, to) => [0, 1, 2, 3, 4].map(n => R.shownPlace(n, from, to))
ok([...shown(1, 3)].sort(), [0, 1, 2, 3, 4], 'the numbers shown are a full 1…N, no gaps or doubles')
ok(R.moveItem([0, 1, 2, 3, 4], 1, 3).map((id, place) => shown(1, 3)[id] === place).every(Boolean), true, '…and each row\'s shown number is its place after the drop')
ok(R.clampDragY(500, { top: 300, bottom: 372 }, { top: 100, bottom: 500 }), 128, 'a row dragged past the list\'s end stops at its last place (the page never grows under the drag)')
ok(R.clampDragY(-400, { top: 300, bottom: 372 }, { top: 100, bottom: 500 }), -200, '…and past its start stops at the first')
ok(R.clampDragY(-50, { top: 300, bottom: 372 }, { top: 100, bottom: 500 }), -50, 'inside the list it follows the pointer')
ok(R.keyMove('ArrowUp', true, 2, 4), 1, 'Alt+↑ moves the row up one')
ok(R.keyMove('ArrowDown', true, 2, 4), 3, 'Alt+↓ moves it down one')
ok(R.keyMove('ArrowUp', true, 0, 4), null, 'Alt+↑ on the first row: nothing')
ok(R.keyMove('ArrowDown', true, 3, 4), null, 'Alt+↓ on the last row: nothing')
ok(R.keyMove('ArrowDown', false, 1, 4), null, 'a plain ↓ is the page\'s (scroll, menus)')
ok(R.keyMove('Enter', true, 1, 4), null, 'another key: nothing')
const dir = 'src/shared/ui/dragReorder/'
const list = read(dir + 'DragReorderList.tsx')
const rowHook = read(dir + 'dragReorderRow.ts')
const sensors = read(dir + 'dragReorderSensors.ts')
for (const f of ['dragReorderModel.ts', 'dragReorderRow.ts', 'dragReorderSensors.ts', 'DragReorderList.tsx']) {
  const text = read(dir + f)
  ok(/from '\.\.\/\.\./.test(text) || /queue|trakt|[^@]media/i.test(text.replace(/^\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')), false, `${f}: generic — imports nothing from a feature and names no queue, Trakt or media`)
}
has(list, /modifiers=\{layout === 'grid' \? undefined : \[withinList\]\}/, 'a list layout holds the drag inside the list (up and down only)')
has(list, /autoScroll=\{EDGE_SCROLL\}/, 'the edge scroll uses the narrow zone')
has(sensors, /threshold: \{ x: 0, y: 0\.12 \}/, '…12% of the scroll area (review 4: 20% scrolled a sideways phone on a two-place move)')
has(list, /const to = dropTarget\(from, e\.over \? at\(e\.over\.id\) : null, ids\.length\)\s+setDrag\(null\)\s+if \(to != null\) move\(from, to\)/, 'a drop is one move; a drop in place saves nothing')
has(sensors, /useSensor\(RowTouchSensor, \{ activationConstraint: \{ delay: 250, tolerance: 6 \} \}\)/, 'touch: press and hold, then drag (a swipe still scrolls)')
has(sensors, /useSensor\(RowMouseSensor, \{ activationConstraint: \{ distance: 6 \} \}\)/, 'mouse: drags once it moves (a click still opens the title)')
ok(/\bPointerSensor\b/.test(sensors.replace(/^\/\/.*$/gm, '')), false, 'no PointerSensor: it would start a drag on a touch swipe and fight the page scroll')
has(sensors, /target\.closest\(`\[\$\{NO_DRAG_ATTR\}\]`\) != null \|\| !\(e\.currentTarget as Element\)\.contains\(target\)/, 'no drag from a row\'s buttons, nor from a menu opened from the row (a portal)')
has(rowHook, /if \(e\.defaultPrevented \|\| !e\.currentTarget\.contains\(e\.target as Node\) \|\| isTyping\(e\.target\)\) return/, 'review 7: Alt+↑/↓ inside an open ⋯ menu (a portal) never moves the row — nor typed in a field (a column name, a select)')
has(rowHook, /const grabClassName = 'touch-pan-y select-none/, 'the row (or its handle) keeps vertical scrolling under a finger')
has(rowHook, /dragActive && 'transition-transform duration-150 ease-out'/, 'rows slide aside only during a drag (CSS, off under Reduce Motion); the drop reorders without a slide')
has(rowHook, /handleProps: handle \? \{ ref: drag\.setActivatorNodeRef, \.\.\.drag\.listeners, onKeyDown \} : \{\}/, 'handle mode: only the handle starts a drag (a card with fields or tables of its own)')
has(rowHook, /\.\.\.\(handle \? \{\} : \{ \.\.\.drag\.listeners, onKeyDown \}\)/, '…and then the row itself does not (Alt+↑/↓ too: from the handle only)')
has(list, /const hit = pointerWithin\(args\)\s+return hit\.length \? hit : closestCenter\(args\)/, 'the drop target is the row under the pointer (a tall card dragged by its header), the nearest centre in a gap')
has(list, /step: layout === 'grid' \? 0 : height \+ gap/, 'grid layout: the others keep their places (only the numbers move)')

// One save path: shown at once, moves during a save wait, only the newest order is sent, a refused save is put back.
const save = read('src/shared/hooks/useOrderSave.ts')
has(save, /if \(sending\.current\) \{ waiting\.current = order; return \}/, 'a move while a save is on its way waits as the newest order (no second call racing)')
has(save, /const next = waiting\.current\s+waiting\.current = null\s+if \(next\) \{ m\.mutate\(next\); return \}/, '…and is sent once the save in flight is done')
has(save, /qc\.setQueryData<D \| undefined>\(queryKey, d => show\(d, order\)\)/, 'every move shows at once')
has(save, /onError: \(\) => \{\s+waiting\.current = null\s+if \(saved\.current !== undefined\) qc\.setQueryData\(queryKey, saved\.current\)/, 'a refused save puts back the last order the server took and drops what waited')
has(save, /const m = useMutationWithFeedback<R, O>\(\{/, 'the save reports through useMutationWithFeedback')

// Every list the owner orders is on it (owner, 25.11.2026: "Yes, all lists"), each saving through its own order write.
const lists = {
  'Media → Queue': ['src/features/media/components/QueuePanel.tsx', 'src/features/media/components/QueueRow.tsx'],
  'Books → Up next': ['src/features/books/components/library/UpNextList.tsx'],
  'Books → Kobo menu order': ['src/features/books/components/kobo/MenuOrderCard.tsx'],
  'Food → Quick guesses': ['src/features/recipes/components/QuickGuessPresets.tsx'],
  'Projects → phases': ['src/features/projects/components/ProjectPlan.tsx', 'src/features/projects/components/PhaseCard.tsx'],
  'Projects → blocks': ['src/features/projects/pages/ProjectPage.tsx', 'src/features/projects/components/BlockCard.tsx'],
  'Projects → a table\'s columns': ['src/features/projects/modals/ProjectBlockEntityModal.tsx'],
  'Games → Play queue': ['src/features/games/test-game/components/TgQueueView.tsx', 'src/features/games/test-game/components/TgQueueViewRow.tsx'],
}
for (const [name, files] of Object.entries(lists)) {
  const text = files.map(read).join('\n')
  has(text, /<DragReorderList\b/, `${name}: the shared DragReorderList`)
  has(text, /useDragReorderRow\(/, `${name}: its rows are the shared row`)
}
ok(require('node:fs').existsSync(join(__dirname, '..', 'src/features/games/test-game/components/TgQueueViewDrag.ts')), false, 'Games: its own drag is gone (one drag, shared)')
// Each saves through its existing order write, on the shared queue (shown at once, moves during a save wait).
has(read('src/features/books/hooks/useLibrary.ts'), /export function useSaveQueueOrder\(\) \{\s+return useOrderSave</, 'Up next: useSaveQueueOrder (books.queue_order) through useOrderSave')
has(read('src/features/books/hooks/useKoboControl.ts'), /export function useSaveMenuOrder\(\) \{\s+return useOrderSave</, 'Kobo menu order: useSaveMenuOrder (kobo_device_config.menu_order) through useOrderSave')
has(read('src/features/recipes/hooks/useQuickGuess.ts'), /export function useMoveQuickGuess\(\) \{\s+return useOrderSave</, 'Quick guesses: useMoveQuickGuess (quick_guess_items.sort_order) through useOrderSave')
const projHooks = read('src/features/projects/hooks/useProjects.ts')
has(projHooks, /export function useMovePhase\(\) \{\s+return useOrderSave</, 'Phases: useMovePhase (project_phases.sort_order) through useOrderSave')
has(projHooks, /export function useMoveBlock\(projectId: string\) \{\s+return useOrderSave</, 'Blocks: useMoveBlock (project_blocks.sort_order) through useOrderSave')
has(read('src/features/projects/modals/ProjectBlockEntityModal.tsx'), /const moveColumn = \(from: number, to: number\) => setColumns\(cs => moveItem\(cs, from, to\)\)/, 'Table columns: a move changes the form; Save stores it with the columns')
has(read('src/features/games/test-game/components/TgQueueView.tsx'), /onMove=\{reorderTo\}/, 'Games: a drop goes through the queue\'s one write chain (useReorderQueue, one write after another)')
// Cards and form rows drag by a handle; a grid of phases moves freely.
has(read('src/features/projects/components/PhaseCard.tsx'), /useDragReorderRow\(phase\.id, \{ handle: true \}\)/, 'a phase drags by its header (its body has tasks and a text box)')
has(read('src/features/projects/components/BlockCard.tsx'), /useDragReorderRow\(block\.id, \{ handle: true \}\)/, 'a block drags by its header (its body has tables and links)')
has(read('src/features/projects/components/ProjectPlan.tsx'), /<DragReorderList as="div" layout="grid"/, 'the phases sit in columns: grid layout')
// @dnd-kit stays out of a page's first download where the list isn't the page itself (verify-bundle-budget).
has(read('src/features/books/components/library/upNextPart.ts'), /lazyPart\('books-up-next', \(\) => import\('\.\/UpNextList'\)/, 'Up next: the drag is a lazy part…')
has(read('src/features/books/components/library/pieces.tsx'), /<Suspense fallback=\{\s+<ol className="flex flex-col gap-1">/, '…and the same rows show until it lands (nothing moves)')
has(read('src/features/books/pages/BooksPage.tsx'), /IDLE_PARTS = \[StatsTab, KoboTab, UpNextList\]/, '…loaded in idle time once Books shows')
has(read('src/features/settings/components/FoodTab.tsx'), /lazyPart\('quick-guess-editor', \(\) => import\('\.\.\/\.\.\/recipes\/components\/QuickGuessPresets'\)/, 'Settings → Food: the Quick guess list (and its drag) loads on its own')
ok(/dragReorder/.test(read('src/features/recipes/components/QuickGuessEditor.tsx')), false, '…and the preset sheet (used by Food\'s logger) never brings the drag along')

console.log(`verify-drag-reorder: ${n} assertions passed`)
