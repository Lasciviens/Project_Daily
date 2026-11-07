#!/usr/bin/env node
// Layout-shift budget (THEME.md §5 "Loading"): how much each page moves after it was drawn, measured
// by the browser's own Layout Instability API — the number Chrome reports as CLS. Per route × width it
// loads the page, records every `layout-shift` entry until the page is quiet, then switches each tab
// in the page header (--tabs) and records what moves after the switch. A shift within 0.5 s of a tap
// doesn't count (the browser's rule: the user caused it), so a tab's own content changing is fine;
// data that lands later and pushes things is not.
//
// Runs against the mocked app harness (scripts/harness, its README says how to start the app):
//   node scripts/audit-cls.mjs --harness scripts/harness [--base http://127.0.0.1:5371]
//        [--routes home,daily] [--widths 402,874,1469,2450] [--slow 800] [--tabs] [--budget 0.1]
//        [--data seed,light,empty] [--revisit] [--json]
// --slow N holds every harness answer N ms, so each skeleton is on screen before its content
// replaces it (the shifts a phone on a slow network sees). Exits 1 when a page goes over the budget.
// --data picks whose account the harness plays, through its `tables` overrides (default seed):
//   seed   the harness's own made-up data — a full account;
//   light  a little of it — two tasks today (one at a time), two work tasks and nothing overdue, two
//          projects in one area with no tasks of their own, one followed team, today's breakfast as
//          the whole diary, two routines with two weeks of workouts, no health data, nothing watched;
//   empty  a new account: every table empty.
// A loading copy has to suit all three: one sized for the seed alone moves a light page as much as a
// short one moves the seed's (THEME.md §5), so check a change with all three.
// --revisit loads each page once, then measures a second load in the same browser (what a page that
// remembers its last layout — DayAgenda's rows — looks like on the next visit).
// What moved is named by its component (the data-src stamp, vite.config.ts) and its old → new box.
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'

const require = createRequire(import.meta.url)
const args = process.argv.slice(2)
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt }
const harness = opt('harness', process.env.APP_HARNESS)
if (!harness || !fs.existsSync(path.join(harness, 'mock-server.cjs'))) {
  console.error('usage: audit-cls.mjs --harness <dir containing mock-server.cjs> [--base url] [--routes a,b] [--widths 402,874,1469,2450] [--slow 800] [--tabs] [--budget 0.1] [--data seed,light,empty] [--revisit] [--json]')
  process.exit(2)
}
const BASE = opt('base', 'http://127.0.0.1:5371')
const ROUTES = opt('routes', 'home,daily,recipes,shop,training,health,wishes,media,football,books,games,work,projects,settings,developer').split(',')
const WIDTHS = opt('widths', '402,874,1469,2450').split(',').map(Number)
// 874 is the phone turned sideways: a touch screen, so the app keeps the phone layout.
const VIEW = { 402: [402, 874, true], 874: [874, 402, true], 1469: [1469, 680, false], 2450: [2450, 1130, false] }
const SLOW = Number(opt('slow', '0'))
const BUDGET = Number(opt('budget', '0.1'))
const TABS = args.includes('--tabs')
const REVISIT = args.includes('--revisit')
const asJson = args.includes('--json')
const SHAPES = opt('data', 'seed').split(',')

const { chromium } = require(path.resolve('node_modules/playwright'))
// resolve, not join: require() reads "scripts/harness/…" (no ./) as a package name.
const { installMocks, SESSION } = require(path.resolve(harness, 'mock-server.cjs'))
const { buildTables, osloDay } = require(path.resolve(harness, 'seed.cjs'))

