#!/usr/bin/env node
// The item screen's look, measured (owner, 27.11.2026, after testing it on the iPhone: "Things dont stand where they
// have to, either not fitting or scaling issues … Work until it is perfect!"). Opens the item screen in the mocked app
// (scripts/harness) — an edit and a new item, every category, Type Movie / TV / Cinema, repeat and all-day on and off,
// no date, a long title and long notes, the time wheels open, the searches open — at 375×812, 402×874, 430×932, the
// phone sideways (874×402) and the laptop (1469×680), scrolls through the whole screen and lists:
//   CUT      text cut or running out of its box where nothing meant it (not a <Truncate>: no ellipsis), or text a
//            scroller's edge cuts (a timeline hour label half in view);
//   OVERLAP  two boxes of one row or group on top of each other;
//   COVERED  an icon, button or line of text partly hidden under another box (not the marks' banner: it peeks by design);
//   HOLDER   a field whose placeholder doesn't fit ("Add a nam");
//   OUTSIDE  anything past the screen's sides (sideways scrolling) or a list over the screen's top or bottom;
//   WHEEL    a time wheel whose band, value and bold row disagree (also with the page zoomed);
//   KEYBOARD the movie search's list with the keyboard up (the window shortened to what it leaves): it must open under
//            its field, inside the screen — not above it over the title (owner, 27.11.2026).
// Each phone size runs at the app's Display scale 100 %, 80 % and 125 % too (Settings: the root font size). At 80 % the
// harness reproduces the owner's screenshots of 27.11.2026: 18 : 20 in the wheel's band for 14:15, "Wed 25.11.2026"
// running into the time pill.
// Exit 1 when it finds anything. Needs the app on the mock (scripts/harness/README.md):
//   node scripts/audit-item-screen.mjs --harness scripts/harness [--base http://127.0.0.1:5371/Project_Daily]
//        [--sizes 375x812,402x874] [--scales 100,80,125] [--shots <dir>] [--only edit,new,wheel]
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'

const require = createRequire(import.meta.url)
const args = process.argv.slice(2)
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt }
const harness = opt('harness', process.env.APP_HARNESS)
if (!harness || !fs.existsSync(path.join(harness, 'mock-server.cjs'))) {
  console.error('usage: audit-item-screen.mjs --harness <dir containing mock-server.cjs> [--base url] [--sizes 402x874,…] [--shots dir]')
  process.exit(2)
}
const BASE = opt('base', 'http://127.0.0.1:5371/Project_Daily')
const SIZES = opt('sizes', '375x812,402x874,430x932,874x402,1469x680').split(',').map(s => s.split('x').map(Number))
const SHOTS = opt('shots', null)
const ONLY = opt('only', 'edit,new,wheel').split(',')
const SCALES = opt('scales', '100,80,125').split(',').map(Number)
const { installMocks, SESSION } = require(path.resolve(harness, 'mock-server.cjs'))
const { chromium } = require(path.resolve('node_modules/playwright'))

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

