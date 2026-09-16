#!/usr/bin/env node
/**
 * verify-screenscraper-rules.cjs — asserts the ScreenScraper sync's pure logic
 * against the REAL, un-mocked module (sucrase-require, this repo's
 * no-unit-test-framework convention).
 *
 * The scrubbing assertions are the ones that matter most: ScreenScraper puts
 * devid/devpassword in the query string of every URL it returns, and this repo
 * writes failures into `app_error_logs`, which ai-proxy can read. A credential
 * that survives scrubbing does not stay in one log line.
 *
 * The edge function keeps a hand-mirrored copy of the module — change one,
 * change the other.
 *
 *   node scripts/verify-screenscraper-rules.cjs
 */
require('sucrase/register')
const R = require('../src/features/games/api/screenscraperRules.ts')

let passed = 0
const failures = []
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a === e) passed++
  else failures.push(`${label}\n    expected ${e}\n    actual   ${a}`)
}
function ok(cond, label) { eq(!!cond, true, label) }

// ── scrubSecrets — security critical ────────────────────────────────────────
const DEV = 'mydevid', PWD = 'sup3rsecret', SSID = 'lasciviens', SSPW = 'memberpass'
const SECRETS = [DEV, PWD, SSID, SSPW]
const MEDIA_URL = `https://api.screenscraper.fr/api2/mediaJeu.php?devid=${DEV}&devpassword=${PWD}&ssid=${SSID}&sspassword=${SSPW}&jeuid=3&media=box-2D`

const scrubbed = R.scrubSecrets(MEDIA_URL, SECRETS)
ok(!scrubbed.includes(DEV),  'devid does not survive scrubbing a media URL')
ok(!scrubbed.includes(PWD),  'devpassword does not survive scrubbing a media URL')
ok(!scrubbed.includes(SSID), 'ssid does not survive scrubbing a media URL')
ok(!scrubbed.includes(SSPW), 'sspassword does not survive scrubbing a media URL')
ok(scrubbed.includes('jeuid=3'), 'the non-secret part of the URL is left readable')

eq(R.scrubSecrets(`fetch failed for ${PWD}`, SECRETS), 'fetch failed for [REDACTED]',
  'a secret is removed from a plain error message, not just from a URL')
ok(!R.scrubSecrets(`...${PWD}...${PWD}...`, SECRETS).includes(PWD),
  'every occurrence is removed, not only the first')
// A truncated body never parses as a URL — substring replacement is why this holds.
ok(!R.scrubSecrets(`{"error":"bad login devpassword=${PWD}`, SECRETS).includes(PWD),
  'a secret is removed from a truncated, unparseable response body')
eq(R.scrubSecrets('devpassword=whatever-else&x=1', []), 'devpassword=[REDACTED]&x=1',
  'a credential parameter is masked even when its value was never passed in')
eq(R.scrubSecrets('DevID=abc', []), 'DevID=[REDACTED]', 'the parameter match is case-insensitive')
eq(R.scrubSecrets('the year 2026 was fine', ['1']), 'the year 2026 was fine',
  'a too-short secret is skipped rather than shredding the message')
eq(R.scrubSecrets('nothing to hide', [null, undefined, '']), 'nothing to hide',
  'absent secrets are ignored')

// ── pickLocalized / names ───────────────────────────────────────────────────
const NOMS = [{ region: 'us', text: 'Sonic 3' }, { region: 'ss', text: 'Sonic the Hedgehog 3' }]
eq(R.pickName(NOMS), 'Sonic the Hedgehog 3', "ScreenScraper's own canonical name (ss) wins over a region")
eq(R.pickName([{ region: 'jp', text: 'Sonikku' }]), 'Sonikku', 'an unpreferred region is still used when it is all there is')
eq(R.pickName([]), null, 'an empty name list yields null')
eq(R.pickName(undefined), null, 'a missing name list yields null')
eq(R.pickName([{ region: 'us', text: '   ' }]), null, 'a whitespace-only name is not a name')
eq(R.pickSynopsis([{ langue: 'fr', text: 'Bonjour' }, { langue: 'en', text: 'Hello' }]), 'Hello',
  'English synopsis is preferred')
eq(R.pickSynopsis([{ langue: 'fr', text: 'Bonjour' }]), 'Bonjour',
  'a French-only synopsis is kept rather than dropped')

// ── release year ────────────────────────────────────────────────────────────
eq(R.pickReleaseYear([{ region: 'us', text: '1994-02-02' }, { region: 'jp', text: '1993-11-01' }]), 1993,
  'the earliest date is the real first release')
