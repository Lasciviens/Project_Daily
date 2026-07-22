# Scriptable food logger — a phone-native "mini app"

> A full-screen Scriptable UITable that logs food WITHOUT opening the web app.
> Searches **Open Food Facts** directly (Scriptable makes native HTTP — no CORS
> limit — so no gateway change needed) to auto-fill per-100g macros, or takes
> them by hand, then logs to the `phone-gateway` (`log_food` / `log_water`).
> Depends only on: `phone-gateway` deployed + `PHONE_GATEWAY_SECRET`.

## Setup
1. Scriptable → **＋** (new script) → delete the template.
2. Paste the code below.
3. Set `SECRET` to your real `PHONE_GATEWAY_SECRET` (same value as Vault).
4. Name it e.g. **Yemek Logla**. Run it (▶) to test.
5. (Optional) Home Screen: add a Scriptable "Run Script" shortcut / a Scriptable
   large widget set to *When Interacting → Run Script*, or "Hey Siri, Yemek Logla".

## How it works
- **🔍 Yemek ara** → type a food → Open Food Facts results (kcal/P/C/F per 100 g)
  → tap one → enter grams → macros are scaled and logged to the current slot.
- **✏️ Elle makro gir** → a 5-field form (name + kcal/protein/carbs/fat) → logs.
- **💧 +250 / +500 ml** → logs water (`log_water`).
- The header shows today's totals live (re-fetched after every action).
- **Öğün** row cycles the target meal slot (defaults by time of day).

`log_food` stores absolute macros, so the search path computes `per100 × grams/100`
client-side before sending. Open Food Facts is free/no-key; if a product has no
`energy-kcal_100g` it's filtered out of the results.

