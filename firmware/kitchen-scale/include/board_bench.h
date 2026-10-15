// Pins on the separate ESP32-S3 N16R8 dev board used for the stage 1 bench.
// GPIO 4 and 5 are plain pins on every ESP32-S3 dev board: not strapping, USB or PSRAM pins.
#pragma once

#define PIN_HX711_DT 4   // HX711 "DT" (data out)
#define PIN_HX711_SCK 5  // HX711 "SCK" (clock)