/** The `tables` overrides for a data shape (--data). */
function tablesFor(shape) {
  if (shape === 'seed') return {}
  const t = buildTables(new Date())
  if (shape === 'empty') return Object.fromEntries(Object.keys(t).map(name => [name, []]))
  if (shape !== 'light') throw new Error(`--data ${shape}: seed, light or empty`)
  const today = osloDay(new Date())
  const ids = (rows) => new Set(rows.map(r => r.id))
  const tasks = new Set(['Buy a birthday card for Kari', 'Call the plumber about the kitchen tap', 'Prepare the Q4 planning slides', 'Review the onboarding checklist'])
  const projects = t.projects.filter(p => p.area === 'personal' && p.status === 'active')
  const projectIds = ids(projects)
  const routines = t.hevy_routines.slice(0, 2)
  const routineIds = ids(routines)
  const workouts = t.hevy_workouts.filter(w => routineIds.has(w.routine_id) && Date.parse(w.start_time) >= Date.now() - 14 * 864e5)
  const workoutIds = ids(workouts)
  const workoutExercises = t.hevy_workout_exercises.filter(e => workoutIds.has(e.hevy_workout_id))
  const workoutExerciseIds = ids(workoutExercises)
  const routineExercises = t.hevy_routine_exercises.filter(e => routineIds.has(e.hevy_routine_id))
  const routineExerciseIds = ids(routineExercises)
  return {
    tasks: t.tasks.filter(x => tasks.has(x.title)), time_blocks: [], schedule_blocks: [],
    projects, project_phases: t.project_phases.filter(p => projectIds.has(p.project_id)),
    project_blocks: t.project_blocks.filter(b => projectIds.has(b.project_id)), project_entries: t.project_entries.filter(e => projectIds.has(e.project_id)),
    work_notes: [], work_weekly_goals: [], work_pinned_links: [],
    football_follows: t.football_follows.slice(0, 1),
    food_log_entries: t.food_log_entries.filter(e => e.date === today && e.meal_slot === 'breakfast'),
    water_log_entries: [], supplement_schedules: [],
    hevy_routines: routines, hevy_routine_exercises: routineExercises,
    hevy_routine_sets: t.hevy_routine_sets.filter(s => routineExerciseIds.has(s.hevy_routine_exercise_id)),
    current_program_routines: t.current_program_routines.filter(p => routineIds.has(p.routine_id)),
    hevy_workouts: workouts, hevy_workout_exercises: workoutExercises, hevy_sets: t.hevy_sets.filter(s => workoutExerciseIds.has(s.hevy_exercise_id)),
    strava_activities: [], health_metrics: [], health_workouts: [], body_composition_reports: [], hevy_body_measurements: [],
    user_movie_entries: [], media_watches: [], user_tv_entries: [], user_tv_episodes: [],
  }
}

function chromePath() {
  const root = '/opt/pw-browsers'
  if (!fs.existsSync(root)) return undefined
  for (const d of fs.readdirSync(root).filter(d => /^chromium-\d+$/.test(d)).sort()) {
    for (const sub of ['chrome-linux64', 'chrome-linux']) {
      const p = `${root}/${d}/${sub}/chrome`
      if (fs.existsSync(p)) return p
    }
  }
  return undefined
}

// Runs in the page before the app: every layout-shift entry, with what moved.
function observe() {
  window.__shifts = []
  const box = (r) => r ? [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] : null
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        window.__shifts.push({
          t: Math.round(e.startTime), value: e.value, input: e.hadRecentInput,
          sources: (e.sources || []).slice(0, 3).map((s) => {
            const el = s.node && (s.node.nodeType === 1 ? s.node : s.node.parentElement)
            const stamp = el && el.closest('[data-src]')
            return { what: el ? `${el.tagName.toLowerCase()} "${(el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 40)}"` : '(removed)',
              src: stamp ? stamp.getAttribute('data-src') : null, from: box(s.previousRect), to: box(s.currentRect) }
          }),
        })
      }
    }).observe({ type: 'layout-shift', buffered: true })
  } catch { /* no Layout Instability API */ }
}

const sum = (entries) => entries.filter(e => !e.input).reduce((s, e) => s + e.value, 0)

