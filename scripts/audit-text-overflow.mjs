#!/usr/bin/env node
// Throwaway audit (THEME.md §3 / §5, CLAUDE.md → W6): finds text that doesn't
// behave at its box, on real rendered pages. Two lists per route × width:
//   SPILL — an element (a chip, a label) that runs out of its parent's box,
//           or text running out of its own box, where nothing clips it;
//   CUT   — text cut by truncate / line-clamp with no way to read the rest
//           (no `title`, not a <Truncate> trigger, nothing around it with one).
// Overflow like this can't be found reliably by reading the code.
//
// Runs against the mocked app harness (the real app on a mock Supabase):
//   node scripts/audit-text-overflow.mjs --harness <dir with mock-server.cjs> \
//        [--base http://127.0.0.1:5371] [--routes home,daily] [--widths 393,1469,2450] [--json]
//   node scripts/audit-text-overflow.mjs --static [--src src]   (source scan only, no browser)
// The harness is NOT part of the repo; nothing here talks to a real backend.
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'

const require = createRequire(import.meta.url)
const args = process.argv.slice(2)
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt }

// --static: no browser. Lists source lines where a `truncate` / `line-clamp-N`
// element has an {expression} child and no `title` — cut text the mock data
// may never cut, so the rendered pass can't see it. A heuristic (one line per
// opening tag); <Truncate> sites never match.
if (args.includes('--static')) {
  const hits = []
  const walk = (d) => {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f)
      if (fs.statSync(p).isDirectory()) walk(p)
      else if (p.endsWith('.tsx')) {
        fs.readFileSync(p, 'utf8').split('\n').forEach((ln, i) => {
          const re = /<([a-z][a-z0-9]*)\b([^<>]*?\bclassName=(?:"[^"]*"|\{[^}]*\})[^<>]*)>\s*\{/g
          for (let m; (m = re.exec(ln));) {
            if (/\b(truncate|line-clamp-[1-6])\b/.test(m[2]) && !/\btitle=/.test(m[2])) hits.push(`${p}:${i + 1}  <${m[1]}>`)
          }
        })
      }
    }
  }
  walk(opt('src', 'src'))
  console.log(hits.join('\n'))
  console.log(`\n${hits.length} bare cut sites in ${new Set(hits.map(h => h.split(':')[0])).size} files`)
  process.exit(0)
}

