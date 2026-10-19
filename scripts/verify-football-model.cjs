// Checks THE football rules (src/features/football/footballModel.ts) against real
// ESPN answers saved in scripts/fixtures/espn/ (docs/integrations/espn.md): the
// parsers, the page's agenda and tables, and what the subscription puts in your day.
//   node scripts/verify-football-model.cjs
require('sucrase/register')
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const M = require('../src/features/football/footballModel.ts')

let n = 0
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); n++ }
const fx = name => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/espn', `${name}.json`), 'utf8'))

// ── A team's fixtures: every competition in one answer ──
const fixtures = M.parseMatches(fx('sched-fix'))
{
  eq(fixtures.length, 5, 'five fixtures in the sample')
  const lille = fixtures.find(m => m.id === '401915396')
  eq(lille.league, { slug: 'uefa.champions', name: 'UEFA Champions League' }, 'the schedule names each match\'s own competition')
  eq([lille.home.team.short, lille.away.team.short], ['Lille', 'Galatasaray'], 'home and away from homeAway, not ESPN\'s "X at Y" name')
  eq([lille.home.score, lille.away.score, lille.state, lille.clock], [null, null, 'pre', ''], 'no score before kick-off')
  eq([lille.kickoff, lille.timeValid], ['2026-10-21T16:45Z', true], 'kick-off in UTC as ESPN gives it')
  eq([lille.venue, lille.city, lille.round], ['Decathlon Arena - Stade Pierre-Mauroy', 'Lille', 'League Phase'], 'stadium, city and round')
  eq(lille.home.team.logo, 'https://a.espncdn.com/i/teamlogos/soccer/500/166.png', 'a schedule\'s logo is team.logos[0].href')
  eq(new Set(fixtures.map(m => m.league.slug)), new Set(['uefa.champions', 'tur.1']), 'Süper Lig and Champions League in one call')
}

// ── Results: a schedule's score is an object ──
const results = M.parseMatches(fx('sched-res'))
{
  const genc = results.find(m => m.id === '401888274')
  eq([genc.home.team.short, genc.home.score, genc.away.score, genc.away.team.short, genc.state, genc.clock],
    ['Genclerbirli', 0, 1, 'Galatasaray', 'post', 'FT'], 'a result: { value, displayValue } read as a number')
  eq(M.outcomeFor(genc, '432'), 'W', 'an away win is a W for the away side')
  eq(M.outcomeFor(results.find(m => m.id === '401915435'), '432'), 'L', '1–4 at home is an L')
  eq(M.outcomeFor(results.find(m => m.id === '401927423'), '432'), 'D', '3–3 is a D')
  eq(M.outcomeFor(genc, '83'), null, 'a team that didn\'t play has no outcome')
  eq(M.outcomeFor(fixtures[0], '432'), null, 'an unplayed match has no outcome')
  eq(results.map(m => m.kickoff), [...results.map(m => m.kickoff)].sort().reverse(), 'results come newest first')
}

// ── A month of a tournament: a scoreboard's score is a string, goals are listed ──
const month = M.parseMatches(fx('scoreboard-cl'))
{
  const lens = month.find(m => m.id === '401915418')
  eq([lens.home.score, lens.away.score], [0, 2], 'a scoreboard\'s "2" read as a number')
  eq(lens.league, { slug: 'uefa.champions', name: 'UEFA Champions League' }, 'a scoreboard\'s matches take the answer\'s league')
  eq(lens.home.team.logo?.startsWith('https://'), true, 'a scoreboard\'s logo is team.logo')
  eq(lens.goals.map(g => [g.minute, g.player, g.teamId, g.kind]).slice(0, 1), [['22\'', 'Luis Suárez', '2250', 'goal']], 'goals from details, cards left out')
  eq(lens.goals.length, 2, 'only scoring plays')
  const fener = month.find(m => m.id === '401915403')
  eq([fener.home.score, fener.away.score], [null, null], 'the scoreboard\'s "0" before kick-off is no score')
}