// ── In the page: one look at what is on screen now ─────────────────────────────────────────────────────────────────
function inspect() {
  const issues = []
  const dialogs = [...document.querySelectorAll('[role=dialog]')]
  const dlg = dialogs[dialogs.length - 1]
  if (!dlg) return ['NO DIALOG']
  const lists = [...document.querySelectorAll('[role=listbox]')]
  const roots = [dlg, ...lists]
  const W = document.documentElement.clientWidth, H = window.innerHeight
  const name = el => {
    const t = (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40)
    const src = el.closest('[data-src]')?.getAttribute('data-src')?.split('#').pop() ?? ''
    return `<${el.tagName.toLowerCase()}${src ? ` @${src}` : ''}> "${t}"`
  }
  const shown = el => {
    if (!el.checkVisibility({ visibilityProperty: true, opacityProperty: true })) return false
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) return false
    const cs = getComputedStyle(el)
    return !(cs.position === 'absolute' && cs.clip !== 'auto') && !el.closest('.sr-only')
  }
  const cut = el => {
    for (let a = el; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a)
      if (cs.textOverflow === 'ellipsis' || cs.webkitLineClamp !== 'none') return true
    }
    return false
  }
  // The scroll area the sheet's rows sit in: what is outside it now is checked at another scroll step.
  const scroller = [...dlg.querySelectorAll('*')].find(e => /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 4 && e.clientHeight > 200)
  const view = scroller ? scroller.getBoundingClientRect() : dlg.getBoundingClientRect()
  const inView = r => r.top >= Math.max(0, view.top) - 0.5 && r.bottom <= Math.min(H, view.bottom) + 0.5
  const textRect = el => {
    const rg = document.createRange()
    let box = null
    for (const n of el.childNodes) {
      if (n.nodeType !== 3 || !n.textContent.trim()) continue
      rg.selectNodeContents(n)
      const r = rg.getBoundingClientRect()
      box = box ? { left: Math.min(box.left, r.left), right: Math.max(box.right, r.right), top: Math.min(box.top, r.top), bottom: Math.max(box.bottom, r.bottom) } : { left: r.left, right: r.right, top: r.top, bottom: r.bottom }
    }
    return box
  }
  // An icon's own drawing (its paths) is one box: the <svg> is checked, never its parts.
  const all = roots.flatMap(r => [r, ...r.querySelectorAll('*')]).filter(e => !e.closest('svg') || e.tagName === 'svg').filter(shown)
  const field = e => /^(INPUT|TEXTAREA|SELECT)$/.test(e.tagName)

  for (const el of all) {
    const r = el.getBoundingClientRect()
    const inList = !!el.closest('[role=listbox]')
    if (!inList && !inView(r)) continue
    // CUT: own text past its own box, or past a clipping ancestor (a scroller's edge: half in view).
    const t = field(el) ? null : textRect(el)
    if (t && !cut(el)) {
      const cs = getComputedStyle(el)
      if (cs.display !== 'inline' && (t.right > r.right + 1 || t.left < r.left - 1)) issues.push(`CUT ${name(el)} runs out of its box by ${Math.round(Math.max(t.right - r.right, r.left - t.left))}px`)
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const acs = getComputedStyle(a)
        if (acs.overflowX === 'visible' && acs.overflowY === 'visible') continue
        const ar = a.getBoundingClientRect()
        const inside = t.left >= ar.left - 1 && t.right <= ar.right + 1
        const outside = t.right <= ar.left || t.left >= ar.right
        if (!inside && !outside) issues.push(`CUT ${name(el)} cut by its ${/(auto|scroll)/.test(acs.overflowX) ? 'scroller' : 'box'}'s edge`)
        break
      }
    }
    // HOLDER: a placeholder wider than its field.
    if ((el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && el.placeholder && !el.value) {
      const cs = getComputedStyle(el)
      const ctx = (window.__auditCanvas ??= document.createElement('canvas')).getContext('2d')
      ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
      const room = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
      const need = ctx.measureText(el.placeholder).width
      if (el.tagName === 'INPUT' && need > room + 0.5) issues.push(`HOLDER ${name(el)} needs ${Math.ceil(need)}px, has ${Math.floor(room)}px`)
    }
    // OUTSIDE: past the screen's sides (not inside a sideways scroller), or a list over its top or bottom.
    const inStrip = (() => { for (let a = el.parentElement; a; a = a.parentElement) { if (/(auto|scroll)/.test(getComputedStyle(a).overflowX) && a.scrollWidth > a.clientWidth) return true } return false })()
    if (!inStrip && (r.left < -0.5 || r.right > W + 0.5)) issues.push(`OUTSIDE ${name(el)} at ${Math.round(r.left)}–${Math.round(r.right)} of ${W}`)
    if (el.getAttribute('role') === 'listbox' && (r.top < -0.5 || r.bottom > H + 0.5)) issues.push(`OUTSIDE list ${name(el)} at ${Math.round(r.top)}–${Math.round(r.bottom)} of ${H}`)
    // OVERLAP: two in-flow children of one box on top of each other.
    const kids = el.tagName === 'svg' ? [] : [...el.children].filter(k => shown(k) && !['absolute', 'fixed'].includes(getComputedStyle(k).position))
    for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
      const a = kids[i].getBoundingClientRect(), b = kids[j].getBoundingClientRect()
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
      if (w > 1.5 && h > 1.5) issues.push(`OVERLAP ${name(kids[i])} × ${name(kids[j])} (${Math.round(w)}×${Math.round(h)}px)`)
    }
    // COVERED: a mark, an icon, a control or a line of text with another box over part of it.
    // The marks' banner peeks from behind its card by design (owner, 24.11.2026: "So not fully fully visible").
    const small = el.matches('button, input, textarea, select, img, svg, [role=img], [role=switch]') || (t && el.children.length === 0)
    if (small && !inList && !el.closest('[data-mark-banner]') && r.width >= 4 && r.height >= 4 && !el.closest('[role=slider]')) {
      const pts = [[r.left + 2, r.top + 2], [r.right - 2, r.top + 2], [r.left + 2, r.bottom - 2], [r.right - 2, r.bottom - 2], [(r.left + r.right) / 2, (r.top + r.bottom) / 2]]
      const hid = pts.filter(([x, y]) => {
        if (x < 0 || y < 0 || x >= W || y >= H) return false
        const top = document.elementFromPoint(x, y)
        if (!top || el.contains(top) || top.contains(el)) return false
        // A list opened over the screen covers it on purpose; the bubble a mark opens too.
        if (top.closest('[role=listbox], [role=status], [role=menu]')) return false
        // A native select lying invisible over its chip (ChipSelect) hides nothing.
        if (getComputedStyle(top).opacity === '0') return false
        return true
      })
      if (hid.length) issues.push(`COVERED ${name(el)} under ${name(document.elementFromPoint(...hid[0]))}`)
    }
  }
  if (document.documentElement.scrollWidth > W + 0.5) issues.push(`OUTSIDE the page scrolls sideways (${document.documentElement.scrollWidth} > ${W})`)
  return issues
}

