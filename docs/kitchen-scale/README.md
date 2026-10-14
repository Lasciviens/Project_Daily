# Kitchen scale

A home-made Wi-Fi kitchen scale with its own touchscreen. You pick a food (or scan it on the phone), put it on the scale, and it shows the weight and the calories and macros from the food library. Save puts it into Food → Today.

This file is the project's one place for the parts in hand, the checked hardware facts, the design, the plan and the progress log. Update it in the same PR as any work on the scale.

**Status (14.10.2026):** planning. The parts are listed below. Nothing is wired, flashed or built yet, and nothing in the app, the database or the edge functions has changed for the scale.

## Progress log

Newest on top. One entry per real step: what was done, what was run or measured, what it showed.

- **14.10.2026**
  - Plan written and parts inventory recorded.
  - Hardware facts checked against board files, datasheets and a photo of one board revision (sources under *Hardware facts*).
  - Waiting on the owner's answers under *Open questions*.

## Parts in hand

### Boards

| Part | Qty | Role in the scale | To check |
|---|---|---|---|
| ESP32-4848S040 (Guition): ESP32-S3 N16R8, 4" 480×480 touchscreen, Wi-Fi + Bluetooth | 1 | The scale's brain and screen | Variant (relay back plate or not), revision printed on the back |
| ESP32-S3 N16R8 development board | 1 | Bench board for stage 1. Same chip as the display board, with many free pins at 3.3 V, so the weighing code is built and tested here first. Possible RFID host later. | Exact board (print on it, one or two USB-C ports) |
| Arduino Uno, from Kjell's "Arduino Startpakke" (art. 87875) | 1 | First wiring and calibration practice at 5 V, where nothing can be damaged | R3 or R4 (printed on the board) |

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
| MFRC522 (RC522) RFID reader, 13.56 MHz | 1 | Not in the first version. **Idea:** a sticker tag under each bowl or jar. The scale reads it and knows the bowl's own weight (automatic tare) or which food is in the jar. It needs 5 pins (SPI bus) and 3.3 V. The display board has no pins left for it next to the HX711; the ESP32-S3 dev board does. Check whether tags or cards came with it. |

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

- **Soldering iron.** The brief chose an FNIRSI HS-02A with 6 tips, a 951 flux pen and a silicone mat. Which of these have arrived?
- **Multimeter**, to check which pin carries 5 V and which is GND before anything touches the display board. Cheap and strongly recommended.
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

- **Stack:** PlatformIO + the Arduino framework + LVGL. **C**
- **Two known working screen setups:** [esp32-smartdisplay](https://github.com/rzeldent/esp32-smartdisplay) (LVGL 9, supports this board) or Arduino_GFX + LVGL 8.4 (ha5dzs). Pick one in stage 0. **C**
- **Expected behaviour:** the screen pauses while flash memory is written (updates over Wi-Fi, saving settings). **C**

### Supabase and the network

- **Edge Functions, free plan:** 500,000 calls a month. **C** ([pricing](https://supabase.com/pricing))
- **Realtime, free plan:** **C** ([limits](https://supabase.com/docs/guides/realtime/limits))
  - 2 million messages a month, 100 a second, 200 connections
  - a broadcast counts 1 message, plus 1 per receiver
- **Realtime from the ESP32:** the ESP32 Supabase library ([ESPSupabase](https://github.com/jhagas/ESPSupabase)) can't send broadcasts. A device login expires every hour, and each refresh token works only once. **C**
- **No direct connection:** the website can't talk to the scale over home Wi-Fi. iPhone browsers block an unencrypted connection from an HTTPS page to a device at home. **C**
- **No MQTT broker:** HiveMQ Cloud's free plan closes 31.12.2026, so no broker there. **C**

## Design (proposed, not approved yet)

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
- **Firmware location.** The firmware lives in this repo (proposed folder: `firmware/kitchen-scale/`), and CI compiles it on every PR. Claude writes and compiles it; the owner flashes the board over USB-C and reports what it shows.

## Plan

Each stage ends with a check the owner does. A stage starts only after the previous one passed.

**0. Know the parts.**
- Photos of the display board (both sides), the HX711 and the load-cell label.
- Install VS Code + PlatformIO.
- Flash a "hello" screen to the display board.
- *Check:* our text shows on the screen.

**1. Weighing on the bench.**
- **a. Arduino Uno at 5 V:** solder the header pins onto the HX711, wire the load cell, print grams to the computer, calibrate with the reference weight. The kit's 16×2 LCD can show the weight.
- **b. ESP32-S3 dev board at 3.3 V:** the same weighing code on the same chip family as the display board, with free pins and nothing to risk.
- **c. Display board:** on the confirmed free pins.
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

## Open questions

1. **Website live weight:** is "scan on the phone → weigh and save on the scale, website about 1 s behind" enough for the first version? Recommended: yes, and no remote Tare (you're standing at the scale anyway).
2. **Display board:** is there a relay back plate? Will an SD card be used?
3. **Your setup:** Windows or Mac? Is there a multimeter or a 3D printer?
4. **Soldering tools:** which have arrived (iron, tips, flux pen, mat)?
5. **Exact parts:** the ESP32-S3 dev board's exact name; Uno R3 or R4; the HX711 colour; the load cell's capacity; whether the RFID reader came with tags.

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
- **OTA (over the air):** installing a new firmware over Wi-Fi instead of the cable.