// ── Odd answers are "nothing", never a throw ──
eq(M.parseMatches(null), [], 'null')
eq(M.parseMatches({ events: 'x' }), [], 'events not a list')
eq(M.parseMatches({ events: [{ id: '1', date: 'soon', competitions: [{}] }] }), [], 'a bad date')
eq(M.parseMatches({ events: [{ id: '1', date: '2026-10-21T16:45Z', competitions: [{ competitors: [{ homeAway: 'home', team: { id: '1', displayName: 'A' } }] }] }] }), [], 'one side missing')
eq(M.scoreOf({ value: 2, displayValue: '2' }), 2, 'score object')
eq(M.scoreOf('3'), 3, 'score string')
eq(M.scoreOf(''), null, 'empty score')
eq(M.scoreOf(undefined), null, 'no score')
{
  const raw = fx('sched-fix').events[0]
  const postponed = JSON.parse(JSON.stringify(raw))
  postponed.competitions[0].status.type.name = 'STATUS_POSTPONED'
  eq(M.matchOf(postponed).state, 'postponed', 'postponed')
  const later = JSON.parse(JSON.stringify(raw))
  later.timeValid = false
  eq(M.matchOf(later).timeValid, false, 'timeValid false is kept')
  const http = JSON.parse(JSON.stringify(raw))
  http.competitions[0].competitors[0].team.logos = [{ href: 'http://x/y.png' }]
  eq(M.matchOf(http).home.team.logo, null, 'only https logos')
}

// ── Tables ──
{
  const cl = M.parseStandings(fx('standings-cl'))
  eq(cl.map(t => t.name), ['League Phase'], 'the Champions League\'s one league-phase table')
  eq(cl[0].rows[0], {
    rank: 1,
    team: { id: '160', name: 'Paris Saint-Germain', short: 'PSG', abbr: 'PSG', logo: 'https://a.espncdn.com/i/teamlogos/soccer/500/160.png' },
    played: 2, won: 2, drawn: 0, lost: 0, gf: 10, ga: 3, gd: 7, points: 6,
    note: { color: '#81D6AC', text: 'Qualifies for round of 16' },
  }, 'a table row: stats by name, the qualification note')
  eq(cl[0].rows.map(r => r.rank), [...cl[0].rows.map(r => r.rank)].sort((a, b) => a - b), 'rows by rank')
  const tur = M.parseStandings(fx('standings-tur'))
  eq([tur[0].rows[0].team.id, tur[0].rows[0].points], ['432', 19], 'Süper Lig: Galatasaray top with 19')
  eq(M.parseStandings({ children: [{ name: 'X', standings: { entries: [{ team: null }] } }] }), [], 'a table with no readable row is dropped')
  eq(M.parseStandings('x'), [], 'junk')
}

// ── tableSlice: the top, then around the teams you follow ──
{
  const row = i => ({ rank: i + 1, team: { id: `t${i + 1}` } })
  const rows = Array.from({ length: 20 }, (_, i) => row(i))
  const ids = out => out.map(r => (r ? r.rank : '…'))
  eq(ids(M.tableSlice(rows, new Set())), [1, 2, 3, 4, '…'], 'nobody followed: the top four and a gap')
  eq(ids(M.tableSlice(rows, new Set(['t12']))), [1, 2, 3, 4, '…', 10, 11, 12, 13, 14, '…'], 'two either side of a followed team')
  eq(ids(M.tableSlice(rows, new Set(['t5']))), [1, 2, 3, 4, 5, 6, 7, '…'], 'no gap where it joins the top')
  eq(ids(M.tableSlice(rows, new Set(['t20']))), [1, 2, 3, 4, '…', 18, 19, 20], 'the bottom: no trailing gap')
  eq(ids(M.tableSlice(rows.slice(0, 8), new Set(['t8']))), [1, 2, 3, 4, 5, 6, 7, 8], 'a short table is shown whole')
}

// ── Squad ──
{
  const squad = M.parseRoster(fx('roster'))
  const g = squad.find(p => p.id === '217267')
  eq(g, {
    id: '217267', name: 'Günay Güvenc', number: '19', position: 'Goalkeeper', group: 'Goalkeepers', age: 35,
    born: '1991-06-25', nationality: 'Türkiye', flag: 'https://a.espncdn.com/i/teamlogos/countries/500/tur.png',
    heightCm: 188, weightKg: 83,
  }, 'a player: inches and pounds as cm and kg, letters kept (ü)')
  const p = (id, abbr, number, name = id) => M.playerOf({ id, displayName: name, jersey: number, position: { abbreviation: abbr, displayName: abbr } })
  const groups = M.squadGroups([p('a', 'F', '9'), p('b', 'G', '1'), p('c', 'M', '10'), p('d', 'D', '4'), p('e', 'D', '2'), p('f', 'X', null), p('g', 'D', null)])
  eq(groups.map(x => [x.group, x.players.map(y => y.id)]), [
    ['Goalkeepers', ['b']], ['Defenders', ['e', 'd', 'g']], ['Midfielders', ['c']], ['Forwards', ['a']], ['Others', ['f']],
  ], 'groups in pitch order, each by shirt number (none last)')
  eq(M.playerOf({ id: '1', displayName: 'X', height: 5, weight: 9000 }).heightCm, null, 'an impossible height is dropped')
  eq(M.playerOf({ id: '1' }), null, 'no name, no player')
}

