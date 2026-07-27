# Scriptable widget pack — 4 widgets + 1 runner

> Four home-screen widgets for Lasci's Board, all driven by the DETERMINISTIC
> `phone-gateway` actions (no AI → instant, reliable). Each script is fully
> self-contained: create a new Scriptable script, paste the code, set `SECRET`,
> run once (▶) to test, then add a Scriptable widget on the Home Screen and
> point it at the script.
>
> Common features across all four: **offline cache** (last good response is
> stored; if the gateway is unreachable the widget renders the cached data with
> a small "çevrimdışı" note instead of breaking), **light/dark theme** matching
> the app's cream/ink palette, and a ~15 min refresh hint (iOS decides the real
> cadence).

| # | Script name (exact) | Widget size | What it is |
|---|---|---|---|
| W1 | `Uyku Paneli` | **Medium** | Last night's sleep + stage bar + 7-night chart |
| W2 | `Komuta Merkezi` | **Large** | ⭐ Full day command center: next event countdown, agenda with now-marker, top tasks, macro bars |
| W3 | `Hizli Log Paneli` (+ runner `HizliLog`) | **Medium** | ⭐ Interactive quick-log grid: tap +250/+500/+1L water, creatine, food, barcode |
| W4 | `Makro Halkalari` | **Small** | Apple-rings-style kcal / protein / water rings |

