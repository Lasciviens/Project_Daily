#!/usr/bin/env node
/*
 * Verification — ai-proxy (the Gemini assistant) is gone (AI phase 5, 23.11.2026). The deploy never prunes, so a step
 * in deploy.yml deletes the deployed function. This checks: the folder is absent (a folder would be re-deployed by the
 * next merge), it is not in config.toml, the deploy step exists, is safe to re-run and fails loudly, nothing calls it,
 * and no code names a Gemini key or Google's generative API.
 *
 *   Run:  node scripts/verify-ai-proxy-retired.cjs
 */
const fs = require('fs')
const path = require('path')
const REPO = path.join(__dirname, '..')
let ok = 0, bad = 0
const check = (n, c, d) => { if (c) { ok++; console.log('  ✓', n) } else { bad++; console.log('  ✗', n, d ?? '') } }
const walk = (d, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, out) } else out.push(p) } return out }
const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8')

check('supabase/functions/ai-proxy does not exist (a folder would be deployed again by the next merge)', !fs.existsSync(path.join(REPO, 'supabase/functions/ai-proxy')))
check('supabase/config.toml does not list ai-proxy', !/functions\.ai-proxy/.test(read('supabase/config.toml')))

const deploy = read('.github/workflows/deploy.yml')
const step = deploy.slice(deploy.indexOf('- name: Delete the retired ai-proxy function'))
const fnDeploy = deploy.indexOf('- name: Edge functions')
check('deploy.yml deletes the deployed ai-proxy after the functions deploy', fnDeploy > 0 && deploy.indexOf('- name: Delete the retired ai-proxy function') > fnDeploy)
check('the step uses the project ref and the access token, like the other steps', /supabase functions delete ai-proxy --project-ref "\$SUPABASE_PROJECT_REF" --yes/.test(step) && /SUPABASE_ACCESS_TOKEN/.test(step.slice(0, 2000)))
check('the step fails loudly (set -e, pipefail) and lists first, so "already gone" is success, never a swallowed error', /set -euo pipefail/.test(step) && /supabase functions list --project-ref/.test(step) && !/\|\|\s*true/.test(step.slice(0, step.indexOf('SUPABASE_ACCESS_TOKEN'))))
check('the step is skipped on a dry run like the deploy above it', /env\.DRY_RUN != 'true'/.test(step.slice(0, 300)))
check('the deploy still never prunes', !/--prune/.test(deploy.replace(/#.*$/gm, '')))

const roots = ['src', 'supabase', '.github', 'scripts/deploy'].map(r => path.join(REPO, r))
const code = roots.flatMap(r => walk(r)).filter(f => /\.(ts|tsx|yml|toml|mjs|cjs)$/.test(f) && !f.includes(`${path.sep}migrations${path.sep}`))
const callers = code.filter(f => /invoke\(\s*['"`]ai-proxy|functions\/v1\/ai-proxy|edgeFunctions:[^\n]*ai-proxy/.test(fs.readFileSync(f, 'utf8')))
check('nothing calls or lists ai-proxy (app, functions, registry)', callers.length === 0, callers.join(', '))
const gem = code.filter(f => !f.endsWith('deploy.yml')).filter(f => /GEMINI_API_KEY|generativelanguage\.googleapis/.test(fs.readFileSync(f, 'utf8')))
check('no code names GEMINI_API_KEY or calls Google\'s generative API', gem.length === 0, gem.join(', '))
console.log(`\n${ok} passed, ${bad} failed`)
process.exit(bad ? 1 : 0)
