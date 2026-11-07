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
//        [--routes home,daily] [--widths 402,874,1469,2450] [--slow 800] [--tabs] [--budget 0.1] [--json]
// --slow N holds every harness answer N ms, so each skeleton is on screen before its content
// replaces it (the shifts a phone on a slow network sees). Exits 1 when a page goes over the budget.
// What moved is named by its component (the data-src stamp, vite.config.ts) and its old → new box.
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'

const require = createRequire(import.meta.url)
const args = process.argv.slice(2)
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt }
const harness = opt('harness', process.env.APP_HARNESS)
if (!harness || !fs.existsSync(path.join(harness, 'mock-server.cjs'))) {
  console.error('usage: audit-cls.mjs --harness <dir containing mock-server.cjs> [--base url] [--routes a,b] [--widths 402,874,1469,2450] [--slow 800] [--tabs] [--budget 0.1] [--json]')
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
const asJson = args.includes('--json')

const { chromium } = require(path.resolve('node_modules/playwright'))
// resolve, not join: require() reads "scripts/harness/…" (no ./) as a package name.
const { installMocks, SESSION } = require(path.resolve(harness, 'mock-server.cjs'))

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

async function measure(browser, route, width) {
  const [w, h, phone] = VIEW[width] ?? [width, 900, width <= 500]
  const context = await browser.newContext({
    viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: phone, hasTouch: phone,
    timezoneId: 'Europe/Oslo', locale: 'en-GB', serviceWorkers: 'block', colorScheme: 'light',
  })
  await installMocks(context)
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
  const out = { route, width, load: 0, tabs: [], worst: [] }
  try {
    await page.goto(`${BASE}/#/${route}`, { waitUntil: 'domcontentloaded' })
    await quiet()
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
  for (const route of ROUTES) for (const width of WIDTHS) rows.push(await measure(browser, route, width))
} finally {
  await browser.close()
}

const over = rows.filter(r => r.load > BUDGET || r.tabs.some(t => t.cls > BUDGET))
if (asJson) console.log(JSON.stringify(rows, null, 2))
else {
  const pad = (s, n) => String(s).padEnd(n)
  console.log(pad('route', 12) + pad('width', 7) + pad('load', 8) + 'worst tab')
  for (const r of rows) {
    const t = r.tabs.slice().sort((a, b) => b.cls - a.cls)[0]
    console.log(pad(r.route, 12) + pad(r.width, 7) + pad(r.load.toFixed(3), 8) + (t ? `${t.cls.toFixed(3)} (${t.tab})` : '–'))
  }
  for (const r of over) {
    console.log(`\nOVER ${BUDGET}: ${r.route} @${r.width}`)
    for (const e of r.worst) for (const s of e.sources) console.log(`  ${e.phase} ${e.value.toFixed(3)}  ${s.src ?? '?'}  ${s.what}  ${JSON.stringify(s.from)} → ${JSON.stringify(s.to)}`)
  }
  console.log(`\n${rows.length - over.length} of ${rows.length} within the budget (${BUDGET})${SLOW ? `, answers held ${SLOW} ms` : ''}`)
}
process.exit(over.length ? 1 : 0)
