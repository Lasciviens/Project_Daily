#!/usr/bin/env node
/*
 * Verification — vitalsReading.ts (the Heart & vitals window's plain-language
 * reading: each signal against your own usual range, the change against the
 * period before, and the overall verdict). Runs the real module through
 * sucrase (no test framework, per CLAUDE.md). All fixtures are synthetic.
 *
 * Run: node scripts/verify-vitals-reading.cjs
 */
require('sucrase/register')
const V = require('../src/features/health/vitalsReading.ts')

let passed = 0
const failures = []
// Numbers and units are joined with a no-break space; compare them as spaces.
const norm = v => JSON.stringify(v)?.replace(/\\u00a0|\u00a0/g, ' ')
function check(label, actual, expected) {
  if (norm(actual) === norm(expected)) passed++
  else failures.push(`${label}\n    expected ${JSON.stringify(expected)}\n    actual   ${JSON.stringify(actual)}`)
}
function ok(label, cond, detail) {
  if (cond) passed++
  else failures.push(`${label}${detail ? `\n    ${detail}` : ''}`)
}
const r1 = n => (n == null ? n : Math.round(n * 10) / 10)

function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
/** Daily series ending on `to`, value = fn(i) for i days back (0 = to); null skips a day. */
function series(to, days, fn) {
  const out = []
  for (let i = days - 1; i >= 0; i--) {
    const v = fn(i)
    if (v != null) out.push({ date: addDays(to, -i), value: v })
  }
  return out
}
// A small deterministic wobble so every range has a real spread: -1, 0, +1, 0, …
const wob = i => [-1, 0, 1, 0][i % 4]

const TO = '2026-09-27'
const DAYS = 120

/** A healthy, steady person: every signal flat with a little wobble. */
function baseSeries(over = {}) {
  const s = {
    resting_heart_rate: series(TO, DAYS, i => 60 + wob(i)),
    heart_rate_variability: series(TO, DAYS, i => 45 + 3 * wob(i)),
    respiratory_rate: series(TO, DAYS, i => 15 + 0.3 * wob(i)),
    blood_oxygen_saturation: series(TO, DAYS, i => 0.96 + 0.005 * wob(i)), // fractions, as exported
    apple_sleeping_wrist_temperature: series(TO, DAYS, i => 35.5 + 0.05 * wob(i)),
    walking_heart_rate_average: series(TO, DAYS, i => 100 + wob(i)),
    cardio_recovery: [{ date: addDays(TO, -3), value: 25 }],
  }
  return { ...s, ...over }
}
/** Replace the last `n` days of a series (i < n) with fn(i). */
function tail(s, n, fn) {
  return s.map(d => {
    const i = Math.round((Date.parse(`${TO}T00:00:00Z`) - Date.parse(`${d.date}T00:00:00Z`)) / 86400000)
    return i < n ? { date: d.date, value: fn(i, d.value) } : d
  })
}
const day = (series, to = TO) => V.readVitals({ from: to, to, series })
const period = (series, days, to = TO) => V.readVitals({ from: addDays(to, -(days - 1)), to, series })
const row = (reading, key) => reading.rows.find(r => r.key === key)

// ─── §1 Normal: everything in range ──────────────────────────────────────────
{
  const r = day(baseSeries())
  check('§1.1 every signal with data gets a row', r.rows.map(x => x.key), ['rhr', 'hrv', 'resp', 'spo2', 'temp', 'walking', 'hrr'])
  check('§1.2 all recovery signals in range', r.rows.filter(x => x.spec.group === 'recovery').map(x => x.status), ['inside', 'inside', 'inside', 'inside', 'inside'])
  check('§1.3 verdict tone', r.verdict.tone, 'success')
  check('§1.4 verdict headline', r.verdict.headline, 'Everything is in your usual range.')
  check('§1.5 nothing flagged', [r.verdict.concerns, r.verdict.goods], [[], []])
  check('§1.6 five recovery signals judged', r.verdict.judged, 5)
  check('§1.7 RHR usual = 60-day median ± 5', [row(r, 'rhr').usual.low, row(r, 'rhr').usual.high], [55, 65])
  check('§1.8 HRV Day value is the 7-day average', row(r, 'hrv').basis, 'smoothed')
  check('§1.9 no composite score anywhere in the output', Object.keys(r.verdict).includes('score'), false)
}

