// Checks THE football rules (src/features/football/footballModel.ts) against real
// ESPN answers saved in scripts/fixtures/espn/ (docs/integrations/espn.md): the
// parsers, the page's agenda and tables, what the subscription puts in your day,
// and the favourites' glance for the Personal page (footballGlance.ts).
//   node scripts/verify-football-model.cjs
require('sucrase/register')
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const M = require('../src/features/football/footballModel.ts')
const V = require('../src/features/football/footballView.ts')
const G = require('../src/features/football/footballGlance.ts')

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
  eq(M.parseLeagueStandings(fx('standings-cl')).name, 'UEFA Champions League', 'the tournament\'s name above its tables')
  eq(M.parseLeagueStandings(null), { name: '', tables: [] }, 'junk: no name, no tables')
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
// ESPN's own club address (/teams/{id}) stopped sending the header a browser needs (31.10.2026): the club comes from
// its schedule answer — the same answer the results are read from.
eq(M.parseScheduleTeam(fx('sched-res')), {
  id: '432', name: 'Galatasaray', logo: 'https://a.espncdn.com/i/teamlogos/soccer/500/432.png', color: '#aa0031',
  standing: '1st in Turkish Super Lig', record: fx('sched-res').team.recordSummary, defaultLeague: 'tur.1',
  espnUrl: 'https://www.espn.com/soccer/club/_/id/432/galatasaray',
}, 'club from its schedule: standing, W-D-L record, its own league (the season\'s), the ESPN page')
eq(M.parseScheduleTeam(fx('sched-fix')).defaultLeague, 'tur.1', 'the fixtures answer names the same league')
eq(M.parseScheduleTeam({ team: { id: '1' } }), null, 'a club without a name')
eq(M.parseScheduleTeam(null), null, 'no answer, no club')
{
  const club = (season, leagues) => M.parseScheduleTeam({ team: { id: '86', displayName: 'Real Madrid' }, season: { name: season }, events: leagues.map(([slug, name]) => ({ league: { slug, name } })) })
  eq(club('2026-27 LALIGA', [['uefa.champions', 'UEFA Champions League'], ['esp.1', 'Spanish LALIGA'], ['uefa.champions', 'UEFA Champions League']]).defaultLeague, 'esp.1',
    'the season names the league even when another competition has more matches ("LALIGA" is "Spanish LALIGA")')
  eq(club('League Phase', [['fifa.friendly', 'International Friendly'], ['fifa.friendly', 'International Friendly'], ['uefa.nations', 'UEFA Nations League']]).defaultLeague, 'uefa.nations',
    'no league named by the season: the one played most, friendlies aside')
  eq(club('2026-27 English Premier League', [['club.friendly', 'Club Friendly']]).defaultLeague, null, 'only friendlies: no league (the squad then says ESPN has none)')
  eq(club(null, []).color, null, 'no colour given, none made up')
}

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

// ── The items the subscription writes ──
{
  const lille = fixtures.find(m => m.id === '401915396')
  eq(M.newMatchItem(lille), {
    title: '⚽ Lille – Galatasaray', notes: 'UEFA Champions League · League Phase · Decathlon Arena - Stade Pierre-Mauroy, Lille',
    domain: 'personal', priority: 'medium', category: 'football', date: '2026-10-21', time: '18:45', durationMinutes: 120, google: 'calendar',
  }, 'a new match item: personal, a Football slot (165), on Google Calendar like any timed item')
  eq(M.newMatchItem({ ...lille, timeValid: false }).google, 'tasks', 'no kick-off yet: Google Tasks, like any item without a time')
  const mine = { taskId: 't1', blockId: 'b1', scope: 'item', title: 'Galatasaray away 🔥', notes: 'with Ali', domain: 'personal', priority: 'high',
    date: '2026-10-21', time: '18:45', durationMinutes: 150, deadline: null, repeat: null, google: 'both', googleTaskList: null, source: null }
  eq(M.movedMatchItem(mine, { ...lille, kickoff: '2026-10-22T19:00Z' }), {
    ...mine, section: null, date: '2026-10-22', time: '21:00',
  }, 'a moved kick-off moves day and time; the owner\'s title, notes, priority, length and Google choice stay')
  eq(M.movedMatchItem({ ...mine, durationMinutes: null }, lille).durationMinutes, null, 'an item that blocks no time keeps blocking none')
  eq(M.movedMatchItem({ ...mine, time: null, durationMinutes: null }, lille).durationMinutes, 120, 'an item with no time yet gets two hours with its kick-off')
  const plan = { kickoff_at: '2026-10-21T16:45Z', time_valid: true }
  eq(M.itemAtKickoff({ date: '2026-10-21', time: '18:45' }, plan), true, 'still at its kick-off: ESPN may move it')
  eq(M.itemAtKickoff({ date: '2026-10-21', time: '22:00' }, plan), false, 'moved by the owner (a replay at 22:00): left alone')
  eq(M.itemAtKickoff({ date: '2026-10-22', time: '18:45' }, plan), false, 'moved to another day: left alone')
  eq(M.itemAtKickoff({ date: '2026-10-21', time: '20:00' }, { ...plan, time_valid: false }), true, 'no fixed time when planned: the day decides')
  eq([M.movedMatchItem(mine, { ...lille, timeValid: false }).time, M.movedMatchItem(mine, { ...lille, timeValid: false }).durationMinutes], [null, null],
  'ESPN un-fixed the time: no time, no length')
}

