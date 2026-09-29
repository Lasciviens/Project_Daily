#!/usr/bin/env node
/* Verification — the pure decisions behind <Truncate> (src/shared/ui/truncateRules.ts)
 * and the motion test set (src/shared/ui/motionRules.ts).
 * Run: node scripts/verify-truncate-and-motion.cjs */
require('sucrase/register')
const T = require('../src/shared/ui/truncateRules')
const M = require('../src/shared/ui/motionRules')
let passed = 0, failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) } else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}
const box = (sw, cw, sh, ch) => ({ scrollWidth: sw, clientWidth: cw, scrollHeight: sh, clientHeight: ch })

console.log('isTextCut')
check('one line: wider text is cut', T.isTextCut(box(240, 180, 20, 20), 1))
check('one line: fitting text is not cut', !T.isTextCut(box(180, 180, 20, 20), 1))
check('one line: 1px rounding is not a cut', !T.isTextCut(box(181, 180, 20, 20), 1))
check('one line: 2px over is a cut', T.isTextCut(box(182, 180, 20, 20), 1))
check('one line ignores height', !T.isTextCut(box(100, 180, 60, 20), 1))
check('clamp: taller text is cut', T.isTextCut(box(180, 180, 60, 40), 2))
check('clamp ignores width (break-words wraps)', !T.isTextCut(box(400, 180, 40, 40), 2))
check('3-line clamp compares heights too', T.isTextCut(box(180, 180, 80, 60), 3))
check('a box with no width is not laid out → not cut', !T.isTextCut(box(240, 0, 20, 20), 1))
check('a box with no height is not laid out → not cut', !T.isTextCut(box(240, 180, 20, 0), 1))

console.log('revealModeFor')
check('one line, free text → popover', T.revealModeFor({ lines: 1, reveal: 'auto', insideTappable: false }) === 'popover')
check('two lines, free text → More', T.revealModeFor({ lines: 2, reveal: 'auto', insideTappable: false }) === 'more')
check('three lines, free text → More', T.revealModeFor({ lines: 3, reveal: 'auto', insideTappable: false }) === 'more')
check('inside a tappable row → hover only (no nested control)', T.revealModeFor({ lines: 1, reveal: 'auto', insideTappable: true }) === 'hover')
check('inside a tappable row wins over a forced popover', T.revealModeFor({ lines: 1, reveal: 'popover', insideTappable: true }) === 'hover')
check('inside a tappable row wins over More', T.revealModeFor({ lines: 2, reveal: 'more', insideTappable: true }) === 'hover')
check('forced popover on a clamp', T.revealModeFor({ lines: 2, reveal: 'popover', insideTappable: false }) === 'popover')
check('forced More on one line', T.revealModeFor({ lines: 1, reveal: 'more', insideTappable: false }) === 'more')
check("reveal 'none' → hover only", T.revealModeFor({ lines: 1, reveal: 'none', insideTappable: false }) === 'hover')

console.log('truncateClass + selector')
check('one line truncates', T.truncateClass(1, false) === 'truncate')
check('two lines clamp and break words', T.truncateClass(2, false) === 'line-clamp-2 break-words')
check('three lines clamp', T.truncateClass(3, false) === 'line-clamp-3 break-words')
check('expanded drops the clamp', T.truncateClass(2, true) === 'break-words')
for (const sel of ['button', 'a[href]', 'label', '[role="button"]', '[role="link"]', '[role="tab"]', 'summary'])
  check(`tappable selector covers ${sel}`, T.TAPPABLE_SELECTOR.split(',').includes(sel))

console.log('bubbleZIndex (text inside a floating layer)')
check('no positioned layer → own z-popover', T.bubbleZIndex(undefined, 70) === undefined)
check('a layer below popovers (the tab bar, 40) → own z-popover', T.bubbleZIndex(40, 70) === undefined)
check('the floating composer (150) → one above it', T.bubbleZIndex(150, 70) === 151)
check('a layer exactly at the popover level → one above it', T.bubbleZIndex(70, 70) === 71)
check('a non-number z-index is ignored', T.bubbleZIndex(Number.NaN, 70) === undefined)

