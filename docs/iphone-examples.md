# iPhone examples — permanent setup (device-secret gateway)

> Companion to `iphone-web-integration.md`. The DURABLE setup: the iPhone talks
> to ONE endpoint (`phone-gateway`) with ONE static, revocable secret
> (`x-phone-secret`) — never-expiring, no JWT to refresh, flat `{action}` bodies
> so the Shortcuts stay simple. Build the shortcuts once on your Mac → they sync
> to the iPhone over iCloud. (Spoken walkthrough happens in chat, in Turkish.)
>
> **See also:** `scriptable-food-logger.md` (the phone-native food logger),
> `scriptable-widgets.md` (home-screen widgets), `web-push-setup.md`
> (server→phone push) and `iphone-web-integration.md` (why this design).

## How it works (why this is safe + permanent)
- The phone hits **`phone-gateway`** (a Supabase Edge Function, `verify_jwt=off`).
- It authenticates by a header **`x-phone-secret`** you choose. The function acts
  as **you** (the single user) **server-side** via the service role. The
  service-role key NEVER touches the phone. A leaked secret is **revocable** in
  seconds (change it in Vault + in the shortcuts).
- Deterministic actions (log a supplement, read today's nutrition) run directly
  in the gateway — instant, free, no AI. AI actions (`ask`/`brief`/`sleep`) the
  gateway forwards to `ai-proxy` (which now also accepts the same secret).

---

## 0 · One-time setup

### 0a · Server (you, in Supabase — do once)
1. **Pick a secret.** On any machine: `openssl rand -hex 24` → copy the output.
   (Keep it private — do NOT commit it. It's your phone's key.)
2. **Supabase → Vault (Edge Function secrets):** add
   `PHONE_GATEWAY_SECRET` = that value. *(`HEVY_USER_ID` and the service-role key
   already exist — the gateway reuses them.)*
3. **Deploy the functions** (both are already set to `verify_jwt = false` in
   `supabase/config.toml`, so a CLI deploy applies it; on a Dashboard deploy,
   toggle **Enforce JWT Verification → OFF** for each):
   - **`phone-gateway`** (new)
   - **`ai-proxy`** (redeploy — it gained the `x-phone-secret` auth branch)
4. Done. Nothing on the phone expires after this.

### 0b · Phone values (used by every shortcut)
- `GATEWAY` = `https://hsaedwwqpcjizeozjbch.supabase.co/functions/v1/phone-gateway`
- One header on every call: **`x-phone-secret: <your secret from step 1>`**
  (+ `Content-Type: application/json`). **No JWT, no anon key needed** — the
  gateway is secret-authed.

### 0c · Build shortcuts on the Mac
Build each shortcut in the **Mac Shortcuts app** (same Apple ID) → it appears on
the iPhone automatically via iCloud. NFC/time automations are set on the iPhone.

---

## Example 1 · NFC sticker → log a supplement  (deterministic, instant, free)
**Does:** tap a sticker → a `supplement` row lands in your food diary for today.
**Buy:** one NFC sticker (NTAG213). **Install:** nothing.

**Shortcut — name `Log Creatine`:**
1. **Get Contents of URL**
   - URL: `GATEWAY`
   - Method: **POST**
   - Headers: `x-phone-secret` = `<your secret>` · `Content-Type` = `application/json`
   - Request Body: **JSON** → `action` (Text) = `log_supplement`
     *(optional: `title` = `Kreatin 5 g`, `calories` = `0`)*
2. **Show Notification** — `Get Dictionary Value` key `logged` → "… loglandı ✓"

**Attach to the sticker (iPhone):** Shortcuts → **Automation** → **＋** → **NFC** →
**Scan** the sticker → **Run Shortcut → Log Creatine** → turn **OFF "Ask Before
Running"**. Stick it on the jar.
**Test:** tap → the app's Food → Today shows the supplement row.

## Example 2 · "Hey Siri, AI'a Sor"  (voice → AI → spoken + Note)
**Shortcut — name `AI'a Sor`:**
1. **Dictate Text** (Turkish). → *Dictated Text*
2. **Get Contents of URL** — POST `GATEWAY`, header `x-phone-secret`, `Content-Type`,
   Request Body **JSON**: `action` = `ask`, `q` = *Dictated Text*.
3. **Get Dictionary Value** — key `text`.
4. **Speak Text** (the value) · *(optional)* **Append to Note** → `AI Answers`.
**Use:** "Hey Siri, AI'a Sor" (or bind to the Action Button).

## Example 3 · 07:00 Daily Brief  (automation → notification + Note)
**Shortcut — name `Sabah Brief`:**
1. **Get Contents of URL** — POST `GATEWAY`, headers as above, Request Body
   **JSON**: `action` = `brief`. *(For sleep, use a second shortcut with
   `action` = `sleep`.)*
2. **Get Dictionary Value** key `text` → **Show Notification** (+ Append to Note).
**Schedule (iPhone):** Automation → **Time of Day** `07:00` Daily → Run `Sabah
Brief` → **Run Immediately**. (iOS shows a small "ran" banner — that's the point.)

## Example 4 · Live Nutrition widget  (Scriptable — free app)
Install **Scriptable** → new script → paste → ▶ to test → add the Scriptable
Small widget to the Home Screen → Edit Widget → pick this script. Put your secret
in `SECRET`. **This never expires** (device secret, not a JWT).

This inline snippet is the minimal reference version — the maintained widget pack
(including `Makro Halkalari`, the same idea with rings + an offline cache) lives in
`scriptable-widgets.md`; keep only one copy in use to avoid divergence.

```javascript
// Lasci's Board — Nutrition (Scriptable, Small widget). Durable: device secret.
const GATEWAY = "https://hsaedwwqpcjizeozjbch.supabase.co/functions/v1/phone-gateway";
const SECRET  = "PASTE_YOUR_PHONE_GATEWAY_SECRET";
const GOAL_KCAL = 2100, GOAL_PROT = 150, GOAL_WATER_ML = 2000; // edit to your targets

const req = new Request(GATEWAY);
req.method = "POST";
req.headers = { "x-phone-secret": SECRET, "Content-Type": "application/json" };
req.body = JSON.stringify({ action: "nutrition_today" });
let d = {};
try { d = await req.loadJSON(); } catch (e) { d = {}; }
const kcal = Math.round(d.kcal || 0), prot = Math.round(d.protein_g || 0);
const waterMl = Math.round(d.water_ml || 0);

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
w.addSpacer(2);
let wtr = w.addText(`💧 ${(waterMl / 1000).toFixed(1)} / ${(GOAL_WATER_ML / 1000).toFixed(0)} L`); wtr.font = Font.systemFont(11); wtr.textColor = waterMl >= GOAL_WATER_ML ? acc : mut;
Script.setWidget(w);
if (config.runsInApp) w.presentSmall();
Script.complete();
```
Refresh is on iOS's widget budget (~every 15–60 min; not real-time).

## Example 5 · Log 1 L water — NFC bottle tap OR manual  (deterministic, instant, free)
**Does:** logs **1 L** into today's water total (shows on Daily, Food, and the
widget). Runs by NFC tap on your bottle, by hand, or by voice.

**Shortcut — name `Su İç`:**
1. **Get Contents of URL**
   - URL: `GATEWAY` · Method: **POST**
   - Headers: `x-phone-secret` = `<your secret>` · `Content-Type` = `application/json`
   - Request Body: **JSON** → `action` (Text) = `log_water` · `amount_ml` (Number) = `1000`
2. **Show Notification** — `Get Dictionary Value` key `logged_ml` → "💧 … ml eklendi"

**Manual run:** it's an ordinary shortcut — tap it in the Shortcuts app, add it
to the Home Screen, or say "Hey Siri, Su İç". (Change `amount_ml` to `500` for a
half-bottle, etc.)
**NFC (optional):** iPhone → Shortcuts → **Automation** → **NFC** → **Scan** the
bottle sticker → **Run Shortcut → Su İç** → turn **OFF "Ask Before Running"**.

---

## Gateway API reference (what the shortcuts send)
`POST /functions/v1/phone-gateway`, header `x-phone-secret: <secret>`, JSON body:
| action | body | returns | AI? |
|---|---|---|---|
| `log_supplement` | `{title?, calories?, date?}` | `{ok, logged}` | no |
| `log_food` | `{title, meal_slot?, calories?, protein_g?, carbs_g?, fat_g?, date?}` | `{ok, logged}` | no |
| `log_water` | `{amount_ml?, date?}` (default 250 ml) | `{ok, logged_ml}` | no |
| `nutrition_today` | `{date?}` | `{ok, kcal, protein_g, water_ml, entries}` | no |
| `recent_foods` | `{slot?, from?}` | `{ok, foods[]}` (dedup, snapshot macros) | no |
| `search_library` | `{q}` | `{ok, items[]}` (your library, per-100g) | no |
| `sleep_stats` | `{}` | `{ok, last_night:{hours,in_bed_h,deep_h,core_h,rem_h,awake_h,start,end,sleeping_hr?,hrv_ms?,spo2_pct?,resp_rate?}, nights[]}` (overlap-merged, Oslo wake-day) | no |
| `tasks_today` | `{}` | `{ok, date, tasks:[{title,priority,due_time}], schedule:[{time,title}]}` | no |
| `import_body_composition` | see below | see below | no |
| `ask` | `{q}` | `{ok, text}` | yes (→ ai-proxy, fast model) |
| `brief` | `{}` | `{ok, text}` | yes (context pre-built, single-shot) |
| `sleep` | `{}` | `{ok, text}` | yes |

`date` defaults to the server's UTC date; pass a `yyyy-MM-dd` (Format Date in the
shortcut) if you care about the exact local day near midnight.

