#!/usr/bin/env node
// Throwaway audit (CLAUDE.md → Layout width, W6/W7): how much of the page's
// width a view actually uses. Per route × width it reports
//   avail  — the page's content width (inside <main> minus the page gutters);
//   used   — distance from the content's left edge to the rightmost painted box
//            (a card, a tile, a bordered row) outside the page header;
//   empty  — avail − used: the band right of the rightmost card (the complaint);
//   height — the page's scroll height (long pages are the other half of it);
//   hOverflow — horizontal overflow of the document or <main> (must be false at 393).
//
// Runs against the mocked app harness (the real app on a mock Supabase):
//   node scripts/audit-page-width.mjs --harness <dir with mock-server.cjs> \
//        [--base http://127.0.0.1:5371] [--routes home,daily,daily:week] [--widths 393,1469,2450] \
//        [--theme light|dark] [--shots <dir>] [--json] [--glance]
// A route `daily:week` opens /daily and then picks the "Week" tab (same for
// month/tasks). `--glance` instead checks Daily's glance board at every width:
// each cell's x and width must be identical on a full day and an empty one
// (CLAUDE.md → Daily, "boxes never change position"). The harness is NOT part
// of the repo; nothing here talks to a real backend.
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'

const require = createRequire(import.meta.url)
const args = process.argv.slice(2)
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt }
const harness = opt('harness', process.env.APP_HARNESS)
if (!harness || !fs.existsSync(path.join(harness, 'mock-server.cjs'))) {
  console.error('usage: audit-page-width.mjs --harness <dir containing mock-server.cjs> [--base url] [--routes a,b:tab] [--widths 393,1469,2450] [--shots dir]')
  process.exit(2)
}
const BASE = opt('base', 'http://127.0.0.1:5371')
const ROUTES = opt('routes', 'home,daily,daily:week,daily:month,daily:tasks,recipes,shop,media,work,projects,training,health,wishes,developer').split(',')
const WIDTHS = opt('widths', '393,1469,2450').split(',').map(Number)
const HEIGHT = { 393: 852, 1469: 680, 2450: 1130 }
const THEME = opt('theme', 'light')
const SHOTS = opt('shots', null)
const asJson = args.includes('--json')
const glance = args.includes('--glance')

const { chromium } = require(path.resolve('node_modules/playwright'))
const { installMocks, SESSION } = require(path.join(harness, 'mock-server.cjs'))

function chromePath() {
  const root = '/opt/pw-browsers'
  if (!fs.existsSync(root)) return undefined
  for (const d of fs.readdirSync(root).filter(d => /^chromium-\d+$/.test(d)).sort()) {
    const p = `${root}/${d}/chrome-linux/chrome`
    if (fs.existsSync(p)) return p
  }
  return undefined
}

// Runs in the page.
function measure() {
  const main = document.querySelector('main[data-app-scroller]') || document.querySelector('main')
  if (!main) return null
  // <main> may also hold the pull-to-refresh indicator; the page is the tallest child's root.
  const wrapper = [...main.children].sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height)[0]
  const page = wrapper?.firstElementChild || main
  const mr = main.getBoundingClientRect()
  const pcs = getComputedStyle(page)
  const left = mr.left + parseFloat(pcs.paddingLeft || '0')
  const right = mr.left + main.clientWidth - parseFloat(pcs.paddingRight || '0')
  const alpha = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c || ''); if (!m) return 0; const p = m[1].split(/[ ,/]+/).filter(Boolean); return p.length > 3 ? Number(p[3]) : 1 }
  const painted = (cs) => alpha(cs.backgroundColor) > 0.02
    || (parseFloat(cs.borderTopWidth) > 0 && alpha(cs.borderTopColor) > 0.02)
    || (parseFloat(cs.borderLeftWidth) > 0 && alpha(cs.borderLeftColor) > 0.02)
    || (cs.boxShadow && cs.boxShadow !== 'none')
  let rightmost = left, count = 0
  for (const el of page.querySelectorAll('*')) {
    if (el.closest('header') && page.contains(el.closest('header')) && !el.closest('header').closest('.card, [class*="rounded-card"]')) continue
    const cs = getComputedStyle(el)
    if (cs.position === 'fixed' || cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) continue
    const r = el.getBoundingClientRect()
    if (r.width < 8 || r.height < 8) continue
    if (!painted(cs)) continue
    // A box clipped away by a horizontal scroller doesn't use page width.
    if (r.left > right + 1) continue
    count++
    rightmost = Math.max(rightmost, Math.min(r.right, right))
  }
  const doc = document.documentElement
  return {
    avail: Math.round(right - left),
    used: Math.round(rightmost - left),
    empty: Math.max(0, Math.round(right - rightmost)),
    height: main.scrollHeight,
    hOverflow: doc.scrollWidth > doc.clientWidth + 1 || main.scrollWidth > main.clientWidth + 1,
    painted: count,
  }
}