// Every wheel open now: the row in the band is the value, and it is the bold one.
function wheels() {
  const issues = []
  const pad = n => String(n).padStart(2, '0')
  for (const col of document.querySelectorAll('[role=spinbutton]')) {
    const c = col.getBoundingClientRect()
    const mid = (c.top + c.bottom) / 2
    const rows = [...col.querySelectorAll('[data-i]')]
    const near = rows.reduce((best, r) => { const b = r.getBoundingClientRect(); const d = Math.abs((b.top + b.bottom) / 2 - mid); return d < best.d ? { r, d } : best }, { r: null, d: Infinity })
    const band = col.parentElement.querySelector(':scope > span[aria-hidden].absolute')?.getBoundingClientRect()
    const bold = rows.find(r => Number(getComputedStyle(r).fontWeight) >= 500)
    const want = pad(Number(col.getAttribute('aria-valuenow')))
    const label = col.getAttribute('aria-label')
    if (!near.r || near.r.textContent !== want) issues.push(`WHEEL ${label}: the middle row is ${near.r?.textContent}, the value ${want}`)
    if (near.d > 1.5) issues.push(`WHEEL ${label}: the row sits ${Math.round(near.d)}px off the middle`)
    if (band && Math.abs((band.top + band.bottom) / 2 - mid) > 1.5) issues.push(`WHEEL ${label}: the band is ${Math.round((band.top + band.bottom) / 2 - mid)}px off the middle`)
    if (bold !== near.r) issues.push(`WHEEL ${label}: bold ${bold?.textContent}, in the band ${near.r?.textContent}`)
  }
  return issues
}

/** The movie search with the keyboard up: Chromium can only shorten the window, which stands in for the visual viewport. */
async function keyboardList(page, w, h, found) {
  await openEdit(page, 'Movie night')
  const search = sheet(page).getByRole('combobox', { name: /search/ }).first()
  await search.scrollIntoViewIfNeeded()
  await search.click()
  const kb = Math.round(h * 0.4)
  await page.setViewportSize({ width: w, height: h - kb })
  await search.fill('a')
  await page.waitForTimeout(1000)
  const r = await page.evaluate(() => {
    const l = document.querySelector('[role=listbox]')?.getBoundingClientRect()
    const f = document.activeElement?.getBoundingClientRect()
    return l && f ? { top: l.top, bottom: l.bottom, field: f.bottom, H: innerHeight } : null
  })
  if (!r) found('KEYBOARD the movie search opened no list')
  else {
    if (r.top < r.field - 0.5) found(`KEYBOARD the movie search's list opened above its field (${Math.round(r.top)}–${Math.round(r.bottom)}, field ends at ${Math.round(r.field)})`)
    if (r.bottom > r.H + 0.5 || r.top < -0.5) found(`KEYBOARD the movie search's list runs outside the screen (${Math.round(r.top)}–${Math.round(r.bottom)} of ${r.H})`)
  }
  for (const x of await page.evaluate(inspect)) found(`keyboard search: ${x}`)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${w}x${h}-keyboard-search.png` })
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: w, height: h })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
}

// ── Driving the screen ─────────────────────────────────────────────────────────────────────────────────────────────
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const LONG_TITLE = 'Dinner with Kari and Ola Nordmann at the new place by Jernbanetorget before the late film'
const LONG_NOTES = 'Bring the tickets.\nAsk about the parking.\n' + 'A long line of notes that runs on and on without a break to see whether it wraps inside its box '.repeat(3)

async function newContext(browser, w, h, phone, scale) {
  const context = await browser.newContext({
    viewport: { width: w, height: h }, deviceScaleFactor: phone ? 3 : 1, isMobile: phone, hasTouch: phone, userAgent: phone ? UA : undefined,
    timezoneId: 'Europe/Oslo', locale: 'en-GB', serviceWorkers: 'block',
  })
  await installMocks(context)
  await context.addInitScript(s => localStorage.setItem('sb-mock-auth-token', JSON.stringify(s)), SESSION)
  // The app's Display scale (Settings; index.html sets the root font size from it before the first paint).
  await context.addInitScript(sc => localStorage.setItem('theme-preference', JSON.stringify({ state: { theme: 'light', accent: 'blue', scale: sc }, version: 1 })), scale)
  // A phone's text fields are 16px (index.css, pointer: coarse — which Chromium's touch emulation doesn't report).
  if (phone) await context.addInitScript(() => document.addEventListener('DOMContentLoaded', () => {
    const st = document.createElement('style')
    st.textContent = "input:not([type='checkbox']):not([type='radio']):not([type='range']):not([type='color']):not([type='file']), select, textarea { font-size: 16px !important; }"
    document.head.appendChild(st)
  }))
  return context
}

async function openDaily(page) {
  await page.goto(`${BASE}/#/daily`)
  await page.locator('[role=button]', { hasText: 'Movie night' }).first().waitFor({ timeout: 30000 })
  await page.waitForTimeout(600)
}
async function openEdit(page, title) {
  await openDaily(page)
  await page.locator('[role=button]', { hasText: title }).first().click()
  await page.getByText('Edit Item').first().waitFor()
  await page.waitForTimeout(900)
}
async function openNew(page) {
  await openDaily(page)
  await page.getByRole('button', { name: 'Add', exact: true }).first().click()
  await page.getByText('New Item').first().waitFor()
  await page.waitForTimeout(900)
}
const sheet = page => page.getByRole('dialog').last()

