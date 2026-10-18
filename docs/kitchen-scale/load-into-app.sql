-- Kitchen scale → the Projects page (one-off load, run ONCE in the Supabase
-- SQL editor AFTER the PR with migration 162 is merged and deployed).
-- Copies docs/kitchen-scale/README.md as it was on 18.10.2026: the project,
-- its 7 phases with their tasks, the parts table, the log, the questions and
-- decisions, the guides and the source links. The README stays the source of
-- truth for the technical detail; this is the working copy in the app.
-- It refuses to run twice (it stops if a project named "Kitchen scale" exists)
-- and runs as one transaction: an error leaves nothing behind.
do $import$
declare
  v_user    uuid;
  v_project uuid;
  v_ph      uuid[] := '{}';
  v_phase   uuid;
  v_parts   uuid;
  v_log     uuid;
  v_dec     uuid;
  v_guides  uuid;
  v_links   uuid;
  i         integer;
begin
  -- The owner: the one account the owner lock lets in.
  if (select count(*) from public.app_allowed_users) <> 1 then
    raise exception 'More than one allowed account: set v_user by hand at the top of this script.';
  end if;
  select user_id into v_user from public.app_allowed_users;
  if exists (select 1 from public.projects where user_id = v_user and name = 'Kitchen scale') then
    raise exception 'A project named "Kitchen scale" already exists — nothing was loaded.';
  end if;

  -- ── The project ──────────────────────────────────────────────────────────
  insert into public.projects (user_id, name, description, notes, status, kind, area, status_line, status_line_at,
                               started_on, link_url, sort_order)
  values (v_user, 'Kitchen scale',
    'A home-made Wi-Fi kitchen scale with its own touchscreen: pick a food, weigh it, and Save puts it into Food → Today.',
    $t$The technical document stays in git: `docs/kitchen-scale/README.md` (parts, hardware facts with their sources, the design, the guides). Firmware: `firmware/kitchen-scale`.$t$,
    'active', 'hardware', 'personal',
    'Stage 1 code ready — waits for the soldering iron', '2026-10-14 20:00+02',
    '2026-10-13', 'https://github.com/Lasciviens/Project_Daily/blob/main/docs/kitchen-scale/README.md',
    coalesce((select max(sort_order) + 1 from public.projects where user_id = v_user), 0))
  returning id into v_project;

  -- ── The plan: 7 phases, each with its check ──────────────────────────────
  insert into public.project_phases (user_id, project_id, name, done_when, status, done_at, sort_order) values
    (v_user, v_project, 'Know the parts', 'The screen works, touch is found and lines up with your finger, and the log lines are sent back.', 'done', '2026-10-14 18:00+02', 0)
  returning id into v_phase; v_ph := v_ph || v_phase;
  insert into public.project_phases (user_id, project_id, name, done_when, status, sort_order) values
    (v_user, v_project, 'Weighing on the bench', '5 objects match the Chef Matteo scale within about 1–2 g, and the reading stays steady for 10 minutes with and without a load.', 'in_progress', 1)
  returning id into v_phase; v_ph := v_ph || v_phase;
  insert into public.project_phases (user_id, project_id, name, done_when, status, sort_order) values
    (v_user, v_project, 'The scale works on its own', 'Used as a normal kitchen scale for a few days (no internet).', 'pending', 2)
  returning id into v_phase; v_ph := v_ph || v_phase;
  insert into public.project_phases (user_id, project_id, name, done_when, status, sort_order) values
    (v_user, v_project, 'Logging from the scale', 'A weighed plate shows in Food → Today with the right numbers.', 'pending', 3)
  returning id into v_phase; v_ph := v_ph || v_phase;
  insert into public.project_phases (user_id, project_id, name, done_when, status, sort_order) values
    (v_user, v_project, 'Phone and scale together', 'Scan → weigh → save without typing.', 'pending', 4)
  returning id into v_phase; v_ph := v_ph || v_phase;
  insert into public.project_phases (user_id, project_id, name, done_when, status, sort_order) values
    (v_user, v_project, 'Housing and reliability', 'A week of daily use; the zero holds and the drift stays small.', 'pending', 5)
  returning id into v_phase; v_ph := v_ph || v_phase;
  insert into public.project_phases (user_id, project_id, name, done_when, status, sort_order) values
    (v_user, v_project, 'Later, if wanted', null, 'pending', 6)
  returning id into v_phase; v_ph := v_ph || v_phase;

  -- ── Its tasks: real tasks, undated, in Backlog, not on Google ─────────────
  insert into public.tasks (user_id, title, domain, section, status, priority, sort_order, source_type,
                            google_sync_enabled, project_id, project_phase_id, completed_at)
  select v_user, t.title, 'personal', 'backlog', t.status, 'medium', t.ord, 'manual', false, v_project, v_ph[t.phase],
         case when t.status = 'done' then timestamptz '2026-10-14 18:00+02' end
  from (values
    (1, 0, 'Photograph the display board (both sides), the HX711 and the load-cell label', 'done'),
    (1, 1, 'Install VS Code + PlatformIO and flash the board-check firmware', 'done'),
    (1, 2, 'Check the screen, touch and the log lines', 'done'),
    (1, 3, 'Pin finder: which H1 pin is which GPIO (optional)', 'open'),
    (2, 0, 'Write the weighing code (scale_core) and the bench program', 'done'),
    (2, 1, 'Solder the HX711''s 4 header pins and the load-cell wires', 'open'),
    (2, 2, 'Wire the HX711 to the ESP32-S3 dev board at 3.3 V (DT → GPIO 4, SCK → GPIO 5)', 'open'),
    (2, 3, 'Build the temporary rig: load cell between two boards with spacers', 'open'),
    (2, 4, 'Flash the bench program and calibrate with a known weight', 'open'),
    (2, 5, 'Compare 5 objects with the Chef Matteo scale', 'open'),
    (2, 6, 'Noise test, empty and with the reference object', 'open'),
    (2, 7, 'Drift: 10 minutes with the reference object on', 'open'),
    (2, 8, 'The same wiring on the display board''s free pins', 'open'),
    (3, 0, 'Big gram number, a "stable" mark and Tare', 'open'),
    (3, 1, 'Setup screen for Wi-Fi and the scale secret', 'open'),
    (3, 2, 'Screen dimming', 'open'),
    (4, 0, 'The scale-gateway function and its secret', 'open'),
    (4, 1, 'The scale''s food picker: favourites, recents, usual for this meal, search', 'open'),
    (4, 2, 'Weighing screen: live kcal and macros, meal by time of day, Save, Undo last, Next item', 'open'),
    (4, 3, 'Read-only Kitchen scale card on Settings → Subscriptions', 'open'),
    (4, 4, 'Security review before it ships', 'open'),
    (5, 0, 'Scan a barcode on the phone → "Send to scale"', 'open'),
    (5, 1, '"Use scale weight" in the website''s food logger', 'open'),
    (5, 2, 'A small table for the scale''s state (migration with database tests)', 'open'),
    (6, 0, 'Final housing: food-safe platform, stop screw, strain relief', 'open'),
    (6, 1, 'The screen on the base, not the platform', 'open'),
    (6, 2, 'USB-C power only; updates over Wi-Fi', 'open'),
    (7, 0, '5-per-second live weight on the website', 'open'),
    (7, 1, 'Saving while offline', 'open'),
    (7, 2, 'Recipes and daily totals on the scale', 'open'),
    (7, 3, 'RFID tags for bowls and jars', 'open')
  ) as t(phase, ord, title, status);

  -- ── Blocks ──────────────────────────────────────────────────────────────
  insert into public.project_blocks (user_id, project_id, kind, title, settings, sort_order) values
    (v_user, v_project, 'table', 'Parts', jsonb_build_object(
      'columns', jsonb_build_array(
        jsonb_build_object('key', 'part', 'label', 'Part', 'type', 'text'),
        jsonb_build_object('key', 'qty', 'label', 'Qty', 'type', 'number'),
        jsonb_build_object('key', 'role', 'label', 'Role', 'type', 'text'),
        jsonb_build_object('key', 'check', 'label', 'To check', 'type', 'text'),
        jsonb_build_object('key', 'state', 'label', 'Status', 'type', 'status', 'options', jsonb_build_array('In hand', 'To buy', 'Ordered')),
        jsonb_build_object('key', 'price', 'label', 'Price', 'type', 'money'),
        jsonb_build_object('key', 'group', 'label', 'Group', 'type', 'text')),
      'groupBy', 'group', 'currency', 'NOK'), 0)
  returning id into v_parts;
  insert into public.project_blocks (user_id, project_id, kind, title, sort_order) values (v_user, v_project, 'log', 'Log', 1) returning id into v_log;
  insert into public.project_blocks (user_id, project_id, kind, title, sort_order) values (v_user, v_project, 'decisions', 'Questions and decisions', 2) returning id into v_dec;
  insert into public.project_blocks (user_id, project_id, kind, title, sort_order) values (v_user, v_project, 'pages', 'Guides', 3) returning id into v_guides;
  insert into public.project_blocks (user_id, project_id, kind, title, sort_order) values (v_user, v_project, 'links', 'Links', 4) returning id into v_links;

  -- Parts (project_id is filled from the block)
  insert into public.project_entries (user_id, block_id, data, sort_order)
  select v_user, v_parts, jsonb_strip_nulls(jsonb_build_object('part', p.part, 'qty', p.qty, 'role', p.role, 'check', p.chk,
           'state', p.state, 'price', p.price, 'group', p.grp)), p.ord
  from (values
    (0,  'ESP32-4848S040 display board (Guition): ESP32-S3 N16R8, 4" 480×480 touchscreen', 1::numeric, 'The scale''s brain and screen', 'Checked in stage 0: no relay back plate, version V1.2', 'In hand', null::numeric, 'Boards'),
    (1,  'ESP32-S3 N16R8 development board', 1, 'Bench board for stage 1; possible RFID host later', 'Exact board; one or two USB-C ports (bench or bench_native_usb)', 'In hand', null, 'Boards'),
    (2,  'Arduino Uno (Kjell Arduino Startpakke, art. 87875)', 1, 'Spare', null, 'In hand', null, 'Boards'),
    (3,  'HX711 load-cell amplifier module', 1, 'Turns the load cell''s tiny signal into numbers', 'Colour (green = one VCC pin, red = VCC + VDD); E− tied to GND?; header pins soldered?', 'In hand', null, 'Weighing'),
    (4,  'Load cell, bar type ("single point")', 1, 'The metal bar that bends a tiny bit under the weight', 'Capacity on its label (5 kg?), the arrow, screw size (M4 or M5)', 'In hand', null, 'Weighing'),
    (5,  'MX1.25 4-pin to Dupont female cable, 200 mm', 10, 'Fits the display board''s P1 (the serial port) — not for the HX711', null, 'In hand', null, 'Cables and connectors'),
    (6,  'Jumper wires (Fun Kit + Kjell)', null, 'Breadboard wiring', null, 'In hand', null, 'Cables and connectors'),
    (7,  '40-pin male header strips', 3, 'Soldered onto the HX711 so it plugs into a breadboard', null, 'In hand', null, 'Cables and connectors'),
    (8,  'Breadboards (Fun Kit + Kjell, 400 points)', 2, 'Wiring without soldering', null, 'In hand', null, 'Cables and connectors'),
    (9,  'Solder wire 63/37 tin-lead, CF-10, 50 g', 1, 'Contains lead: fresh air, wash your hands, never on a food surface', null, 'In hand', null, 'Soldering'),
    (10, 'Soldering iron FNIRSI HS-02A, 6-tip box', 1, 'Stage 1: the HX711''s header pins', null, 'Ordered', null, 'Soldering'),
    (11, 'MFRC522 (RC522) RFID reader with tags and a card', 1, 'Later (stage 6): a tag under each bowl or jar', 'Needs 5 pins (SPI) and 3.3 V — the dev board, not the display board', 'In hand', null, 'RFID'),
    (12, 'Multimeter', 1, 'Check the 3.3 V supply before stage 1c', null, 'To buy', 200, 'To get'),
    (13, 'USB-C power adapter, 5 V, at least 1 A', 1, 'Power for the scale', null, 'To buy', null, 'To get'),
    (14, 'Two stiff plates about 20 × 20 cm, two spacers, screws for the load cell, one stop screw', 1, 'Platform and base', null, 'To buy', null, 'To get'),
    (15, 'microSD "sniffer" breakout (optional)', 1, 'Reaches GPIO 41/42 and 3.3 V without soldering on the display board', null, 'To buy', null, 'To get'),
    (16, 'A reference weight weighed on the Chef Matteo scale (a filled water bottle)', 1, 'Calibration', null, 'To buy', null, 'To get')
  ) as p(ord, part, qty, role, chk, state, price, grp);

  -- Log (newest first in the app)
  insert into public.project_entries (user_id, block_id, entry_date, title, body, sort_order) values
    (v_user, v_log, '2026-10-13', 'Plan written, parts recorded', $t$- Plan written and parts inventory recorded.
- Hardware facts checked against board files, datasheets and a photo of one board revision (sources in the README).$t$, 0),
    (v_user, v_log, '2026-10-14', 'Stage 0 firmware ready', $t$The board-check firmware (`firmware/kitchen-scale`, v0.1.0) builds with PlatformIO: 396 KB, no warnings from our files.$t$, 1),
    (v_user, v_log, '2026-10-14', 'Stage 0 flashed and checked on the board', $t$- VS Code 1.141.2 + PlatformIO IDE 3.3.4; uploaded over USB-C on the first try (the CH340 works with macOS's built-in driver).
- Screen: text clear, Chip, Flash and PSRAM right, "Touch: GT911 found" green. Touch lines up with the finger.
- Back of the board: no relay back plate; version V1.2.

```
Kitchen scale - stage 0 board check - v0.1.0
Chip: ESP32-S3 rev 2, 2 cores, 240 MHz
Flash: 16777216 bytes, PSRAM: 8388608 bytes (8384788 free)
Screen: started
Touch: GT911 at 0x5D
```$t$, 2),
    (v_user, v_log, '2026-10-14', 'Stage 1 code ready (not run on hardware yet)', $t$- Weighing logic (`lib/scale_core`): spike filter (median of 3), an average of 8 that restarts on a change over 4 g, tare when stable, calibration from a known weight, zero tracking within 0.5 g.
- `node scripts/verify-scale-core.mjs` passes 32 checks; all three programs build.
- Not run on hardware: it waits for the soldering iron.$t$, 3);

  -- Questions and decisions
  insert into public.project_entries (user_id, block_id, state, entry_date, title, body, sort_order) values
    (v_user, v_dec, 'open', null, 'Exact part names', 'The ESP32-S3 dev board and its USB-C ports (one or two), the HX711''s colour, the load cell''s capacity. Read them off the parts when they''re out on the table.', 0),
    (v_user, v_dec, 'open', null, 'GPIO 40/2/1: header H1 or the speaker amplifier?', 'Small 0 Ω resistors on the board decide this; the pin finder test will show it.', 1),
    (v_user, v_dec, 'decided', '2026-10-14', 'First version: scan on the phone, weigh and save on the scale', 'The website about one second behind. No remote Tare.', 2),
    (v_user, v_dec, 'decided', '2026-10-14', 'Computer: a Mac', 'No 3D printer, no multimeter.', 3),
    (v_user, v_dec, 'decided', '2026-10-14', 'SD card not needed', 'One is available, but the scale doesn''t need it. GPIO 41/42 stay free.', 4),
    (v_user, v_dec, 'decided', '2026-10-14', 'RFID waits for a later stage', 'Tags and a card came with the reader.', 5),
    (v_user, v_dec, 'decided', '2026-10-14', 'Start the plan and the code before the soldering iron arrives', null, 6),
    (v_user, v_dec, 'decided', '2026-10-14', 'The Uno step is dropped', 'The ESP32-S3 dev board is just as safe at 3.3 V, and one program to learn is simpler than two. The Uno stays a spare.', 7),
    (v_user, v_dec, 'decided', '2026-10-14', 'No relay back plate', 'Owner''s photo of the back of the board.', 8);

  -- Guides (the README keeps the full text)
  insert into public.project_entries (user_id, block_id, title, body, sort_order) values
    (v_user, v_guides, 'Design', $t$```
Load cell → HX711 → display board ──HTTPS + scale secret──▶ scale-gateway ──▶ Supabase
Phone / website (your normal login) ──────────────────────────────────────────┘
```

- **Its own path:** a `scale-gateway` edge function with its own secret; revoking the scale never touches another device.
- **A save is an ordinary diary row:** one `food_log_entries` row (food + grams + meal), eaten; the database computes its calories.
- **The live link:** while awake the scale checks in about once a second; the website sees the weight about one second behind.
- **Secrets stay on the board:** Wi-Fi password and scale secret typed on the touchscreen, never in the code.

Full text: `docs/kitchen-scale/README.md` → Design.$t$, 0),
    (v_user, v_guides, 'Flashing from the Mac', $t$## One-time setup
1. Install Visual Studio Code, then the PlatformIO IDE extension; restart VS Code.
2. Get the repo onto the Mac, on the branch with the firmware.
3. File → Open Folder → `firmware/kitchen-scale`.
4. Click ✓ (Build) in the bottom bar. The first build downloads about 1 GB; it ends with `SUCCESS`.

## Flash and read the log
1. Connect the display board with a USB-C **data** cable.
2. Click → (Upload). No port: try another cable; still nothing: the CH340 driver from WCH.
3. Click the plug icon (Serial Monitor); press RST to see the start-up lines again.

Full text: `docs/kitchen-scale/README.md` → Flashing from the Mac.$t$, 1),
    (v_user, v_guides, 'Stage 1: weighing on the bench', $t$## Solder and wire
1. Solder the 4 header pins onto the HX711's GND, DT, SCK and VCC.
2. Load cell wires: red → E+, black → E−, white → A−, green → A+ (B+ and B− stay empty).
3. With USB unplugged: VCC → 3V3 (**never 5V**), GND → GND, DT → GPIO 4, SCK → GPIO 5.
4. One end block on the base, the other on the platform, each with a spacer; the arrow points down.

## Flash and calibrate
1. Two USB-C ports: the COM/UART one with `bench`; one port: `bench_native_usb`.
2. `pio run -e bench -t upload`, then `pio device monitor`.
3. Press the platform: the raw number must move by thousands.
4. Empty: `t`. Reference object on: `c <grams>`.

## Check and report
- Five objects within 1–2 g of the Chef Matteo scale.
- Noise test `n`: a spread of 1 g or less.
- Drift: 10 minutes, 2–3 g of change or less.

Full text: `docs/kitchen-scale/README.md` → Stage 1.$t$, 2),
    (v_user, v_guides, 'Hardware facts', $t$Pin numbers, limits and their sources, each marked **C** (a primary source confirms it) or **L** (likely), live in `docs/kitchen-scale/README.md` → Hardware facts (checked 14.10.2026). Pin numbers in code come only from `firmware/kitchen-scale/include/board_*.h`.

- The HX711 runs on 3.3 V when an ESP32 reads it — never 5 V on its data line.
- Never put the HX711 on P1 / GPIO 43–44: that is the flashing and log line.$t$, 3);

  -- Links
  insert into public.project_entries (user_id, block_id, title, url, body, sort_order) values
    (v_user, v_links, 'The plan (README)', 'https://github.com/Lasciviens/Project_Daily/blob/main/docs/kitchen-scale/README.md', 'The source of truth for parts, facts and guides.', 0),
    (v_user, v_links, 'Firmware', 'https://github.com/Lasciviens/Project_Daily/tree/main/firmware/kitchen-scale', null, 1),
    (v_user, v_links, 'rzeldent board files (Sunton/Guition)', 'https://github.com/rzeldent/platformio-espressif32-sunton', 'Pin facts for the display board', 2),
    (v_user, v_links, 'ESPHome device page', 'https://devices.esphome.io/devices/guition-esp32-s3-4848s040/', null, 3),
    (v_user, v_links, 'HX711 datasheet', 'https://cdn.sparkfun.com/datasheets/Sensors/ForceFlex/hx711_english.pdf', null, 4),
    (v_user, v_links, 'HX711_ADC library', 'https://github.com/olkal/HX711_ADC', null, 5);

  raise notice 'Kitchen scale loaded: 7 phases, 31 tasks, 5 blocks.';
end
$import$;
