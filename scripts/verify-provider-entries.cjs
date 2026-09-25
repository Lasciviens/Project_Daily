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

// ── isHiddenEntry / visibleEntries / countHidden ────────────────────────────
const rows = [
  { id: 'a', cat: 'ps5_native_game' },
  { id: 'b', cat: 'tv_app' },
  { id: 'c', cat: null },
]
const kindOf = r => P.psnKind(r.cat)
// No stored status anywhere: the provider's own type is the only signal.
const autoHidden = r => P.isHiddenEntry(kindOf(r), undefined)

ok(P.visibleEntries(rows, autoHidden, false).map(r => r.id), ['a', 'c'],
  'unknown is KEPT — hiding removes what is known not to be a game, never what is simply unclassified')
ok(P.visibleEntries(rows, autoHidden, true).map(r => r.id), ['a', 'b', 'c'],
  'Show hidden puts everything back')
ok(P.countHidden(rows, autoHidden), 1, 'and the label can say how many are hidden')
ok(P.visibleEntries([], autoHidden, false), [], 'nothing to filter')

// An explicit status always beats the provider's own classification, BOTH ways.
ok(P.isHiddenEntry('game', 'hidden'), true,
  'an explicit hide wins over a provider that insists this is a game')
ok(P.isHiddenEntry('not_game', 'backlog'), false,
  'a real status un-hides an app the user has deliberately taken an interest in')
ok(P.isHiddenEntry('not_game', undefined), true, 'no status: the provider decides')
ok(P.isHiddenEntry('not_game', null), true, 'a null status is no status')
ok(P.isHiddenEntry('unknown', undefined), false, 'unclassified stays visible')
ok(P.isHiddenEntry('unknown', 'hidden'), true, 'unclassified can still be hidden by hand')

console.log(`✅ ${n} assertions passed`)
