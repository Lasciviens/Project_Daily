#!/usr/bin/env node
/*
 * Verification — Settings → APIs registry (src/features/settings/apiRegistry.ts)
 * against the real module through sucrase: unique ids, https docs links, app
 * paths, DD.MM.YYYY dates, known categories, `sinceFrom` files that exist,
 * no secret VALUES, and the search/filter helpers.
 *
 *   Run:  node scripts/verify-api-registry.cjs
 */
require('sucrase/register')
const fs = require('fs')
const path = require('path')
const R = require('../src/features/settings/apiRegistry')

let passed = 0
let failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}
const list = R.API_REGISTRY
const bad = (pred) => list.filter(pred).map(e => e.id).join(', ')

console.log('\nshape')
check('has entries', list.length >= 25, String(list.length))
{
  const ids = list.map(e => e.id)
  check('ids are unique', new Set(ids).size === ids.length)
}
check('every docsUrl is https', !bad(e => !/^https:\/\/\S+$/.test(e.docsUrl)), bad(e => !/^https:\/\//.test(e.docsUrl)))
check('every extra docs link is https', !bad(e => (e.moreDocs ?? []).some(d => !/^https:\/\//.test(d.url))))
check('every entry is used somewhere', !bad(e => e.usedIn.length === 0))
check('every usedIn path starts with /', !bad(e => e.usedIn.some(u => !u.path.startsWith('/'))), bad(e => e.usedIn.some(u => !u.path.startsWith('/'))))
check('since is DD.MM.YYYY', !bad(e => !/^\d{2}\.\d{2}\.\d{4}$/.test(e.since)), bad(e => !/^\d{2}\.\d{2}\.\d{4}$/.test(e.since)))
check('since is a real calendar date', !bad(e => {
  const [d, m, y] = e.since.split('.').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCDate() !== d || dt.getUTCMonth() !== m - 1
}))
check('category is known', !bad(e => !R.API_CATEGORIES.includes(e.category)))
check('transports / auth / direction have labels', !bad(e =>
  e.transports.length === 0 || e.transports.some(t => !R.TRANSPORT_LABEL[t]) || !R.AUTH_LABEL[e.auth] || !R.DIRECTION_LABEL[e.direction]))
check('purpose and cadence are filled', !bad(e => !e.purpose.trim() || !e.cadence.trim() || !e.connection.trim()))
check('sinceFrom file exists in the repo', !bad(e => !fs.existsSync(path.join(__dirname, '..', e.sinceFrom))), bad(e => !fs.existsSync(path.join(__dirname, '..', e.sinceFrom))))
check('edge functions exist in supabase/functions', !bad(e => (e.edgeFunctions ?? []).some(f => !fs.existsSync(path.join(__dirname, '..', 'supabase/functions', f)))),
  bad(e => (e.edgeFunctions ?? []).some(f => !fs.existsSync(path.join(__dirname, '..', 'supabase/functions', f)))))
check('secrets are names, never values', !bad(e => (e.secrets ?? []).some(s => !/^[A-Z][A-Z0-9_]+( \(.+\))?$/.test(s))), bad(e => (e.secrets ?? []).some(s => !/^[A-Z][A-Z0-9_]+( \(.+\))?$/.test(s))))
check('migration numbers are three digits', !bad(e => (e.migrations ?? []).some(m => !/^\d{3}$/.test(m))))
check('history-start entries carry the history-start date', !bad(e => e.sinceIsHistoryStart && e.since !== '22.07.2026'))

console.log('\nsearch + filter')
check('empty query matches all', R.filterApis(list, [], '').length === list.length)
check('category filter narrows', R.filterApis(list, ['Games'], '').every(e => e.category === 'Games') && R.filterApis(list, ['Games'], '').length >= 4)
check('several categories union', R.filterApis(list, ['Games', 'Food'], '').length === R.filterApis(list, ['Games'], '').length + R.filterApis(list, ['Food'], '').length)
check('search by edge function', R.filterApis(list, [], 'phone-gateway').some(e => e.id === 'phone-gateway'))
check('search by secret name', R.filterApis(list, [], 'steam_api_key').some(e => e.id === 'steam-web'))
check('search is word-AND and case-insensitive', R.filterApis(list, [], 'GOOGLE tasks').some(e => e.id === 'google-tasks') && R.filterApis(list, [], 'zzz nothing').length === 0)
check('search folds accents', R.matchesQuery({ ...list[0], name: 'Türkçe', provider: '', purpose: '', connection: '', usedIn: [] }, 'turkce'))
check('category counts sum to the list', R.categoryCounts(list).reduce((n, c) => n + c.count, 0) === list.length)

console.log('\nsince vs git (skipped without git history)')
{
  const { execFileSync } = require('child_process')
  const root = path.join(__dirname, '..')
  const gitDate = (file) => {
    try {
      const out = execFileSync('git', ['log', '--diff-filter=A', '--follow', '--format=%ad', '--date=short', '--', file], { cwd: root, encoding: 'utf8' }).trim().split('\n').pop()
      if (!/^\d{4}-\d{2}-\d{2}$/.test(out)) return null
      const [y, m, d] = out.split('-'); return `${d}.${m}.${y}`
    } catch { return null }
  }
  const dated = list.map(e => [e, gitDate(e.sinceFrom)]).filter(([, g]) => g)
  if (dated.length === 0) console.log('  (no git history — skipped)')
  else {
    const off = dated.filter(([e, g]) => e.since !== g).map(([e, g]) => `${e.id}: ${e.since} ≠ ${g}`)
    check('since equals the first git commit of sinceFrom', off.length === 0, off.join('; '))
  }
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
