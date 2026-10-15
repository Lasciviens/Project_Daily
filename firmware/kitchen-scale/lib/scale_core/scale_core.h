// Weighing logic shared by every scale firmware: spike filter, smoothing, tare,
// calibration, the "stable" flag and zero tracking.
// Pure C++ with no Arduino calls, so scripts/verify-scale-core.mjs can test it on a computer.
#pragma once
#include <stdint.h>

struct ScaleConfig {
  uint8_t window = 8;                     // readings averaged; at 10 readings/s that is 0.8 s
  float jumpGrams = 4.0f;                 // a bigger change restarts the average, so the number follows at once
  float stableSpreadGrams = 1.0f;         // max spread across the window to count as stable
  float zeroTrackGrams = 0.5f;            // drift this close to zero is absorbed while stable
  float capacityGrams = 5000.0f;          // above this the scale reports overload
  // Before calibration grams are unknown, so the same checks use raw counts
  // (a 5 kg cell on an HX711 at 3.3 V gives roughly 400 counts per gram).
  int32_t jumpCountsUncalibrated = 2000;
  int32_t stableSpreadCountsUncalibrated = 500;
  int32_t minCalibrationCounts = 1000;    // a known weight must move the reading at least this much
};

class ScaleCore {
 public:
  static const uint8_t MAX_WINDOW = 32;

  explicit ScaleCore(const ScaleConfig &config = ScaleConfig());

  // One reading from the HX711 (signed 24-bit counts).
  void addReading(int32_t raw);

  // The scale shows zero once it is stable (done inside addReading).
  void requestTare();
  bool tarePending() const { return tarePending_; }

  // With a known weight on the scale and the reading stable: learns counts per gram.
  // Returns false when not stable, the weight is not positive, or the reading barely moved.
  bool calibrate(float knownGrams);

  void setCountsPerGram(float countsPerGram) { countsPerGram_ = countsPerGram; }
  float countsPerGram() const { return countsPerGram_; }
  bool calibrated() const { return countsPerGram_ != 0.0f; }

  int32_t offset() const { return offset_; }
  float meanRaw() const;            // the smoothed reading in counts
  float grams() const;              // smoothed, tared and calibrated; 0 before calibration
  int32_t displayGrams() const;     // rounded to whole grams
  bool stable() const;
  bool overloaded() const;
  uint8_t readings() const { return count_; }  // readings in the current window

 private:
  int32_t spikeFiltered(int32_t raw);
  void restartWindow(int32_t value);
  void push(int32_t value);
  float spreadCounts() const;

  ScaleConfig config_;
  int32_t window_[MAX_WINDOW];
  uint8_t head_ = 0;
  uint8_t count_ = 0;
  int64_t sum_ = 0;

  int32_t recent_[3];               // the last raw readings, for the median-of-3 spike filter
  uint8_t recentCount_ = 0;
  int32_t lastRaw_ = 0;

  int32_t offset_ = 0;
  float countsPerGram_ = 0.0f;
  bool tarePending_ = false;
};
