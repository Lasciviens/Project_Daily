# Scriptable food logger — a phone-native "mini app" (v2)

> Log food WITHOUT opening the web app, four ways:
> - **Son yenenler** — one tap re-logs a recently eaten food (snapshot macros).
> - **📚 Kütüphanem** — search your own ingredient library (per-100g → grams).
> - **🔍 Online (OFF)** — Open Food Facts search (called directly — Scriptable
>   does native HTTP, no CORS).
> - **📷 Barkod** — scanned via a companion Shortcut, or typed → OFF product.
>
> Everything goes through the `phone-gateway` (`log_food` / `log_water` /
> `nutrition_today` / `recent_foods` / `search_library`). Depends only on:
> `phone-gateway` deployed + `PHONE_GATEWAY_SECRET`.
> **After adding recent_foods/search_library the gateway must be redeployed.**

## Setup
1. Scriptable → **＋** (new script) → delete the template.
2. Paste the code below.
3. Set `SECRET` to your real `PHONE_GATEWAY_SECRET` (same value as Vault).
4. Name it **Yemek Logla**. Run (▶) to test. Add to Home Screen / "Hey Siri, Yemek Logla".

### Barcode scanning (optional companion Shortcut)
Scriptable has no camera-scanner API, so scanning is done by a tiny Shortcut:
**Scan QR/Barcode** → **Run Script** `Yemek Logla` (pass the scanned text as
input). The script reads it (`args.shortcutParameter`) → OFF product lookup →
grams → log. Without the Shortcut, use the in-app **📷 Barkod gir** (type it).

## How it works
- The header shows today's totals (`nutrition_today`), re-fetched after each action.
- **Öğün** cycles the target meal slot (defaults by time of day).
- Search results (OFF or library) are per-100g → tap one → enter grams → macros
  are scaled (`per100 × grams/100`) and logged via `log_food` (which stores
  absolute macros). Recents already carry a full snapshot → re-logged as-is.

```javascript
// Lasci's Board — Food Logger v2 (Scriptable mini app).
const GATEWAY = "https://hsaedwwqpcjizeozjbch.supabase.co/functions/v1/phone-gateway";
const SECRET  = "PASTE_YOUR_PHONE_GATEWAY_SECRET";

const SLOTS = [
  ["breakfast", "🌅 Kahvaltı"], ["lunch", "☀️ Öğle"], ["dinner", "🌙 Akşam"],
  ["snack", "🍎 Atıştırma"], ["supplement", "💊 Takviye"],
];
const ACC = new Color("#C0622B");
const num = v => { const n = Number(String(v).replace(",", ".")); return Number.isFinite(n) ? n : 0; };
const slotByTime = () => { const h = new Date().getHours(); return h < 11 ? 0 : h < 15 ? 1 : h < 21 ? 2 : 3; };
const slotLabel = s => (SLOTS.find(x => x[0] === s) || SLOTS[3])[1];
let slot = SLOTS[slotByTime()][0];

// ── gateway ──
async function gw(action, extra = {}) {
  const r = new Request(GATEWAY);
  r.method = "POST";
  r.headers = { "x-phone-secret": SECRET, "Content-Type": "application/json" };
  r.body = JSON.stringify({ action, ...extra });
  try { return await r.loadJSON(); } catch (e) { return { ok: false, error: String(e) }; }
}
const recentFoods = async () => (await gw("recent_foods", { slot })).foods || [];
const libSearch = async q => ((await gw("search_library", { q })).items || []).map(i => ({
  name: i.name, kcal: num(i.per100 && i.per100.kcal), p: num(i.per100 && i.per100.p),
  c: num(i.per100 && i.per100.c), f: num(i.per100 && i.per100.f),
}));

// ── Open Food Facts (direct HTTP, no key/CORS) ──
function offMap(p) {
  return {
    name: [p.product_name, p.brands].filter(Boolean).join(" · ").trim(),
    kcal: num(p.nutriments && p.nutriments["energy-kcal_100g"]),
    p: num(p.nutriments && p.nutriments.proteins_100g),
    c: num(p.nutriments && p.nutriments.carbohydrates_100g),
    f: num(p.nutriments && p.nutriments.fat_100g),
  };
}
async function offSearch(q) {
  const url = "https://world.openfoodfacts.org/cgi/search.pl?search_terms=" + encodeURIComponent(q)
    + "&search_simple=1&action=process&json=1&page_size=24&fields=product_name,brands,nutriments";
  const req = new Request(url); req.headers = { "User-Agent": "LascisBoard/1.0 (personal use)" };
  try { const j = await req.loadJSON(); return (j.products || []).map(offMap).filter(x => x.name && x.kcal > 0); }
  catch (e) { return []; }
}
async function offBarcode(ean) {
  const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(ean)}.json?fields=product_name,brands,nutriments`;
  const req = new Request(url); req.headers = { "User-Agent": "LascisBoard/1.0 (personal use)" };
  try { const j = await req.loadJSON(); if (j.status !== 1 || !j.product) return null; const m = offMap(j.product); return m.kcal > 0 ? m : null; }
  catch (e) { return null; }
}

