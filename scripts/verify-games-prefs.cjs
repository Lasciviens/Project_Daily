// Checks src/features/games/prefs/gamesPrefs.ts — platforms left out of stats (migration 133).
require('sucrase/register')
const assert = require('assert')
const { normalizeGamesPrefs, gamesPrefsDoc, countedGames, defaultGamesPrefs } = require('../src/features/games/prefs/gamesPrefs.ts')
let n = 0
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++ }

eq(defaultGamesPrefs(), { excludedPlatforms: [] }, 'default: nothing left out')
eq(normalizeGamesPrefs(null), { excludedPlatforms: [] }, 'null doc')
eq(normalizeGamesPrefs({ excluded_platforms: ['pico8', 'android', 'pico8', '', 3, ' all ', 'all'] }), { excludedPlatforms: ['android', 'pico8'] }, 'deduped, sorted, junk and "all" dropped')
eq(normalizeGamesPrefs({ excludedPlatforms: ['steam'] }), { excludedPlatforms: ['steam'] }, 'camelCase read too')
eq(gamesPrefsDoc({ excludedPlatforms: ['snes', 'android', 'snes'] }), { excluded_platforms: ['android', 'snes'] }, 'stored doc')
eq(normalizeGamesPrefs(gamesPrefsDoc({ excludedPlatforms: ['b', 'a'] })), { excludedPlatforms: ['a', 'b'] }, 'round trip')

const games = [{ id: 1, platformKey: 'snes' }, { id: 2, platformKey: 'android' }, { id: 3, platformKey: 'steam' }, { id: 4, platformKey: 'android' }]
eq(countedGames(games, []), games, 'nothing left out: same list')
assert.strictEqual(countedGames(games, []), games, 'nothing left out: same reference (no re-render churn)'); n++
eq(countedGames(games, ['android']).map(g => g.id), [1, 3], 'android left out')
eq(countedGames(games, ['android', 'steam', 'gone']).map(g => g.id), [1], 'several, unknown key harmless')
eq(games.length, 4, 'source list untouched')

console.log(`verify-games-prefs: ${n} assertions passed`)
