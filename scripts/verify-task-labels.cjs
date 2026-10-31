// A task's own labels (migration 180; owner, 31.10.2026: "an option to add other labels" — "My own labels"):
// the browser's copy of the database's cleaning rule (todo/taskLabels.ts — verify-db-task-labels compares it
// with SQL's task_labels_clean case by case), the sheet's suggestions, and where the labels go: the one save
// sends them for a task only, the rows show them, the assistant's catalogue names the column.
require('sucrase/register')
const fs = require('fs')
const path = require('path')
const L = require('../src/features/todo/taskLabels.ts')

let n = 0
const eq = (a, b, msg) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) { console.error(`✗ ${msg}\n  got  ${JSON.stringify(a)}\n  want ${JSON.stringify(b)}`); process.exit(1) }
  n++
}
const src = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')

// ── The rule ──
eq(L.cleanLabels(['  Errands ', 'errands', 'Phone\tcall', 'Home  Office']), ['Errands', 'Phone call', 'Home Office'],
  'trimmed, a tab a space, spaces squashed, the same label in another case once (the first kept)')
eq(L.cleanLabels(['x'.repeat(40)]), ['x'.repeat(30)], 'cut at 30 characters')
eq(L.cleanLabels(['🙂'.repeat(35)])[0].length, 60, 'an emoji is one character, not two (30 emoji kept)')
eq(L.cleanLabels(['ab '.repeat(12)]), ['ab ab ab ab ab ab ab ab ab ab'], 'a cut that ends in a space is trimmed again')
eq(L.cleanLabels(['', '   ', '\n', null, 7, undefined]), [], 'empty, blank and non-text labels are dropped')
eq(L.cleanLabels(Array.from({ length: 14 }, (_, i) => `L${i}`)).length, 10, 'at most ten, the first ones')
eq(L.cleanLabel('  Kitchen   scale  '), 'Kitchen scale', 'one label: spaces squashed and trimmed')
eq(L.labelsOf({ labels: ['A', 2, 'B'] }), ['A', 'B'], 'a row\'s labels: text only')
eq(L.labelsOf({}), [], 'a row from an older database has none')

// ── Suggestions ──
const known = ['Errands', 'Phone', 'Kitchen scale', 'Home office', 'Health']
eq(L.labelSuggestions(known, '', []), known, 'nothing typed: the owner\'s labels, most used first (as the database orders them)')
eq(L.labelSuggestions(known, 'h', []), ['Home office', 'Health', 'Phone', 'Kitchen scale'], 'typed: the ones that start with it, then the ones that contain it')
eq(L.labelSuggestions(known, 'E', ['errands']), ['Phone', 'Kitchen scale', 'Home office', 'Health'],
  'a label already on the task isn\'t offered again (any case); the rest that contain the letters')
eq(L.labelSuggestions(known, '', [], 2), ['Errands', 'Phone'], 'at most the limit')
eq(L.labelSuggestions(['Phone call', 'Phone', 'Phonics'], 'phone', [])[0], 'Phone', 'the exact label first: Enter on "Phone" picks Phone, never the more used "Phone call"')

// ── Where they go ──
const form = src('src/shared/components/plan-modal/planForm.ts')
eq(/\.\.\.\(repeat \|\| !f\.labelsTouched \? \{\} : \{ labels: cleanLabels\(f\.labels\) \}\)/.test(form), true,
  'the one save sends a task\'s labels cleaned and only when changed in the sheet (untouched, the database keeps them — a sheet opened without them never wipes them), never a repeat\'s rule')
const sheet = src('src/shared/components/plan-modal/ItemForm.tsx')
eq(/const showLabels = !repeating && !day && !hideTask\('labels'\)/.test(sheet) && /<LabelsFact value=\{form\.labels\} onChange=\{labels => patch\(\{ labels, labelsTouched: true \}\)\}/.test(sheet), true,
  'the sheet shows "+ Label" for a task, never for a repeat\'s rule or a repeat\'s day ("This day" opens without its task\'s labels)')
eq(/onBlur=\{\(\) => \{ if \(typed && !has\(value, typed\)\) onChange/.test(src('src/shared/components/plan-modal/LabelsFact.tsx')), true,
  'a label typed and never Entered is added when the field is left (Save), never dropped without a word')
eq(/VALUE_FACTS: readonly SheetRow\[\] = \['priority', 'area', 'list'\]/.test(sheet) && /<ListFact\b/.test(sheet), true,
  'a Google Task\'s list is a value with a menu of the lists (owner: "+Google List … did nothing")')
eq(/answer\.labels === null/.test(src('src/features/items/useItems.ts')), true,
  'a save to a database without migration 180 says the labels weren\'t kept, never silently')
for (const f of ['src/features/todo/components/ToDoItem.tsx', 'src/features/work/components/WorkTaskCard.tsx', 'src/features/work/components/WorkListView.tsx']) {
  eq(/<TaskLabelPills\b/.test(src(f)), true, `${path.basename(f)} shows the labels as chips`)
}
eq(/labels\(text\[\]/.test(src('supabase/functions/ai-proxy/index.ts')), true, 'the assistant\'s catalogue names tasks.labels')
const mig = src('supabase/migrations/180_task_labels.sql')
eq(/before insert or update of labels on public\.tasks/.test(mig), true, 'every writer is cleaned by the database (a trigger, not app code)')

console.log(`verify-task-labels: ${n} checks passed`)
