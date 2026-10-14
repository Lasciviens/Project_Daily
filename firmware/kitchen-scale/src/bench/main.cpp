// Kitchen scale — stage 1 bench: the HX711 and the load cell on the ESP32-S3 dev board.
// Prints the weight five times a second and takes typed commands in the serial monitor.
// Wiring, calibration steps and what to report: docs/kitchen-scale/README.md → Stage 1.

#include <Arduino.h>
#include <Preferences.h>

#include "board_bench.h"
#include "hx711_reader.h"
#include "scale_core.h"

namespace {

const uint32_t PRINT_EVERY_MS = 200;
const uint32_t WAIT_LIMIT_MS = 10000;
const uint32_t NOISE_TEST_MS = 10000;
const uint32_t SILENT_WARNING_MS = 3000;

Hx711Reader hx(PIN_HX711_DT, PIN_HX711_SCK);
ScaleCore scale;
Preferences prefs;

String input;
bool showRaw = false;
uint32_t lastPrintMs = 0;
uint32_t lastReadingMs = 0;
uint32_t lastSilentWarningMs = 0;
uint32_t readingsThisSecond = 0;
uint32_t readingsPerSecond = 0;
uint32_t secondStartedMs = 0;

enum class Waiting { None, Tare, Calibrate };
Waiting waiting = Waiting::None;
float knownGrams = 0;
uint32_t waitStartedMs = 0;

struct NoiseTest {
  bool running = false;
  uint32_t startedMs = 0;
  uint32_t count = 0;
  double sum = 0;
  double sumSquares = 0;
  float lo = 0;
  float hi = 0;
} noise;

void printHelp() {
  Serial.println("Commands (type, then Enter):");
  Serial.println("  t          tare: zero the scale (waits until the reading is stable)");
  Serial.println("  c <grams>  calibrate with a known weight on the scale, e.g. c 1000");
  Serial.println("  n          noise test: 10 s of readings, then the spread");
  Serial.println("  r          raw counts on/off in the weight lines");
  Serial.println("  i          info: calibration, offset, readings per second");
  Serial.println("  forget     delete the saved calibration");
  Serial.println("  h          this help");
}

void loadCalibration() {
  prefs.begin("scale", true);
  const float cpg = prefs.getFloat("cpg", 0.0f);
  prefs.end();
  scale.setCountsPerGram(cpg);
  if (cpg != 0.0f) {
    Serial.printf("Calibration loaded: %.3f counts per gram\n", cpg);
  } else {
    Serial.println("Not calibrated yet: tare, put a known weight on, then type c <grams>.");
  }
}

void saveCalibration() {
  prefs.begin("scale", false);
  prefs.putFloat("cpg", scale.countsPerGram());
  prefs.end();
}

void forgetCalibration() {
  prefs.begin("scale", false);
  prefs.remove("cpg");
  prefs.end();
  scale.setCountsPerGram(0.0f);
  Serial.println("Saved calibration deleted.");
}

void startWaiting(Waiting what) {
  waiting = what;
  waitStartedMs = millis();
}

void startNoiseTest() {
  noise = NoiseTest();
  noise.running = true;
  noise.startedMs = millis();
  Serial.printf("Noise test: keep the scale still for %u s...\n", (unsigned)(NOISE_TEST_MS / 1000));
}

void printInfo() {
  Serial.printf("Firmware v%s (stage 1 bench), HX711 DT=GPIO %d, SCK=GPIO %d\n", FIRMWARE_VERSION,
                PIN_HX711_DT, PIN_HX711_SCK);
  Serial.printf("Counts per gram: %.3f%s\n", scale.countsPerGram(),
                scale.calibrated() ? "" : " (not calibrated)");
  Serial.printf("Offset: %ld counts, smoothed reading: %.1f counts\n", (long)scale.offset(), scale.meanRaw());
  Serial.printf("Readings per second: %lu\n", (unsigned long)readingsPerSecond);
}

void handleCommand(String command) {
  command.trim();
  if (command.isEmpty()) return;
  if (command == "h") {
    printHelp();
  } else if (command == "t") {
    scale.requestTare();
    startWaiting(Waiting::Tare);
    Serial.println("Taring...");
  } else if (command.startsWith("c ")) {
    knownGrams = command.substring(2).toFloat();
    if (knownGrams <= 0) {
      Serial.println("Give the known weight in grams, e.g. c 1000");
      return;
    }
    startWaiting(Waiting::Calibrate);
    Serial.printf("Calibrating with %.1f g...\n", knownGrams);
  } else if (command == "n") {
    startNoiseTest();
  } else if (command == "r") {
    showRaw = !showRaw;
  } else if (command == "i") {
    printInfo();
  } else if (command == "forget") {
    forgetCalibration();
  } else {
    Serial.printf("Unknown command \"%s\". Type h for help.\n", command.c_str());
  }
}

void readSerial() {
  while (Serial.available()) {
    const char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      handleCommand(input);
      input = "";
    } else if (input.length() < 40) {
      input += c;
    }
  }
}

