#include "pin_finder.h"

#include <Arduino.h>

namespace {
const uint32_t BLINK_MS = 300;
const uint32_t PAUSE_MS = 1500;
}  // namespace

void PinFinder::start() {
  for (uint8_t i = 0; i < count_; i++) {
    pinMode(pins_[i], OUTPUT);
    digitalWrite(pins_[i], LOW);
  }
  running_ = true;
  index_ = 0;
  step_ = 0;
  nextMs_ = millis();
}

void PinFinder::stop() {
  for (uint8_t i = 0; i < count_; i++) pinMode(pins_[i], INPUT);
  running_ = false;
}

bool PinFinder::update(uint32_t nowMs) {
  if (!running_ || (int32_t)(nowMs - nextMs_) < 0) return false;
  const uint8_t halfSteps = activeBlinks() * 2;
  if (step_ < halfSteps) {
    digitalWrite(activePin(), step_ % 2 == 0 ? HIGH : LOW);
    step_++;
    nextMs_ = nowMs + BLINK_MS;
    return false;
  }
  // Blinks done: pause, then move on to the next pin.
  digitalWrite(activePin(), LOW);
  index_ = (index_ + 1) % count_;
  step_ = 0;
  nextMs_ = nowMs + PAUSE_MS;
  return true;
}