// ─── §2 One-off: one high resting HR today ───────────────────────────────────
{
  const s = baseSeries({ resting_heart_rate: tail(series(TO, DAYS, i => 60 + wob(i)), 1, () => 68) })
  const r = day(s)
  const rhr = row(r, 'rhr')
  check('§2.1 RHR above', rhr.status, 'above')
  check('§2.2 above is the concern direction', rhr.signal, 'concern')
  check('§2.3 delta vs usual', rhr.deltaVsUsual, 8)
  check('§2.4 a one-day run', rhr.run && rhr.run.days, 1)
  check('§2.5 one signal off → neutral, not a warning', r.verdict.tone, 'neutral')
  check('§2.6 headline names it with its size', r.verdict.headline, 'One signal is off: resting heart rate is 8 bpm above your usual.')
  ok('§2.7 one-off framed as noise', r.verdict.notes.some(n => n.includes('One day is noise')), JSON.stringify(r.verdict.notes))
  ok('§2.8 meaning gives plain causes, no diagnosis', /can all raise it/.test(rhr.meaning) && !/you have/i.test(rhr.meaning), rhr.meaning)
  check('§2.9 vs the 7 days before', r1(rhr.deltaVsPrevious), r1(68 - (60 + (wob(1) + wob(2) + wob(3) + wob(4) + wob(5) + wob(6) + wob(7)) / 7)))
  check('§2.10 label', rhr.previousLabel, 'vs the 7 days before')
}

// ─── §3 Persistent: the same rise four days running ──────────────────────────
{
  const s = baseSeries({ resting_heart_rate: tail(series(TO, DAYS, i => 60 + wob(i)), 4, () => 68) })
  const r = day(s)
  check('§3.1 run of 4', row(r, 'rhr').run.days, 4)
  check('§3.2 persistent → warn', r.verdict.tone, 'warn')
  ok('§3.3 says how long and what to do', r.verdict.notes.some(n => n.includes('4 readings in a row') && n.includes('easing off')), JSON.stringify(r.verdict.notes))
}

// ─── §4 Multi-signal: resting HR up and HRV down together ────────────────────
{
  const s = baseSeries({
    resting_heart_rate: tail(series(TO, DAYS, i => 60 + wob(i)), 1, () => 67),
    heart_rate_variability: tail(series(TO, DAYS, i => 45 + 3 * wob(i)), 7, () => 30),
  })
  const r = day(s)
  check('§4.1 HRV below', row(r, 'hrv').status, 'below')
  check('§4.2 two concerns', r.verdict.concerns, ['rhr', 'hrv'])
  check('§4.3 warn', r.verdict.tone, 'warn')
  check('§4.4 label', r.verdict.label, '2 signals off')
  check('§4.5 headline combines them',
    r.verdict.headline,
    'Two recovery signals are off: resting heart rate is 7 bpm above your usual and HRV is below your usual range — together these often mean fatigue, illness coming on, alcohol or short sleep.')
  ok('§4.6 HRV has been low for days → persistence note', r.verdict.notes.some(n => n.startsWith('HRV (SDNN) has been off')), JSON.stringify(r.verdict.notes))
}

// ─── §5 HRV smoothing: one low day is not a flag ─────────────────────────────
{
  const s = baseSeries({ heart_rate_variability: tail(series(TO, DAYS, i => 45 + 3 * wob(i)), 1, () => 30) })
  const r = day(s)
  check('§5.1 one low HRV day, 7-day average still usual', row(r, 'hrv').status, 'inside')
  check('§5.2 verdict unchanged', r.verdict.tone, 'success')
}

