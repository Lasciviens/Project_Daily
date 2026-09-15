#!/usr/bin/env node
/**
 * verify-esde-import-rules.cjs — asserts the ES-DE import's pure logic against
 * the REAL, un-mocked module (sucrase-require, this repo's no-unit-test-
 * framework convention; precedent: scripts/verify-health-source-resolver.cjs).
 *
 * What this covers is what a green deploy cannot tell you: the local-wall-clock
 * timestamp conversion across a DST boundary, the 0-1 to 0-100 rating rescale,
 * and the difference between an absent number and a zero.
 *
 * The edge function keeps a hand-mirrored copy of this module (Deno functions
 * are self-contained here and cannot import from src/) — if you change one,
 * change both. See the module's own header.
 *
 *   node scripts/verify-esde-import-rules.cjs
 */
require('sucrase/register')
const R = require('../src/features/games/api/esdeImportRules.ts')

let passed = 0
const failures = []
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a === e) passed++
  else failures.push(`${label}\n    expected ${e}\n    actual   ${a}`)
}

// ── parseEsdeTimestamp ──────────────────────────────────────────────────────
eq(R.parseEsdeTimestamp('19991014T000000'), { y: 1999, mo: 10, d: 14, h: 0, mi: 0, se: 0 }, 'a real releasedate from the export parses')
eq(R.parseEsdeTimestamp('20260519T210643'), { y: 2026, mo: 5, d: 19, h: 21, mi: 6, se: 43 }, 'a real lastplayed from the export parses')
eq(R.parseEsdeTimestamp('00000000T000000'), null, "ES-DE's all-zeros sentinel is absent, not year 0")
eq(R.parseEsdeTimestamp('1999-10-14T00:00:00'), null, 'an ISO-shaped string is rejected — this format has no separators')
eq(R.parseEsdeTimestamp('19991014T250000'), null, 'hour 25 is rejected rather than rolling over')
eq(R.parseEsdeTimestamp('19991314T000000'), null, 'month 13 is rejected')
eq(R.parseEsdeTimestamp(''), null, 'empty string is absent')
eq(R.parseEsdeTimestamp(null), null, 'null is absent')
eq(R.parseEsdeTimestamp(20260519), null, 'a number is not a timestamp')

// ── esdeIso: the DST-safe conversion, the whole reason this file exists ─────
// Oslo is UTC+1 in winter and UTC+2 in summer. A hardcoded offset gets exactly
// one of these two right, which is the bug this guards.
eq(R.esdeIso('20260119T120000', 'Europe/Oslo'), '2026-01-19T11:00:00.000Z', 'a winter time resolves at UTC+1')
eq(R.esdeIso('20260719T120000', 'Europe/Oslo'), '2026-07-19T10:00:00.000Z', 'a summer time resolves at UTC+2')
eq(R.esdeIso('20260519T210643', 'Europe/Oslo'), '2026-05-19T19:06:43.000Z', 'the real lastplayed from the export resolves')
eq(R.esdeIso('20260719T120000', 'UTC'), '2026-07-19T12:00:00.000Z', 'UTC is a no-op, so the two-pass correction cannot drift on its own')
eq(R.esdeIso(null, 'Europe/Oslo'), null, 'an absent timestamp stays absent')
// The day AFTER each transition, where a single-pass conversion is most likely
// to land on the wrong side.
eq(R.esdeIso('20260330T120000', 'Europe/Oslo'), '2026-03-30T10:00:00.000Z', 'the day after spring-forward is already UTC+2')
eq(R.esdeIso('20261026T120000', 'Europe/Oslo'), '2026-10-26T11:00:00.000Z', 'the day after fall-back is back to UTC+1')

// ── esdeDate ────────────────────────────────────────────────────────────────
eq(R.esdeDate('19991014T000000'), '1999-10-14', 'releasedate becomes a plain date')
eq(R.esdeDate('20060103T000000'), '2006-01-03', 'single-digit month and day are zero-padded')
eq(R.esdeDate('00000000T000000'), null, 'the zero sentinel yields no date')

// ── esdeInt: absent vs zero ─────────────────────────────────────────────────
eq(R.esdeInt(4), 4, 'a real playcount survives')
eq(R.esdeInt('2814'), 2814, 'a numeric string survives — XML text is a string')
eq(R.esdeInt(0), 0, 'an explicit 0 is a real value and is kept')
eq(R.esdeInt(undefined), null, 'an omitted field is null, never 0')
eq(R.esdeInt(''), null, 'an empty string is absent, never 0')
eq(R.esdeInt(null), null, 'null is absent')
eq(R.esdeInt(-5), null, 'a negative playtime is not a fact')
eq(R.esdeInt('not a number'), null, 'unparseable text is absent')
eq(R.esdeInt(29.6), 30, 'a fractional value rounds rather than truncating')

// ── esdeRating: 0-1 in, 0-100 out ───────────────────────────────────────────
eq(R.esdeRating(0.9), 90, "the export's own 0.9 becomes 90")
eq(R.esdeRating(1), 100, 'the top of the scale becomes 100')
eq(R.esdeRating(0), 0, 'zero is a real rating, not absent')
eq(R.esdeRating(0.755), 75.5, 'one decimal is preserved — the column is numeric(4,1)')
eq(R.esdeRating(1.5), null, 'out of range is DROPPED, not clamped to 100')
eq(R.esdeRating(-0.2), null, 'negative is dropped')
eq(R.esdeRating(undefined), null, 'an omitted rating is absent')
eq(R.esdeRating('0.9'), 90, 'a numeric string is accepted')