```javascript
// Lasci's Board — Food Logger (Scriptable mini app, full-screen UITable).
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
async function gw(action, extra) {
  const r = new Request(GATEWAY);
  r.method = "POST";
  r.headers = { "x-phone-secret": SECRET, "Content-Type": "application/json" };
  r.body = JSON.stringify({ action, ...extra });
  try { return await r.loadJSON(); } catch (e) { return { ok: false, error: String(e) }; }
}

// ── Open Food Facts (direct HTTP, no key/CORS) ──
async function offSearch(q) {
  const url = "https://world.openfoodfacts.org/cgi/search.pl?search_terms="
    + encodeURIComponent(q) + "&search_simple=1&action=process&json=1&page_size=24"
    + "&fields=product_name,brands,nutriments";
  const req = new Request(url);
  req.headers = { "User-Agent": "LascisBoard/1.0 (personal use)" };
  try {
    const j = await req.loadJSON();
    return (j.products || []).map(p => ({
      name: [p.product_name, p.brands].filter(Boolean).join(" · ").trim(),
      kcal: num(p.nutriments && p.nutriments["energy-kcal_100g"]),
      p: num(p.nutriments && p.nutriments.proteins_100g),
      c: num(p.nutriments && p.nutriments.carbohydrates_100g),
      f: num(p.nutriments && p.nutriments.fat_100g),
    })).filter(x => x.name && x.kcal > 0);
  } catch (e) { return []; }
}

// ── dialogs ──
async function form(title, msg, fields) {
  const a = new Alert(); a.title = title; if (msg) a.message = msg;
  fields.forEach(f => a.addTextField(f.ph, f.val != null ? String(f.val) : ""));
  a.addAction("Kaydet"); a.addCancelAction("Vazgeç");
  const i = await a.present();
  if (i === -1) return null;
  const out = {}; fields.forEach((f, idx) => out[f.key] = a.textFieldValue(idx)); return out;
}
async function toast(msg) { const a = new Alert(); a.title = msg; a.addAction("Tamam"); await a.present(); }
async function pickSlot() {
  const a = new Alert(); a.title = "Öğün seç";
  SLOTS.forEach(s => a.addAction(s[1])); a.addCancelAction("Vazgeç");
  const i = await a.present(); if (i >= 0) slot = SLOTS[i][0];
}

// ── actions ──
async function manualEntry() {
  const v = await form("Elle gir", slotLabel(slot), [
    { key: "title", ph: "Yemek adı" }, { key: "calories", ph: "kcal" },
    { key: "protein_g", ph: "protein (g)" }, { key: "carbs_g", ph: "karbonhidrat (g)" }, { key: "fat_g", ph: "yağ (g)" },
  ]);
  if (!v || !v.title.trim()) return;
  const res = await gw("log_food", {
    meal_slot: slot, title: v.title.trim(),
    calories: num(v.calories), protein_g: num(v.protein_g), carbs_g: num(v.carbs_g), fat_g: num(v.fat_g),
  });
  await toast(res.ok ? `✓ ${v.title.trim()} loglandı` : `Hata: ${res.error}`);
}
async function searchEntry() {
  const q = await form("Yemek ara", "Open Food Facts", [{ key: "q", ph: "örn: yulaf ezmesi" }]);
  if (!q || !q.q.trim()) return;
  const results = await offSearch(q.q.trim());
  if (!results.length) { await toast("Sonuç bulunamadı"); return; }
  const t = new UITable(); t.showSeparators = true;
  results.forEach(r => {
    const row = new UITableRow(); row.height = 56;
    const c = row.addText(r.name, `${Math.round(r.kcal)} kcal · P${Math.round(r.p)} K${Math.round(r.c)} Y${Math.round(r.f)} /100g`);
    c.titleFont = Font.systemFont(15); c.subtitleColor = Color.gray();
    row.onSelect = () => logPer100(r);
    t.addRow(row);
  });
  await t.present();
}
async function logPer100(r) {
  const g = await form(r.name.split(" · ")[0], "Kaç gram?", [{ key: "g", ph: "gram", val: 100 }]);
  if (!g) return;
  const grams = num(g.g) || 100, k = grams / 100;
  const res = await gw("log_food", {
    meal_slot: slot, title: `${r.name.split(" · ")[0]} ${grams}g`,
    calories: Math.round(r.kcal * k), protein_g: Math.round(r.p * k),
    carbs_g: Math.round(r.c * k), fat_g: Math.round(r.f * k),
  });
  await toast(res.ok ? `✓ ${grams}g · ${Math.round(r.kcal * k)} kcal loglandı` : `Hata: ${res.error}`);
}

// ── main screen (reloadable) ──
const table = new UITable(); table.showSeparators = true;
async function render() {
  const n = await gw("nutrition_today", {});
  table.removeAllRows();
  const h = new UITableRow(); h.height = 66; h.isHeader = true;
  const hc = h.addText("🍽️ Bugün", n.ok
    ? `${n.kcal} kcal · ${n.protein_g} g protein · 💧 ${((n.water_ml || 0) / 1000).toFixed(1)} L`
    : "gateway'e bağlanılamadı");
  hc.titleFont = Font.boldSystemFont(19); table.addRow(h);

  const s = new UITableRow(); const sc = s.addText("Öğün", slotLabel(slot));
  sc.titleFont = Font.systemFont(15); s.onSelect = async () => { await pickSlot(); await render(); }; table.addRow(s);

  const btn = (label, fn) => {
    const r = new UITableRow(); const c = r.addText(label);
    c.titleColor = ACC; c.titleFont = Font.semiboldSystemFont(16);
    r.onSelect = async () => { await fn(); await render(); }; table.addRow(r);
  };
  btn("🔍 Yemek ara (Open Food Facts)", searchEntry);
  btn("✏️ Elle makro gir", manualEntry);
  btn("💧 +250 ml su", async () => { await gw("log_water", { amount_ml: 250 }); });
  btn("💧 +500 ml su", async () => { await gw("log_water", { amount_ml: 500 }); });
  table.reload();
}
await render();
await table.present();
```

## Next steps (optional)
- **Barcode:** Scriptable has no native scanner API, but a companion Shortcut can
  scan a barcode and pass it in; add an Open Food Facts `product/{ean}.json`
  lookup to prefill.
- **Recents / your own library:** would need a small new gateway action
  (`recent_foods` / `search_library`) — the app already has both server-side.