// ─── §6 Sparse: thin history, a missing night, too few readings ──────────────
{
  const s = baseSeries({
    blood_oxygen_saturation: series(TO, 6, () => 0.96), // 5 nights of history + tonight
    apple_sleeping_wrist_temperature: series(addDays(TO, -1), DAYS, i => 35.5 + 0.05 * wob(i)), // no reading tonight… or the 2 nights before
    heart_rate_variability: series(TO, DAYS, i => (i < 7 && i !== 0 && i !== 3 ? null : 45 + 3 * wob(i))), // 2 readings in the last 7 days
  })
  const r = day(s)
  check('§6.1 SpO₂ has a value but no usual range yet', [row(r, 'spo2').value, row(r, 'spo2').status, row(r, 'spo2').reason], [96, 'unknown', 'no-history'])
  ok('§6.2 says how much history it has', row(r, 'spo2').reasonText.includes('5 of the 10 readings'), row(r, 'spo2').reasonText)
  check('§6.3 wrist temp falls back to last night (the newest within 3 days)', [row(r, 'temp').status, row(r, 'temp').valueDate], ['inside', addDays(TO, -1)])
  check('§6.4 HRV with 2 of 7 days → too few for a 7-day average', [row(r, 'hrv').status, row(r, 'hrv').reason], ['unknown', 'few-readings'])
  ok('§6.5 not-judged list names them', r.verdict.notes.some(n => n.startsWith('Not judged:') && n.includes('HRV') && n.includes('Blood oxygen')), JSON.stringify(r.verdict.notes))
  check('§6.6 the judged count excludes them', r.verdict.judged, 3)

  // A night older than the 3-day fallback is not "tonight".
  const old = baseSeries({ apple_sleeping_wrist_temperature: series(addDays(TO, -5), DAYS, i => 35.5 + 0.05 * wob(i)) })
  check('§6.7 no recent night → no reading (history keeps the row)', [row(day(old), 'temp').status, row(day(old), 'temp').reason], ['unknown', 'no-reading'])
  ok('§6.8 overnight metric says to wear the Watch to sleep', row(day(old), 'temp').meaning.includes('Wear the Watch to sleep'), row(day(old), 'temp').meaning)

  // Thin (but sufficient) history is labelled rough.
  const thin = baseSeries({ blood_oxygen_saturation: series(TO, 16, i => 0.96 + 0.005 * wob(i)) })
  check('§6.9 15 nights of history → judged but thin', [row(day(thin), 'spo2').status, row(day(thin), 'spo2').thinHistory], ['inside', true])
  ok('§6.10 rough-reading note', day(thin).verdict.notes.some(n => n.includes('read it as rough')), JSON.stringify(day(thin).verdict.notes))
}

// ─── §7 Missing data ─────────────────────────────────────────────────────────
{
  const s = baseSeries()
  delete s.apple_sleeping_wrist_temperature
  delete s.cardio_recovery
  const r = day(s)
  check('§7.1 a metric with no data is not shown', r.rows.map(x => x.key), ['rhr', 'hrv', 'resp', 'spo2', 'walking'])
  const none = day({})
  check('§7.2 nothing at all', [none.rows.length, none.verdict.label], [0, 'No readings'])
  check('§7.3 empty verdict headline', none.verdict.headline, 'No heart or overnight readings for this day yet.')
  const onlyOld = V.readVitals({ from: TO, to: TO, series: { resting_heart_rate: series('2026-01-31', 30, () => 60) } })
  check('§7.4 data only far in the past → not shown', onlyOld.rows.length, 0)
  const noHist = day({ resting_heart_rate: series(TO, 3, () => 60) })
  check('§7.5 all signals unjudgeable → "not enough readings"', [noHist.verdict.label, noHist.verdict.headline], ['Not enough data', 'Not enough readings to judge this day yet.'])
}

