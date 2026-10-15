---
paths:
  - "firmware/**"
  - ".github/workflows/firmware-check.yml"
  - "docs/kitchen-scale/**"
---
# Kitchen scale firmware rules

Background, parts, board facts and the plan: `docs/kitchen-scale/README.md`.

- Pin numbers come only from the `firmware/kitchen-scale/include/board_*.h` files; a pin fact not yet confirmed on the owner's board says so.
- The HX711 runs on 3.3 V when an ESP32 reads it (5 V on its data line exceeds the pin's 3.6 V limit). Never put it on P1 / GPIO 43–44: that is the flashing and log line.
- No secret in the code or the repo: the Wi-Fi password and the scale secret are typed on the touchscreen and kept in the board's flash (NVS).
- Every version is pinned: the platform by its release URL, every library by its exact version.
- The GT911 touch reader is read-only — never write the touch chip's configuration.
- On-screen text is English; dates on the screen are DD.MM.YYYY, times HH:MM (24 h).
- Weighing logic (filtering, tare, calibration, stable, zero tracking) lives only in `lib/scale_core`, with no Arduino calls; every program calls it, none re-implements it. Its checks run on a computer: `node scripts/verify-scale-core.mjs`.
- Before a push: `pio run -e display -e bench -e bench_native_usb` in `firmware/kitchen-scale` (our `src/` builds with `-Werror`) and `node scripts/verify-scale-core.mjs`; CI repeats both.
- The owner flashes and runs the device; a stage counts as done only with the owner's evidence (log lines, photos), recorded in the doc's progress log.
- The scale talks only to its own edge function with its own secret — never `phone-gateway`, never a Supabase key with table access.
