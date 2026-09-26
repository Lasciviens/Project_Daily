#!/usr/bin/env node
/**
 * verify-game-edit.cjs — the game edit form's date round trip and
 * changed-fields-only patch (src/features/games/api/gameEdit.ts), and what a
 * Steam/PSN re-import may write onto an existing row
 * (src/features/games/api/providerImportRules.ts). No test framework here.
 *
 *   TZ=Europe/Oslo node scripts/verify-game-edit.cjs
 *   (it re-runs itself under Oslo, UTC and Los Angeles)
 */
require('sucrase/register')
const assert = require('assert')
const { execFileSync } = require('child_process')

if (!process.env.__VGE_CHILD) {
  for (const tz of ['Europe/Oslo', 'UTC', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
    process.stdout.write(execFileSync(process.execPath, [__filename], { env: { ...process.env, TZ: tz, __VGE_CHILD: '1' } }))
  }
  process.exit(0)
}

const E = require('../src/features/games/api/gameEdit.ts')
const P = require('../src/features/games/api/providerImportRules.ts')
let n = 0
const ok = (a, b, what) => { assert.deepStrictEqual(a, b, `[${process.env.TZ}] ${what}`); n++ }

// ── Dates: the day shown is the day saved, and saving it again changes nothing ──
for (const day of ['2026-01-01', '2026-03-29', '2026-10-25', '2026-12-31', '2024-02-29']) {
  let v = day
  for (let i = 0; i < 10; i++) v = E.isoToDateInput(E.dateInputToIso(v))
  ok(v, day, `${day} survives ten save/reopen round trips (DST days included)`)
}
// A timestamp stored at local midnight by the old code shows its local day.
ok(E.isoToDateInput(new Date(2026, 8, 15, 0, 30).toISOString()), '2026-09-15', 'an early-morning local timestamp shows its local day, not the UTC one')
ok(E.isoToDateInput(null), '', 'no date → empty input')
ok(E.isoToDateInput('not a date'), '', 'garbage → empty input')
ok(E.dateInputToIso(''), null, 'cleared input → null')
ok(E.dateInputToIso('2026-9-5'), null, 'a malformed input is not saved')

// ── Only what changed is sent ──
const initial = { title: 'Ico', genres: ['Action', 'Adventure'], rating: 8, started_at: '2026-01-01T11:00:00.000Z', play_notes: null }
ok(E.diffPatch(initial, { ...initial }), {}, 'nothing changed → empty patch')
ok(E.diffPatch(initial, { ...initial, title: 'ICO' }), { title: 'ICO' }, 'a typo fix sends the title only — never the rating or dates it loaded')
ok(E.diffPatch(initial, { ...initial, genres: ['Action', 'Adventure'] }), {}, 'an equal array is not a change')
ok(E.diffPatch(initial, { ...initial, genres: ['Action'] }), { genres: ['Action'] }, 'a changed array is')
ok(E.diffPatch(initial, { ...initial, play_notes: undefined }), {}, 'null and undefined are the same empty value')
ok(E.diffPatch(initial, { ...initial, rating: null }), { rating: null }, 'clearing a value is a change')

// ── Provider re-import: play figures refresh, curated fields are only filled ──
const row = {
  title: 'The Witcher 3 (my spelling)', primary_cover_url: 'https://x/chosen.jpg', genres: ['RPG'], release_year: 2015,
  play_seconds: 3600, play_count: 4, last_played_at: '2026-08-01T10:00:00Z',
}
const steam = { title: 'The Witcher® 3: Wild Hunt', play_seconds: 7200, last_played_at: '2026-09-01T10:00:00Z', primary_cover_url: 'https://steam/600x900.jpg' }
const u = P.providerUpdateFields(row, steam)
ok([u.title, u.primary_cover_url, u.genres, u.release_year], [row.title, row.primary_cover_url, ['RPG'], 2015],
  'a refresh never resets a corrected title, a chosen cover, genres or year (Steam sends no genres or year)')
ok([u.play_seconds, u.last_played_at], [7200, '2026-09-01T10:00:00Z'], 'play figures take the provider’s latest')
ok(u.play_count, 4, 'a count the provider does not report keeps the stored one')
const empty = { title: '', primary_cover_url: null, genres: [], release_year: null, play_seconds: null, play_count: null, last_played_at: null }
const f = P.providerUpdateFields(empty, { title: 'Bloodborne', genres: ['ACTION'], release_year: 2015, primary_cover_url: 'https://psn/c.png', play_seconds: 60 })
ok([f.title, f.genres, f.release_year, f.primary_cover_url], ['Bloodborne', ['ACTION'], 2015, 'https://psn/c.png'], 'empty fields are filled')
ok(Object.keys(u).sort(), Object.keys(f).sort(), 'every row gets the same columns (a batch upsert fills missing ones with NULL)')
ok(P.providerUpdateFields({ ...row, last_played_at: null }, { title: 'x', last_played_at: null }).last_played_at, null, 'no date anywhere stays null')

console.log(`[${process.env.TZ}] verify-game-edit: ${n} assertions passed`)