// ─── §8 Good signs ───────────────────────────────────────────────────────────
{
  const s = baseSeries({
    resting_heart_rate: tail(series(TO, DAYS, i => 60 + wob(i)), 1, () => 53),
    walking_heart_rate_average: tail(series(TO, DAYS, i => 100 + wob(i)), 7, () => 94),
  })
  const r = day(s)
  check('§8.1 lower RHR is a good sign', [row(r, 'rhr').status, row(r, 'rhr').signal], ['below', 'good'])
  check('§8.2 success tone', r.verdict.tone, 'success')
  check('§8.3 headline', r.verdict.headline, 'Everything is in your usual range or better: resting heart rate is lower than usual — usually a sign you’re well recovered.')
  ok('§8.4 walking HR context note', r.verdict.notes.includes('Walking heart rate is lower than usual — consistent with better fitness.'), JSON.stringify(r.verdict.notes))
}

// ─── §9 Harmless deviations ──────────────────────────────────────────────────
{
  const s = baseSeries({
    blood_oxygen_saturation: tail(series(TO, DAYS, i => 0.96 + 0.005 * wob(i)), 1, () => 0.995),
    apple_sleeping_wrist_temperature: tail(series(TO, DAYS, i => 35.5 + 0.05 * wob(i)), 1, () => 34.8),
  })
  const r = day(s)
  check('§9.1 high SpO₂ / cool wrist are neutral', [row(r, 'spo2').signal, row(r, 'temp').signal], ['neutral', 'neutral'])
  check('§9.2 no warning for them', [r.verdict.tone, r.verdict.concerns], ['success', []])
  ok('§9.3 but they are explained', r.verdict.notes.some(n => n.startsWith('Wrist temperature (sleep): Cooler')), JSON.stringify(r.verdict.notes))
}

// ─── §10 Wrist temperature is shown as a deviation ───────────────────────────
{
  const s = baseSeries({ apple_sleeping_wrist_temperature: tail(series(TO, DAYS, () => 35.5), 1, () => 36.1) })
  const r = day(s)
  const t = row(r, 'temp')
  check('§10.1 above', t.status, 'above')
  check('§10.2 value as a deviation', V.displayValue(t), '+0.6 °C')
  check('§10.3 usual as ± (floor 0.3 when the history is dead steady)', V.displayUsual(t), '± 0.3 °C')
  check('§10.4 sentence', r.verdict.headline, 'One signal is off: wrist temperature is 0.6 °C above your usual night.')
}

// ─── §11 The baseline comes BEFORE the judged period ─────────────────────────
{
  // A week at 70 after months at 60: the week's own readings must not move "usual".
  const s = baseSeries({ resting_heart_rate: tail(series(TO, DAYS, () => 60), 7, () => 70) })
  const r = period(s, 7)
  const rhr = row(r, 'rhr')
  check('§11.1 usual centre is the prior median, untouched by the week', rhr.usual.center, 60)
  check('§11.2 week average above', [rhr.value, rhr.status], [70, 'above'])
  check('§11.3 every day of the week counted above', [rhr.daysAbove, rhr.daysBelow, rhr.daysChecked], [7, 0, 7])
  check('§11.4 period wording + day count', r.verdict.headline, 'One signal is off: resting heart rate averaged 10 bpm above your usual (high on 7 of 7 days).')
  check('§11.5 a whole week off → warn', r.verdict.tone, 'warn')
  check('§11.6 vs the previous 7 days', [rhr.deltaVsPrevious, rhr.previousLabel], [10, 'vs the 7 days before'])
}

// ─── §12 Heart-rate recovery (population cut-off) ────────────────────────────
{
  const slow = day(baseSeries({ cardio_recovery: [{ date: addDays(TO, -10), value: 10 }] }))
  const h = row(slow, 'hrr')
  check('§12.1 latest reading within 30 days, below the 12 bpm cut-off', [h.basis, h.status, h.referenceKind], ['latest', 'below', 'population'])
  check('§12.2 usual text', V.displayUsual(h), 'more than 12 bpm')
  ok('§12.3 fitness context, not a recovery alarm', slow.verdict.tone === 'success' && slow.verdict.notes.some(n => n.startsWith('Heart-rate recovery after your latest workout was 10 bpm')), JSON.stringify(slow.verdict))
  const stale = day(baseSeries({ cardio_recovery: [{ date: addDays(TO, -45), value: 25 }] }))
  check('§12.4 a reading older than 30 days is not shown', row(stale, 'hrr'), undefined)
  const wk = period(baseSeries({ cardio_recovery: [{ date: addDays(TO, -2), value: 20 }] }), 7)
  check('§12.5 one workout in a week is enough', [row(wk, 'hrr').status, row(wk, 'hrr').readings], ['inside', 1])
}

