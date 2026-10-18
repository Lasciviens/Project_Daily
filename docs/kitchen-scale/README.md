# Kitchen scale

A home-made Wi-Fi kitchen scale with its own touchscreen. You pick a food (or scan it on the phone), put it on the scale, and it shows the weight and the calories and macros from the food library. Save puts it into Food → Today.

This file is the project's one place for the parts in hand, the checked hardware facts, the design, the plan and the progress log. Update it in the same PR as any work on the scale. The app's Projects page holds a working copy (tasks, parts, log, decisions), loaded once from this file by `load-into-app.sql` (18.10.2026); this file stays the source of truth.

**Status (14.10.2026):** stage 0 is done on the owner's display board: chip, 16 MB flash, 8 MB PSRAM, screen and touch all work, and the back of the board is recorded (no relay back plate, board version V1.2). The only thing left open is the optional pin finder test. Stage 1 code (the weighing logic and the bench program) is ready and waits for the soldering iron. Nothing has been wired or built yet. Nothing in the app, the database or the edge functions has changed for the scale.

## Progress log

Newest on top. One entry per real step: what was done, what was run or measured, what it showed.

- **14.10.2026 · stage 1 code ready (not run on hardware yet)**
  - Weighing logic, `firmware/kitchen-scale/lib/scale_core`:
    - spike filter (median of 3 readings), then an average of 8 readings that restarts on a change over 4 g, so the number follows a new weight at once
    - tare that waits for a stable reading; calibration from a known weight, which also works with the signal wires swapped
    - "stable" when the 8 readings lie within 1 g; zero tracking within 0.5 g; overload above 5000 g or at the HX711's limits
  - Checked on a computer: `node scripts/verify-scale-core.mjs` passes 32 checks. Five deliberately broken copies (spike filter, zero tracking, jump restart, stability window, tare) each fail at least one check.
  - HX711 reader (`lib/hx711_reader`) and the bench program (`src/bench`, programs `bench` and `bench_native_usb`): weight 5 times a second, typed commands, the calibration saved on the board.
  - All three programs build (`display`, `bench`, `bench_native_usb`); our own files now build with warnings treated as errors.
  - Not run on hardware: it waits for the soldering iron (*Stage 1: weighing on the bench* below).