// ── dialogs ──
async function form(title, msg, fields) {
  const a = new Alert(); a.title = title; if (msg) a.message = msg;
  fields.forEach(f => a.addTextField(f.ph, f.val != null ? String(f.val) : ""));
  a.addAction("Kaydet"); a.addCancelAction("Vazgeç");
  const i = await a.present(); if (i === -1) return null;
  const out = {}; fields.forEach((f, idx) => out[f.key] = a.textFieldValue(idx)); return out;
}
async function toast(msg) { const a = new Alert(); a.title = msg; a.addAction("Tamam"); await a.present(); }
async function pickSlot() {
  const a = new Alert(); a.title = "Öğün seç";
  SLOTS.forEach(s => a.addAction(s[1])); a.addCancelAction("Vazgeç");
  const i = await a.present(); if (i >= 0) slot = SLOTS[i][0];
}

// ── logging ──
async function logFood(f) { return gw("log_food", { meal_slot: slot, ...f }); }
async function logRecent(f) {
  const res = await logFood({ title: f.title, calories: num(f.calories), protein_g: num(f.protein_g), carbs_g: num(f.carbs_g), fat_g: num(f.fat_g) });
  await toast(res.ok ? `✓ ${f.title} loglandı` : `Hata: ${res.error}`);
}
async function logPer100(r) {
  const g = await form(r.name.split(" · ")[0], "Kaç gram?", [{ key: "g", ph: "gram", val: 100 }]);
  if (!g) return;
  const grams = num(g.g) || 100, k = grams / 100;
  const res = await logFood({
    title: `${r.name.split(" · ")[0]} ${grams}g`,
    calories: Math.round(r.kcal * k), protein_g: Math.round(r.p * k),
    carbs_g: Math.round(r.c * k), fat_g: Math.round(r.f * k),
  });
  await toast(res.ok ? `✓ ${grams}g · ${Math.round(r.kcal * k)} kcal loglandı` : `Hata: ${res.error}`);
}
async function manualEntry() {
  const v = await form("Elle gir", slotLabel(slot), [
    { key: "title", ph: "Yemek adı" }, { key: "calories", ph: "kcal" },
    { key: "protein_g", ph: "protein (g)" }, { key: "carbs_g", ph: "karbonhidrat (g)" }, { key: "fat_g", ph: "yağ (g)" },
  ]);
  if (!v || !v.title.trim()) return;
  const res = await logFood({ title: v.title.trim(), calories: num(v.calories), protein_g: num(v.protein_g), carbs_g: num(v.carbs_g), fat_g: num(v.fat_g) });
  await toast(res.ok ? `✓ ${v.title.trim()} loglandı` : `Hata: ${res.error}`);
}