eq(R.pickReleaseYear([{ text: '1991' }]), 1991, 'a year-only date parses')
eq(R.pickReleaseYear([{ text: '0000-00-00' }]), null, 'an all-zero date is not a year')
eq(R.pickReleaseYear([]), null, 'no dates yields null')

// ── genres / modes ──────────────────────────────────────────────────────────
const GENRES = [
  { principale: '0', noms: [{ langue: 'en', text: 'Action' }] },
  { principale: '1', noms: [{ langue: 'en', text: 'Platform' }] },
]
eq(R.pickGenres(GENRES), ['Platform', 'Action'], 'the primary genre leads')
eq(R.pickGenres([{ noms: [{ langue: 'fr', text: 'Plateforme' }] }]), ['Plateforme'],
  'a French-only genre is kept rather than dropped')
eq(R.pickGenres([]), null, 'no genres yields null, not an empty array')
eq(R.pickModes([{ noms: [{ langue: 'en', text: 'Co-op' }] }, { noms: [{ langue: 'en', text: 'Co-op' }] }]), ['Co-op'],
  'duplicate modes collapse')

// ── age rating ──────────────────────────────────────────────────────────────
eq(R.pickAgeRating([{ type: 'ESRB', text: 'E' }, { type: 'PEGI', text: '12' }]), 'PEGI 12',
  'PEGI is preferred over ESRB')
eq(R.pickAgeRating([{ type: 'ESRB', text: 'E' }]), 'ESRB E', 'ESRB is used when PEGI is absent')
eq(R.pickAgeRating([{ type: 'Tectoy', text: 'x' }]), null, 'an unrecognised rating body is ignored')

// ── score: out of 20, never into games.rating ───────────────────────────────
eq(R.scoreToRating100({ text: '17' }), 85, 'a 17/20 becomes 85/100')
eq(R.scoreToRating100({ text: '20' }), 100, 'the top of the scale becomes 100')
eq(R.scoreToRating100({ text: '0' }), 0, 'zero is a real score')
eq(R.scoreToRating100({ text: '21' }), null, 'a value above 20 is dropped, never clamped')
eq(R.scoreToRating100({ text: '' }), null, 'an empty score is absent')
eq(R.scoreToRating100(undefined), null, 'a missing note is absent')

// ── media ───────────────────────────────────────────────────────────────────
const MEDIAS = [
  { type: 'ss', url: 'u-ss', region: 'wor', format: 'png' },
  { type: 'box-2D', url: 'u-box-jp', region: 'jp', format: 'jpg' },
  { type: 'box-2D', url: 'u-box-wor', region: 'wor', format: 'png' },
]
eq(R.pickMedia(MEDIAS, 'cover')?.url, 'u-box-wor', 'the preferred region breaks a tie between same-type media')
eq(R.pickMedia(MEDIAS, 'screenshot')?.url, 'u-ss', 'the screenshot role maps to the in-game type')
eq(R.pickMedia(MEDIAS, 'fanart'), null, 'a missing role yields null rather than the wrong artwork')
eq(R.pickMedia([{ type: 'box-2D', url: 'only', region: 'kr' }], 'cover')?.url, 'only',
  'an unpreferred region is still the right artwork')
eq(R.mediaExtension({ format: 'JPG' }), 'jpg', 'the reported format is normalised')
eq(R.mediaExtension({ format: '' }), 'png', 'a missing format falls back rather than producing a dotfile')
eq(R.mediaExtension(null), 'png', 'no media at all still yields a usable extension')
eq(R.storagePath('abc-123', 'cover', 'png'), 'abc-123/cover.png',
  'the object path is keyed by our own game id, so a re-scrape overwrites itself')

// ── rom name ────────────────────────────────────────────────────────────────
eq(R.romNameFromPath('./Sonic the Hedgehog 3 (USA).md'), 'Sonic the Hedgehog 3 (USA).md',
  'the ES-DE path reduces to the filename romnom wants')
eq(R.romNameFromPath('./sub/dir/Game (USA).sfc'), 'Game (USA).sfc', 'a nested path reduces to its basename')
eq(R.romNameFromPath('Plain.sfc'), 'Plain.sfc', 'a bare filename passes through')
eq(R.romNameFromPath(null), null, 'a missing path yields null')
eq(R.romNameFromPath('./'), null, 'a path with no filename yields null')