// ── The months a tournament is read for ──
eq(M.leagueMonths('2026-10-19T12:00:00Z'), ['202610', '202611'], 'this month and the next')
eq(M.leagueMonths('2026-10-05T12:00:00Z'), ['202609', '202610', '202611'], 'early in a month: the last one too (results)')
eq(M.leagueMonths('2026-12-28T12:00:00Z'), ['202612', '202701'], 'the year turns')
eq(M.leagueMonths('2026-10-31T23:30:00Z'), ['202610', '202611', '202612'], '00:30 on 01.11 in Norway is November (UTC still says October)')
eq(M.leagueMonths('2026-10-20T12:00:00Z', 30), ['202609', '202610', '202611'], 'the reach follows resultDays')

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

  // Unsubscribe / Unfollow (owner, 25.10.2026): what leaves the day
  const sub = (m, f = {}) => ({ ...plan(m), id: 'p-' + m.id, origin: 'subscription', ...f })
  const leave = (ps, others = new Set()) => M.subscriptionLeavers('432', fixtures, ps, others, NOW).map(p => p.event_id)
  eq(leave(fixtures.map(m => sub(m))), fixtures.map(m => m.id), 'unsubscribe: every coming match the subscription added leaves')
  eq(leave([sub(lille, { origin: 'manual' })]), [], 'unsubscribe: a match you planned yourself (Plan it) stays')
  eq(leave([sub(lille, { task_id: null })]), [], 'unsubscribe: an item already deleted is nothing to remove')
  eq(leave([sub(lille, { kickoff_at: '2026-10-19T11:00:00Z' })]), [], 'unsubscribe: a match already kicked off stays')
  eq(leave([sub(lille)], new Set([lille.home.team.id])), [], 'unsubscribe: a match another subscribed team plays in stays')
  eq(M.subscriptionLeavers('999999', fixtures, fixtures.map(m => sub(m)), new Set(), NOW), [], 'unsubscribe: only that team\'s matches')
}

// ── The page's view ──
eq([V.dayLabel('2026-10-19', '2026-10-19'), V.dayLabel('2026-10-20', '2026-10-19'), V.dayLabel('2026-10-18', '2026-10-19'), V.dayLabel('2026-10-21', '2026-10-19')],
  ['Today', 'Tomorrow', 'Yesterday', 'Wed 21.10.2026'], 'day headings: relative words, else weekday and DD.MM.YYYY')
