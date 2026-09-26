#!/usr/bin/env node
/**
 * verify-game-cache-patch.cjs — the optimistic cache rules
 * (src/features/games/api/gameCachePatch.ts): one row patched in every
 * cached games read, the shared status-date rule, the next queue slot.
 *   node scripts/verify-game-cache-patch.cjs
 */
require('sucrase/register')
const assert = require('assert')
const C = require('../src/features/games/api/gameCachePatch.ts')

let n = 0
const ok = (a, b, what) => { assert.deepStrictEqual(a, b, what); n++ }

// ── patchGameData: every cached shape ──
const list = [{ id: 'a', rating: 1 }, { id: 'b', rating: 2 }]
const patched = C.patchGameData(list, 'b', { rating: 9 })
ok(patched[1], { id: 'b', rating: 9 }, 'a list row is patched')
ok(patched[0] === list[0], true, 'untouched rows keep their identity (memoised cards do not re-render)')
ok(C.patchGameData(list, 'zzz', { rating: 9 }) === list, true, 'a list without the row is returned as is')
ok(C.patchGameData(undefined, 'a', { rating: 9 }), undefined, 'an unloaded cache stays unloaded (never [] = "library empty")')
ok(C.patchGameData({ id: 'a', title: 'x' }, 'a', { rating: 3 }), { id: 'a', title: 'x', rating: 3 }, 'a detail row is patched')
ok(C.patchGameData({ id: 'q' }, 'a', { rating: 3 }), { id: 'q' }, 'another game’s detail is left alone')
const stats = { rows: [{ id: 'a', play_status: 'backlog' }], platforms: [] }
ok(C.patchGameData(stats, 'a', { play_status: 'playing' }).rows[0].play_status, 'playing', 'the stats read’s rows are patched')
ok(C.patchGameData(stats, 'x', { play_status: 'playing' }) === stats, true, 'stats without the row: same object')
ok(C.patchGameData('text', 'a', {}), 'text', 'unknown shapes are ignored')

// ── statusPatch: the server write and the optimistic patch agree ──
const NOW = '2026-09-26T10:00:00.000Z'
ok(C.statusPatch({ id: 'a', title: 't' }, 'playing', NOW), { play_status: 'playing', started_at: NOW }, 'Playing stamps a start date')
ok(C.statusPatch({ id: 'a', title: 't', started_at: '2026-01-01T00:00:00Z' }, 'playing', NOW), { play_status: 'playing' }, 'an existing start date is kept')
ok(C.statusPatch({ id: 'a', title: 't', library: 'steam', last_played_at: '2025-05-05T12:00:00Z', play_seconds: 9000 }, 'completed', NOW),
  { play_status: 'completed', finished_at: '2025-05-05T12:00:00Z' }, 'Completed takes the provider’s last session, not now')
ok(C.statusPatch({ id: 'a', title: 't', esde_last_played: '2026-02-02T20:00:00Z', last_played_at: '2020-01-01T00:00:00Z' }, 'completed', NOW).finished_at,
  '2026-02-02T20:00:00Z', 'a retro row reads ES-DE’s live date, not the frozen 096 copy')
ok(C.statusPatch(null, 'completed', NOW), { play_status: 'completed', finished_at: NOW }, 'no session anywhere → now')
ok(C.statusPatch({ id: 'a', title: 't', finished_at: '2024-01-01T00:00:00Z' }, 'completed', NOW), { play_status: 'completed' }, 'an existing finish date is kept')
ok(C.statusPatch({ id: 'a', title: 't' }, 'hidden', NOW), { play_status: 'hidden' }, 'other statuses stamp nothing')

// ── nextQueuePosition ──
ok(C.nextQueuePosition([[{ play_order: 3 }, { play_order: null }], [{ play_order: 7 }], { rows: [] }, undefined]), 8, 'max over every cached list + 1')
ok(C.nextQueuePosition([]), 1, 'an empty queue starts at 1')

console.log(`verify-game-cache-patch: ${n} assertions passed`)