console.log('easing + tween')
check('ease starts at 0', M.easeOutCubic(0) === 0)
check('ease ends at 1', M.easeOutCubic(1) === 1)
check('ease is fast first (half time → 87.5%)', Math.abs(M.easeOutCubic(0.5) - 0.875) < 1e-9, String(M.easeOutCubic(0.5)))
check('ease clamps below 0 and above 1', M.easeOutCubic(-1) === 0 && M.easeOutCubic(2) === 1)
{
  let mono = true, prev = -1
  for (let i = 0; i <= 100; i++) { const v = M.easeOutCubic(i / 100); if (v < prev) mono = false; prev = v }
  check('ease never goes backwards', mono)
}
check('tween at 0 is the start', M.tweenValue(10, 50, 0) === 10)
check('tween at 1 is exactly the end (no float drift)', M.tweenValue(0.1, 2300.7, 1) === 2300.7)
check('tween halfway', M.tweenValue(0, 200, 0.5) === 100)
check('tween downwards', M.tweenValue(100, 40, 0.5) === 70)

console.log('format')
check('rounds to whole numbers', M.formatTweenNumber(1133.6) === '1134')
check('keeps fixed decimals while counting (width stays)', M.formatTweenNumber(12.3, 3) === '12.300')
check('no float noise', M.roundTo(0.1 + 0.2, 1) === 0.3)
check('negative decimals treated as 0', M.formatTweenNumber(7.6, -2) === '8')

console.log('widerText (room a count keeps)')
check('the longer rendering wins', M.widerText('710', '1166') === '1166' && M.widerText('2300', '0') === '2300')
check('a tie keeps the first', M.widerText('1234', '9999') === '1234')
check('decimals and separators count as characters', M.widerText('9.500', '10.250') === '10.250')

console.log('ringShare')
check('not armed yet → empty (it sweeps in)', M.ringShare({ armed: false, ready: true, value: 0.6, lastReal: 0.6 }) === 0)
check('ready → the value', M.ringShare({ armed: true, ready: true, value: 0.3, lastReal: 0.6 }) === 0.3)
check('loading → holds the last real share (no drain to the placeholder)', M.ringShare({ armed: true, ready: false, value: 0, lastReal: 0.49 }) === 0.49)
check('first load not armed stays empty even while loading', M.ringShare({ armed: false, ready: false, value: 0, lastReal: 0 }) === 0)

console.log('row "new" window')
check('a row stays new longer than its 260ms rise-in', M.FRESH_ROW_MS > 260)
check('…but not long enough to replay on a quick remount', M.FRESH_ROW_MS <= 600)

console.log('shouldTween')
check('first appearance (from 0) animates', M.shouldTween(0, 1166, true))
check('a real change animates', M.shouldTween(1166, 900, true))
check('a refetch of the same value does not', !M.shouldTween(1166, 1166, true))
check('disabled setting never animates', !M.shouldTween(0, 1166, false))
check('NaN / Infinity never animate', !M.shouldTween(0, NaN, true) && !M.shouldTween(Infinity, 5, true))
check('no known start → no animation', !M.shouldTween(null, 5, true))

console.log('nextNewIds')
{
  const a = M.nextNewIds(null, ['t1', 't2'], '2026-09-28')
  check('first load is the baseline: nothing new', a.fresh.size === 0 && a.known.size === 2)
  const b = M.nextNewIds(a, ['t1', 't2', 't3'], '2026-09-28')
  check('an added row is new', b.fresh.size === 1 && b.fresh.has('t3'))
  const c = M.nextNewIds(b, ['t1', 't2', 't3'], '2026-09-28')
  check('the next render with the same rows marks nothing', c.fresh.size === 0)
  const d = M.nextNewIds(c, ['t1', 't3'], '2026-09-28')
  check('a removed row is not "new"', d.fresh.size === 0)
  const e = M.nextNewIds(d, ['t1', 't2', 't3'], '2026-09-28')
  check('a row that comes back (Undo) is new again', e.fresh.size === 1 && e.fresh.has('t2'))
  const f = M.nextNewIds(e, ['x1', 'x2'], '2026-09-29')
  check('another day is a new baseline: nothing new', f.fresh.size === 0 && f.scope === '2026-09-29')
  const g = M.nextNewIds({ scope: 's', known: null, fresh: new Set() }, ['a'], 's')
  check('an unloaded state is a baseline too', g.fresh.size === 0)
  const h = M.nextNewIds(M.nextNewIds(null, [], 's'), ['a', 'b'], 's')
  check('rows arriving in an empty (loaded) list are new', h.fresh.size === 2)
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