/** Scrolls the screen top to bottom, looking at each step. */
async function sweep(page, label, found, shots) {
  const steps = await page.evaluate(() => {
    const dlg = [...document.querySelectorAll('[role=dialog]')].pop()
    const s = [...dlg.querySelectorAll('*')].find(e => /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 4 && e.clientHeight > 200)
    if (!s) return 1
    s.scrollTop = 0
    return Math.max(1, Math.ceil((s.scrollHeight - s.clientHeight) / (s.clientHeight * 0.6)) + 1)
  })
  for (let i = 0; i < steps; i++) {
    await page.waitForTimeout(150)
    for (const x of await page.evaluate(inspect)) found(`${label}: ${x}`)
    if (shots) await page.screenshot({ path: `${shots}-${i}.png` })
    await page.evaluate(() => {
      const dlg = [...document.querySelectorAll('[role=dialog]')].pop()
      const s = [...dlg.querySelectorAll('*')].find(e => /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 4 && e.clientHeight > 200)
      if (s) s.scrollTop += s.clientHeight * 0.6
    })
  }
}

async function tap(page, locator) {
  await locator.scrollIntoViewIfNeeded()
  await locator.click()
  await page.waitForTimeout(350)
}
async function pickCategory(page, label) {
  await tap(page, sheet(page).getByRole('button', { name: /^Category/ }).first())
  await tap(page, sheet(page).getByRole('menuitemradio', { name: label, exact: true }).first())
}