void addToNoiseTest() {
  const float value = scale.calibrated() ? scale.grams() : scale.meanRaw();
  if (noise.count == 0) noise.lo = noise.hi = value;
  noise.lo = min(noise.lo, value);
  noise.hi = max(noise.hi, value);
  noise.sum += value;
  noise.sumSquares += (double)value * value;
  noise.count++;
}

void finishNoiseTest() {
  noise.running = false;
  if (noise.count < 2) {
    Serial.println("Noise test: no readings from the HX711.");
    return;
  }
  const double mean = noise.sum / noise.count;
  const double variance = noise.sumSquares / noise.count - mean * mean;
  const char *unit = scale.calibrated() ? "g" : "counts";
  Serial.printf("Noise test: %lu readings, spread %.2f %s (%.2f to %.2f), std dev %.2f %s\n",
                (unsigned long)noise.count, noise.hi - noise.lo, unit, noise.lo, noise.hi,
                sqrt(variance > 0 ? variance : 0), unit);
}

void readScale(uint32_t now) {
  if (!hx.ready()) return;
  scale.addReading(hx.read());
  lastReadingMs = now;
  readingsThisSecond++;
  if (noise.running) addToNoiseTest();
}

void countReadingsPerSecond(uint32_t now) {
  if (now - secondStartedMs < 1000) return;
  readingsPerSecond = readingsThisSecond;
  readingsThisSecond = 0;
  secondStartedMs = now;
}

void finishWaiting(uint32_t now) {
  if (waiting == Waiting::Tare && !scale.tarePending()) {
    Serial.println("Zeroed.");
    waiting = Waiting::None;
  } else if (waiting == Waiting::Calibrate && scale.stable()) {
    if (scale.calibrate(knownGrams)) {
      saveCalibration();
      Serial.printf("Calibrated: %.3f counts per gram (saved).\n", scale.countsPerGram());
    } else {
      Serial.println("Calibration failed: the reading barely moved. Tare with the scale empty first, "
                     "then put the known weight on.");
    }
    waiting = Waiting::None;
  } else if (waiting != Waiting::None && now - waitStartedMs > WAIT_LIMIT_MS) {
    Serial.println("Still not stable after 10 s: is something touching or shaking the scale?");
    waitStartedMs = now;
  }
}

void warnIfSilent(uint32_t now) {
  if (now - lastReadingMs < SILENT_WARNING_MS || now - lastSilentWarningMs < SILENT_WARNING_MS) return;
  lastSilentWarningMs = now;
  Serial.printf("No reading from the HX711: check VCC to 3V3, GND to GND, DT to GPIO %d, SCK to GPIO %d.\n",
                PIN_HX711_DT, PIN_HX711_SCK);
}

void printWeight(uint32_t now) {
  if (now - lastPrintMs < PRINT_EVERY_MS || noise.running || scale.readings() == 0) return;
  lastPrintMs = now;
  const char *state = scale.overloaded() ? "OVERLOAD" : scale.stable() ? "stable" : "...";
  if (!scale.calibrated()) {
    Serial.printf("raw %ld  %s  (not calibrated)\n", (long)lroundf(scale.meanRaw()), state);
  } else if (showRaw) {
    Serial.printf("%6ld g  %-8s raw %ld\n", (long)scale.displayGrams(), state, (long)lroundf(scale.meanRaw()));
  } else {
    Serial.printf("%6ld g  %s\n", (long)scale.displayGrams(), state);
  }
}

}  // namespace

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println();
  Serial.printf("Kitchen scale - stage 1 bench - v%s\n", FIRMWARE_VERSION);
  hx.begin();
  loadCalibration();
  Serial.println("Zeroing: keep the scale empty. Type h for commands.");
  scale.requestTare();
  startWaiting(Waiting::Tare);
  lastReadingMs = millis();
}

void loop() {
  const uint32_t now = millis();
  readSerial();
  readScale(now);
  countReadingsPerSecond(now);
  if (noise.running && now - noise.startedMs >= NOISE_TEST_MS) finishNoiseTest();
  finishWaiting(now);
  warnIfSilent(now);
  printWeight(now);
  delay(2);
}
