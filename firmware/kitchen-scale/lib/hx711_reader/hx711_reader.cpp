#include "hx711_reader.h"

#include <Arduino.h>

void Hx711Reader::begin() {
  // The pull-up keeps an unconnected DT line high ("not ready"), so a missing HX711
  // shows as no readings instead of endless zeros. A connected HX711 drives the line
  // itself and easily overrides the weak internal resistor.
  pinMode(data_, INPUT_PULLUP);
  pinMode(clock_, OUTPUT);
  digitalWrite(clock_, LOW);
}

bool Hx711Reader::ready() const { return digitalRead(data_) == LOW; }

int32_t Hx711Reader::read() {
  uint32_t value = 0;
  // A clock pulse held high for more than 60 us powers the HX711 down, so no
  // interrupt (Wi-Fi, the screen) may stretch one.
  noInterrupts();
  for (uint8_t i = 0; i < 24; i++) {
    digitalWrite(clock_, HIGH);
    delayMicroseconds(1);
    value = (value << 1) | (digitalRead(data_) == HIGH ? 1 : 0);
    digitalWrite(clock_, LOW);
    delayMicroseconds(1);
  }
  // The 25th pulse selects channel A, gain 128, for the next reading.
  digitalWrite(clock_, HIGH);
  delayMicroseconds(1);
  digitalWrite(clock_, LOW);
  interrupts();

  if (value & 0x800000) value |= 0xFF000000;  // sign-extend 24 bits
  return (int32_t)value;
}
