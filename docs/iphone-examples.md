# iPhone examples — ready-to-test recipes

> Companion to `iphone-web-integration.md`. Four concrete examples you can build
> and test TODAY, with zero backend deploy. Everything you need is here: apps to
> install, values to paste, and the exact Shortcut/Scriptable steps.
> (Spoken walkthrough happens in chat, in Turkish — this file is the reference.)

## What the phone actually talks to
Not the website — the **Supabase HTTPS API** (the same API the web app uses). A
Shortcut is just another HTTP client that carries the same auth token. Two targets:
- **Direct DB** (`/rest/v1/…`) — deterministic, instant, no AI, free. (Examples 1, 4)
- **AI** (`/functions/v1/ai-proxy`) — natural language, flexible, costs a Gemini call. (Examples 2, 3)

---

## 0 · One-time setup (needed by all examples)

**Devices / apps**
- iPhone on **iOS 16.4+** (17+ ideal). Build the shortcuts on your **Mac's Shortcuts app** — same Apple ID → they sync to the iPhone over iCloud automatically (bigger screen than building on the phone).
- Example 4 only: install the free **Scriptable** app (App Store, no account).
- Example 1 only: one cheap **NFC sticker** (NTAG213, ~a few TL).

**Base values** (client-safe — already public in the deployed web bundle)
- `BASE` = `https://hsaedwwqpcjizeozjbch.supabase.co`
- `ANON_KEY` =
  `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhzYWVkd3dxcGNqaXplb3pqYmNoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1NjYyMTQsImV4cCI6MjA5NjE0MjIxNH0.Is-ZgzL1YPwCqeTZ8zi1jEvOYv3Hw_1X0LntlvkjOA8`

**Your access token (JWT)** — a temporary login key (spike credential)
1. On a desktop browser, open the app **logged in**.
2. `F12` → **Application** → **Local Storage** → the site → key
   `sb-hsaedwwqpcjizeozjbch-auth-token` → copy the `access_token` string inside.
3. Paste it wherever a step says `<YOUR_JWT>`.
- ⚠️ **It expires** (~1 hour, up to the dashboard max). Grab a fresh one right
  before a test session. To stop re-pasting it, do **Appendix A** (a one-time
  deploy that swaps the JWT for a never-expiring, revocable device secret).
- 🚫 The **service-role key** is NEVER placed on the phone. `ANON_KEY` + your JWT
  (or the Appendix-A device secret) is all a phone ever uses. RLS scopes every
  call to you — a leaked shortcut exposes only your own data, and is revocable.

**Auth headers used by every HTTP call**
```
apikey: <ANON_KEY>
Authorization: Bearer <YOUR_JWT>
```

---

## Example 1 · NFC sticker → log a supplement  (direct DB, no AI, instant)

**Does:** tap a sticker on your creatine jar → a row lands in `food_log_entries`
(supplement slot, today) → a confirmation banner. No app/site opens, no AI.
**Install:** nothing (Shortcuts is built in). **Buy:** 1 NFC sticker.

**Build the Shortcut — name it `Log Creatine`:**
1. **Format Date** — Date: `Current Date`, Format: Custom, `yyyy-MM-dd`. (→ "Today")
2. **Get Contents of URL**
   - URL: `https://hsaedwwqpcjizeozjbch.supabase.co/rest/v1/food_log_entries`
   - Method: **POST**
   - Headers: `apikey` = `<ANON_KEY>` · `Authorization` = `Bearer <YOUR_JWT>` · `Content-Type` = `application/json` · `Prefer` = `return=minimal`
   - Request Body: **JSON**
     - `date` (Text) = the *Formatted Date* variable from step 1
     - `meal_slot` (Text) = `supplement`
     - `custom_title` (Text) = `Kreatin 5 g`
     - `calories` (Number) = `0`
     - `status` (Text) = `eaten`
   - *(Do NOT add `user_id` — the DB fills it from your token automatically.)*
3. **Show Notification** — text: `Kreatin loglandı ✓`

**Attach it to the sticker (on the iPhone):**
Shortcuts → **Automation** → **＋** → **NFC** → **Scan** (hold the sticker to the
top of the phone) → give it a name → **Next** → add **Run Shortcut → Log Creatine**
→ turn **OFF "Ask Before Running"** (so it runs on tap). Stick it on the jar.