async function measure(browser, route, width, shape) {
  const [w, h, phone] = VIEW[width] ?? [width, 900, width <= 500]
  const context = await browser.newContext({
    viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: phone, hasTouch: phone,
    timezoneId: 'Europe/Oslo', locale: 'en-GB', serviceWorkers: 'block', colorScheme: 'light',
  })
  await installMocks(context, { tables: tablesFor(shape) })
  // Registered after the mock, so it runs first: hold each answer, then hand it to the mock.
  if (SLOW) await context.route(u => u.hostname === 'mock.supabase.co', async (r) => { await new Promise(res => setTimeout(res, SLOW)); return r.fallback() })
  await context.addInitScript((session) => {
    try {
      localStorage.setItem('theme-preference', JSON.stringify({ state: { theme: 'light', accent: 'blue' }, version: 1 }))
      localStorage.setItem('sb-mock-auth-token', JSON.stringify(session))
    } catch { /* ignore */ }
  }, SESSION)
  await context.addInitScript(observe)
  const page = await context.newPage()
  const quiet = async () => {
    try { await page.waitForLoadState('networkidle', { timeout: 12000 }) } catch { /* long poll */ }
    await page.waitForTimeout(2500 + SLOW)
  }
  const out = { data: shape, route, width, load: 0, tabs: [], worst: [] }
  try {
    await page.goto(`${BASE}/#/${route}`, { waitUntil: 'domcontentloaded' })
    await quiet()
    if (REVISIT) {
      await page.reload({ waitUntil: 'domcontentloaded' })
      await quiet()
    }
    let seen = await page.evaluate(() => window.__shifts.length)
    const load = await page.evaluate(() => window.__shifts)
    out.load = sum(load)
    out.worst.push(...load.filter(e => !e.input).map(e => ({ ...e, phase: 'load' })))
    if (TABS) {
      // The page's own sections: the visible tablist in its header with the most tabs.
      const tabs = await page.evaluate(() => {
        const lists = [...document.querySelectorAll('main header [role="tablist"]')].filter(l => l.getBoundingClientRect().width > 0 && !l.closest('[inert]'))
        const tl = lists.sort((a, b) => b.querySelectorAll('[role="tab"]').length - a.querySelectorAll('[role="tab"]').length)[0]
        if (!tl) return null
        return { index: [...document.querySelectorAll('main [role="tablist"]')].indexOf(tl),
          tabs: [...tl.querySelectorAll('[role="tab"]')].map((t, i) => ({ i, label: (t.textContent || '').trim(), selected: t.getAttribute('aria-selected') === 'true' })) }
      })
      for (const tab of tabs?.tabs.filter(t => !t.selected) ?? []) {
        await page.locator('main [role="tablist"]').nth(tabs.index).locator('[role="tab"]').nth(tab.i).click({ timeout: 4000 }).catch(() => {})
        await quiet()
        const after = await page.evaluate((n) => window.__shifts.slice(n), seen)
        seen += after.length
        out.tabs.push({ tab: tab.label, cls: sum(after) })
        out.worst.push(...after.filter(e => !e.input).map(e => ({ ...e, phase: tab.label })))
      }
    }
  } finally {
    await context.close()
  }
  out.worst = out.worst.sort((a, b) => b.value - a.value).slice(0, 3)
  return out
}

const browser = await chromium.launch({ executablePath: chromePath(), args: ['--no-sandbox'] })
const rows = []
try {
  for (const shape of SHAPES) for (const route of ROUTES) for (const width of WIDTHS) rows.push(await measure(browser, route, width, shape))
} finally {
  await browser.close()
}

const over = rows.filter(r => r.load > BUDGET || r.tabs.some(t => t.cls > BUDGET))
if (asJson) console.log(JSON.stringify(rows, null, 2))
else {
  const pad = (s, n) => String(s).padEnd(n)
  console.log(pad('data', 7) + pad('route', 12) + pad('width', 7) + pad('load', 8) + 'worst tab')
  for (const r of rows) {
    const t = r.tabs.slice().sort((a, b) => b.cls - a.cls)[0]
    console.log(pad(r.data, 7) + pad(r.route, 12) + pad(r.width, 7) + pad(r.load.toFixed(3), 8) + (t ? `${t.cls.toFixed(3)} (${t.tab})` : '–'))
  }
  for (const r of over) {
    console.log(`\nOVER ${BUDGET}: ${r.data} ${r.route} @${r.width}`)
    for (const e of r.worst) for (const s of e.sources) console.log(`  ${e.phase} ${e.value.toFixed(3)}  ${s.src ?? '?'}  ${s.what}  ${JSON.stringify(s.from)} → ${JSON.stringify(s.to)}`)
  }
  console.log(`\n${rows.length - over.length} of ${rows.length} within the budget (${BUDGET})${SLOW ? `, answers held ${SLOW} ms` : ''}${REVISIT ? ', second visit' : ''}`)
}
process.exit(over.length ? 1 : 0)
