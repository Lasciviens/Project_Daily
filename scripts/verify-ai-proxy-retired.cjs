#!/usr/bin/env node
/*
 * Verification — ai-proxy is retired (AI phase 5, 23.11.2026). deploy.yml never prunes, so the folder stays as a stub
 * the next deploy puts over the last Gemini version. The stub must be harmless: no import, no secret, no database, no
 * outside call, always 410; it must not be in config.toml (platform JWT verification stays on); and nothing in the app,
 * the other functions or the deploy calls it or names a Gemini key.
 *
 *   Run:  node scripts/verify-ai-proxy-retired.cjs
 */
const fs = require('fs')
const path = require('path')
const sucrase = require('sucrase')
const REPO = path.join(__dirname, '..')
let ok = 0, bad = 0
const check = (n, c, d) => { if (c) { ok++; console.log('  ✓', n) } else { bad++; console.log('  ✗', n, d ?? '') } }
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const walk = (d, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, out) } else out.push(p) } return out }

;(async () => {
  const dir = path.join(REPO, 'supabase/functions/ai-proxy')
  const files = fs.readdirSync(dir)
  check('the folder holds only the stub (index.ts)', files.join() === 'index.ts', files.join())
  const src = fs.readFileSync(path.join(dir, 'index.ts'), 'utf8')
  const code = strip(src)
  check('no import, no Deno.env, no fetch, no createClient, no key name', !/\bimport\b|Deno\.env|\bfetch\s*\(|createClient|API_KEY|SECRET|SERVICE_ROLE|\bsupabase\b/i.test(code), code)
  check('the stub is short (under 30 lines): nothing else can hide in it', src.split('\n').length < 30)
  let handler
  new Function('Deno', sucrase.transform(src, { transforms: ['typescript'] }).code)({ serve: (f) => { handler = f } })
  for (const method of ['GET', 'POST', 'OPTIONS', 'DELETE']) {
    const res = await handler(new Request('http://x/', { method, headers: { authorization: 'Bearer anything' }, body: method === 'POST' ? '{"messages":[]}' : undefined }))
    const text = await res.text()
    check(`${method} answers 410 with only the one fixed sentence`, res.status === 410 && JSON.parse(text).error === 'ai-proxy was removed. Ask AI runs on the claude function.', text)
  }
  check('supabase/config.toml no longer lists ai-proxy (JWT verification on)', !/functions\.ai-proxy/.test(fs.readFileSync(path.join(REPO, 'supabase/config.toml'), 'utf8')))
  const roots = ['src', 'supabase/functions', 'supabase/claude-src', '.github'].map(r => path.join(REPO, r))
  const callers = roots.flatMap(r => walk(r))
    .filter(f => !f.includes(`${path.sep}ai-proxy${path.sep}`) && /\.(ts|tsx|yml)$/.test(f))
    .filter(f => /invoke\(\s*['"`]ai-proxy|functions\/v1\/ai-proxy|['"`]ai-proxy['"`]/.test(fs.readFileSync(f, 'utf8')))
  check('nothing calls or lists ai-proxy by name (app, functions, workflows)', callers.length === 0, callers.join(', '))
  const gem = [path.join(REPO, 'src'), path.join(REPO, 'supabase'), path.join(REPO, '.github')].flatMap(r => walk(r))
    .filter(f => /\.(ts|tsx|yml|toml)$/.test(f))
    .filter(f => /GEMINI_API_KEY|generativelanguage\.googleapis/.test(fs.readFileSync(f, 'utf8')))
  check('no code names GEMINI_API_KEY or calls Google\'s generative API', gem.length === 0, gem.join(', '))
  console.log(`\n${ok} passed, ${bad} failed`)
  process.exit(bad ? 1 : 0)
})()