// ── Club ──
eq(M.parseTeam(fx('team')), {
  id: '432', name: 'Galatasaray', logo: 'https://a.espncdn.com/i/teamlogos/soccer/500/432.png', color: '#aa0031',
  standing: '1st in Turkish Super Lig', record: '6-1-1', defaultLeague: 'tur.1',
  espnUrl: 'https://www.espn.com/soccer/club/_/id/432/galatasaray',
}, 'club: standing, W-D-L record, its league, the ESPN page')
eq(M.parseTeam({ team: { id: '1' } }), null, 'a club without a name')

// ── Match popup ──
{
  const d = M.parseMatchDetail(fx('summary'))
  eq([d.match.id, d.match.league?.slug, d.match.home.team.short, d.match.home.score, d.match.away.score, d.match.away.team.short],
    ['401843461', 'nor.1', 'Sarpsborg FK', 0, 3, 'Rosenborg'], 'the summary\'s header is a match')
  eq([d.match.venue, d.match.city], ['Sarpsborg Stadion', 'Sarpsborg'], 'venue from gameInfo')
  eq(d.attendance, null, 'attendance 0 is unknown, not "0 people"')
  eq(d.lineups.map(l => [l.side, l.formation]), [['home', '4-4-2'], ['away', '4-4-2']], 'both line-ups with their formation')
  eq(d.lineups[0].starters[0], { name: 'Leander Oy', number: '87', position: 'G' }, 'a starter')
  eq(M.parseMatchDetail({ header: null }), null, 'no header, no match')
}

// ── "+ Follow" search ──
{
  const teams = M.parseSearch(fx('search-team'))
  eq(teams[0], { kind: 'team', ref: '432', name: 'Galatasaray', subtitle: 'Turkish Super Lig', logo: 'https://a.espncdn.com/i/teamlogos/soccer/500/432.png', league: 'tur.1' },
    'a team: its id from the uid, its own league')
  eq(teams.every(h => h.kind === 'team'), true, 'football only (the sample has other sports)')
  const leagues = M.parseSearch(fx('search-league'))
  eq(leagues.find(h => h.ref === 'uefa.euro')?.name, 'UEFA European Championship', 'a tournament: its slug is its ref')
  eq(leagues.some(h => h.ref === 'uefa.euroq'), true, 'qualifiers are their own tournament')
  eq(M.parseSearch({ results: [{ type: 'team', contents: [{ sport: 'golf', displayName: 'X', uid: 's:1~t:9' }] }] }), [], 'other sports dropped')
}

// ── Time: Norway's day and clock ──
eq(M.osloParts('2026-10-21T16:45Z'), { date: '2026-10-21', time: '18:45' }, 'summer time: UTC+2')
eq(M.osloParts('2026-11-03T17:45Z'), { date: '2026-11-03', time: '18:45' }, 'winter time: UTC+1')
eq(M.osloParts('2026-10-21T22:30Z'), { date: '2026-10-22', time: '00:30' }, 'after midnight in Oslo is the next day')

// ── The page's agenda ──
{
  const NOW = '2026-10-19T12:00:00Z'
  const live = JSON.parse(JSON.stringify(fixtures[0]))
  live.id = 'live1'; live.state = 'in'; live.clock = '67\''
  const twin = JSON.parse(JSON.stringify(fixtures[1]))
  twin.state = 'post'; twin.home.score = 2; twin.away.score = 1
  const a = M.buildAgenda([...fixtures, ...results, fixtures[0], live], NOW)
  eq(a.live.map(m => m.id), ['live1'], 'live first')
  eq(a.upcoming.map(g => [g.date, g.matches.map(m => m.id)]), [
    ['2026-10-21', ['401915396']], ['2026-10-26', ['401888265']], ['2026-10-30', ['401888259']],
    ['2026-11-03', ['401915311']], ['2026-11-07', ['401888371']],
  ], 'upcoming grouped by Norwegian day, each match once')
  eq(a.results.map(m => m.id), ['401888274', '401915435', '401888280'], 'results of the last ten days, newest first')
  eq(M.buildAgenda([fixtures[1], twin], NOW).results.map(m => m.home.score), [2], 'the same match twice: the copy with a score wins')
  eq(M.buildAgenda(fixtures, NOW, { aheadDays: 7 }).upcoming.length, 1, 'only aheadDays ahead (26.10 20:30 is past 7 days)')
}