// ── esdeGenres ──────────────────────────────────────────────────────────────
eq(R.esdeGenres('Platform'), ['Platform'], 'a single genre becomes a one-element array')
eq(R.esdeGenres('Racing, Driving'), ['Racing', 'Driving'], 'the comma-separated string splits')
eq(R.esdeGenres('Action,  Adventure ,RPG'), ['Action', 'Adventure', 'RPG'], 'irregular spacing is trimmed')
eq(R.esdeGenres(''), null, 'an empty genre is absent, not an empty array')
eq(R.esdeGenres(',,'), null, 'a string of separators yields nothing rather than empty strings')
eq(R.esdeGenres(undefined), null, 'an omitted genre is absent')

// ── esdeKey ─────────────────────────────────────────────────────────────────
eq(R.esdeKey('genesis', './Sonic 3.md') === R.esdeKey('genesis', './Sonic 3.md'), true, 'the same pair yields the same key')
eq(R.esdeKey('genesis', './Sonic 3.md') === R.esdeKey('snes', './Sonic 3.md'), false, 'the same filename on two systems is two keys')
// A hand-picked delimiter would collide here; JSON encoding is why this holds.
eq(R.esdeKey('a', 'b:c') === R.esdeKey('a:b', 'c'), false, 'a separator inside a path cannot forge another key')
eq(R.esdeKey('a', '"quoted"') === R.esdeKey('a', '"quoted"'), true, 'quotes in a path round-trip')

// ── rollUpEsdeStats ─────────────────────────────────────────────────────────
eq(
  R.rollUpEsdeStats([{ esde_playcount: 4, esde_playtime_seconds: 2814, esde_last_played: '2026-05-19T19:06:43.000Z' }]),
  { esde_playcount: 4, esde_playtime_seconds: 2814, esde_last_played: '2026-05-19T19:06:43.000Z' },
  'a single variant rolls up to itself — the case for all 1125 games measured today',
)
eq(
  R.rollUpEsdeStats([
    { esde_playcount: 4, esde_playtime_seconds: 2814, esde_last_played: '2026-05-19T19:06:43.000Z' },
    { esde_playcount: 2, esde_playtime_seconds: 100, esde_last_played: '2026-07-01T10:00:00.000Z' },
  ]),
  { esde_playcount: 6, esde_playtime_seconds: 2914, esde_last_played: '2026-07-01T10:00:00.000Z' },
  'two variants sum their play, and last_played is the later one',
)
eq(
  R.rollUpEsdeStats([
    { esde_playcount: 2, esde_playtime_seconds: 100, esde_last_played: '2026-07-01T10:00:00.000Z' },
    { esde_playcount: 4, esde_playtime_seconds: 2814, esde_last_played: '2026-05-19T19:06:43.000Z' },
  ]),
  { esde_playcount: 6, esde_playtime_seconds: 2914, esde_last_played: '2026-07-01T10:00:00.000Z' },
  'the later last_played wins regardless of row order',
)
eq(
  R.rollUpEsdeStats([{ esde_playcount: null, esde_playtime_seconds: null, esde_last_played: null }]),
  { esde_playcount: null, esde_playtime_seconds: null, esde_last_played: null },
  'a never-played game stays null — it does NOT become 0',
)
eq(
  R.rollUpEsdeStats([
    { esde_playcount: null, esde_playtime_seconds: null, esde_last_played: null },
    { esde_playcount: 3, esde_playtime_seconds: 60, esde_last_played: '2026-01-01T00:00:00.000Z' },
  ]),
  { esde_playcount: 3, esde_playtime_seconds: 60, esde_last_played: '2026-01-01T00:00:00.000Z' },
  'one played variant beside an unplayed one contributes alone, and null does not poison the sum',
)
eq(
  R.rollUpEsdeStats([{ esde_playcount: 0, esde_playtime_seconds: 0, esde_last_played: null }]),
  { esde_playcount: 0, esde_playtime_seconds: 0, esde_last_played: null },
  'a recorded 0 survives as 0 — distinct from the null case above',
)
eq(R.rollUpEsdeStats([]), { esde_playcount: null, esde_playtime_seconds: null, esde_last_played: null }, 'no variants at all yields nulls, not zeros')

// ── isTrue ──────────────────────────────────────────────────────────────────
eq(R.isTrue(true), true, 'a real boolean is true')
eq(R.isTrue('true'), true, 'the XML string "true" is true — ES-DE writes flags as text')
eq(R.isTrue(false), false, 'false is false')
eq(R.isTrue('false'), false, 'the string "false" is false')
eq(R.isTrue(undefined), false, 'an omitted flag is false')
eq(R.isTrue(1), false, 'a 1 is not the flag ES-DE writes')

// ── report ──────────────────────────────────────────────────────────────────
if (failures.length > 0) {
  console.error(`\n${failures.length} FAILED of ${passed + failures.length}:\n`)
  for (const f of failures) console.error(`  ✗ ${f}\n`)
  process.exit(1)
}
console.log(`✓ ${passed} assertions passed (esde import rules)`)
