#!/usr/bin/env node
/**
 * verify-screenscraper-v2.cjs — asserts the rewritten ScreenScraper scraper's
 * pure logic against the REAL modules in src/features/games/scraper/ (sucrase,
 * this repo's no-unit-test-framework convention), and that both edge
 * functions carry the current copy of it.
 *
 * The fixture follows real captured responses (docs/games/
 * screenscraper-integration.md §16): string scalars, `{region|langue, text}`
 * arrays, group arrays with `noms`, a `rom` block with parallel region arrays,
 * and media URLs that carry all four credentials.
 *
 *   node scripts/verify-screenscraper-v2.cjs
 */
require('sucrase/register')
const { execFileSync } = require('node:child_process')
const path = require('node:path')
const R = require('../src/features/games/scraper/ssRules.ts')
const P = require('../src/features/games/scraper/ssPlan.ts')
const X = require('../src/features/games/scraper/ssProxy.ts')
const C = require('../src/features/games/scraper/ssMediaCatalog.ts')

let passed = 0
const failures = []
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a === e) passed++
  else failures.push(`${label}\n    expected ${e}\n    actual   ${a}`)
}
function ok(cond, label) { eq(!!cond, true, label) }

const DEV = 'mydevid', PWD = 'sup3rsecret', SSID = 'lasciviens', SSPW = 'memberpass'
const SECRETS = [DEV, PWD, SSID, SSPW]
const creds = `devid=${DEV}&devpassword=${PWD}&softname=x&ssid=${SSID}&sspassword=${SSPW}`
const media = (file, token, extra = {}) => ({
  type: token.replace(/\(.*$/, '').replace(/\[.*$/, ''), parent: 'jeu',
  url: `https://neoclone.screenscraper.fr/api2/${file}?${creds}&systemeid=1&jeuid=5&media=${encodeURIComponent(token)}`,
  crc: 'abcd1234', md5: 'm', sha1: 's', size: '123456', format: 'png', ...extra,
})

const JEU = {
  id: '5', romid: '777', notgame: 'false', cloneof: '0',
  noms: [{ region: 'wor', text: 'Sonic the Hedgehog' }, { region: 'ss', text: 'Sonic The Hedgehog' }, { region: 'jp', text: 'ソニック' }],
  systeme: { id: '1', text: 'Megadrive' },
  editeur: { id: '10', text: 'SEGA' }, developpeur: { id: '11', text: 'Sonic Team' },
  joueurs: { text: '1' }, note: { text: '16' }, topstaff: null, rotation: '0',
  synopsis: [{ langue: 'fr', text: 'Texte' }, { langue: 'en', text: 'English text' }],
  classifications: [{ type: 'SS', text: '6' }, { type: 'ESRB', text: 'E' }, { type: 'PEGI', text: '3' }],
  dates: [{ region: 'jp', text: '1991-07-26' }, { region: 'us', text: '1991-06-23' }, { region: 'eu', text: '1991' }],
  genres: [
    { id: '1', principale: '0', noms: [{ langue: 'en', text: 'Action' }] },
    { id: '2', principale: '1', noms: [{ langue: 'fr', text: 'Plateforme' }, { langue: 'en', text: 'Platform' }] },
  ],
  modes: [{ id: '3', principale: '1', noms: [{ langue: 'en', text: 'Single-player' }] }],
  familles: [{ id: '4', principale: '1', noms: [{ langue: 'fr', text: 'Sonic' }] }],
  numeros: [{ id: '5', noms: [{ langue: 'fr', text: '1' }] }],
  hacks: [{ id: '9', name: 'x', downloadurl: `https://www.screenscraper.fr/mediaFichierHack.php?${creds}` }],
  rom: {
    id: '777', romfilename: 'Sonic The Hedgehog (USA, Europe).md', romsize: '524288', romcrc: 'f9394e97', rommd5: 'aa', romsha1: 'bb',
    regions: { regions_shortname: ['us', 'eu'] }, langues: { langues_shortname: ['en'] },
    beta: '0', demo: '0', proto: '0', hack: '0', best: '1', romcloneof: '0',
  },
  roms: [{ id: '777', romfilename: 'a.md', romsize: '1' }, { id: '778', romfilename: 'b.md', hack: '1' }],
  medias: [
    media('mediaJeu.php', 'box-2D(us)'), media('mediaJeu.php', 'box-2D(eu)'), media('mediaJeu.php', 'box-2D(jp)'),
    media('mediaJeu.php', 'fanart', { region: undefined }), media('mediaJeu.php', 'support-2D(eu)[2]', { support: '2' }),
    media('mediaJeu.php', 'support-2D(eu)[1]', { support: '1' }),
    media('mediaVideoJeu.php', 'video-normalized', { format: 'mp4', size: '4000000' }),
    media('mediaManuelJeu.php', 'manuel(eu)', { format: 'pdf' }),
    { ...media('mediaJeu.php', 'pictocouleur(fr)'), parent: 'genre' },
    { type: 'box-2D', parent: 'jeu', url: 'https://evil.example/x.png?media=box-2D(us)' },
  ].map(m => ({ ...m, region: m.url.match(/media=[^(]*\(([a-z]+)\)/)?.[1] ?? undefined })),
}

// ── Security ────────────────────────────────────────────────────────────────
const url0 = JEU.medias[0].url
const scrubbed = R.scrubSecrets(`failed: ${url0}`, SECRETS)
for (const s of SECRETS) ok(!scrubbed.includes(s), `scrubSecrets removes ${s}`)
ok(R.scrubSecrets(`devpassword=unknownvalue&x=1`, []).includes('devpassword=[REDACTED]'), 'scrubSecrets masks an unknown credential parameter')

const stripped = JSON.stringify(R.stripCredentials({ header: { commandRequested: url0 }, response: { jeu: JEU } }))
for (const s of SECRETS) ok(!stripped.includes(s), `stripCredentials leaves no ${s} anywhere`)
ok(!/"url"/.test(stripped) && !/downloadurl/.test(stripped), 'stripCredentials drops url and downloadurl keys')
ok(stripped.includes('Sonic The Hedgehog'), 'stripCredentials keeps the data')
eq(R.stripCredentials({ note: `see ${url0}` }), {}, 'a credential-bearing string under any key is dropped')
eq(R.stripCredentials({ roms: Array.from({ length: 400 }, (_, i) => ({ i })) }).roms.length, 300, 'long rom lists are capped')

// ── Media inventory ─────────────────────────────────────────────────────────
eq(R.mediaRef(url0), { ep: 'img', token: 'box-2D(us)' }, 'mediaRef reads endpoint + token')
eq(R.mediaRef('https://x/api2/mediaFichierJeu.php?media=themehs'), null, 'unknown endpoints are refused')
eq(R.mediaRef('https://x/api2/mediaJeu.php?media=box-2D(us);drop'), null, 'a malformed token is refused')
const inv = R.mediaInventory(JEU.medias)
eq(inv.length, 8, 'inventory keeps the game own files (drops pictograms and bad URLs)')
ok(!JSON.stringify(inv).includes(PWD), 'inventory carries no credentials')
eq(inv.find(m => m.type === 'manuel').ep, 'manual', 'manual endpoint recognised')
eq(inv.find(m => m.type === 'video-normalized').ep, 'video', 'video endpoint recognised')
eq(inv.find(m => m.token === 'support-2D(eu)[2]').support, '2', 'disc number kept')
eq(R.pickMediaEntry(inv, 'box-2D', ['eu', 'us']).region, 'eu', 'region order decides')
eq(R.pickMediaEntry(inv, 'box-2D', ['fr']).region, 'us', 'no wanted region → first available')
eq(R.pickMediaEntry(inv, 'support-2D', ['eu']).support, '1', 'first disc before later ones')
eq(R.pickMediaEntry(inv, 'wheel', ['eu']), null, 'missing type → null')

// ── Candidate mapping ───────────────────────────────────────────────────────
const cand = R.toCandidate(JEU, ['filename'], { regions: ['eu', 'us'], languages: ['en'] })
eq(cand.values.title, 'Sonic The Hedgehog', 'title prefers their canonical ss name')
eq(cand.values.description, 'English text', 'description follows the language order')
eq(cand.values.release_year, 1991, 'earliest year')
eq(cand.values.release_date, '1991-06-23', 'release date for the ROM region (us first in rom regions)')
eq(cand.values.publisher, 'SEGA', 'publisher from {id,text}')
eq(cand.values.developer, 'Sonic Team', 'developer')
eq(cand.values.genres, ['Platform', 'Action'], 'primary genre leads, English names')
eq(cand.values.series_name, 'Sonic', 'series falls back to French when English is missing')
eq(cand.values.age_rating, 'PEGI 3', 'PEGI preferred')
eq(cand.values.rating, 80, '16/20 → 80')
eq(cand.values.region, 'us, eu', 'ROM regions from parallel arrays')
eq(cand.values.players, '1', 'players')
eq(cand.system, { id: 1, name: 'Megadrive' }, 'system id + name')
eq(cand.rom.flags, ['best'], 'rom flags')
eq(cand.flags, ['best dump'], 'candidate flags')
eq(cand.roms_total, 2, 'every known dump counted')
eq(cand.hacks_total, 1, 'hacks counted')
eq(cand.names.length, 3, 'every regional name kept')
eq(cand.clone_of, null, 'cloneof "0" means not a clone')
eq(cand.rotation, null, 'rotation "0" means none')
const ng = R.toCandidate({ id: '9', notgame: 'true', noms: [{ region: 'ss', text: 'ZZZ(notgame): BIOS' }] }, ['name'], { regions: [], languages: [] })
eq([ng.values.title, ng.not_a_game, ng.flags], ['BIOS', true, ['not a game']], 'not-a-game prefix cleaned and flagged')
eq(R.withOverrides(cand, { titleRegion: 'wor', descriptionLang: 'fr' }).values.title, 'Sonic the Hedgehog', 'override picks a regional title')
eq(R.withOverrides(cand, { descriptionLang: 'fr' }).values.description, 'Texte', 'override picks a description language')
eq(R.withOverrides(cand, { titleRegion: 'xx' }).values.title, 'Sonic The Hedgehog', 'an unknown override changes nothing')
eq([R.isRealJeu({}), R.isRealJeu({ id: '3' })], [false, true], 'an empty search entry is no entry')

// ── Plain-text answers ──────────────────────────────────────────────────────
eq(R.classifyText(200, 'Erreur de login : Vérifier vos identifiants développeur !'), 'login', 'a 200 login error is a login error')
eq(R.classifyText(200, 'NOMEDIA'), 'no_media', 'NOMEDIA')
eq(R.classifyText(200, 'CRCOK'), 'unchanged', 'CRCOK')
eq(R.classifyText(404, 'Erreur : Jeu non trouvée !'), 'not_found', '404')
eq(R.classifyText(430, 'Votre quota de scrape est dépassé'), 'quota', '430')
eq(R.classifyText(429, ''), 'busy', '429')
eq(R.classifyText(423, ''), 'closed', '423')

// ── Search planning ─────────────────────────────────────────────────────────
const kinds = plan => plan.queries.map(q => q.kind)
let plan = P.planSearch({ name: 'Sonic', systemId: 1, rom: { filename: './roms/Sonic (USA).md', crc: 'F9394E97' } })
eq(kinds(plan), ['hash', 'name'], 'hash + name run together')
eq(plan.queries[0].params, { romtype: 'rom', romnom: 'Sonic (USA).md', crc: 'f9394e97', systemeid: '1' }, 'hash query sends filename, lowercased hash and system')
plan = P.planSearch({ rom: { filename: 'Sonic (USA).md' } })
eq([kinds(plan), plan.notes[0].kind], [[], 'filename'], 'a filename without a system is explained, not sent')
plan = P.planSearch({ rom: { filename: 'Sonic (USA).md', size: 524288 }, systemId: 1 })
eq(plan.queries[0].params, { romtype: 'rom', romnom: 'Sonic (USA).md', romtaille: '524288', systemeid: '1' }, 'filename + size + system')
plan = P.planSearch({ rom: { crc: 'xyz' }, systemId: 1 })
eq([kinds(plan), plan.notes[0].kind], [[], 'hash'], 'a malformed hash is not sent')
plan = P.planSearch({ name: 'The Ys' })
eq([kinds(plan), plan.notes[0].kind], [[], 'name'], 'a name under 4 letters (the ignored) is explained')
eq(kinds(P.planSearch({ name: 'The Sims' })), ['name'], '"The Sims" is searchable')
eq(kinds(P.planSearch({ jeuId: '5', rom: { serial: 'SLUS-123' } })), ['id', 'serial'], 'id and serial')
eq(kinds(P.planSearch({ name: 'Sonic', rom: { crc: 'f9394e97' }, useRom: false })), ['name'], 'ROM info can be switched off')
eq(kinds(P.planSearch({ name: 'Sonic', rom: { crc: 'f9394e97' }, useName: false })), ['hash'], 'name can be switched off')
eq(P.romFileName('C:\\roms\\snes\\Axelay (USA).sfc'), 'Axelay (USA).sfc', 'Windows path reduced to a filename')

// ── Merge ───────────────────────────────────────────────────────────────────
const c = (id, basis, rom = null) => ({ jeu_id: id, matched_by: [basis], rom, rom_id: null, values: {}, flags: [] })
const merged = P.mergeCandidates([
  { kind: 'name', items: [c('7', 'name'), c('5', 'name'), c('8', 'name')] },
  { kind: 'filename', items: [c('5', 'filename', { filename: 'x' })] },
])
eq(merged.map(m => m.jeu_id), ['5', '7', '8'], 'exact match first, then name order, no duplicates')
eq(merged[0].matched_by, ['filename', 'name'], 'every way it was found is kept')
ok(merged[0].rom, 'the ROM lookup copy supplies the rom block')

// ── Field policies ──────────────────────────────────────────────────────────
const game = { title: 'Mine', description: null, genres: [], publisher: 'SEGA', release_year: 1990 }
const platform = { rating: null, release_date: '1991-01-01', region: null }
const vals = { title: 'Theirs', description: 'D', genres: ['Platform'], publisher: 'SEGA', release_year: 1991, rating: 80, release_date: '1991-06-23', cover: null }
let patch = P.planPatch({ games: game, platform }, vals, { title: 'fill', description: 'fill', genres: 'fill', publisher: 'replace', release_year: 'replace', rating: 'fill', release_date: 'skip', cover: 'fill' })
eq(patch.games, { description: 'D', release_year: 1991, genres: ['Platform'] }, 'fill writes gaps only, replace overwrites, same value is no write')
eq(patch.platform, { rating: 80 }, 'platform fields go to game_platforms')
eq(patch.prior, { description: null, release_year: 1990, genres: null, rating: null }, 'prior values recorded for undo')
eq(patch.skipped.find(s => s.field === 'title').reason, 'has_value', 'fill never overwrites')
eq(patch.skipped.find(s => s.field === 'publisher').reason, 'same', 'identical value is not a write')
eq(patch.skipped.find(s => s.field === 'release_date').reason, 'policy', 'skip is respected')
patch = P.planPatch({ games: game, platform: null }, { rating: 80 }, { rating: 'replace' })
eq(patch.platform, {}, 'no variant → no platform write')
ok(P.sameValue(1991, '1991') && !P.sameValue(['a', 'b'], ['b', 'a']), 'sameValue: numbers loose, arrays ordered')

// ── Preferences ─────────────────────────────────────────────────────────────
const d = P.defaultPrefs()
eq([d.fields.title, d.fields.cover, d.snapshot, d.budgetMb], ['fill', 'fill', true, 800], 'defaults fill gaps, snapshot on, 800 MB budget')
const n = P.normalizePrefs({ fields: { title: 'replace', bogus: 'x', genres: 'nope' }, media: { manuel: 'store', 'box-2D': 'skip', 'bad type!': 'store' }, imageScale: 9, regions: ['EU', 'x!', 'us'], budgetMb: 5 })
eq([n.fields.title, n.fields.genres], ['replace', 'fill'], 'valid policies kept, invalid ones defaulted')
eq(n.media, { manuel: 'on_demand', 'box-2D': 'skip' }, 'a manual cannot be stored; bad keys dropped')
eq([n.imageScale, n.regions, n.budgetMb], [2, ['eu', 'us'], 50], 'clamped and cleaned')
eq(P.normalizePrefs({ imageScale: 0 }).imageScale, 0, 'scale 0 = original size')
eq(P.normalizePrefs(null), d, 'garbage → defaults')
eq(P.mediaModeFor(n, 'box-2D'), 'skip', 'user choice wins')
eq(P.mediaModeFor(d, 'box-2D-side'), 'on_demand', 'catalogue default otherwise')
eq(P.storeWidth({ ...d, imageScale: 0.5 }, 'box-2D'), 320, 'width scales')
eq(P.storeWidth({ ...d, imageScale: 0 }, 'fanart'), null, 'original size → no maxwidth')

// ── Catalogue ───────────────────────────────────────────────────────────────
eq([C.outputFormatFor('box-2D', 900000), C.outputFormatFor('ss', 3000), C.outputFormatFor('wheel-hd', 900000)], ['jpg', 'png', 'png'], 'JPEG for big opaque art, PNG for small pixel art and transparency')
eq([C.canStore('box-2D'), C.canStore('manuel'), C.canStore('video')], [true, false, false], 'only images are stored')
eq(C.mediaInfo('flyer').mode, 'on_demand', 'an unknown type is usable on demand')
ok(C.MEDIA_TYPES.every(t => t.kind !== 'image' || t.width > 0), 'every image type has a width')

// ── Proxy ───────────────────────────────────────────────────────────────────
const ref = { jeuId: '5', systemId: 1, sig: 'A'.repeat(32) }
const q = X.proxyQuery(ref, { ep: 'img', token: 'box-2D(us)' }, { width: 160, format: 'jpg' })
eq(q, 'j=5&s=1&m=box-2D%28us%29&w=160&f=jpg&k=' + 'A'.repeat(32), 'proxy query is stable')
const parsed = X.parseProxyQuery(new URLSearchParams(q))
eq([parsed.jeuId, parsed.systemId, parsed.token, parsed.width, parsed.format], ['5', 1, 'box-2D(us)', 160, 'jpg'], 'proxy query round-trips')
eq(X.upstreamFor(parsed), { file: 'mediaJeu.php', params: { systemeid: '1', jeuid: '5', media: 'box-2D(us)', maxwidth: '160', outputformat: 'jpg' } }, 'upstream request')
const vq = X.parseProxyQuery(new URLSearchParams(X.proxyQuery(ref, { ep: 'video', token: 'video-normalized' }, { width: 300 })))
eq([vq.ep, vq.width, X.upstreamFor(vq).file], ['video', null, 'mediaVideoJeu.php'], 'videos are never resized')
for (const [bad, why] of [['j=5x&s=1&m=box-2D&k=' + 'A'.repeat(32), 'game id'], ['j=5&s=1&m=box-2D(us)%26x=1&k=' + 'A'.repeat(32), 'token injection'],
  ['j=5&s=1&m=box-2D&k=short', 'short signature'], ['j=5&s=1&m=box-2D&w=9999&k=' + 'A'.repeat(32), 'width'], ['j=5&s=1&e=file&m=x&k=' + 'A'.repeat(32), 'endpoint']]) {
  ok('error' in X.parseProxyQuery(new URLSearchParams(bad)), `proxy refuses a bad ${why}`)
}
ok(X.allowedContentType('img', 'image/png') && !X.allowedContentType('img', 'text/html'), 'images only on img')
ok(X.allowedContentType('manual', 'application/pdf') && !X.allowedContentType('video', 'text/plain'), 'pdf and video types')
ok(X.safeEqual('abc', 'abc') && !X.safeEqual('abc', 'abd') && !X.safeEqual('abc', 'ab'), 'safeEqual')

;(async () => {
  const s1 = await X.signMedia('service-key', '5', 1)
  const s2 = await X.signMedia('service-key', '5', 1)
  const s3 = await X.signMedia('service-key', '6', 1)
  const s4 = await X.signMedia('other-key', '5', 1)
  eq([s1.length, s1 === s2, s1 === s3, s1 === s4], [32, true, false, false], 'signature: deterministic, bound to game and key')
  ok(/^[A-Za-z0-9_-]+$/.test(s1), 'signature is base64url')

  // ── Both edge functions carry the current shared code ──
  try {
    execFileSync('node', [path.join(__dirname, 'sync-screenscraper-shared.mjs'), '--check'], { stdio: 'pipe' })
    passed++
  } catch (e) {
    failures.push(`edge functions are stale — run node scripts/sync-screenscraper-shared.mjs\n    ${String(e.stderr || e.message).trim()}`)
  }

  if (failures.length) {
    console.error(`✗ ${failures.length} failed, ${passed} passed\n`)
    for (const f of failures) console.error('  ✗ ' + f)
    process.exit(1)
  }
  console.log(`✓ verify-screenscraper-v2: ${passed} assertions passed`)
})()