// ── mapJeuToGame ────────────────────────────────────────────────────────────
const JEU = {
  id: 3, noms: NOMS, dates: [{ text: '1994-02-02' }],
  editeur: { text: 'SEGA' }, developpeur: { text: 'Sonic Team' },
  synopsis: [{ langue: 'en', text: 'Yet again Sonic…' }],
  genres: GENRES, modes: [{ noms: [{ langue: 'en', text: 'Co-op' }] }],
  joueurs: { text: '1-2' }, classifications: [{ type: 'PEGI', text: '7' }],
  familles: [{ noms: [{ langue: 'fr', text: 'Sonic' }] }],
}
const mapped = R.mapJeuToGame(JEU)
eq(mapped.title, 'Sonic the Hedgehog 3', 'mapping takes the canonical title')
eq(mapped.release_year, 1994, 'mapping takes the release year')
eq(mapped.publisher, 'SEGA', 'mapping takes the publisher')
eq(mapped.players, '1-2', 'players stays the range string it is, not a number')
eq(mapped.series_name, 'Sonic', 'the series survives even though only French exists')
eq(mapped.external_ref, '3', 'the ScreenScraper id is stored as text')
eq(R.mapJeuToGame({}).title, null, 'an empty response maps to nulls rather than throwing')

// ── fillOnlyMissing — ScreenScraper fills gaps, never overrules ─────────────
eq(R.fillOnlyMissing({ title: 'Mine', developer: null }, { title: 'Theirs', developer: 'Sonic Team' }),
  { developer: 'Sonic Team' },
  'an existing value is kept and only the empty column is filled')
eq(R.fillOnlyMissing({ genres: [] }, { genres: ['Platform'] }), { genres: ['Platform'] },
  'an empty array counts as missing')
eq(R.fillOnlyMissing({ genres: ['Mine'] }, { genres: ['Theirs'] }), {},
  'a non-empty array is left alone')
eq(R.fillOnlyMissing({ title: '' }, { title: 'Real' }), { title: 'Real' },
  'an empty string counts as missing')
eq(R.fillOnlyMissing({ title: null }, { title: null }), {},
  'nothing incoming means nothing written')
eq(R.fillOnlyMissing({ release_year: 0 }, { release_year: 1994 }), {},
  'a real 0 is a value, not a gap')

// ── buildSystemIdMap — the collision rule ───────────────────────────────────
// Real rows, as cached from systemesListe: several systems claim one alias.
const SYSTEMS = [
  { id: 4,   name: 'Super Nintendo',                        retropie_names: ['snes'] },
  { id: 202, name: 'Snes - Super Mario World Hacks',        retropie_names: ['snes'] },
  { id: 107, name: 'Satellaview',                           retropie_names: ['snes'] },
  { id: 1,   name: 'Megadrive',                             retropie_names: ['genesis', 'megadrive'] },
  { id: 203, name: 'Megadrive - Sonic The Hedgehog 2 Hacks', retropie_names: ['genesis'] },
  { id: 23,  name: 'Dreamcast',                             retropie_names: ['dreamcast'] },
]
const MAP = R.buildSystemIdMap(SYSTEMS)
eq(R.resolveSystemId(MAP, 'snes')?.id, 4,
  'the real console wins over a hack collection claiming the same alias')
eq(R.resolveSystemId(MAP, 'genesis')?.id, 1,
  'Megadrive wins over the Sonic-hacks system — the bug that returned "Amy Rose In Sonic The Hedgehog"')
eq(R.resolveSystemId(MAP, 'megadrive')?.id, 1, 'a second alias of the same system resolves too')
eq(R.resolveSystemId(MAP, 'SNES')?.id, 4, 'the lookup is case-insensitive')
eq(R.resolveSystemId(MAP, ' snes ')?.id, 4, 'surrounding whitespace does not break the lookup')
eq(R.resolveSystemId(MAP, 'switch'), null, 'an unmapped system resolves to null rather than to something wrong')
eq(R.resolveSystemId(MAP, null), null, 'no system yields null')
eq(R.resolveSystemId(MAP, 'snes')?.name, 'Super Nintendo',
  'the chosen system is named so a wrong pick is visible in the result')
eq(R.buildSystemIdMap([{ id: NaN, retropie_names: ['x'] }]).size, 0, 'a non-numeric id is skipped')
eq(R.buildSystemIdMap([{ id: 5, retropie_names: null }]).size, 0, 'a system with no aliases contributes nothing')
eq(R.buildSystemIdMap([{ id: 5, retropie_names: ['', '  '] }]).size, 0, 'blank aliases are ignored')

// ── report ──────────────────────────────────────────────────────────────────
if (failures.length > 0) {
  console.error(`\n${failures.length} FAILED of ${passed + failures.length}:\n`)
  for (const f of failures) console.error(`  ✗ ${f}\n`)
  process.exit(1)
}
console.log(`✓ ${passed} assertions passed (screenscraper rules)`)