**Test:** tap the jar → open the app's Food → Today: a `Kreatin 5 g` row under
"supplement". **Your to-do:** buy sticker · paste ANON+JWT · build shortcut (Mac)
· set the NFC automation (iPhone).

---

## Example 2 · "Hey Siri, AI'a sor"  (voice → AI → spoken answer + saved to a Note)

**Does:** you speak a question; it goes to `ai-proxy`; the AI answers (it can read
your data / add tasks / log food etc.); Siri speaks the reply and it's appended
to a "AI Answers" note. Two-way, hands-free. **Install:** nothing.

**Build the Shortcut — name it `AI'a Sor`:**
1. **Dictate Text** (Language: Turkish). → variable *Dictated Text*
2. **Get Contents of URL**
   - URL: `https://hsaedwwqpcjizeozjbch.supabase.co/functions/v1/ai-proxy`
   - Method: **POST**
   - Headers: `apikey` = `<ANON_KEY>` · `Authorization` = `Bearer <YOUR_JWT>` · `Content-Type` = `application/json`
   - Request Body: **JSON**
     - key `messages` → type **Array** → one item of type **Dictionary** with:
       - `role` (Text) = `user`
       - `content` (Text) = the *Dictated Text* variable
3. **Get Dictionary Value** — Get **Value** for **Key** `text` in *Contents of URL*.
4. **Speak Text** — the Dictionary Value.
5. *(optional)* **Append to Note** — Note: `AI Answers`, text: the Dictionary Value.

**Use it:** "Hey Siri, AI'a Sor" → speak → it answers aloud. (Assign it to the
**Action Button** on iPhone 15 Pro+ for a one-press version.)
**Note:** long AI answers with many tool steps can be slow — keep voice prompts short.

---

## Example 3 · 07:00 Daily Brief  (time automation → notification + Note)

**Does:** every morning at 07:00 a Shortcut asks `ai-proxy` for a short brief
(today's tasks + schedule + planned workout) and shows it as a notification (and
saves it to a note). **Install:** nothing.

**Build the Shortcut — name it `Sabah Brief`:**
1. **Get Contents of URL**
   - URL: `…/functions/v1/ai-proxy` · Method POST · same 3 headers as Example 2
   - Request Body: **JSON** → `messages` Array → Dictionary { `role`=`user`,
     `content`=`Bana bugünün kısa sabah brief'ini ver: bugünkü görevler, program ve planlı antrenman. Kısa, madde madde.` }
2. **Get Dictionary Value** — key `text`.
3. **Show Notification** — the value. *(optional)* **Append to Note** → `Daily Brief`.

**Schedule it (iPhone):** Shortcuts → **Automation** → **＋** → **Time of Day** →
`07:00`, Daily → **Next** → **Run Shortcut → Sabah Brief** → **Run Immediately**.
**Note:** iOS shows a small "ran" banner for auto-run automations — here that's
exactly what you want. Same recipe works for **sleep**: change the prompt to
`Dün gece nasıl uyudum? Süre, kalite ve dünkü ortalamaya göre kısa yorum.` (the AI
reads your synced `health_metrics`; last night must have synced by 07:00).

---

## Example 4 · Live Nutrition widget  (Scriptable — free app)

**Does:** a home-screen widget showing today's eaten kcal + protein, refreshed on
iOS's widget budget (~every 15–60 min; not real-time). **Install:** Scriptable (free).

**Steps:** open Scriptable → **＋** (new script) → paste the code below → tap ▶ to
test → long-press the Home Screen → **＋** → **Scriptable** → add the Small widget →
long-press it → **Edit Widget** → Script = this script.

