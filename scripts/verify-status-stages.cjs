#!/usr/bin/env node
/* Verification — one meaning, one colour (shared/theme/stage.ts): every
 * feature's status maps to the same tone as its counterpart elsewhere. */
require('sucrase/register')
const assert = require('node:assert/strict')
const { STAGE_TONE } = require('../src/shared/theme/stage')
const { BUCKET_TONE } = require('../src/features/media/libraryModel')
const { STATUS_TONE } = require('../src/features/todo/taskTones')
const { PROJECT_STATUS_TONE, PHASE_STATUS_TONE, ITEM_STATUS_TONE } = require('../src/features/projects/projectTones')
const { PLAY_STATUS_TONE } = require('../src/features/games/playStatusTones')

let n = 0
const ok = (a, e, m) => { assert.deepStrictEqual(a, e, m); n++ }
const T = STAGE_TONE

ok(new Set(Object.values(T)).size, 7, 'seven stages, seven different tones')
ok(Object.values(T).includes('accent'), false, 'a status is never the accent colour')

// In progress — one colour.
for (const [name, tone] of [['Watching', BUCKET_TONE.watching], ['Playing', PLAY_STATUS_TONE.playing], ['Task in progress', STATUS_TONE.in_progress], ['Project active', PROJECT_STATUS_TONE.active], ['Phase in progress', PHASE_STATUS_TONE.in_progress], ['Item in progress', ITEM_STATUS_TONE.in_progress]]) ok(tone, T.active, `${name} = in progress`)
// Done — one colour.
for (const [name, tone] of [['Movie completed', BUCKET_TONE.completed], ['Game completed', PLAY_STATUS_TONE.completed], ['Task done', STATUS_TONE.done], ['Project completed', PROJECT_STATUS_TONE.completed], ['Phase done', PHASE_STATUS_TONE.done], ['Item done', ITEM_STATUS_TONE.done]]) ok(tone, T.done, `${name} = done`)
// Given up — one colour.
for (const [name, tone] of [['Movie dropped', BUCKET_TONE.dropped], ['Game dropped', PLAY_STATUS_TONE.dropped], ['Task cancelled', STATUS_TONE.cancelled], ['Item cancelled', ITEM_STATUS_TONE.cancelled]]) ok(tone, T.dropped, `${name} = dropped`)
// Waiting — one colour.
for (const [name, tone] of [['Series paused', BUCKET_TONE.paused], ['Task waiting', STATUS_TONE.waiting], ['Project on hold', PROJECT_STATUS_TONE.on_hold]]) ok(tone, T.paused, `${name} = paused`)
// Planned / not started / coming soon.
ok(BUCKET_TONE.wishlist, T.planned, 'Wishlist = planned'); ok(PLAY_STATUS_TONE.wishlist, T.planned, 'Game wishlist = planned')
ok(PLAY_STATUS_TONE.backlog, T.idle, 'Backlog = not started'); ok(STATUS_TONE.open, T.idle, 'Open task = not started'); ok(PHASE_STATUS_TONE.pending, T.idle, 'Pending phase = not started')
ok(BUCKET_TONE.coming, T.upcoming, 'Coming soon has its own colour')
ok(new Set(Object.values(BUCKET_TONE)).size, 6, 'six library statuses, six colours on the covers')

console.log(`verify-status-stages: ${n} assertions passed`)
