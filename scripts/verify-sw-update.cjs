// Checks when a new app version may replace the one on screen (src/app/swUpdateRules.ts).
//   node scripts/verify-sw-update.cjs
require('sucrase/register')
const assert = require('assert')
const R = require('../src/app/swUpdateRules.ts')

let n = 0
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); n++ }
const at = (m) => R.canApplyUpdate({ hidden: false, idleMs: 0, popupOpen: false, typing: false, ...m })

// The owner's report: reloads right after opening the app and in the middle of work.
eq(at({}), false, 'on screen and in use: never')
eq(at({ idleMs: 60 * 1000 }), false, 'a minute without input is still "in use"')
eq(at({ idleMs: R.IDLE_MS - 1 }), false, 'just under the idle limit')
eq(at({ idleMs: R.IDLE_MS }), true, 'left alone for the idle limit')
eq(at({ hidden: true }), true, 'in the background')

// Never throws away what is open or typed.
eq(at({ hidden: true, popupOpen: true }), false, 'a popup is open')
eq(at({ hidden: true, typing: true }), false, 'text in a field')
eq(at({ idleMs: R.IDLE_MS * 3, popupOpen: true }), false, 'idle with a popup open')
eq(at({ idleMs: R.IDLE_MS * 3, typing: true }), false, 'idle with text in a field')

// Asking the server for a new version.
eq(R.shouldCheckForUpdate(R.CHECK_EVERY_MS, 'interval'), true, 'half an hour after the last check')
eq(R.shouldCheckForUpdate(R.CHECK_EVERY_MS - 61 * 1000, 'interval'), false, 'the minute tick before that')
eq(R.shouldCheckForUpdate(5 * 60 * 1000, 'visible'), false, 'back after 5 minutes: no new check')
eq(R.shouldCheckForUpdate(16 * 60 * 1000, 'visible'), true, 'back after 16 minutes: check')

console.log(`verify-sw-update: ${n} checks passed`)
