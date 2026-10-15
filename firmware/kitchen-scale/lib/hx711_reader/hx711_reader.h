// Reads an HX711 load-cell amplifier on channel A (gain 128) over its two wires.
// Power the HX711 from 3.3 V when an ESP32 reads it (docs/kitchen-scale/README.md).
#pragma once
#include <stdint.h>

class Hx711Reader {
 public:
  Hx711Reader(uint8_t dataPin, uint8_t clockPin) : data_(dataPin), clock_(clockPin) {}

  void begin();
  // A new reading is waiting (the HX711 pulls its data line low).
  bool ready() const;
  // Signed 24-bit counts. Call only when ready().
  int32_t read();

 private:
  uint8_t data_;
  uint8_t clock_;
};
