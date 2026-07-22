# iPhone examples — permanent setup (device-secret gateway)

> Companion to `iphone-web-integration.md`. The DURABLE setup: the iPhone talks
> to ONE endpoint (`phone-gateway`) with ONE static, revocable secret
> (`x-phone-secret`) — never-expiring, no JWT to refresh, flat `{action}` bodies
> so the Shortcuts stay simple. Build the shortcuts once on your Mac → they sync
> to the iPhone over iCloud. (Spoken walkthrough happens in chat, in Turkish.)

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

```javascript
// Lasci's Board — Nutrition (Scriptable, Small widget). Durable: device secret.
const GATEWAY = "https://hsaedwwqpcjizeozjbch.supabase.co/functions/v1/phone-gateway";
const SECRET  = "PASTE_YOUR_PHONE_GATEWAY_SECRET";
const GOAL_KCAL = 2100, GOAL_PROT = 150; // edit to your targets

const req = new Request(GATEWAY);
req.method = "POST";
req.headers = { "x-phone-secret": SECRET, "Content-Type": "application/json" };
req.body = JSON.stringify({ action: "nutrition_today" });
let d = {};
try { d = await req.loadJSON(); } catch (e) { d = {}; }
const kcal = Math.round(d.kcal || 0), prot = Math.round(d.protein_g || 0);

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
Refresh is on iOS's widget budget (~every 15–60 min; not real-time).

---

## Gateway API reference (what the shortcuts send)
`POST /functions/v1/phone-gateway`, header `x-phone-secret: <secret>`, JSON body:
| action | body | returns | AI? |
|---|---|---|---|
| `log_supplement` | `{title?, calories?, date?}` | `{ok, logged}` | no |
| `log_food` | `{title, meal_slot?, calories?, protein_g?, carbs_g?, fat_g?, date?}` | `{ok, logged}` | no |
| `nutrition_today` | `{date?}` | `{ok, kcal, protein_g, entries}` | no |
| `ask` | `{q}` | `{ok, text}` | yes (→ ai-proxy) |
| `brief` | `{}` | `{ok, text}` | yes |
| `sleep` | `{}` | `{ok, text}` | yes |

`date` defaults to the server's UTC date; pass a `yyyy-MM-dd` (Format Date in the
shortcut) if you care about the exact local day near midnight.

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
