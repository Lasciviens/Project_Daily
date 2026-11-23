// RETIRED (AI rebuild, phase 5, 23.11.2026). This function used to be the Gemini assistant; Ask AI, the coach chat and
// the phone's question all run on the `claude` function now, and nothing calls this one.
//
// Why the file is still here: deploy.yml deploys the functions in this folder and never uses --prune, so deleting the
// folder would leave the last deployed ai-proxy (the Gemini code, with its key) live on Supabase. This stub is what
// the next deploy puts in its place: it answers every request with 410 and does nothing else — no import, no secret,
// no database, no outside call (verify-ai-proxy-retired checks that). The owner deletes the function in the Supabase
// dashboard and then the stub folder can go (docs/deploy-checklist.md).
//
// Not listed in supabase/config.toml on purpose: platform JWT verification stays ON, so a call with no valid token is
// refused by the platform before this code runs.
Deno.serve(() => new Response(JSON.stringify({ error: 'ai-proxy was removed. Ask AI runs on the claude function.' }), {
  status: 410,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
}))