Setup for each: Scriptable → **＋** → delete template → paste → set `SECRET`
(same `PHONE_GATEWAY_SECRET` as Vault) → name the script EXACTLY as in the
table (W3's deep links depend on names) → ▶ to preview → Home Screen → add
Scriptable widget of the right size → Edit Widget → choose the script.

**W3 interactivity note (iOS limitation):** home-screen widgets can't run code
in place — a tap opens a deep link. Each button hands off to the tiny `HizliLog`
runner (Scriptable opens for ~a second, logs, fires a confirmation
notification). Same pattern as `Barkod Tara`. Small widgets allow only ONE tap
target, which is why W3 must be a **medium** widget.

---

## W1 · Uyku Paneli (medium)

Last night: big hours + bedtime→wake + a colored stage bar (deep/core/REM/awake)
+ a 7-night bar chart with a 8h target line and the period average. Data:
`sleep_stats` (overlap-merged server-side — numbers match the site).

```javascript
// Lasci's Board — Uyku Paneli (Scriptable, MEDIUM widget)
const GATEWAY = "https://hsaedwwqpcjizeozjbch.supabase.co/functions/v1/phone-gateway";
const SECRET  = "PASTE_YOUR_PHONE_GATEWAY_SECRET";

const dark = Device.isUsingDarkAppearance();
const C = {
  bg:  new Color(dark ? "#221D18" : "#FBF8F2"),
  ink: new Color(dark ? "#F1EBE2" : "#2A2622"),
  mut: new Color(dark ? "#B4A99B" : "#6B635A"),
  acc: new Color(dark ? "#E28A4F" : "#C0622B"),
  low: new Color("#f87171"),
};
const STAGE = [
  ["deep_h",  "Derin",  new Color("#3b5bdb")],
  ["core_h",  "Core",   new Color("#4dabf7")],
  ["rem_h",   "REM",    new Color("#9775fa")],
  ["awake_h", "Uyanık", new Color("#ffa94d")],
];

async function gw(action, extra = {}) {
  const r = new Request(GATEWAY);
  r.method = "POST";
  r.headers = { "x-phone-secret": SECRET, "Content-Type": "application/json" };
  r.body = JSON.stringify({ action, ...extra });
  return await r.loadJSON();
}
async function cached(name, fetcher) {
  const fm = FileManager.local();
  const p = fm.joinPath(fm.cacheDirectory(), "lasci-" + name + ".json");
  try { const d = await fetcher(); fm.writeString(p, JSON.stringify(d)); return { data: d, stale: false }; }
  catch (e) { if (fm.fileExists(p)) return { data: JSON.parse(fm.readString(p)), stale: true }; return { data: null, stale: true }; }
}

function stageBar(n, w, h) {
  const ctx = new DrawContext(); ctx.size = new Size(w, h); ctx.opaque = false; ctx.respectScreenScale = true;
  const total = STAGE.reduce((a, [k]) => a + (Number(n[k]) || 0), 0) || 1;
  let x = 0;
  for (const [k, , col] of STAGE) {
    const seg = ((Number(n[k]) || 0) / total) * w;
    if (seg > 0.5) { ctx.setFillColor(col); ctx.fillRect(new Rect(x, 0, seg, h)); }
    x += seg;
  }
  return ctx.getImage();
}

function nightsChart(nights, w, h) {
  const ctx = new DrawContext(); ctx.size = new Size(w, h); ctx.opaque = false; ctx.respectScreenScale = true;
  const chartH = h - 12; // leave room for day letters
  const maxH = Math.max(9, ...nights.map(n => n.hours || 0));
  const gap = 5, bw = (w - gap * (nights.length - 1)) / Math.max(nights.length, 1);
  // 8h target line
  ctx.setFillColor(new Color(dark ? "#B4A99B" : "#6B635A", 0.35));
  ctx.fillRect(new Rect(0, chartH - (8 / maxH) * chartH, w, 1));
  const df = new DateFormatter(); df.dateFormat = "E";
  nights.forEach((n, i) => {
    const bh = Math.max(2, ((n.hours || 0) / maxH) * chartH);
    const x = i * (bw + gap);
    ctx.setFillColor((n.hours || 0) >= 7 ? C.acc : C.low);
    const p = new Path(); p.addRoundedRect(new Rect(x, chartH - bh, bw, bh), 2, 2);
    ctx.addPath(p); ctx.fillPath();
    ctx.setFont(Font.systemFont(7)); ctx.setTextColor(C.mut); ctx.setTextAlignedCenter();
    ctx.drawTextInRect(df.string(new Date(n.date + "T12:00:00")).slice(0, 2), new Rect(x - 2, chartH + 2, bw + 4, 9));
  });
  return ctx.getImage();
}

const { data, stale } = await cached("sleep", () => gw("sleep_stats"));
const w = new ListWidget(); w.backgroundColor = C.bg; w.setPadding(12, 14, 10, 14);
w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);

const last = data && data.last_night;
if (!last) {
  w.addSpacer(); const t = w.addText("😴 Uyku verisi yok"); t.textColor = C.mut; t.font = Font.mediumSystemFont(14); w.addSpacer();
} else {
  const root = w.addStack(); root.layoutHorizontally(); root.topAlignContent();
  const left = root.addStack(); left.layoutVertically();
  let t = left.addText("😴 DÜN GECE"); t.font = Font.mediumSystemFont(10); t.textColor = C.mut;
  t = left.addText(`${last.hours} sa`); t.font = Font.boldSystemFont(28); t.textColor = C.ink;
  t = left.addText(`${last.start ?? "—"} → ${last.end ?? "—"}`); t.font = Font.systemFont(11); t.textColor = C.mut;
  left.addSpacer(8);
  left.addImage(stageBar(last, 132, 8)).cornerRadius = 4;
  left.addSpacer(4);
  const leg = left.addStack(); leg.layoutHorizontally(); leg.spacing = 6;
  for (const [k, label, col] of STAGE) {
    const s = leg.addText(`${label} ${Math.round((last[k] || 0) * 10) / 10}`);
    s.font = Font.systemFont(8); s.textColor = col;
  }
  root.addSpacer();
  const right = root.addStack(); right.layoutVertically();
  t = right.addText("SON 7 GECE"); t.font = Font.mediumSystemFont(10); t.textColor = C.mut;
  right.addSpacer(4);
  const nights = (data.nights || []).slice(-7);
  right.addImage(nightsChart(nights, 138, 84));
  const avg = nights.length ? Math.round(nights.reduce((a, n) => a + (n.hours || 0), 0) / nights.length * 10) / 10 : 0;
  t = right.addText(`ort ${avg} sa`); t.font = Font.systemFont(9); t.textColor = C.mut; t.rightAlignText();
}
if (stale) { const t = w.addText("⚠︎ çevrimdışı veri"); t.font = Font.systemFont(8); t.textColor = C.mut; }
Script.setWidget(w);
if (config.runsInApp) await w.presentMedium();
Script.complete();
```

---

## W2 · Komuta Merkezi (large) ⭐ advanced

The whole day on one card, three gateway calls in parallel (`tasks_today` +
`nutrition_today` + `sleep_stats`):
- header: date + greeting + last night's sleep,
- **day progress bar** (07:00→23:00),
- **next event countdown** ("⏭ 14:30 Antrenman · 1s 12dk sonra"),
- agenda with a "●" now-marker (past items muted),
- top-4 open tasks sorted by priority (colored dots),
- footer: kcal / protein / water progress bars (edit `GOAL_*`).

```javascript
// Lasci's Board — Komuta Merkezi (Scriptable, LARGE widget)
const GATEWAY = "https://hsaedwwqpcjizeozjbch.supabase.co/functions/v1/phone-gateway";
const SECRET  = "PASTE_YOUR_PHONE_GATEWAY_SECRET";
const GOAL_KCAL = 2100, GOAL_PROT = 150, GOAL_WATER_ML = 2000; // edit to your targets

const dark = Device.isUsingDarkAppearance();
const C = {
  bg:  new Color(dark ? "#221D18" : "#FBF8F2"),
  ink: new Color(dark ? "#F1EBE2" : "#2A2622"),
  mut: new Color(dark ? "#B4A99B" : "#6B635A"),
  acc: new Color(dark ? "#E28A4F" : "#C0622B"),
  trk: new Color(dark ? "#3A332B" : "#E7DECF"),
  blu: new Color("#60a5fa"), sky: new Color("#38bdf8"),
};
const PRI = { urgent: new Color("#ef4444"), high: new Color("#f59e0b"), medium: new Color("#eab308"), low: new Color(dark ? "#8a7f70" : "#a89c8a") };
const PRI_RANK = { urgent: 0, high: 1, medium: 2, low: 3 };

async function gw(action, extra = {}) {
  const r = new Request(GATEWAY);
  r.method = "POST";
  r.headers = { "x-phone-secret": SECRET, "Content-Type": "application/json" };
  r.body = JSON.stringify({ action, ...extra });
  return await r.loadJSON();
}
async function cached(name, fetcher) {
  const fm = FileManager.local();
  const p = fm.joinPath(fm.cacheDirectory(), "lasci-" + name + ".json");
  try { const d = await fetcher(); fm.writeString(p, JSON.stringify(d)); return { data: d, stale: false }; }
  catch (e) { if (fm.fileExists(p)) return { data: JSON.parse(fm.readString(p)), stale: true }; return { data: null, stale: true }; }
}
function hbar(pct, w, h, fg) {
  const ctx = new DrawContext(); ctx.size = new Size(w, h); ctx.opaque = false; ctx.respectScreenScale = true;
  let p = new Path(); p.addRoundedRect(new Rect(0, 0, w, h), h / 2, h / 2); ctx.addPath(p); ctx.setFillColor(C.trk); ctx.fillPath();
  const fw = Math.max(h, w * Math.min(pct, 1));
  p = new Path(); p.addRoundedRect(new Rect(0, 0, fw, h), h / 2, h / 2); ctx.addPath(p); ctx.setFillColor(fg); ctx.fillPath();
  return ctx.getImage();
}

const [T, N, S] = await Promise.all([
  cached("tasks", () => gw("tasks_today")),
  cached("nut",   () => gw("nutrition_today")),
  cached("sleep", () => gw("sleep_stats")),
]);
const now = new Date();
const nowMin = now.getHours() * 60 + now.getMinutes();
const toMin = t => { const [h, m] = String(t).split(":").map(Number); return h * 60 + (m || 0); };

const w = new ListWidget(); w.backgroundColor = C.bg; w.setPadding(14, 16, 12, 16);
w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);

// ── Header: date + greeting · sleep ──
const df = new DateFormatter(); df.dateFormat = "d MMMM EEEE";
const greet = now.getHours() < 11 ? "Günaydın" : now.getHours() < 18 ? "İyi günler" : "İyi akşamlar";
const head = w.addStack(); head.layoutHorizontally(); head.centerAlignContent();
let t = head.addText(`${greet} · ${df.string(now)}`); t.font = Font.mediumSystemFont(12); t.textColor = C.ink;
head.addSpacer();
const sleepH = S.data && S.data.last_night ? S.data.last_night.hours : null;
t = head.addText(sleepH != null ? `😴 ${sleepH} sa` : "😴 —"); t.font = Font.systemFont(11); t.textColor = C.mut;
w.addSpacer(4);
// day progress 07:00 → 23:00
w.addImage(hbar(Math.min(Math.max((nowMin - 420) / 960, 0), 1), 300, 3, C.acc));
w.addSpacer(8);

// ── Next event countdown ──
const sched = ((T.data && T.data.schedule) || []).map(s => ({ ...s, min: toMin(s.time) })).sort((a, b) => a.min - b.min);
const next = sched.find(s => s.min > nowMin);
if (next) {
  const d = next.min - nowMin;
  const cd = d >= 60 ? `${Math.floor(d / 60)}s ${d % 60}dk sonra` : `${d} dk sonra`;
  t = w.addText(`⏭ ${next.time}  ${next.title} · ${cd}`); t.font = Font.semiboldSystemFont(13); t.textColor = C.acc; t.lineLimit = 1;
} else {
  t = w.addText(sched.length ? "✓ Bugünkü program tamamlandı" : "Bugün planlı etkinlik yok");
  t.font = Font.mediumSystemFont(12); t.textColor = C.mut;
}
w.addSpacer(6);

// ── Agenda (max 5, now-marker) ──
for (const s of sched.slice(0, 5)) {
  const row = w.addStack(); row.layoutHorizontally(); row.spacing = 6;
  const isPast = s.min <= nowMin && (!next || s.min !== next.min);
  const isNow  = next ? sched.indexOf(s) === sched.indexOf(next) - 1 && s.min <= nowMin : isPast && s === sched[sched.length - 1];
  let m = row.addText(isNow ? "●" : " "); m.font = Font.boldSystemFont(10); m.textColor = C.acc;
  m = row.addText(s.time); m.font = Font.mediumSystemFont(11); m.textColor = isPast && !isNow ? C.mut : C.ink;
  m = row.addText(s.title); m.font = Font.systemFont(11); m.textColor = isPast && !isNow ? C.mut : C.ink; m.lineLimit = 1;
}
w.addSpacer(8);

// ── Tasks (top 4 by priority) ──
const tasks = ((T.data && T.data.tasks) || [])
  .sort((a, b) => (PRI_RANK[a.priority] ?? 9) - (PRI_RANK[b.priority] ?? 9)).slice(0, 4);
t = w.addText(`GÖREVLER (${((T.data && T.data.tasks) || []).length} açık)`); t.font = Font.mediumSystemFont(9); t.textColor = C.mut;
w.addSpacer(2);
if (!tasks.length) { t = w.addText("✓ Açık görev yok"); t.font = Font.systemFont(11); t.textColor = C.mut; }
for (const task of tasks) {
  const row = w.addStack(); row.layoutHorizontally(); row.spacing = 6;
  let d = row.addText("●"); d.font = Font.boldSystemFont(9); d.textColor = PRI[task.priority] || C.mut;
  d = row.addText(task.title); d.font = Font.systemFont(11); d.textColor = C.ink; d.lineLimit = 1;
  if (task.due_time) { row.addSpacer(); d = row.addText(task.due_time); d.font = Font.systemFont(10); d.textColor = C.mut; }
}
w.addSpacer();

// ── Footer: macro bars ──
const kcal = Math.round((N.data && N.data.kcal) || 0);
const prot = Math.round((N.data && N.data.protein_g) || 0);
const wtr  = Math.round((N.data && N.data.water_ml) || 0);
const foot = w.addStack(); foot.layoutHorizontally(); foot.spacing = 12;
const cell = (label, val, pct, col) => {
  const c = foot.addStack(); c.layoutVertically();
  let x = c.addText(label); x.font = Font.systemFont(8); x.textColor = C.mut;
  c.addSpacer(2); c.addImage(hbar(pct, 86, 5, col)); c.addSpacer(2);
  x = c.addText(val); x.font = Font.mediumSystemFont(9); x.textColor = C.ink;
};
cell("KALORİ", `${kcal} / ${GOAL_KCAL}`, kcal / GOAL_KCAL, C.acc);
cell("PROTEİN", `${prot} / ${GOAL_PROT} g`, prot / GOAL_PROT, C.blu);
cell("SU", `${(wtr / 1000).toFixed(1)} / ${(GOAL_WATER_ML / 1000).toFixed(0)} L`, wtr / GOAL_WATER_ML, C.sky);
if (T.stale || N.stale) { w.addSpacer(2); t = w.addText("⚠︎ çevrimdışı veri"); t.font = Font.systemFont(8); t.textColor = C.mut; }

Script.setWidget(w);
if (config.runsInApp) await w.presentLarge();
Script.complete();
```

---

## W3 · Hizli Log Paneli (medium) ⭐ advanced + interactive

A live status line (water/kcal/protein today) over a 2×3 **tappable button
grid**: `+250 ml`, `+500 ml`, `+1 L`, `💊 Kreatin`, `🍽️ Yemek` (opens the
Scriptable food logger), `📷 Barkod` (runs the `Barkod Tara` shortcut). Water
and creatine taps go through the tiny `HizliLog` runner below — it logs via the
gateway and fires a confirmation notification with today's new total.

**Install BOTH scripts.** Names matter: the widget script can be named anything
(suggested `Hizli Log Paneli`), but the runner MUST be named exactly `HizliLog`
and your food logger `Yemek Logla` (they're addressed by URL).

```javascript
// Lasci's Board — Hizli Log Paneli (Scriptable, MEDIUM widget; pair with the "HizliLog" runner)
const GATEWAY = "https://hsaedwwqpcjizeozjbch.supabase.co/functions/v1/phone-gateway";
const SECRET  = "PASTE_YOUR_PHONE_GATEWAY_SECRET";

const dark = Device.isUsingDarkAppearance();
const C = {
  bg:  new Color(dark ? "#221D18" : "#FBF8F2"),
  ink: new Color(dark ? "#F1EBE2" : "#2A2622"),
  mut: new Color(dark ? "#B4A99B" : "#6B635A"),
  btn: new Color(dark ? "#2E2820" : "#F1E9DC"),
};

async function gw(action, extra = {}) {
  const r = new Request(GATEWAY);
  r.method = "POST";
  r.headers = { "x-phone-secret": SECRET, "Content-Type": "application/json" };
  r.body = JSON.stringify({ action, ...extra });
  return await r.loadJSON();
}
async function cached(name, fetcher) {
  const fm = FileManager.local();
  const p = fm.joinPath(fm.cacheDirectory(), "lasci-" + name + ".json");
  try { const d = await fetcher(); fm.writeString(p, JSON.stringify(d)); return { data: d, stale: false }; }
  catch (e) { if (fm.fileExists(p)) return { data: JSON.parse(fm.readString(p)), stale: true }; return { data: null, stale: true }; }
}

const { data: n, stale } = await cached("nut", () => gw("nutrition_today"));
const BTNS = [
  { icon: "💧", label: "+250 ml", url: "scriptable:///run/HizliLog?do=water&ml=250" },
  { icon: "💧", label: "+500 ml", url: "scriptable:///run/HizliLog?do=water&ml=500" },
  { icon: "💧", label: "+1 L",    url: "scriptable:///run/HizliLog?do=water&ml=1000" },
  { icon: "💊", label: "Kreatin", url: "scriptable:///run/HizliLog?do=creatine" },
  { icon: "🍽️", label: "Yemek",  url: "scriptable:///run/Yemek%20Logla" },
  { icon: "📷", label: "Barkod",  url: "shortcuts://run-shortcut?name=" + encodeURIComponent("Barkod Tara") },
];

const w = new ListWidget(); w.backgroundColor = C.bg; w.setPadding(10, 12, 10, 12);
w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);

const st = w.addStack(); st.layoutHorizontally(); st.centerAlignContent();
let t = st.addText(n
  ? `💧 ${((n.water_ml || 0) / 1000).toFixed(1)} L   🔥 ${Math.round(n.kcal || 0)} kcal   🥩 ${Math.round(n.protein_g || 0)} g`
  : "Gateway'e ulaşılamadı");
t.font = Font.mediumSystemFont(11); t.textColor = C.ink;
st.addSpacer();
if (stale) { t = st.addText("⚠︎"); t.font = Font.systemFont(10); t.textColor = C.mut; }
w.addSpacer(8);

for (let row = 0; row < 2; row++) {
  const r = w.addStack(); r.layoutHorizontally(); r.spacing = 6;
  for (let col = 0; col < 3; col++) {
    const b = BTNS[row * 3 + col];
    const s = r.addStack(); s.layoutVertically(); s.centerAlignContent();
    s.backgroundColor = C.btn; s.cornerRadius = 10; s.size = new Size(0, 42);
    s.url = b.url;
    const inner = s.addStack(); inner.layoutHorizontally(); inner.addSpacer();
    let x = inner.addText(`${b.icon} ${b.label}`); x.font = Font.mediumSystemFont(11); x.textColor = C.ink;
    inner.addSpacer();
  }
  if (row === 0) w.addSpacer(6);
}

Script.setWidget(w);
if (config.runsInApp) await w.presentMedium();
Script.complete();
```

**Runner — create a second script named exactly `HizliLog`:**

```javascript
// Lasci's Board — HizliLog runner (called by the Hizli Log Paneli widget taps)
const GATEWAY = "https://hsaedwwqpcjizeozjbch.supabase.co/functions/v1/phone-gateway";
const SECRET  = "PASTE_YOUR_PHONE_GATEWAY_SECRET";

async function gw(action, extra = {}) {
  const r = new Request(GATEWAY);
  r.method = "POST";
  r.headers = { "x-phone-secret": SECRET, "Content-Type": "application/json" };
  r.body = JSON.stringify({ action, ...extra });
  return await r.loadJSON();
}
async function notify(title, body) {
  const n = new Notification(); n.title = title; n.body = body; await n.schedule();
}

const p = args.queryParameters || {};
try {
  if (p.do === "water") {
    const ml = Number(p.ml) || 250;
    const res = await gw("log_water", { amount_ml: ml });
    if (!res.ok) throw new Error(res.error || "log_water failed");
    const today = await gw("nutrition_today").catch(() => null);
    await notify("💧 Su eklendi", `+${ml} ml` + (today && today.ok ? ` · bugün toplam ${((today.water_ml || 0) / 1000).toFixed(1)} L` : ""));
  } else if (p.do === "creatine") {
    const res = await gw("log_supplement", {});
    if (!res.ok) throw new Error(res.error || "log_supplement failed");
    await notify("💊 Loglandı", `${res.logged} ✓`);
  } else {
    await notify("HizliLog", "Bilinmeyen komut: " + (p.do || "—"));
  }
} catch (e) {
  await notify("⚠️ Loglanamadı", String(e && e.message ? e.message : e));
}
Script.complete();
```

---

## W4 · Makro Halkalari (small)

Apple-Activity-style concentric rings drawn with `DrawContext`: outer =
calories, middle = protein, inner = water; the center shows the remaining kcal.
Edit `GOAL_*`.

```javascript
// Lasci's Board — Makro Halkalari (Scriptable, SMALL widget)
const GATEWAY = "https://hsaedwwqpcjizeozjbch.supabase.co/functions/v1/phone-gateway";
const SECRET  = "PASTE_YOUR_PHONE_GATEWAY_SECRET";
const GOAL_KCAL = 2100, GOAL_PROT = 150, GOAL_WATER_ML = 2000; // edit to your targets

const dark = Device.isUsingDarkAppearance();
const C = {
  bg:  new Color(dark ? "#221D18" : "#FBF8F2"),
  ink: new Color(dark ? "#F1EBE2" : "#2A2622"),
  mut: new Color(dark ? "#B4A99B" : "#6B635A"),
  acc: new Color(dark ? "#E28A4F" : "#C0622B"),
  trk: new Color(dark ? "#3A332B" : "#E7DECF"),
  blu: new Color("#60a5fa"), sky: new Color("#38bdf8"),
};

async function gw(action, extra = {}) {
  const r = new Request(GATEWAY);
  r.method = "POST";
  r.headers = { "x-phone-secret": SECRET, "Content-Type": "application/json" };
  r.body = JSON.stringify({ action, ...extra });
  return await r.loadJSON();
}
async function cached(name, fetcher) {
  const fm = FileManager.local();
  const p = fm.joinPath(fm.cacheDirectory(), "lasci-" + name + ".json");
  try { const d = await fetcher(); fm.writeString(p, JSON.stringify(d)); return { data: d, stale: false }; }
  catch (e) { if (fm.fileExists(p)) return { data: JSON.parse(fm.readString(p)), stale: true }; return { data: null, stale: true }; }
}

// Arc drawing: DrawContext has no arc primitive — stamp small filled circles
// along the circumference (the standard Scriptable ring technique).
function arc(ctx, cx, cy, r, lw, a0, a1, color) {
  ctx.setFillColor(color);
  for (let a = a0; a <= a1; a += 2.5) {
    const rad = a * Math.PI / 180;
    ctx.fillEllipse(new Rect(cx + r * Math.cos(rad) - lw / 2, cy + r * Math.sin(rad) - lw / 2, lw, lw));
  }
}
function ring(ctx, cx, cy, r, lw, pct, color) {
  arc(ctx, cx, cy, r, lw, 0, 360, C.trk);
  if (pct > 0) arc(ctx, cx, cy, r, lw, -90, -90 + 360 * Math.min(pct, 1), color);
}

const { data: n, stale } = await cached("nut", () => gw("nutrition_today"));
const kcal = Math.round((n && n.kcal) || 0);
const prot = Math.round((n && n.protein_g) || 0);
const wtr  = Math.round((n && n.water_ml) || 0);
const left = Math.max(GOAL_KCAL - kcal, 0);

const S = 155;
const ctx = new DrawContext(); ctx.size = new Size(S, S); ctx.opaque = false; ctx.respectScreenScale = true;
ring(ctx, S / 2, S / 2, 66, 10, kcal / GOAL_KCAL, C.acc);
ring(ctx, S / 2, S / 2, 52, 10, prot / GOAL_PROT, C.blu);
ring(ctx, S / 2, S / 2, 38, 10, wtr / GOAL_WATER_ML, C.sky);
ctx.setTextAlignedCenter();
ctx.setFont(Font.boldSystemFont(22)); ctx.setTextColor(kcal > GOAL_KCAL ? new Color("#f87171") : C.ink);
ctx.drawTextInRect(String(kcal > GOAL_KCAL ? kcal - GOAL_KCAL : left), new Rect(0, S / 2 - 16, S, 26));
ctx.setFont(Font.systemFont(8)); ctx.setTextColor(C.mut);
ctx.drawTextInRect(kcal > GOAL_KCAL ? "kcal aşıldı" : "kcal kaldı", new Rect(0, S / 2 + 10, S, 12));

const w = new ListWidget(); w.backgroundColor = C.bg; w.setPadding(0, 0, 0, 0);
w.backgroundImage = ctx.getImage();
w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
if (stale) { const t = w.addText(" ⚠︎"); t.font = Font.systemFont(8); t.textColor = C.mut; }
Script.setWidget(w);
if (config.runsInApp) await w.presentSmall();
Script.complete();
```

---

## Troubleshooting
- **Empty/zero values:** check `SECRET` matches Vault's `PHONE_GATEWAY_SECRET`
  and that `phone-gateway` is deployed (all four widgets share it).
- **"⚠︎ çevrimdışı veri":** the last fetch failed; the widget is showing its
  cached copy. It self-heals on the next successful refresh.
- **W3 buttons do nothing:** script names must match the URLs exactly —
  runner `HizliLog`, food logger `Yemek Logla`, shortcut `Barkod Tara`.
- **Refresh cadence:** iOS batches widget refreshes (~15–60 min). Opening
  Scriptable and running a script updates immediately.