eq(V.dayLabel('2027-01-01', '2026-12-31'), 'Tomorrow', 'tomorrow across the year')
{
  const days = V.byDayAndLeague([...fixtures, ...month.filter(m => m.state === 'pre')].sort((a, b) => a.kickoff.localeCompare(b.kickoff)))
  eq(days.map(d => d.date).slice(0, 2), ['2026-10-20', '2026-10-21'], 'by Norwegian day')
  eq(days[0].leagues.map(g => [g.name, g.matches.length, g.more.length]), [['UEFA Champions League', 2, 0]], 'a day\'s matches under their competition (three or fewer: none folded)')
}
{
  // A real Champions League month: nine matches a night (scoreboard-cl-month.json, 19.10.2026).
  const full = M.parseMatches(fx('scoreboard-cl-month'))
  eq(full.length, 36, 'the whole month: 36 matches')
  const gs = new Set(['432'])
  const days = V.byDayAndLeague(full, gs)
  const night = d => days.find(x => x.date === d).leagues[0]
  eq(night('2026-10-21').matches.map(m => m.home.team.short + ' – ' + m.away.team.short), ['Lille – Galatasaray'],
    'a night with Galatasaray: its match shows, never behind a fold')
  eq(night('2026-10-21').more.length, 8, '…the other eight fold into "8 more"')
  eq(night('2026-10-14').matches.length, 3, 'a night without a followed team: the first three')
  eq(night('2026-10-14').more.length, 6, '…and "6 more"')
  eq(V.byDayAndLeague(full, gs, Infinity).every(d => d.leagues.every(g => g.more.length === 0)), true, 'the tournament picked in the filter: nothing folded')
  eq(days.every(d => d.leagues.every(g => [...g.matches, ...g.more].length === full.filter(m => M.osloParts(m.kickoff).date === d.date).length)), true,
    'folding hides nothing: every match is in a group')
  const team = { kind: 'team', ref: '432' }
  eq(V.filterMatches([...fixtures, ...month], team).every(m => m.home.team.id === '432' || m.away.team.id === '432'), true, 'a team filter keeps its matches')
  eq(V.filterMatches(fixtures, { kind: 'league', ref: 'tur.1' }).map(m => m.id), ['401888265', '401888259', '401888371'], 'a tournament filter keeps its matches')
  eq(V.filterMatches(fixtures, null).length, fixtures.length, 'no filter: everything')
}
{
  const f = (kind, ref, league) => ({ kind, ref, league, name: ref })
  const follows = [f('team', '432', 'tur.1'), f('league', 'uefa.champions', 'uefa.champions'), f('team', '436', 'tur.1')]
  const active = new Set(['uefa.champions', 'tur.1'])
  eq(V.tableLeagues(follows, null, active), ['tur.1', 'uefa.champions'], 'the teams\' leagues first, then the tournaments, once each')
  eq(V.tableLeagues(follows, { kind: 'team', ref: '432' }, active), ['tur.1'], 'a filter shows its own table')
  eq(V.tableLeagues([...follows, f('league', 'fifa.world', 'fifa.world')], null, active), ['tur.1', 'uefa.champions'],
    'a tournament with no match on the page (a finished World Cup) shows no old table')
  const t = (name, ids) => ({ name, rows: ids.map((id, i) => ({ rank: i + 1, team: { id } })) })
  eq(V.tablesToShow([t('A', ['1', '2']), t('B', ['432', '3']), t('C', ['4'])], new Set(['432'])), { shown: [t('B', ['432', '3'])], hidden: 2 },
    'a group stage: the group with a followed team')
  eq(V.tablesToShow([t('A', ['1']), t('B', ['2'])], new Set(['432'])).shown.map(x => x.name), ['A'], 'no followed team: the first table')
  const tur = M.parseStandings(fx('standings-tur'))[0].rows
  const tones = V.noteTones([...tur, { ...tur[0], note: { color: '#ff0000', text: 'Relegation' } }])
  eq([...tones.values()][0], 'success', 'the top zone is success')
  eq(tones.get('Relegation'), 'danger', 'relegation is danger')
  eq([...tones.values()].every(x => ['success', 'info', 'highlight', 'upcoming', 'danger'].includes(x)), true, 'zones are THEME tones, never ESPN\'s colours')
}
eq(V.SUGGESTIONS.map(s => s.ref), ['432', 'uefa.champions', 'fifa.world', 'uefa.euro', 'eng.1', 'esp.1', 'ger.1', 'ita.1', 'fra.1'],
  'suggestions: Galatasaray, Champions League, World Cup, Euro (owner, 19.10.2026), then the five big leagues (25.10.2026)')
eq(V.SUGGESTIONS.every(s => s.kind !== 'league' || s.league === s.ref), true, 'a suggested tournament is its own league (163)')
eq(V.SUGGESTIONS.every(s => /^[a-z0-9][a-z0-9._-]{0,59}$/.test(s.ref) && (s.kind !== 'team' || /^\d+$/.test(s.ref))), true, 'suggestions pass 163\'s ref checks')
eq([V.scoreText(results[0]), V.scoreText(fixtures[0])], ['0–1', null], 'score text: home first; none before kick-off')