```javascript
// Lasci's Board — Nutrition (Scriptable). Small widget.
const BASE = "https://hsaedwwqpcjizeozjbch.supabase.co";
const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhzYWVkd3dxcGNqaXplb3pqYmNoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1NjYyMTQsImV4cCI6MjA5NjE0MjIxNH0.Is-ZgzL1YPwCqeTZ8zi1jEvOYv3Hw_1X0LntlvkjOA8";
const JWT  = "PASTE_YOUR_ACCESS_TOKEN";   // spike; expires ~1h. See Appendix A for a durable secret.
const GOAL_KCAL = 2100, GOAL_PROT = 150;  // edit to your targets

const today = new Date().toISOString().slice(0, 10);
const url = `${BASE}/rest/v1/food_log_entries?date=eq.${today}&status=eq.eaten&select=calories,protein_g`;
const req = new Request(url);
req.headers = { apikey: ANON, Authorization: `Bearer ${JWT}` };
let rows = [];
try { rows = await req.loadJSON(); } catch (e) { rows = []; }
const kcal = Math.round(rows.reduce((a, r) => a + (+r.calories || 0), 0));
const prot = Math.round(rows.reduce((a, r) => a + (+r.protein_g || 0), 0));

const dark = Device.isUsingDarkAppearance();
const w = new ListWidget();
w.backgroundColor = new Color(dark ? "#221D18" : "#FBF8F2");
const ink = new Color(dark ? "#F1EBE2" : "#2A2622");
const mut = new Color(dark ? "#B4A99B" : "#6B635A");
const acc = new Color(dark ? "#E28A4F" : "#C0622B");
let t = w.addText("🍽️ Bugün"); t.font = Font.mediumSystemFont(11); t.textColor = mut;
w.addSpacer(4);
let k = w.addText(`${kcal} / ${GOAL_KCAL}`); k.font = Font.boldSystemFont(22); k.textColor = ink;
let ku = w.addText("kcal"); ku.font = Font.systemFont(10); ku.textColor = mut;
w.addSpacer(4);
let p = w.addText(`protein ${prot} / ${GOAL_PROT} g`); p.font = Font.mediumSystemFont(13); p.textColor = acc;
w.addSpacer(2);
let left = w.addText(`${Math.max(0, GOAL_KCAL - kcal)} kcal kaldı`); left.font = Font.systemFont(11); left.textColor = mut;
Script.setWidget(w);
if (config.runsInApp) w.presentSmall();
Script.complete();
```
**Heads-up:** the inline `JWT` expires (~1h) → the widget stops updating after
that. For a widget that keeps working, use the **Appendix A** device secret (put
it in `JWT`'s place and point the URL at the gateway), or store a durable token
in Scriptable's `Keychain`.

---

## Appendix A · Make it durable — the device-secret gateway  *(Phase 2, one deploy)*

The JWT hassle disappears with a thin Edge Function that authenticates by a
**static, random, revocable secret** and acts as you **server-side** via the
service role (never on the device) — exactly the repo's `hevy-sync` pattern.
Then every shortcut sends `x-phone-secret: <secret>` (never expires) and can use a
**flat** body (no nested JSON). Deploy when the spike proves the idea.

Skeleton (`supabase/functions/phone-gateway/index.ts`, `verify_jwt = off`):
```ts
// Auth: header x-phone-secret === Deno.env.get('PHONE_GATEWAY_SECRET').
// Acts as the single user (HEVY_USER_ID) via SUPABASE_SERVICE_ROLE_KEY, SERVER-SIDE.
// Routes a flat body: { action: 'log_supplement'|'brief'|'ask'|..., ... } to
//   deterministic DB ops OR a passthrough to ai-proxy — so shortcuts stay simple.
// Same CORS/verify_jwt=off deploy note as hevy-sync/health-export-webhook.
```
Deploy steps (yours): add `PHONE_GATEWAY_SECRET` (a long random string) to Supabase
Vault → deploy the function with **Enforce JWT Verification OFF** → swap the
shortcuts' `Authorization: Bearer <JWT>` for `x-phone-secret: <secret>` and point
them at `/functions/v1/phone-gateway`. (I'll write the full function when you pick
this — it's flagged here so the plan is complete.)

---

## Test checklist
- [ ] Grabbed a fresh `<YOUR_JWT>` from the browser (all examples).
- [ ] Ex 1: NFC automation runs → row appears in Food/Today.
- [ ] Ex 2: "Hey Siri, AI'a Sor" speaks a real answer.
- [ ] Ex 3: 07:00 automation shows the brief banner (test now via "Run" in the automation).
- [ ] Ex 4: Scriptable widget shows today's kcal/protein on the Home Screen.
- [ ] Web Push (separate spike) verified on the real iPhone (EEA/Norway).