// Runs in the page: "left/width" of every glance-board cell, relative to <main>.
function glanceCells() {
  const label = [...document.querySelectorAll('main *')].find(e => e.children.length === 0 && /at a glance$/i.test(e.textContent.trim()))
  const grid = label?.parentElement?.querySelector(':scope > .grid')
  const main = document.querySelector('main').getBoundingClientRect()
  return grid ? [...grid.children].map(c => { const r = c.getBoundingClientRect(); return `${Math.round(r.left - main.left)}/${Math.round(r.width)}` }).join(' ') : null
}

async function openPage(browser, width, route) {
  const phone = width <= 500
  const context = await browser.newContext({
    viewport: { width, height: HEIGHT[width] ?? 900 }, deviceScaleFactor: 1, isMobile: phone, hasTouch: phone,
    timezoneId: 'Europe/Oslo', locale: 'en-GB', serviceWorkers: 'block', colorScheme: THEME,
    permissions: ['geolocation'], geolocation: { latitude: 59.9139, longitude: 10.7522 },
  })
  await installMocks(context)
  await context.addInitScript(({ theme, session }) => {
    try {
      localStorage.setItem('theme-preference', JSON.stringify({ state: { theme, accent: 'blue' }, version: 1 }))
      localStorage.setItem('sb-mock-auth-token', JSON.stringify(session))
    } catch { /* ignore */ }
  }, { theme: THEME, session: SESSION })
  const page = await context.newPage()
  await page.goto(`${BASE}/#/${route}`, { waitUntil: 'domcontentloaded' })
  try { await page.waitForLoadState('networkidle', { timeout: 8000 }) } catch { /* long-poll */ }
  await page.waitForTimeout(900)
  return { context, page }
}

const browser = await chromium.launch({ executablePath: chromePath(), args: ['--no-sandbox'] })
if (glance) {
  let bad = 0
  try {
    for (const width of WIDTHS) {
      const cells = []
      for (const route of ['daily', 'daily?date=2099-12-20']) {
        const { context, page } = await openPage(browser, width, route)
        cells.push(await page.evaluate(glanceCells))
        await context.close()
      }
      const ok = cells[0] != null && cells[0] === cells[1]
      if (!ok) bad++
      console.log(`${String(width).padEnd(6)}${ok ? 'same' : 'MOVED'}  full: ${cells[0]}  empty: ${cells[1]}`)
    }
  } finally { await browser.close() }
  process.exit(bad ? 1 : 0)
}
const rows = []
try {
  for (const spec of ROUTES) {
    const [route, tab] = spec.split(':')
    for (const width of WIDTHS) {
      const { context, page } = await openPage(browser, width, route)
      if (tab) {
        const label = tab[0].toUpperCase() + tab.slice(1)
        try { await page.getByRole('tab', { name: label, exact: true }).filter({ visible: true }).first().click({ timeout: 4000 }) } catch { /* no such tab */ }
        await page.waitForTimeout(700)
      }
      const m = await page.evaluate(measure)
      if (SHOTS) {
        fs.mkdirSync(SHOTS, { recursive: true })
        await page.screenshot({ path: path.join(SHOTS, `${spec.replace(':', '-')}-${width}-${THEME}.png`) })
      }
      rows.push({ route: spec, width, ...m })
      await context.close()
    }
  }
} finally {
  await browser.close()
}

if (asJson) console.log(JSON.stringify(rows, null, 2))
else {
  const pad = (s, n) => String(s).padEnd(n)
  console.log(pad('route', 16) + pad('width', 7) + pad('avail', 7) + pad('used', 7) + pad('empty', 7) + pad('height', 8) + 'hOverflow')
  for (const r of rows) console.log(pad(r.route, 16) + pad(r.width, 7) + pad(r.avail, 7) + pad(r.used, 7) + pad(r.empty, 7) + pad(r.height, 8) + (r.hOverflow ? 'YES' : 'no'))
}
