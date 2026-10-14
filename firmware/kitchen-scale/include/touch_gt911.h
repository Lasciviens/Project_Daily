// Minimal, read-only GT911 touch reader.
// Read-only on purpose: the common TAMC_GT911 library rewrites the touch chip's
// stored configuration on every start (with an uninitialised checksum).
#pragma once
#include <stdint.h>

struct TouchPoint {
  bool fresh;    // the chip had a new report; when false, nothing changed
  bool touched;  // a finger is down (only meaningful when fresh)
  uint16_t x;
  uint16_t y;
};

// Starts I2C and finds the chip at 0x5D or 0x14. Returns the address, or 0 if absent.
uint8_t touchBegin(int sda, int scl);

// The chip's latest report of its first touch point.
TouchPoint touchRead();