---

## `import_body_composition` — full contract (for Codex)

**What it's for:** a smart-scale "Body composition analysis report" photo is
shared to an Apple Shortcut; the Shortcut OCRs the fixed report layout
on-device (Apple's built-in OCR — **no AI/LLM anywhere in this path**) and
POSTs the 14 extracted numbers here. **Do not change the OCR steps or the
existing extraction logic** — this section only documents what to send to the
gateway at the end of that already-working flow, plus the notification you
show for each outcome.

**Endpoint:** `POST /functions/v1/phone-gateway`
**Headers:** `x-phone-secret: <secret>` · `Content-Type: application/json`
(same as every other action — no new headers).

### Request body

```json
{
  "action": "import_body_composition",
  "measured_at": "2026-09-06T08:23:00",
  "measurement_timezone": "Europe/Oslo",
  "weight_kg": 83.6,
  "body_fat_percent": 24.4,
  "body_fat_mass_kg": 20.4,
  "lean_body_mass_kg": 63.2,
  "body_water_percent": 55.4,
  "protein_percent": 15.0,
  "muscle_percent": 70.4,
  "skeletal_muscle_percent": 42.9,
  "skeletal_muscle_index": 8.2,
  "bmi": 25.8,
  "visceral_fat_index": 8,
  "subcutaneous_fat_kg": 18.0,
  "bmr_kcal": 1735,
  "body_score": 79
}
```

- `measured_at` — **local wall-clock time exactly as printed on the report**
  (`"2026/09/06 08:23"` → format as `"2026-09-06T08:23:00"`), with **no**
  `Z` suffix and **no** `+HH:MM`/`-HH:MM` offset. The report never prints a
  timezone, so sending one here would be ambiguous, not helpful — the
  gateway is what resolves it correctly (DST included).
- `measurement_timezone` — optional IANA zone name. **Omit it and the
  gateway defaults to `Europe/Oslo`** (today's only real device/timezone),
  but send it explicitly if you have it — it costs nothing and removes any
  future ambiguity if a shortcut ever runs from a different zone.
- The 14 numeric fields — send them as JSON **numbers** (the Shortcuts
  "Number" body-field type), not strings, matching the report exactly
  (`visceral_fat_index`/`bmr_kcal`/`body_score` are whole numbers; the rest
  can carry one decimal place). **Do not round, clamp, or default a missing
  OCR read to 0** — send whatever the OCR step actually produced (including
  nothing/blank if the OCR genuinely failed to read that field) and let the
  gateway reject it with a named field error; a silently-substituted 0 would
  write a wrong number that looks like a real reading.

### Responses — one for every outcome, with the exact body to branch on

**`created`** — new report, no earlier row for this `measured_at`.
```json
{ "status": "created", "id": "b1a2c3d4-…" }
```
HTTP 201. Show: "✓ Rapor kaydedildi" (or similar).

**`already_exists`** — the SAME report (same `measured_at`, matching
numbers) was already imported; nothing was written or changed.
```json
{ "status": "already_exists", "id": "b1a2c3d4-…" }
```
HTTP 200. Show a neutral "already saved" notification, not an error — this is
the expected result of re-sharing the same photo twice, or the Shortcut
retrying after a network hiccup.

**`validation_error`** — a required field was missing, non-numeric, out of a
sane range, or the two numbers didn't add up (see "Consistency checks"
below). Never writes a row.
```json
{
  "status": "validation_error",
  "errors": {
    "body_fat_mass_kg": "inconsistent with weight_kg × body_fat_percent (expected ≈20.40)",
    "bmr_kcal": "required"
  }
}
```
HTTP 400. Show the field name(s) so a bad OCR crop is easy to spot and retake.

**`conflict`** — a report for this EXACT `measured_at` already exists but
with DIFFERENT numbers. Never overwrites — the existing row is left exactly
as it was.
```json
{ "status": "conflict", "id": "b1a2c3d4-…", "message": "A report already exists for this measured_at with different values." }
```
HTTP 409. This should be rare (it means the same minute-stamp was scanned
twice with two different readings) — show it as a real error, distinct from
`already_exists`.

**`unauthorized`** — same shape as every other action (bad/missing
`x-phone-secret`), not specific to this one.
```json
{ "error": "Unauthorized" }
```
HTTP 401.

**`server_error`** — an unexpected failure (DB unreachable, etc.).
```json
{ "status": "server_error", "error": "<message>" }
```
HTTP 500. (A genuinely unhandled exception anywhere in the gateway falls
back to the shared `{ "ok": false, "error": "<message>" }` shape instead —
treat that the same way as `server_error`.)

### Consistency checks (why a technically-valid report can still 400)
Two cross-checks catch a misread OCR field even when every individual number
looks plausible on its own — tolerance accounts for the report's own 1-decimal
rounding, not device classification:
- `body_fat_mass_kg` ≈ `weight_kg × body_fat_percent / 100`
- `lean_body_mass_kg` ≈ `weight_kg − body_fat_mass_kg`

(tolerance: the larger of 0.15 kg or 0.5% of `weight_kg`)

### Idempotency key
`(measured_at, source)` — `source` is always `"movinglife_report"` for this
report layout and is set server-side; you never send it. Re-running the exact
same shortcut against the exact same photo is always safe (→ `already_exists`),
including if it happens to fire twice at once (a concurrent duplicate resolves
the same way, never as two rows).

## Security & rotation
- The only thing on the phone is the **device secret** — not the service key, not
  your login. It's scoped to your data (the gateway acts only as your user id).
- **Revoke:** change `PHONE_GATEWAY_SECRET` in Vault (+ update the shortcuts/
  widget). Every old copy stops working instantly.
- The `ai-proxy` change keeps the browser flow identical (it still validates a
  real JWT via getUser); the secret is a second, additive path.

## Test checklist
- [ ] `PHONE_GATEWAY_SECRET` set in Vault; `phone-gateway` deployed; `ai-proxy` redeployed (both verify_jwt off).
- [ ] Ex 1: tap NFC → supplement row appears in Food/Today.
- [ ] Ex 2: "Hey Siri, AI'a Sor" speaks a real answer.
- [ ] Ex 3: 07:00 automation (test via "Run") shows the brief.
- [ ] Ex 4: Scriptable widget shows today's kcal/protein and keeps updating.
- [ ] Migration `085_body_composition_reports.sql` applied; `phone-gateway` redeployed → `import_body_composition` with a real report's numbers returns `created`; re-sending the identical body returns `already_exists`; re-sending with one number changed returns `conflict`.