// ── The favourites' glance (168): the Personal page's Football card ──
{
  const NOW = '2026-10-19T12:00:00Z'
  const plain = x => JSON.parse(JSON.stringify(x)) // drops the fields a glance leaves out
  const gs = { id: 'f1', ref: '432', name: 'Galatasaray', logo: 'https://a.espncdn.com/i/teamlogos/soccer/500/432.png' }
  const tur = M.parseLeagueStandings(fx('standings-tur'))
  const lille = fixtures.find(m => m.id === '401915396')
  const derby = fixtures.find(m => m.id === '401888265')
  const glance = (matches, now = NOW, more = {}) => G.teamGlance(gs, { league: 'tur.1', standings: tur, matches, ...more }, now)

  eq(G.favouritesOf([
    { id: 'a', kind: 'team', favourite: false }, { id: 'b', kind: 'team', favourite: true },
    { id: 'c', kind: 'league', favourite: true }, { id: 'd', kind: 'team', favourite: true }, { id: 'e', kind: 'team' },
  ]).map(f => f.id), ['b', 'd'], 'favourites: starred teams only, in the Following list\'s order (a row without the column is none)')

  eq(plain(glance([...fixtures, ...results])), {
    id: 'f1', ref: '432', name: 'Galatasaray', logo: 'https://a.espncdn.com/i/teamlogos/soccer/500/432.png',
    league: 'tur.1', leagueName: 'Turkish Super Lig', position: 1, points: 19, played: 8,
    form: ['D', 'W', 'L', 'W'],
    results: [
      { eventId: '401888274', league: 'tur.1', kickoffISO: '2026-10-17T13:00Z', day: '2026-10-17', time: '15:00', opponent: 'Genclerbirli',
        opponentLogo: 'https://a.espncdn.com/i/teamlogos/soccer/500/996.png', home: false, competition: 'Turkish Super Lig', score: '0–1', outcome: 'W' },
      { eventId: '401915435', league: 'uefa.champions', kickoffISO: '2026-10-13T19:00Z', day: '2026-10-13', time: '21:00', opponent: 'Barcelona',
        opponentLogo: 'https://a.espncdn.com/i/teamlogos/soccer/500/83.png', home: true, competition: 'UEFA Champions League', score: '1–4', outcome: 'L' },
      { eventId: '401888280', league: 'tur.1', kickoffISO: '2026-10-09T17:00Z', day: '2026-10-09', time: '19:00', opponent: 'Kasimpasa',
        opponentLogo: 'https://a.espncdn.com/i/teamlogos/soccer/500/6870.png', home: true, competition: 'Turkish Super Lig', score: '3–1', outcome: 'W' },
    ],
    next: {
      eventId: '401915396', league: 'uefa.champions', kickoffISO: '2026-10-21T16:45Z', day: '2026-10-21', time: '18:45',
      opponent: 'Lille', opponentLogo: 'https://a.espncdn.com/i/teamlogos/soccer/500/166.png', home: false, competition: 'UEFA Champions League',
    },
  }, 'glance: 1st in the Süper Lig table with 19 points from 8, the form oldest first, the last three results newest first with the score home first (won 0–1 at Gençlerbirliği), next away at Lille 21.10.2026 18:45 (Oslo), nothing live')
  const popup = [...results.filter(m => M.outcomeFor(m, '432')).slice(0, 5)].reverse().map(m => M.outcomeFor(m, '432'))
  eq(glance([...fixtures, ...results]).form, popup, 'glance: the form is the club popup\'s, the newest last')
  eq(glance([...results, ...results, ...fixtures]).form, popup, 'glance: a result from two sources counts once')
  const many = Array.from({ length: 7 }, (_, i) => ({ ...results[i % 2], id: `r${i}`, kickoff: `2026-10-0${i + 1}T12:00Z` }))
  eq(glance(many).form, ['W', 'L', 'W', 'L', 'W'], 'glance: only the last five results')
  eq(glance(many).results.map(r => r.eventId), ['r6', 'r5', 'r4'], 'glance: the last results are the newest three, newest first')
  eq(glance([...results, ...results, ...fixtures]).results.map(r => r.eventId), ['401888274', '401915435', '401888280'], 'glance: a result from two sources is listed once')
  eq(glance([{ ...results[0], home: { ...results[0].home, score: null } }]).results, [], 'glance: a result without a score from ESPN isn\'t listed (never a made-up 0–0)')

  // A match being played: live from the favourite's side; the next is the one after it.
  const playing = { ...lille, state: 'in', clock: '67\'', home: { ...lille.home, score: 1 }, away: { ...lille.away, score: 0 } }
  const during = glance([playing, ...fixtures.filter(m => m !== lille), ...results], '2026-10-21T17:52:00Z')
  eq(plain(during.live), {
    eventId: '401915396', league: 'uefa.champions', kickoffISO: '2026-10-21T16:45Z', day: '2026-10-21', time: '18:45',
    opponent: 'Lille', opponentLogo: 'https://a.espncdn.com/i/teamlogos/soccer/500/166.png', home: false, competition: 'UEFA Champions League',
    score: '1–0', minute: '67\'',
  }, 'glance: live — the score home first as the page writes it, the minute, the opponent')
  eq([during.next.eventId, during.next.opponent, during.next.home, during.next.day, during.next.time], ['401888265', 'Fenerbahce', true, '2026-10-26', '19:30'],
    'glance: next is the derby at home, 26.10.2026 19:30 (winter time in Oslo)')
  eq(plain(glance([{ ...playing, clock: '', home: { ...playing.home, score: null } }]).live).score, '–', 'glance: live without a score from ESPN says "–", never a made-up 0–0')
  eq('minute' in plain(glance([{ ...playing, clock: '' }]).live), false, 'glance: live without ESPN\'s clock has no minute (the page says "Live")')

  // What "next" is: the page's Coming up, from the favourite's side.
  eq(glance([{ ...lille, timeValid: false }]).next.time, null, 'glance: a kick-off ESPN hasn\'t fixed has no time (never ESPN\'s placeholder)')
  eq(glance([{ ...lille, state: 'postponed' }, derby]).next.eventId, '401888265', 'glance: a postponed match isn\'t the next one')
  eq(glance([lille, derby], '2026-10-21T17:30:00Z').next.eventId, '401915396', 'glance: kicked off but ESPN not live yet: still next, as on the page')
  eq(glance([lille, derby], '2026-10-21T20:00:00Z').next.eventId, '401888265', 'glance: over three hours past kick-off with no word from ESPN: the next one')
  eq(glance([lille], '2026-12-01T12:00:00Z').next, undefined, 'glance: nothing coming: no next')

  // The day Personal shows: the favourite's match that day, in any state.
  const onDay = (matches, day) => G.teamGlance(gs, { league: 'tur.1', standings: tur, matches }, NOW, day).onDay
  eq([onDay([...fixtures, ...results], '2026-10-26')?.opponent, onDay([...fixtures, ...results], '2026-10-26')?.state, onDay([...fixtures, ...results], '2026-10-26')?.time],
    ['Fenerbahce', 'pre', '19:30'], 'glance: the day with the derby shows it (Oslo day, kick-off time)')
  const played = results.find(m => M.outcomeFor(m, '432'))
  const playedDay = M.osloParts(played.kickoff).date
  eq([onDay(results, playedDay)?.state, onDay(results, playedDay)?.outcome, typeof onDay(results, playedDay)?.score],
    ['post', M.outcomeFor(played, '432'), 'string'], 'glance: a day with a played match shows its result and score')
  eq(onDay([...fixtures, ...results], '2026-10-27'), undefined, 'glance: a day with no match: none')
  eq(G.teamGlance(gs, { league: 'tur.1', standings: tur, matches: fixtures }, NOW).onDay, undefined, 'glance: no day asked: none')
  const barca = G.teamGlance({ ...gs, ref: '83', name: 'Barcelona' }, { league: 'esp.1', standings: tur, matches: [...fixtures, ...results] }, NOW)
  eq([barca.form, barca.next, barca.position], [['W'], undefined, undefined],
    'glance: only the favourite\'s own matches and table row count (Barcelona: its 4–1 at Galatasaray, nothing else)')

  // Missing data is "nothing", never a crash.
  eq(plain(G.teamGlance({ ...gs, logo: null }, { league: null, standings: null, matches: [] }, NOW)),
    { id: 'f1', ref: '432', name: 'Galatasaray', logo: null, league: null, form: [], results: [] }, 'glance: nothing read yet — no table, no form, no results, no match')
  eq(G.teamGlance({ ...gs, logo: null }, { league: 'tur.1', standings: tur, matches: [] }, NOW).logo,
    'https://a.espncdn.com/i/teamlogos/soccer/500/432.png', 'glance: a follow without a logo takes the table\'s')
  eq(plain(glance([], NOW, { standings: { name: '', tables: [] } })).position, undefined, 'glance: a table without the team: no place')
  const t = (name, ids) => ({ name, rows: ids.map((id, i) => ({ rank: i + 1, team: { id, logo: null }, played: 2, points: 6 - i * 3 })) })
  eq([glance([], NOW, { standings: { name: 'UEFA Champions League', tables: [t('Group A', ['1', '2']), t('Group B', ['3', '432'])] } }).position],
    [2], 'glance: a group stage: its place in its own group')
  eq(glance([{ ...lille, league: null }]).next.competition, undefined, 'glance: a match without its competition still shows')
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