const harness = opt('harness', process.env.APP_HARNESS)
if (!harness || !fs.existsSync(path.join(harness, 'mock-server.cjs'))) {
  console.error('usage: audit-text-overflow.mjs --harness <dir containing mock-server.cjs> [--base url] [--routes a,b] [--widths 393,1469]')
  process.exit(2)
}
const BASE = opt('base', 'http://127.0.0.1:5371')
const ROUTES = opt('routes', 'home,daily,recipes,shop,media,work,projects,training,health,wishes,developer,games').split(',')
const WIDTHS = opt('widths', '393,1469,2450').split(',').map(Number)
const HEIGHT = { 393: 852, 1469: 680, 2450: 1130 }
const asJson = args.includes('--json')

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
function scan() {
  const out = { spill: [], cut: [] }
  const vw = window.innerWidth
  const desc = (el) => {
    const c = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 4).join('.') : ''
    const t = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 70)
    return `${el.tagName.toLowerCase()}${c ? '.' + c : ''} "${t}"`
  }
  const visible = (el, cs) => {
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return false
    const r = el.getBoundingClientRect()
    return r.width >= 2 && r.height >= 2 && r.bottom > -2000 && r.top < window.innerHeight + 6000
  }
  const clipsX = (cs) => cs.overflowX !== 'visible'
  const scroller = (el) => !!el.closest('.scroll-x,[data-scroll-x],.overflow-x-auto,[role="tablist"]')
  const hasOwnText = (el) => [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())
  const root = document.querySelector('main') || document.body
  const all = [root, ...root.querySelectorAll('*'), ...document.querySelectorAll('[role="dialog"] *')]
  const seen = new Set()
  for (const el of all) {
    if (seen.has(el)) continue
    seen.add(el)
    const cs = getComputedStyle(el)
    if (!visible(el, cs) || scroller(el)) continue
    if (el.closest('svg,.recharts-wrapper,[aria-hidden="true"]')) continue
    const r = el.getBoundingClientRect()

    // CUT: truncated / clamped with no reveal.
    const clampLines = Number(cs.webkitLineClamp) || 0
    const cutX = cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1
    const cutY = clampLines > 0 && el.scrollHeight > el.clientHeight + 1
    if ((cutX || cutY) && (el.innerText || '').trim()) {
      const revealed = !!el.closest('[title]') || el.getAttribute('role') === 'button' || !!el.querySelector('[title]')
      if (!revealed) out.cut.push(desc(el))
    }

    // SPILL (a): text running out of its own box while nothing clips it.
    if (!clipsX(cs) && hasOwnText(el) && cs.whiteSpace.includes('nowrap') && el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
      out.spill.push(`${desc(el)} — text ${el.scrollWidth}px in a ${el.clientWidth}px box`)
      continue
    }
    // SPILL (b): the element pokes out of its parent while no ancestor clips it.
    const p = el.parentElement
    if (!p || cs.position === 'absolute' || cs.position === 'fixed') continue
    const pcs = getComputedStyle(p)
    if (pcs.display.startsWith('inline') && !pcs.display.includes('flex') && !pcs.display.includes('grid') && pcs.display !== 'inline-block') continue
    const pr = p.getBoundingClientRect()
    const padR = parseFloat(pcs.borderRightWidth) || 0
    const padL = parseFloat(pcs.borderLeftWidth) || 0
    const over = Math.max(r.right - (pr.right - padR), (pr.left + padL) - r.left)
    if (over <= 1.5) continue
    // A deliberate bleed (-mx-3 on a full-width row, a pulled-in hit area) is not a spill.
    const bleed = Math.max(0, -parseFloat(cs.marginLeft) || 0, -parseFloat(cs.marginRight) || 0)
    if (over <= bleed + 1.5) continue
    let clipped = false
    for (let a = p; a && a !== document.body; a = a.parentElement) {
      const acs = getComputedStyle(a)
      if (acs.overflowX !== 'visible') {
        const ar = a.getBoundingClientRect()
        if (r.right <= ar.right + 1 && r.left >= ar.left - 1) break // fits inside the clip → only this parent is small
        // A horizontal scroll strip is meant to hold more than it shows.
        clipped = acs.overflowX === 'auto' || acs.overflowX === 'scroll' ? 'scroll' : true
        break
      }
    }
    // Clipped by a truncating box = a cut (the CUT list covers it), not a spill.
    if (clipped) continue
    out.spill.push(`${desc(el)} — ${Math.round(over)}px past its parent${r.right > vw + 1 ? ' (off screen)' : ''}`)
  }
  out.spill = [...new Set(out.spill)]
  out.cut = [...new Set(out.cut)]
  return out
}

const browser = await chromium.launch({ executablePath: chromePath(), args: ['--no-sandbox'] })
const report = []
try {
  for (const width of WIDTHS) {
    const phone = width <= 500
    for (const route of ROUTES) {
      const context = await browser.newContext({
        viewport: { width, height: HEIGHT[width] ?? 900 }, deviceScaleFactor: 1, isMobile: phone, hasTouch: phone,
        timezoneId: 'Europe/Oslo', locale: 'en-GB', serviceWorkers: 'block',
      })
      await installMocks(context, {})
      await context.addInitScript(({ session }) => {
        try {
          localStorage.setItem('theme-preference', JSON.stringify({ state: { theme: 'light', accent: 'blue', motion: 'standard' }, version: 1 }))
          localStorage.setItem('sb-mock-auth-token', JSON.stringify(session))
        } catch { /* private mode */ }
      }, { session: SESSION })
      const page = await context.newPage()
      await page.goto(`${BASE}/#/${route}`, { waitUntil: 'domcontentloaded' })
      try { await page.waitForLoadState('networkidle', { timeout: 8000 }) } catch { /* long poll */ }
      await page.waitForTimeout(1500)
      const res = await page.evaluate(scan)
      report.push({ route, width, ...res })
      await context.close()
      if (!asJson) {
        console.log(`\n== ${route} @${width}: ${res.spill.length} spill, ${res.cut.length} cut without reveal`)
        for (const s of res.spill) console.log(`  SPILL ${s}`)
        for (const c of res.cut) console.log(`  CUT   ${c}`)
      }
    }
  }
} finally {
  await browser.close()
}
if (asJson) console.log(JSON.stringify(report, null, 2))
