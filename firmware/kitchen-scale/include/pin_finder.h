// Pin finder: tells which header pin is which GPIO without a multimeter.
// Each candidate pin blinks its own count in turn (1st pin once, 2nd twice, ...);
// an LED + 220 ohm resistor between a header pin and GND shows the count.
#pragma once
#include <stdint.h>

class PinFinder {
 public:
  PinFinder(const uint8_t *pins, uint8_t count) : pins_(pins), count_(count) {}

  void start();
  void stop();  // all candidate pins back to inputs (high impedance)
  bool running() const { return running_; }
  // Call often; returns true when the active pin changed (time to redraw).
  bool update(uint32_t nowMs);
  uint8_t activePin() const { return pins_[index_]; }
  uint8_t activeBlinks() const { return index_ + 1; }

 private:
  const uint8_t *pins_;
  uint8_t count_;
  bool running_ = false;
  uint8_t index_ = 0;
  uint8_t step_ = 0;  // on/off half-steps done for the active pin, then a pause
  uint32_t nextMs_ = 0;
};
