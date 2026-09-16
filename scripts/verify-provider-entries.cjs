// Throwaway verification for src/features/games/providerEntries.ts — no unit
// test framework in this repo (CLAUDE.md).  node scripts/verify-provider-entries.cjs
require('sucrase/register')
const assert = require('assert')
const P = require('../src/features/games/providerEntries.ts')

let n = 0
const ok = (a, b, what) => { assert.deepStrictEqual(a, b, what); n++ }

// ── mergeOwnership ──────────────────────────────────────────────────────────
// Sony lists the same titleId twice when a game is BOTH bought and in the
// catalogue. Keeping only one row is how a game you paid for reads as a rental.
ok([...P.mergeOwnership([
  { titleId: 'CUSA1', membership: 'NONE' },
  { titleId: 'CUSA1', membership: 'PS_PLUS' },
])], [['CUSA1', 'both']], 'bought then in the catalogue is both')
ok([...P.mergeOwnership([
  { titleId: 'CUSA1', membership: 'PS_PLUS' },
  { titleId: 'CUSA1', membership: 'NONE' },
])], [['CUSA1', 'both']], 'and the other way round is the same answer')
ok([...P.mergeOwnership([{ titleId: 'CUSA2', membership: 'NONE' }])], [['CUSA2', 'owned']], 'bought outright')
ok([...P.mergeOwnership([{ titleId: 'CUSA3', membership: 'PS_PLUS' }])], [['CUSA3', 'plus']], 'catalogue only')
ok([...P.mergeOwnership([{ titleId: 'CUSA4', membership: 'ps_plus' }])], [['CUSA4', 'plus']], 'membership is compared case-insensitively')
ok([...P.mergeOwnership([{ titleId: 'CUSA5' }])], [['CUSA5', 'owned']], 'no membership at all is not a subscription')
ok([...P.mergeOwnership([{ membership: 'PS_PLUS' }])], [], 'a row with no titleId is dropped')
ok([...P.mergeOwnership([])], [], 'nothing purchased')
ok([...P.mergeOwnership([
  { titleId: 'A', membership: 'NONE' }, { titleId: 'A', membership: 'NONE' },
])], [['A', 'owned']], 'the same row twice does not become "both"')
ok(P.OWNERSHIP_LABEL.both, 'PS+ & Own', 'the label the badge shows')

// ── psnKind ─────────────────────────────────────────────────────────────────
ok(P.psnKind('ps4_game'), 'game', 'a PS4 game')
ok(P.psnKind('ps5_native_game'), 'game', 'a PS5 game')
ok(P.psnKind('pspc_game'), 'game', 'a PC game on their list')
ok(P.psnKind('unknown'), 'unknown', 'Sony saying it does not know is not "not a game"')
ok(P.psnKind(null), 'unknown', 'nor is an absent category')
ok(P.psnKind(''), 'unknown', 'nor an empty one')
ok(P.psnKind('ps4_app'), 'not_game', 'an app is not a game')

// ── steamKind ───────────────────────────────────────────────────────────────
ok(P.steamKind('game'), 'game', 'a game')
ok(P.steamKind('dlc'), 'not_game', 'dlc')
ok(P.steamKind('music'), 'not_game', 'a soundtrack')
ok(P.steamKind('video'), 'not_game', 'a video')
ok(P.steamKind('demo'), 'not_game', 'a demo')
ok(P.steamKind('tool'), 'not_game', 'a tool')
// Most of a large library has never had its store page fetched.
ok(P.steamKind(null), 'unknown', 'an app whose store page was never fetched is unclassified')

// ── hideNonGames ────────────────────────────────────────────────────────────
const rows = [
  { id: 'a', kind: 'game' }, { id: 'b', kind: 'not_game' }, { id: 'c', kind: 'unknown' },
]
const kindOf = (r) => r.kind
ok(P.hideNonGames(rows, kindOf).map(r => r.id), ['a', 'c'],
  'unknown is KEPT — the toggle removes what is known not to be a game, never what is simply unclassified')
ok(P.countNonGames(rows, kindOf), 1, 'and the label can say how many it would remove')
ok(P.hideNonGames([], kindOf), [], 'nothing to filter')

console.log(`✅ ${n} assertions passed`)