- **14.10.2026 · stage 0 flashed and checked on the board**
  - Setup on the Mac: VS Code 1.141.2 + PlatformIO IDE 3.3.4, PlatformIO Core 6.2.0 (same as CI).
  - `pio run -e display` built locally: 396,144 bytes, no warnings from our files. Uploaded over USB-C on the first try; the CH340 (USB VID:PID 1A86:7523) worked with macOS's built-in driver, no extra install.
  - esptool at upload: ESP32-S3 (QFN56) revision v0.2, embedded PSRAM 8 MB, 40 MHz crystal, flash auto-detected as 16 MB. All four images written and hash-verified.
  - Serial log after a reset (115200 baud):
    ```
    Kitchen scale - stage 0 board check - v0.1.0
    Chip: ESP32-S3 rev 2, 2 cores, 240 MHz
    Flash: 16777216 bytes, PSRAM: 8388608 bytes (8384788 free)
    Screen: started
    Touch: GT911 at 0x5D
    ```
    This confirms the N16R8 module (16 MB flash, 8 MB PSRAM) and the GT911 at its usual address 0x5D.
  - Screen (owner): the text shows clearly, the Chip, Flash and PSRAM lines are right, and "Touch: GT911 found" is green. The 12 MHz pixel clock gives no visible glitches.
  - Touch (owner + serial log): the dot appears right under the finger, with no mirroring or rotation. Taps on the four corners of the drawing box (y 200–380, x 22–458) came back as about (40, 215) top left, (438, 214) top right, (434, 366) bottom right and (40, 377) bottom left.
  - Back of the board (owner's phone photo, read in another session; the photo is not in the repo): no relay back plate. The board sits alone in a metal housing and nothing is plugged into header H1.
  - Silkscreen: "ESP32-4848S040" and the Guition logo. Next to the SD slot it reads "TF1 V1.2": TF1 is the SD slot's label, V1.2 is likely the board version. Date code "2525", likely 2025, week 25. Read from a photo, so not 100 % certain.
  - Module: "sparkle IoT ESP32-S3", marked N16R8, with an external antenna on a u.FL cable running to an antenna strip at the bottom edge of the housing.
  - On the board:
    - CH340C USB-serial chip
    - RST and BOOT buttons
    - P1 4-pin socket (+5V, TX, RX, GND)
    - P6 "BAT" battery socket with an IP5306 charger chip
    - P7 "speak" speaker socket with an amplifier chip next to it
    - microSD slot (TF1)
    - an unfitted P2 footprint between the buttons
  - Not done yet: the optional pin finder.

- **14.10.2026 · stage 0 firmware ready**
  - The board-check firmware (`firmware/kitchen-scale`, v0.1.0) builds with PlatformIO in the cloud session: 396 KB, no warnings from our files.
  - Not flashed yet: next step is *Flashing from the Mac* below.
  - The owner's answers are recorded under *Decisions*.
- **14.10.2026 · plan**
  - Plan written and parts inventory recorded.
  - Hardware facts checked against board files, datasheets and a photo of one board revision (sources under *Hardware facts*).
  - Waiting on the owner's answers under *Open questions*.

## Parts in hand

### Boards

| Part | Qty | Role in the scale | To check |
|---|---|---|---|
| ESP32-4848S040 (Guition): ESP32-S3 N16R8, 4" 480×480 touchscreen, Wi-Fi + Bluetooth | 1 | The scale's brain and screen | Checked in stage 0: no relay back plate, version V1.2 |
| ESP32-S3 N16R8 development board | 1 | Bench board for stage 1. Same chip as the display board, with many free pins at 3.3 V, so the weighing code is built and tested here first. Possible RFID host later. | Exact board (print on it); one or two USB-C ports, which decides `bench` or `bench_native_usb` |
| Arduino Uno, from Kjell's "Arduino Startpakke" (art. 87875) | 1 | Spare: stage 1 goes straight to the ESP32-S3 dev board (see *Plan*) | — |

### Weighing

| Part | Qty | Role | To check |
|---|---|---|---|
| HX711 load-cell amplifier module | 1 | Turns the load cell's tiny signal into numbers | Colour (green = one VCC pin, red = VCC + VDD); whether E− is tied to GND; whether the header pins are soldered |
| Load cell, bar type ("single point") | 1 | The metal bar that bends a tiny bit under the weight | Capacity on its label (the brief says 5 kg), the arrow, screw size (M4 or M5) |

### Cables and connectors

| Part | Qty | Role |
|---|---|---|
| MX1.25 4-pin to Dupont female cable, 200 mm | 10 | Fits the display board's P1 plug (GND, RX, TX, +5 V: the serial port). Not for the HX711 (see *Hardware facts*). Useful for serial logs or linking two boards. |
| Jumper wires: 65 (Fun Kit) + 20 female–male Dupont (Fun Kit) + 70 solid + 2 stranded (Kjell) | — | Breadboard wiring |
| 40-pin male header strips: 2 (Fun Kit) + 1 (Kjell) | 3 | Soldered onto the HX711 so it plugs into a breadboard |
| Breadboards: Fun Kit + Kjell (400 points) | 2 | Wiring without soldering |

### Soldering

| Part | Qty | Note |
|---|---|---|
| Solder wire 63/37 tin-lead, CF-10, 50 g | 1 | Contains lead: work with fresh air, wash your hands afterwards, and never solder on a surface used for food. |

### RFID

| Part | Qty | Note |
|---|---|---|
| MFRC522 (RC522) RFID reader, 13.56 MHz, with tags and a card | 1 | Later (stage 6); the owner wants it. **Idea:** a sticker tag under each bowl or jar. The scale reads it and knows the bowl's own weight (automatic tare) or which food is in the jar. It needs 5 pins (SPI bus) and 3.3 V. The display board has no pins left for it next to the HX711; the ESP32-S3 dev board does. |

### Electronics Fun Kit (full list)

- **Power and bench:** power supply module (MB102 breadboard supply: 3.3 V or 5 V per rail, a clean 3.3 V for the HX711 on the bench), breadboard.
- **Chips:** 74HC595 shift register ×1, 4N35 optocoupler ×1.
- **Inputs:** 10 kΩ precision potentiometer ×1, buttons ×10, photoresistors ×2, thermistor ×1.
- **Sound:** passive buzzer ×1, active buzzer ×1 (a beep for "stable" or "saved").
- **Wires and headers:** female–male Dupont wires ×20, a 65-piece jumper wire set, 40-pin headers ×2.
- **Capacitors:**
  - electrolytic 100 µF 50 V ×5 and 10 µF 50 V ×5
  - ceramic 22 pF ×10 and 104 (100 nF) ×10

  The 100 nF and 10 µF ones can smooth the HX711's power.
- **Other parts:** PN2222 transistors ×5, diodes ×5.
- **LEDs:** RGB ×1; red, yellow, blue, green and white ×10 each.
- **Resistors:** 10 Ω, 100 Ω, 330 Ω, 1 kΩ, 2 kΩ, 5.1 kΩ, 10 kΩ, 100 kΩ and 1 MΩ ×10 each; 220 Ω ×30.

### Kjell "Arduino Startpakke", art. 87875 (full list)

- **Board and book:** Arduino Uno, USB cable, project book (170 pages, English, 15 projects), wooden base, 9 V battery.
- **Wiring:** breadboard (400 points), 70 solid jumper wires, black and red stranded wire, 40×1 male header.
- **Display:** 16×2 character LCD (can show the weight in the Uno practice step).
- **Sensors:** TMP36 temperature sensor, tilt sensor, phototransistors ×6.
- **Inputs:** 10 kΩ potentiometers ×3, buttons ×10.
- **Outputs:** piezo buzzer, small DC motor, small servo motor.
- **Chips and power parts:** L293D H-bridge motor driver, 4N35 optocoupler, IRF520 MOSFETs ×2, 1N4007 diodes ×5, 100 µF capacitors ×3.
- **LEDs:** white ×1, RGB ×1, red ×8, green ×8, yellow ×8, blue ×3.
- **Other:** coloured gels ×3.
- **Resistors:** 220 Ω ×20, 560 Ω ×5, 1 kΩ ×5, 4.7 kΩ ×5, 10 kΩ ×20, 1 MΩ ×5, 10 MΩ ×5.

## Not in hand yet: to confirm or get

- **Soldering iron:** FNIRSI HS-02A, 6-tip box, ordered and on its way (14.10.2026). Stage 1 needs it: the HX711's header pins must be soldered.
- **Multimeter:** none. Stage 0 doesn't need one (the pin finder uses an LED instead). Recommended before stage 1c, to check the 3.3 V supply; a basic one costs about 200 NOK.
- **USB-C power adapter:** 5 V, at least 1 A.
- **Platform and base:**
  - two stiff plates about 20 × 20 cm (plywood, acrylic or a cutting board)
  - two spacers, plus screws that fit the load cell
  - one stop screw, so a dropped pot can't overload the cell
- **Optional: microSD "sniffer" breakout.** It plugs into the SD slot and reaches GPIO 41/42 and 3.3 V without soldering on the display board.
- **A reference weight:** anything weighed on the Chef Matteo scale (a filled water bottle works).

## Hardware facts (checked 14.10.2026)

Confidence: **C** = a primary source confirms it; **L** = likely (community sources or reasoning). The pin facts come from board files and a photo of one board revision (marked "TF1 V1.0", date code 2343). Check them on our own board before wiring.

### ESP32-4848S040 display board

- **Module:** ESP32-S3-WROOM-1 N16R8, i.e. 16 MB flash and 8 MB PSRAM. Screen controller ST7701S at 480×480, touch controller GT911. **C**
- **Pins already used:**
  - screen data GPIO 0, 3–15, 20, 46
  - screen timing 16, 17, 18, 21
  - screen setup bus 39, 47, 48
  - backlight 38
  - touch I2C 19, 45
  - PSRAM 33–37
  - SD card 41, 42, sharing 47 and 48

  **C** (SD card **L**)
- **Pins left:** **L**
  - GPIO 1, 2, 40: only without the relay back plate and audio
  - GPIO 41, 42: only without an SD card
  - GPIO 43/44: the serial port (see P1)
- **USB-C** runs through a CH340C USB-to-serial chip to GPIO 43/44, with automatic reset for flashing. **C**
- **P1** (4 pins, about 1.25 mm apart, fits the MX1.25 cables): GND, RX (GPIO44), TX (GPIO43), **+5 V**. **C**
  - This is the flashing and log line, so it is **not for the HX711**.
- **H1** (2×4 header, 2.54 mm, Dupont ends fit):
  - right column: GND, RXD, TXD, 5V **C**
  - left column: GND plus three unlabelled pins, likely GPIO 40/2/1 **L**
- **Test pad S3** = +3.2 V. **C**
- **Relay back plate (mains power):** don't use it in the scale. One owner found its safety parts missing from the factory. Power the scale over USB-C only. **C**
- **Board version:** the source photo behind these facts showed a V1.0 board; the owner's board is V1.2. **C** (owner's photo)
  - "TF1" is the SD slot's label, not the board revision.
  - Screen and touch work the same on both versions (stage 0 on the owner's board).
- **Battery socket:** the board has one (P6, IP5306 charger chip), so a battery-powered scale is possible later. **C** (owner's photo)
- **Metal housing:** it may weaken Wi-Fi; plan the antenna's position in the final enclosure. **L**

Sources:
- [rzeldent board files](https://github.com/rzeldent/platformio-espressif32-sunton) and their [back photo](https://github.com/rzeldent/platformio-espressif32-sunton/blob/main/assets/images/esp32-4848S040C-back.jpg)
- [ESPHome device page](https://devices.esphome.io/devices/guition-esp32-s3-4848s040/)
- [ha5dzs PlatformIO project](https://github.com/ha5dzs/Guition-ESP32-4848S040-platformio)
- [vanderwulp notes](https://michiel.vanderwulp.be/domotica/Modules/SmartDisplay-ESP32-S3-4.0inch/)
- [HomeDing](https://homeding.github.io/boards/esp32s3/panel-4848S040.htm)

### HX711

- **Power it from 3.3 V when an ESP32 reads it.** It accepts 2.6–5.5 V, but at 5 V its data line would send 5 V into a pin rated for at most 3.6 V. **C** ([datasheet](https://cdn.sparkfun.com/datasheets/Sensors/ForceFlex/hx711_english.pdf))
- **Speed:** 10 readings per second (the usual default) is quieter than 80 and is enough. **C**
- **Bad ground on cheap modules:** some are missing the E− to GND connection, which gives noisy, jumpy readings. A short wire fixes it. **L**
- **Libraries:** [HX711_ADC](https://github.com/olkal/HX711_ADC) (does not block, has tare and smoothing) or [HX711](https://github.com/bogde/HX711) (simpler). **C**
- **Realistic accuracy:** 1 g steps, not 0.1 g.
  - A cheap cell creeps a few grams under a load left on it, and drifts with temperature.
  - So tare before each item. **L/C**

### Load cell

- **Wires:** red E+, black E−, green A+, white A−. If readings come out negative, swap green and white. **C**
- **Mounting:** a "Z" shape. **C**
  - One end block is bolted to the base and the other to the platform, each through a spacer.
  - Only the end blocks touch; the middle floats.
  - The arrow points down.
- **Limits:**
  - Safe overload is 120 % (6 kg for a 5 kg cell), so add a stop screw. **C**
  - Platform about 15–20 cm square. **L**

### Firmware tools

- **Stack:** PlatformIO + the Arduino framework; LVGL comes in stage 2 for the real screens. **C**
- **Platform:** PlatformIO's own `espressif32` platform still ships Arduino core 2.0.17, which the screen library no longer supports (the build fails on `esp32-hal-periman.h`, checked 14.10.2026). The firmware uses **pioarduino** 55.03.312 (Arduino core 3.3.12, 20.09.2026), the community-maintained platform that brings core 3 to PlatformIO. **C**
- **Screen:** Arduino_GFX 1.6.8 with its own preset values for this board (12 MHz pixel clock; one project saw glitches at 16 MHz). **C**
- **Touch:** our own read-only GT911 reader. The common TAMC_GT911 library rewrites the touch chip's stored configuration at every start, with a checksum computed from an uninitialised variable. **C** (read in its source)
- **HX711 reader:** our own (`lib/hx711_reader`). Interrupts are off during each read, because a clock pulse held high for over 60 µs switches the HX711 off. **C** (datasheet)
- **Firmware layout:**
  - `platformio.ini`: the programs `display`, `bench` and `bench_native_usb` share one N16R8 settings block.
  - Pins only in `include/board_4848s040.h` and `include/board_bench.h`.
  - `lib/scale_core`: the weighing logic, with no Arduino calls, checked on a computer by `scripts/verify-scale-core.mjs` on every PR.
  - Our own `src/` builds with `-Wall -Wextra -Werror`; the *Firmware check* workflow builds all three programs.
- **Other known setup:** [esp32-smartdisplay](https://github.com/rzeldent/esp32-smartdisplay) (LVGL 9) supports this board too; its CIY1 board file puts the LED on GPIO 16, which is the screen's HSYNC line. **C**
- **Expected behaviour:** the screen pauses while flash memory is written (updates over Wi-Fi, saving settings). **C**

### Supabase and the network

- **Edge Functions, free plan:** 500,000 calls a month. **C** ([pricing](https://supabase.com/pricing))
- **Realtime, free plan:** **C** ([limits](https://supabase.com/docs/guides/realtime/limits))
  - 2 million messages a month, 100 a second, 200 connections
  - a broadcast counts 1 message, plus 1 per receiver
- **Realtime from the ESP32:** the ESP32 Supabase library ([ESPSupabase](https://github.com/jhagas/ESPSupabase)) can't send broadcasts. A device login expires every hour, and each refresh token works only once. **C**
- **No direct connection:** the website can't talk to the scale over home Wi-Fi. iPhone browsers block an unencrypted connection from an HTTPS page to a device at home. **C**
- **No MQTT broker:** HiveMQ Cloud's free plan closes 31.12.2026, so no broker there. **C**

## Design (first-version scope approved by the owner 14.10.2026)

```
Load cell → HX711 → display board ──HTTPS + scale secret──▶ scale-gateway ──▶ Supabase tables
                                                                                  ▲
Phone / website (your normal login) ──────────────────────────────────────────────┘
```

- **Its own path.**
  - A new edge function, `scale-gateway`, with its own secret (`x-scale-secret`), the same pattern as the RP6 handheld and the Kobo.
  - Revoking the scale never touches another device.
  - It acts as the owner on the server and offers only what the scale needs:
    - a short food list (favourites, recents, usual for this meal) and search
    - "log this food, these grams, this meal"
    - "anything waiting for me?"
- **A save is an ordinary diary row.** One `food_log_entries` row: library food + grams + meal slot, marked eaten.
  - The database computes its calories (migration 106), so there is no new table and no new calculation.
  - Several items on one plate share a meal group ("As meal").
- **The live link.**
  - While awake, the scale checks in about once a second.
  - The reply carries whatever the phone sent, such as a scanned food. The website sees the weight about one second behind.
  - Streaming 5 readings a second through Realtime is a later choice, only if wanted.
- **Secrets stay on the board.** The Wi-Fi password and the scale secret are typed on the touchscreen once and stored on the board, never in the code or the repo.
- **Firmware location.** The firmware lives in this repo in `firmware/kitchen-scale/`. The *Firmware check* workflow compiles it on every PR that touches it. Claude writes and compiles it; the owner flashes the board over USB-C and reports what it shows.

## Plan

Each stage ends with a check the owner does. A stage starts only after the previous one passed.

**0. Know the parts.**
- Photos of the display board (both sides), the HX711 and the load-cell label.
- Install VS Code + PlatformIO and flash the board-check firmware (*Flashing from the Mac*).
- It shows the chip, flash, PSRAM and touch status, draws where you touch, and has the pin finder.
- *Check:* the screen works, touch is found and lines up with your finger, and the log lines are sent back.

**1. Weighing on the bench.**
- **a. ESP32-S3 dev board at 3.3 V:** solder the HX711's header pins and the load-cell wires, then run the bench program (*Stage 1: weighing on the bench*). It is the same chip and the same weighing code as the final scale, with free pins and nothing to risk.
- **b. Display board:** the same wiring on the confirmed free pins (the pin finder decides which).
- The Uno step was dropped (14.10.2026): the dev board is just as safe at 3.3 V, and one program to learn is simpler than two. The Uno stays a spare.
- The load cell sits between two boards with spacers.
- *Check:*
  - 5 objects match the Chef Matteo scale within about 1–2 g
  - the reading stays steady for 10 minutes with and without a load

**2. The scale works on its own (no internet).**
- Big gram number, a "stable" mark, Tare.
- A setup screen for Wi-Fi and the secret.
- Screen dimming.
- *Check:* used as a normal kitchen scale for a few days.

**3. Logging from the scale.**
- The `scale-gateway` function and its secret.
- **The scale's food picker:** favourites, recents, usual for this meal, and search.
- **On the weighing screen:**
  - live kcal and protein/carbs/fat
  - the meal picked by the time of day (Oslo time)
  - Save, and Undo last
  - "Next item", which tares and keeps the plate as one meal group
- A read-only Kitchen scale card on Settings → Subscriptions (last seen, firmware version).
- A security review before it ships.
- *Check:* a weighed plate shows in Food → Today with the right numbers.

**4. Phone and scale together.**
- Scan a barcode on the phone, tap "Send to scale", and the scale shows that food within about a second.
- "Use scale weight" in the website's food logger.
- Needs one small table for the scale's state, as a migration with database tests.
- *Check:* scan → weigh → save without typing.

**5. Housing and reliability.**
- Final housing with a food-safe platform, the stop screw, and strain relief on the cables.
- **The screen sits on the base, not the platform**, so pressing it doesn't change the weight.
- USB-C power only.
- Updates over Wi-Fi.
- *Check:* a week of daily use, the zero holds, the drift stays small.

**6. Later, if wanted.**
- 5-per-second live weight on the website.
- Saving while offline.
- Recipes and daily totals on the scale.
- RFID tags for bowls and jars.

## Decisions

Owner's answers, 14.10.2026:
- **First version:** scan on the phone → weigh and save on the scale, with the website about one second behind. No remote Tare.
- **Computer:** a Mac. No 3D printer, no multimeter.
- **SD card:** one is available, but the scale doesn't need it. GPIO 41/42 stay free for us.
- **RFID:** tags and a card came with the reader. It waits for a later stage.
- **Order:** start the plan and the code before the soldering iron arrives.

## Open questions

1. **Exact part names:** the ESP32-S3 dev board and its USB-C ports (one or two), the HX711's colour, the load cell's capacity. Read them off the parts when they're out on the table.
2. **GPIO 40/2/1:** do they reach header H1 or the speaker amplifier? Small 0 Ω resistors on the board decide this; the pin finder test will show it.

Closed: **Relay back plate**: none (owner's photo of the back, 14.10.2026).

## Flashing from the Mac (stage 0)

One-time setup:
1. Install [Visual Studio Code](https://code.visualstudio.com/). In it, open Extensions and install **PlatformIO IDE**. Restart VS Code when it asks.
2. Get the repo onto the Mac (GitHub Desktop or `git clone`), on the branch with the firmware.
3. In VS Code: File → Open Folder → `firmware/kitchen-scale`. PlatformIO sees the project by itself.
4. Click the ✓ (Build) in the blue bar at the bottom. The first build downloads the tools, about 1 GB, and takes several minutes. It ends with `SUCCESS`.

Flash and read the log:
1. Connect the display board to the Mac with a USB-C **data** cable (some cables only charge).
2. Click → (Upload) in the bottom bar. PlatformIO finds the port by itself.
   - Without a port: try another cable.
   - Still nothing: install the CH340 driver from WCH, the maker of the board's USB chip. Recent macOS usually has it built in.
3. Click the plug icon (Serial Monitor). Press the board's RST button to see the start-up lines again.

What to check and send back:
- **Photos:** the front and back of the display board.
- **The log lines:** "Chip: …", "Flash: …", "Touch: …". Copy them.
- **The screen:** does the text show? Do the Chip, Flash and PSRAM lines show 16 MB flash and 8 MB PSRAM? Does "Touch: GT911 found" show in green?
- **Touch:** draw in the box. Is the dot right under your finger? If it appears mirrored or turned, say which way.

### Pin finder (optional)

This finds which pin on header H1 is which GPIO, without a multimeter.

You need from the kits: a red LED, a 220 Ω resistor, the breadboard and two male–male jumper wires.

1. **Unplug USB.**
2. **Build the LED circuit:**
   - LED long leg → resistor → jumper wire to one of the three unlabelled pins in H1's left column.
   - LED short leg → jumper wire to H1's GND (top left).
3. **Run it:** plug in USB and tap the "Pin finder" button (or type `p` in the Serial Monitor). Count the blinks:
   - 1 = GPIO 40
   - 2 = GPIO 2
   - 3 = GPIO 1
4. **Repeat** for the other two pins: unplug before moving a wire.

Notes:
- The resistor stays in line every time; a wire straight from one pin to another can damage the board.
- If a relay back plate sits on H1, you'll hear the relays click 1, 2 or 3 times instead.

## Stage 1: weighing on the bench

Needs the soldering iron. The program is `bench` in `firmware/kitchen-scale`.

### What you need

- ESP32-S3 dev board, HX711, load cell, breadboard and jumper wires (Kjell kit).
- Soldering iron and solder.
- Two stiff boards for a temporary rig, spacers and screws for the load cell (*Not in hand yet*).
- A reference object weighed on the Chef Matteo scale, for example a full water bottle. Write its grams down.

### Solder and wire

1. Solder the 4 header pins onto the HX711's GND, DT, SCK and VCC holes.
2. Solder the load cell's 4 wires to the HX711's other side:
   - red → E+
   - black → E−
   - white → A−
   - green → A+

   B+ and B− stay empty.
3. Push the HX711 and the dev board into the breadboard and connect, with USB unplugged:

   | HX711 | ESP32-S3 dev board |
   |---|---|
   | VCC (and VDD, if the board has both) | 3V3 — **never 5V** |
   | GND | GND |
   | DT | GPIO 4 |
   | SCK | GPIO 5 |

4. Fix one end block of the load cell to the base board and the other to the platform board, each with a spacer, so only the end blocks touch. The arrow on the cell points down.

### Flash and calibrate

1. **Pick the USB port.** A dev board with two USB-C ports: use the one marked COM or UART, with the `bench` program. Only one port: use `bench_native_usb`.
2. **Upload and open the log:** `pio run -e bench -t upload`, then `pio device monitor`.
   - The log shows "Zeroing...", then "Zeroed.", then lines like `raw 123456  stable  (not calibrated)`.
3. **Check the wiring:** press the platform lightly with a finger. The raw number must change by thousands; down instead of up is fine. If it doesn't move, or "No reading from the HX711" appears, recheck the wiring.
4. **Calibrate:**
   - With the platform empty, type `t` and wait for "Zeroed.".
   - Put the reference object on and type `c <its grams>`, for example `c 1563`.
   - Expect "Calibrated: … counts per gram (saved)". The calibration survives a power-off.

Commands:

| Command | What it does |
|---|---|
| `t` | Tare: zero the scale once the reading is stable |
| `c <grams>` | Calibrate with a known weight on the scale |
| `n` | Noise test: 10 s of readings, then the spread |
| `r` | Raw counts on/off in the weight lines |
| `i` | Info: calibration, offset, readings per second |
| `forget` | Delete the saved calibration |
| `h` | Help |

### What to check and report

Write each result into the progress log.

1. **Five objects:** compare each against the Chef Matteo scale, in a small table. Good means within 1–2 g.
2. **Noise test (`n`):** once empty and once with the reference object on. Good means a spread of 1 g or less.
3. **Drift:** leave the reference object on for 10 minutes and note the first and last reading. Good means 2–3 g of change or less.
4. **Readings per second (`i`):**
   - About 10 is the HX711's quiet setting.
   - About 80 means the module is wired for its fast mode, which is noisier.

If readings jump around a lot, a missing E− to GND link on cheap HX711 modules is a known cause (*Hardware facts → HX711*).

## Words used here

- **GPIO:** a pin the program can switch on and off or read, like a light switch the code controls.
- **ADC:** a chip that turns a voltage into a number. The HX711 is one, made for load cells.
- **Load cell:** a metal bar with stickers (strain gauges) whose resistance changes a tiny bit as the bar bends under weight.
- **Tare:** set the current weight as zero, for example with an empty plate on the scale.
- **Calibration:** teaching the scale how many raw numbers equal one gram, using an object of known weight.
- **Firmware:** the program that runs on the board.
- **Flashing:** copying the firmware onto the board, here over the USB-C cable.
- **Serial port (UART):** a two-wire text line between the board and the computer, used for flashing and for log messages.
- **SPI, I2C:** two common ways for chips to talk to each other over a few wires; SPI is faster and needs more pins.
- **PSRAM:** extra memory on the board. The screen's picture is kept there.
- **LVGL:** the library that draws buttons, lists and numbers on the touchscreen.
- **Edge function:** a small program that runs on Supabase's servers, the "door" a device knocks on.
- **Header pins:** a row of metal pins soldered onto a small board so it plugs into a breadboard.
- **Noise:** the small random wobble in the reading when nothing changes, like a needle that never quite stops.
- **Drift:** a slow change in the reading over minutes while nothing changes on the scale.
- **OTA (over the air):** installing a new firmware over Wi-Fi instead of the cable.
