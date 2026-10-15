#include "scale_core.h"

#include <math.h>

namespace {
// The HX711 pins its output at these values when the input is out of range.
const int32_t RAW_MAX = 8388607;
const int32_t RAW_MIN = -8388608;

int32_t median3(int32_t a, int32_t b, int32_t c) {
  if (a > b) { int32_t t = a; a = b; b = t; }
  if (b > c) { int32_t t = b; b = c; c = t; }
  if (a > b) { int32_t t = a; a = b; b = t; }
  return b;
}
}  // namespace

ScaleCore::ScaleCore(const ScaleConfig &config) : config_(config) {
  if (config_.window < 1) config_.window = 1;
  if (config_.window > MAX_WINDOW) config_.window = MAX_WINDOW;
}

int32_t ScaleCore::spikeFiltered(int32_t raw) {
  if (recentCount_ < 3) {
    recent_[recentCount_++] = raw;
    return raw;
  }
  recent_[0] = recent_[1];
  recent_[1] = recent_[2];
  recent_[2] = raw;
  return median3(recent_[0], recent_[1], recent_[2]);
}

void ScaleCore::restartWindow(int32_t value) {
  head_ = 0;
  count_ = 0;
  sum_ = 0;
  push(value);
}

void ScaleCore::push(int32_t value) {
  if (count_ == config_.window) {
    sum_ -= window_[head_];
  } else {
    count_++;
  }
  window_[head_] = value;
  sum_ += value;
  head_ = (head_ + 1) % config_.window;
}

void ScaleCore::addReading(int32_t raw) {
  lastRaw_ = raw;
  const int32_t value = spikeFiltered(raw);

  if (count_ > 0) {
    const float jumpCounts = calibrated() ? config_.jumpGrams * fabsf(countsPerGram_)
                                          : (float)config_.jumpCountsUncalibrated;
    if (fabsf((float)value - meanRaw()) > jumpCounts) {
      restartWindow(value);
      return;
    }
  }
  push(value);

  if (!stable()) return;
  if (tarePending_) {
    offset_ = (int32_t)lroundf(meanRaw());
    tarePending_ = false;
  } else if (calibrated() && fabsf(grams()) < config_.zeroTrackGrams) {
    offset_ = (int32_t)lroundf(meanRaw());
  }
}

void ScaleCore::requestTare() { tarePending_ = true; }

bool ScaleCore::calibrate(float knownGrams) {
  if (!stable() || knownGrams <= 0.0f) return false;
  const float delta = meanRaw() - (float)offset_;
  if (fabsf(delta) < (float)config_.minCalibrationCounts) return false;
  countsPerGram_ = delta / knownGrams;
  return true;
}

float ScaleCore::meanRaw() const {
  if (count_ == 0) return 0.0f;
  return (float)((double)sum_ / count_);
}

float ScaleCore::grams() const {
  if (!calibrated() || count_ == 0) return 0.0f;
  return (meanRaw() - (float)offset_) / countsPerGram_;
}

int32_t ScaleCore::displayGrams() const { return (int32_t)lroundf(grams()); }

float ScaleCore::spreadCounts() const {
  int32_t lo = window_[0], hi = window_[0];
  for (uint8_t i = 1; i < count_; i++) {
    if (window_[i] < lo) lo = window_[i];
    if (window_[i] > hi) hi = window_[i];
  }
  return (float)(hi - lo);
}

bool ScaleCore::stable() const {
  if (count_ < config_.window) return false;
  const float limit = calibrated() ? config_.stableSpreadGrams * fabsf(countsPerGram_)
                                   : (float)config_.stableSpreadCountsUncalibrated;
  return spreadCounts() <= limit;
}

bool ScaleCore::overloaded() const {
  if (lastRaw_ >= RAW_MAX || lastRaw_ <= RAW_MIN) return true;
  return calibrated() && grams() > config_.capacityGrams;
}