// ─── §13 Units ───────────────────────────────────────────────────────────────
{
  const r = day(baseSeries())
  check('§13.1 SpO₂ fractions become percent (0.955 → 95.5)', r1(row(r, 'spo2').value), 95.5)
  check('§13.2 percent has no space', V.displayValue({ ...row(r, 'spo2'), value: 96.2 }), '96%')
  check('§13.3 fmtVital minus sign', V.fmtVital(-2.34, 1), '−2.3')
  check('§13.4 fmtSignedVital', [V.fmtSignedVital(0.04, 1), V.fmtSignedVital(-3, 0), V.fmtSignedVital(2, 0)], ['±0.0', '−3', '+2'])
  check('§13.5 thousands separator', V.fmtVital(1234.5, 0), '1,235')
  check('§13.6 SpO₂ changes are in points (singular for 1)',
    [V.displayChange(-1, V.VITAL_SPECS.spo2), V.displayChange(2, V.VITAL_SPECS.spo2), V.displayChange(-3, V.VITAL_SPECS.rhr)], ['−1 point', '+2 points', '−3 bpm'])
}

// ─── §14 A developing run inside a normal period ─────────────────────────────
{
  const s = baseSeries({ resting_heart_rate: tail(series(TO, DAYS, i => 60 + wob(i)), 3, () => 67) })
  const r = period(s, 30)
  const rhr = row(r, 'rhr')
  check('§14.1 the month average is still usual', rhr.status, 'inside')
  check('§14.2 but the last 3 readings are above', [rhr.run.direction, rhr.run.days], ['above', 3])
  ok('§14.3 the verdict says so', r.verdict.notes.some(n => n.includes('has been above your usual for the last 3 readings')), JSON.stringify(r.verdict.notes))
  check('§14.4 and softens the tone', r.verdict.tone, 'neutral')
}

// ─── §15 Few readings inside a period ────────────────────────────────────────
{
  const s = baseSeries({ respiratory_rate: series(TO, DAYS, i => (i < 7 && i !== 2 ? null : 15 + 0.3 * wob(i))) })
  const r = period(s, 7)
  check('§15.1 one night in 7 → too few', [row(r, 'resp').status, row(r, 'resp').reason], ['unknown', 'few-readings'])
  ok('§15.2 reason text', row(r, 'resp').reasonText.startsWith('Only 1 reading in these 7 days'), row(r, 'resp').reasonText)
}

// ─── §16 Breathing rate: the +3 level ────────────────────────────────────────
{
  const s = baseSeries({ respiratory_rate: tail(series(TO, DAYS, () => 15), 1, () => 18.5) })
  const r = day(s)
  check('§16.1 above', row(r, 'resp').status, 'above')
  ok('§16.2 names the infection-linked level', row(r, 'resp').meaning.includes('A rise of 3 or more'), row(r, 'resp').meaning)
  const small = day(baseSeries({ respiratory_rate: tail(series(TO, DAYS, () => 15), 1, () => 16.8) }))
  ok('§16.3 a smaller rise does not claim it', !row(small, 'resp').meaning.includes('A rise of 3 or more'), row(small, 'resp').meaning)
}

