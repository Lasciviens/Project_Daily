// Checks lib/scale_core on a computer. Built and run by scripts/verify-scale-core.mjs.
#include <math.h>
#include <stdio.h>
#include <stdlib.h>

#include "scale_core.h"

namespace {

int passed = 0;
int failed = 0;

void check(bool ok, const char *what) {
  if (ok) {
    passed++;
  } else {
    failed++;
    printf("FAIL: %s\n", what);
  }
}

bool near(float a, float b, float tolerance) { return fabsf(a - b) <= tolerance; }

// A 5 kg cell on an HX711 at 3.3 V: roughly 430 counts per gram around an empty
// reading of 120000. The noise pattern is fixed so every run is the same.
const int32_t EMPTY = 120000;
const float CPG = 430.0f;
const int32_t NOISE[] = {0, 35, -20, 50, -45, 10, -30, 25, -5, 40};

int32_t rawFor(float grams, int i) { return EMPTY + (int32_t)lroundf(grams * CPG) + NOISE[i % 10]; }

void feed(ScaleCore &s, float grams, int n, int start = 0) {
  for (int i = 0; i < n; i++) s.addReading(rawFor(grams, start + i));
}

ScaleCore calibratedScale() {
  ScaleCore s;
  s.requestTare();
  feed(s, 0, 12);
  feed(s, 1000, 12);
  s.calibrate(1000);
  feed(s, 0, 12);
  return s;
}

void uncalibrated() {
  ScaleCore s;
  feed(s, 0, 12);
  check(!s.calibrated(), "a new scale is not calibrated");
  check(s.grams() == 0.0f, "an uncalibrated scale reports 0 g");
  check(s.stable(), "stability works before calibration (raw counts)");
}

void tareAndCalibrate() {
  ScaleCore s;
  s.requestTare();
  check(s.tarePending(), "tare waits until the reading is stable");
  feed(s, 0, 4);
  check(s.tarePending(), "tare still waits while the window is filling");
  feed(s, 0, 8);
  check(!s.tarePending(), "tare is applied once stable");
  check(abs(s.offset() - EMPTY) < 50, "tare stores the empty reading as the offset");

  check(!s.calibrate(1000), "calibration refuses an empty scale");
  feed(s, 1000, 3);
  check(!s.calibrate(1000), "calibration refuses an unstable reading");
  feed(s, 1000, 12);
  check(s.calibrate(1000), "calibration accepts a stable known weight");
  check(near(s.countsPerGram(), CPG, 1.0f), "calibration learns about 430 counts per gram");
  check(s.displayGrams() == 1000, "the known weight then reads 1000 g");
  check(!s.calibrate(-5), "calibration refuses a weight that is not positive");
}

void reversedWires() {
  ScaleCore s;
  s.requestTare();
  for (int i = 0; i < 12; i++) s.addReading(EMPTY - NOISE[i % 10]);
  for (int i = 0; i < 12; i++) s.addReading(EMPTY - (int32_t)(500 * CPG) - NOISE[i % 10]);
  check(s.calibrate(500), "calibration works when the signal wires are swapped");
  check(s.countsPerGram() < 0, "swapped wires give a negative counts-per-gram");
  check(s.displayGrams() == 500, "swapped wires still read positive grams");
}

void followsChangesFast() {
  ScaleCore s = calibratedScale();
  feed(s, 243, 2);
  check(s.displayGrams() == 243, "a new weight shows within two readings");
  check(!s.stable(), "a new weight is not stable straight away");
  feed(s, 243, 8, 2);
  check(s.stable(), "a new weight is stable after the window fills");
  check(s.displayGrams() == 243, "and still reads 243 g");
}

void noiseAndSpikes() {
  ScaleCore s = calibratedScale();
  feed(s, 500, 12);
  check(s.stable(), "noise of about 0.1 g keeps the reading stable");
  s.addReading(8000000);
  check(s.displayGrams() == 500, "a single spike is ignored");
  check(!s.overloaded(), "a single spike is not an overload");
  feed(s, 500, 3);
  check(s.stable(), "and the reading stays stable after it");
}

void zeroTracking() {
  ScaleCore s = calibratedScale();
  // About 0.3 g of drift on an empty scale is absorbed.
  for (int i = 0; i < 12; i++) s.addReading(EMPTY + 130 + NOISE[i % 10]);
  check(fabsf(s.grams()) < 0.1f, "small drift near zero is absorbed");
  // 2 g is a real weight, not drift.
  feed(s, 2.3f, 12);
  check(s.displayGrams() == 2, "2 g is not absorbed by zero tracking");
}

void tareWithPlate() {
  ScaleCore s = calibratedScale();
  feed(s, 350, 12);
  s.requestTare();
  feed(s, 350, 1);
  check(!s.tarePending(), "tare with a stable plate applies on the next reading");
  check(s.displayGrams() == 0, "the plate reads 0 g after tare");
  feed(s, 350 + 137, 12);
  check(s.displayGrams() == 137, "food on the plate reads its own weight");
  feed(s, 0, 12);
  check(s.displayGrams() == -350, "lifting the plate reads minus its weight");
}

void overload() {
  ScaleCore s = calibratedScale();
  feed(s, 5200, 12);
  check(s.overloaded(), "above 5000 g is an overload");
  s.addReading(8388607);
  s.addReading(8388607);
  check(s.overloaded(), "a saturated HX711 reading is an overload");
}

}  // namespace

int main() {
  uncalibrated();
  tareAndCalibrate();
  reversedWires();
  followsChangesFast();
  noiseAndSpikes();
  zeroTracking();
  tareWithPlate();
  overload();
  if (failed) {
    printf("%d failed, %d passed\n", failed, passed);
    return 1;
  }
  printf("scale_core: %d passed\n", passed);
  return 0;
}