// ── search / barcode (results funnel into logPer100) ──
async function resultsTable(results) {
  if (!results.length) { await toast("Sonuç bulunamadı"); return; }
  const t = new UITable(); t.showSeparators = true;
  results.forEach(r => {
    const row = new UITableRow(); row.height = 56;
    const c = row.addText(r.name, `${Math.round(r.kcal)} kcal · P${Math.round(r.p)} K${Math.round(r.c)} Y${Math.round(r.f)} /100g`);
    c.titleFont = Font.systemFont(15); c.subtitleColor = Color.gray();
    row.onSelect = () => logPer100(r); t.addRow(row);
  });
  await t.present();
}
async function searchFlow(source) {
  const q = await form(source === "lib" ? "Kütüphanede ara" : "Online ara",
    source === "lib" ? "Kendi kütüphanen" : "Open Food Facts", [{ key: "q", ph: "örn: yulaf" }]);
  if (!q || !q.q.trim()) return;
  await resultsTable(source === "lib" ? await libSearch(q.q.trim()) : await offSearch(q.q.trim()));
}
async function barcodeFlow(ean) {
  if (!ean) { const v = await form("Barkod", "Ürün barkodunu gir", [{ key: "e", ph: "8690..." }]); if (!v || !v.e.trim()) return; ean = v.e.trim(); }
  const m = await offBarcode(ean);
  if (!m) { await toast("Ürün bulunamadı: " + ean); return; }
  await logPer100(m);
}

// ── main (reloadable) ──
const table = new UITable(); table.showSeparators = true;
async function render() {
  const [n, recents] = await Promise.all([gw("nutrition_today"), recentFoods()]);
  table.removeAllRows();

  const h = new UITableRow(); h.height = 66; h.isHeader = true;
  const hc = h.addText("🍽️ Bugün", n.ok
    ? `${n.kcal} kcal · ${n.protein_g} g protein · 💧 ${((n.water_ml || 0) / 1000).toFixed(1)} L`
    : "gateway'e bağlanılamadı");
  hc.titleFont = Font.boldSystemFont(19); table.addRow(h);

  const s = new UITableRow(); const sc = s.addText("Öğün", slotLabel(slot)); sc.titleFont = Font.systemFont(15);
  s.onSelect = async () => { await pickSlot(); await render(); }; table.addRow(s);

  const btn = (label, fn) => {
    const r = new UITableRow(); const c = r.addText(label);
    c.titleColor = ACC; c.titleFont = Font.semiboldSystemFont(16);
    r.onSelect = async () => { await fn(); await render(); }; table.addRow(r);
  };
  btn("🔍 Online ara (OFF)", () => searchFlow("off"));
  btn("📚 Kütüphanemde ara", () => searchFlow("lib"));
  btn("📷 Barkod gir", () => barcodeFlow());
  btn("✏️ Elle makro gir", manualEntry);
  btn("💧 +250 ml su", () => gw("log_water", { amount_ml: 250 }));
  btn("💧 +500 ml su", () => gw("log_water", { amount_ml: 500 }));

  if (recents.length) {
    const rh = new UITableRow(); rh.isHeader = true;
    rh.addText("Son yenenler").titleFont = Font.mediumSystemFont(13); table.addRow(rh);
    recents.forEach(f => {
      const row = new UITableRow(); row.height = 50;
      const c = row.addText(f.title, `${Math.round(num(f.calories))} kcal · ${Math.round(num(f.protein_g))} p`);
      c.titleFont = Font.systemFont(15); c.subtitleColor = Color.gray();
      row.onSelect = async () => { await logRecent(f); await render(); }; table.addRow(row);
    });
  }
  table.reload();
}

// A companion Shortcut (Scan Barcode → Run Script) can hand a barcode in.
const incoming = (
  (args.shortcutParameter && String(args.shortcutParameter)) ||
  (args.plainTexts && args.plainTexts[0]) ||
  (args.queryParameters && args.queryParameters.ean)
) || null;
if (incoming && /^\d{6,}$/.test(String(incoming).trim())) await barcodeFlow(String(incoming).trim());

await render();
await table.present();
```

## Gateway actions used
| action | body | returns |
|---|---|---|
| `nutrition_today` | `{}` | `{ok, kcal, protein_g, water_ml}` |
| `recent_foods` | `{slot?, from?}` | `{ok, foods:[{title, calories, protein_g, carbs_g, fat_g, meal_slot}]}` |
| `search_library` | `{q}` | `{ok, items:[{name, per100:{kcal,p,c,f}, serving_label, serving_grams}]}` |
| `log_food` | `{meal_slot, title, calories, protein_g, carbs_g, fat_g}` | `{ok, logged}` |
| `log_water` | `{amount_ml}` | `{ok, logged_ml}` |