// ─── §17 Long periods ────────────────────────────────────────────────────────
{
  // Data only since 95 days ago: a 90-day view has 5 days before it.
  const recent = {}
  for (const [k, v] of Object.entries(baseSeries())) recent[k] = v.filter(d => d.date >= addDays(TO, -94))
  const r = period(recent, 90)
  check('§17.1 no usual range before the period', row(r, 'rhr').reason, 'no-history')
  ok('§17.2 → the long-period note', r.verdict.notes.some(n => n.startsWith('A long period often has no earlier history')), JSON.stringify(r.verdict.notes))
  check('§17.3 the period value still reads (average of 90 days)', [row(r, 'rhr').readings, row(r, 'rhr').basis], [90, 'period'])
  const short = period(recent, 7)
  ok('§17.4 a week in the same data has no such note', !short.verdict.notes.some(n => n.startsWith('A long period')), JSON.stringify(short.verdict.notes))
}

// ─── §18 Sources ─────────────────────────────────────────────────────────────
{
  const r = day(baseSeries())
  const urls = r.sources.map(s => s.url)
  check('§18.1 sources are de-duplicated', urls.length, new Set(urls).size)
  ok('§18.2 cites Apple Vitals, Plews 2013 and Natarajan 2021',
    urls.includes('https://support.apple.com/en-us/120142') && urls.some(u => u.includes('23852425')) && urls.some(u => u.includes('PMC8443549')))
  ok('§18.3 every row has an about text and a range rule', r.rows.every(x => x.spec.about && x.spec.rangeRule))
}

// ─── §19 Persistence inside a period, even when the run broke ────────────────
{
  const pattern = [60, 70, 70, 60, 70, 70, 60] // i = 0 … 6 (today first)
  const s = baseSeries({ resting_heart_rate: tail(series(TO, DAYS, () => 60), 7, i => pattern[i]) })
  const r = period(s, 7)
  const rhr = row(r, 'rhr')
  check('§19.1 4 of 7 days above, the last day back in range', [rhr.daysAbove, rhr.daysChecked, rhr.run], [4, 7, null])
  check('§19.2 headline with the day count', r.verdict.headline, 'One signal is off: resting heart rate averaged 6 bpm above your usual (high on 4 of 7 days).')
  ok('§19.3 persistence says how many days', r.verdict.notes.some(n => n.startsWith('It has been off on 4 of 7 days in this period')), JSON.stringify(r.verdict.notes))
  check('§19.4 → warn', r.verdict.tone, 'warn')
  const two = baseSeries({ resting_heart_rate: tail(series(TO, DAYS, () => 60), 7, i => [60, 80, 60, 80, 60, 60, 60][i]) })
  const r2 = period(two, 7)
  check('§19.5 2 high days (mean above) is not "persistent"', [row(r2, 'rhr').status, r2.verdict.tone], ['above', 'neutral'])
}

// ─── §20 Smoothed signals have no per-day count ──────────────────────────────
{
  const s = baseSeries({ heart_rate_variability: tail(series(TO, DAYS, i => 45 + 3 * wob(i)), 7, () => 30) })
  const r = period(s, 7)
  const h = row(r, 'hrv')
  check('§20.1 HRV week below, no day counts', [h.status, h.daysChecked], ['below', null])
  check('§20.2 headline without a count', r.verdict.headline, 'One signal is off: HRV averaged below your usual range.')
  ok('§20.3 a low 7-day average for a week is persistent', r.verdict.tone === 'warn' && r.verdict.notes.some(n => n.includes('readings in a row')), JSON.stringify(r.verdict))
}

// ─── §21 A difference on the edge of the rule gets a decimal ─────────────────
{
  const r = day(baseSeries({ resting_heart_rate: tail(series(TO, DAYS, () => 60), 1, () => 65.4) }))
  check('§21.1 5.4 above the median is above ± 5', row(r, 'rhr').status, 'above')
  check('§21.2 and reads "5.4", not "5"', r.verdict.headline, 'One signal is off: resting heart rate is 5.4 bpm above your usual.')
}

console.log(`${passed} passed, ${failures.length} failed`)
if (failures.length) {
  for (const f of failures) console.log(`✗ ${f}`)
  process.exit(1)
}