// ── Into your day ──
{
  const lille = fixtures.find(m => m.id === '401915396')
  eq(M.matchItem(lille), {
    title: '⚽ Lille – Galatasaray',
    notes: 'UEFA Champions League · League Phase · Decathlon Arena - Stade Pierre-Mauroy, Lille',
    date: '2026-10-21', time: '18:45', durationMinutes: 120,
  }, 'the item: home first, Norwegian day and kick-off, two hours')
  eq(M.matchItem({ ...lille, timeValid: false }).time, null, 'no fixed kick-off: no time, no block')
}

// ── The subscription ──
{
  const NOW = '2026-10-19T12:00:00Z'
  const gs = new Set(['432'])
  const lille = fixtures.find(m => m.id === '401915396')
  const derby = fixtures.find(m => m.id === '401888265')
  const ids = r => ({ add: r.add.map(m => m.id), move: r.move.map(x => x.match.id) })
  eq(ids(M.syncPlan(fixtures, gs, [], NOW)).add, fixtures.map(m => m.id), 'every coming match of a subscribed team')
  eq(ids(M.syncPlan(fixtures, new Set(['83']), [], NOW)).add, [], 'nobody subscribed in them: nothing')
  eq(ids(M.syncPlan([...fixtures, ...results], gs, [], NOW)).add.length, 5, 'results are never added')
  const plan = (m, f = {}) => ({ event_id: m.id, task_id: 'task-' + m.id, kickoff_at: m.kickoff, time_valid: m.timeValid, ...f })
  eq(ids(M.syncPlan([lille], gs, [plan(lille)], NOW)), { add: [], move: [] }, 'planned and unchanged: nothing')
  eq(ids(M.syncPlan([lille], gs, [plan(lille, { task_id: null })], NOW)), { add: [], move: [] }, 'you deleted it: never added again')
  eq(ids(M.syncPlan([lille], gs, [plan(lille, { kickoff_at: '2026-10-21T19:00Z' })], NOW)), { add: [], move: ['401915396'] }, 'ESPN moved the kick-off: the item follows')
  eq(ids(M.syncPlan([lille], gs, [plan(lille, { time_valid: false })], NOW)), { add: [], move: ['401915396'] }, 'ESPN fixed the time: the item gets it')
  eq(ids(M.syncPlan([lille], new Set(), [plan(lille, { kickoff_at: '2026-10-21T19:00Z' })], NOW)).move, ['401915396'], 'a match planned by hand follows too')
  eq(ids(M.syncPlan([{ ...derby, timeValid: false }], gs, [], NOW)).add, [], 'no fixed kick-off yet: wait for it')
  eq(ids(M.syncPlan([{ ...derby, kickoff: '2027-01-30T17:00Z' }], gs, [], NOW)).add, [], 'beyond 45 days: later')
  eq(ids(M.syncPlan([{ ...derby, state: 'postponed' }], gs, [], NOW)).add, [], 'postponed: left alone')
  eq(ids(M.syncPlan([lille, lille], gs, [], NOW)).add, ['401915396'], 'the same match from two sources: once')
}

// ── Guards: no surface parses ESPN on its own ──
{
  const dir = path.join(__dirname, '../src/features/football')
  const files = []
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => (e.isDirectory() ? walk(path.join(d, e.name)) : files.push(path.join(d, e.name))))
  walk(dir)
  const espnHosts = files.filter(f => /espn\.com/.test(fs.readFileSync(f, 'utf8')) && !/espnApi\.ts$|footballModel\.ts$/.test(f))
  eq(espnHosts.map(f => path.relative(dir, f)), [], 'only espnApi.ts calls ESPN')
}

console.log(`verify-football-model: ${n} checks passed`)