async function run() {
  const browser = await chromium.launch({ executablePath: chromePath(), args: ['--no-sandbox'] })
  const all = new Map()
  const runs = SIZES.flatMap(([w, h]) => (Math.min(w, h) <= 500 ? SCALES : [100]).map(scale => [w, h, scale]))
  for (const [w, h, scale] of runs) {
    const phone = w <= 900 && Math.min(w, h) <= 500
    const tag = `${w}x${h}${scale === 100 ? '' : `@${scale}%`}`
    const found = x => { const k = x.replace(/^[^:]*: /, ''); if (!all.has(`${tag} ${x}`)) all.set(`${tag} ${x}`, k) }
    const shot = SHOTS ? n => `${SHOTS}/${tag}-${n}` : () => null
    const context = await newContext(browser, w, h, phone, scale)
    const page = await context.newPage()
    page.on('pageerror', e => found(`page error: ${String(e).slice(0, 160)}`))

    if (ONLY.includes('edit')) {
      await openEdit(page, 'Movie night')
      await sweep(page, 'edit movie', found, shot('edit-movie'))
      for (const type of ['TV', 'Cinema', 'Movie']) {
        await tap(page, sheet(page).getByRole('tab').filter({ hasText: new RegExp(`^${type}$`) }).first())
        await sweep(page, `edit type ${type}`, found, type === 'Cinema' ? shot('edit-cinema') : null)
      }
      // With: names and its field; the searches open.
      const withField = sheet(page).getByRole('combobox', { name: /^With/ })
      await tap(page, withField)
      await withField.fill('Kari Nordmann'); await page.keyboard.press('Enter')
      await withField.fill('Ola'); await page.keyboard.press('Enter')
      await page.keyboard.press('Escape')
      await sweep(page, 'edit with names', found, shot('edit-with'))
      const search = sheet(page).getByRole('combobox', { name: /search/ }).first()
      await tap(page, search)
      await search.fill('a')
      await page.waitForTimeout(900)
      for (const x of await page.evaluate(inspect)) found(`edit movie search: ${x}`)
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/${tag}-search.png` })
      await page.keyboard.press('Escape')
      await page.keyboard.press('Escape')
      await page.waitForTimeout(300)
      if (phone && h > w) await keyboardList(page, w, h, found)
      // Repeat on, then all-day.
      await openEdit(page, 'Coffee with Kari')
      await sweep(page, 'edit place', found, shot('edit-place'))
      await tap(page, sheet(page).getByRole('switch', { name: 'All-day' }))
      await sweep(page, 'edit all-day', found, shot('edit-allday'))
    }

    if (ONLY.includes('wheel')) {
      for (const variant of ['plain', 'zoom 125%']) {
        await openEdit(page, 'Movie night')
        if (variant === 'zoom 125%') await page.evaluate(() => { document.documentElement.style.zoom = '1.25' })
        for (const [pill, time] of [[/^Starts at/, null], [/^Ends at/, null]]) {
          await tap(page, sheet(page).getByRole('button', { name: pill }))
          await page.waitForTimeout(500)
          for (const x of await page.evaluate(wheels)) found(`wheel ${variant}: ${x}`)
          // Turn it with the keys: the band follows.
          const col = sheet(page).getByRole('spinbutton').first()
          await col.focus(); await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp')
          await page.waitForTimeout(700)
          for (const x of await page.evaluate(wheels)) found(`wheel ${variant} after keys: ${x}`)
          if (SHOTS && variant !== 'plain') await page.screenshot({ path: `${SHOTS}/${tag}-wheel-${variant.replace(/\W+/g, '')}.png` })
          await tap(page, sheet(page).getByRole('button', { name: pill }))
          void time
        }
        await page.evaluate(() => { document.documentElement.style.zoom = '' })
      }
    }

    if (ONLY.includes('new')) {
      for (const cat of ['Daily', 'Training', 'Media', 'Games', 'Work', 'Projects', 'Football', 'Other']) {
        await openNew(page)
        if (cat !== 'Daily') await pickCategory(page, cat)
        await sweep(page, `new ${cat}`, found, cat === 'Games' || cat === 'Daily' ? shot(`new-${cat.toLowerCase()}`) : null)
        await page.keyboard.press('Escape'); await page.waitForTimeout(400)
      }
      // A long title and notes, a repeat, all-day, then no date.
      await openNew(page)
      await sheet(page).getByRole('textbox', { name: 'Title' }).fill(LONG_TITLE)
      const notes = sheet(page).getByRole('textbox', { name: 'Notes' })
      await notes.scrollIntoViewIfNeeded(); await notes.fill(LONG_NOTES)
      await sweep(page, 'new long', found, shot('new-long'))
      await tap(page, sheet(page).getByRole('button', { name: /^Repeat/ }).first())
      await sheet(page).getByRole('combobox', { name: 'Repeat' }).selectOption('weekly')
      await page.waitForTimeout(400)
      await sweep(page, 'new repeat', found, shot('new-repeat'))
      await sheet(page).getByRole('combobox', { name: 'Repeat' }).selectOption('none')
      await tap(page, sheet(page).getByRole('switch', { name: 'All-day' }))
      await sweep(page, 'new all-day', found, null)
      await tap(page, sheet(page).getByRole('switch', { name: 'Date' }))
      await sweep(page, 'new no date', found, shot('new-nodate'))
      await page.keyboard.press('Escape')
    }
    await context.close()
  }
  await browser.close()
  const lines = [...all.keys()]
  console.log(lines.length ? lines.join('\n') : 'The item screen: nothing clipped, overlapping, covered, cut or outside.')
  console.log(`\n${lines.length} finding(s) at ${SIZES.map(s => s.join('x')).join(', ')} (phones at ${SCALES.join(' / ')} %)`)
  process.exit(lines.length ? 1 : 0)
}

run().catch(e => { console.error(e); process.exit(2) })
