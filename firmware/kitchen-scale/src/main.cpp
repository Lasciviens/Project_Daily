// Kitchen scale — stage 0: board check.
// Proves the toolchain, the screen, the touch panel and the serial log, and finds
// which header pin is which GPIO without a multimeter (the pin finder).
// Plan, board facts and how to flash: docs/kitchen-scale/README.md.

#include <Arduino.h>
#include <Arduino_GFX_Library.h>

#include "board_4848s040.h"
#include "pin_finder.h"
#include "touch_gt911.h"

namespace {

constexpr uint16_t rgb(uint8_t r, uint8_t g, uint8_t b) {
  return ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3);
}
const uint16_t BG = rgb(18, 18, 20);
const uint16_t FG = rgb(235, 235, 235);
const uint16_t MUTED = rgb(150, 150, 155);
const uint16_t ACCENT = rgb(192, 98, 43);
const uint16_t OK = rgb(70, 170, 90);
const uint16_t BAD = rgb(210, 70, 60);

// Areas on the 480x480 screen.
const int16_t DRAW_TOP = 200, DRAW_BOTTOM = 380;
const int16_t BUTTON_TOP = 400;

Arduino_DataBus *setupBus = new Arduino_SWSPI(
    GFX_NOT_DEFINED /* DC */, PIN_TFT_SETUP_CS, PIN_TFT_SETUP_SCK, PIN_TFT_SETUP_SDA,
    GFX_NOT_DEFINED /* MISO */);
Arduino_ESP32RGBPanel *panel = new Arduino_ESP32RGBPanel(
    PIN_TFT_DE, PIN_TFT_VSYNC, PIN_TFT_HSYNC, PIN_TFT_PCLK,
    PIN_TFT_R0, PIN_TFT_R1, PIN_TFT_R2, PIN_TFT_R3, PIN_TFT_R4,
    PIN_TFT_G0, PIN_TFT_G1, PIN_TFT_G2, PIN_TFT_G3, PIN_TFT_G4, PIN_TFT_G5,
    PIN_TFT_B0, PIN_TFT_B1, PIN_TFT_B2, PIN_TFT_B3, PIN_TFT_B4,
    1 /* hsync polarity */, 10 /* front porch */, 8 /* pulse width */, 50 /* back porch */,
    1 /* vsync polarity */, 10 /* front porch */, 8 /* pulse width */, 20 /* back porch */,
    0 /* pclk active neg */, TFT_PIXEL_CLOCK_HZ);
Arduino_RGB_Display *gfx = new Arduino_RGB_Display(
    TFT_WIDTH, TFT_HEIGHT, panel, 0 /* rotation */, true /* auto flush */,
    setupBus, GFX_NOT_DEFINED /* reset */, st7701_type9_init_operations,
    sizeof(st7701_type9_init_operations));

const uint8_t FINDER_PINS[] = {PIN_FREE_A, PIN_FREE_B, PIN_FREE_C};
PinFinder finder(FINDER_PINS, sizeof FINDER_PINS);

uint8_t touchAddress = 0;
bool wasTouched = false;

void line(int16_t y, uint8_t size, uint16_t color, const String &text) {
  gfx->fillRect(0, y, TFT_WIDTH, size * 8 + 4, BG);
  gfx->setTextSize(size);
  gfx->setTextColor(color);
  gfx->setCursor(16, y);
  gfx->print(text);
}

void drawFinderButton() {
  gfx->fillRect(0, BUTTON_TOP, TFT_WIDTH, TFT_HEIGHT - BUTTON_TOP, BG);
  gfx->fillRoundRect(16, BUTTON_TOP, TFT_WIDTH - 32, 64, 12, finder.running() ? ACCENT : MUTED);
  gfx->setTextColor(BG);
  gfx->setTextSize(2);
  gfx->setCursor(32, BUTTON_TOP + 14);
  if (finder.running()) {
    gfx->print("Pin finder ON: GPIO " + String(finder.activePin()));
    gfx->setCursor(32, BUTTON_TOP + 36);
    gfx->print(String(finder.activeBlinks()) + " blink(s). Tap to stop.");
  } else {
    gfx->print("Pin finder off");
    gfx->setCursor(32, BUTTON_TOP + 36);
    gfx->print("Tap to start (only with the LED test)");
  }
}

void drawStaticScreen() {
  gfx->fillScreen(BG);
  line(16, 4, FG, "Kitchen scale");
  line(56, 2, MUTED, "Stage 0 - board check - v" FIRMWARE_VERSION);
  line(92, 2, FG, "Chip: " + String(ESP.getChipModel()) + " rev " + String(ESP.getChipRevision()));
  line(116, 2, FG, "Flash: " + String(ESP.getFlashChipSize() / (1024 * 1024)) + " MB   PSRAM: " +
                       String(ESP.getPsramSize() / (1024 * 1024)) + " MB");
  if (touchAddress) {
    line(140, 2, OK, "Touch: GT911 found at 0x" + String(touchAddress, HEX));
  } else {
    line(140, 2, BAD, "Touch: GT911 not found");
  }
  line(168, 2, MUTED, "Touch test: draw in the box");
  gfx->drawRect(16, DRAW_TOP, TFT_WIDTH - 32, DRAW_BOTTOM - DRAW_TOP, MUTED);
  drawFinderButton();
}

void toggleFinder() {
  if (finder.running()) {
    finder.stop();
    Serial.println("Pin finder stopped");
  } else {
    finder.start();
    Serial.println("Pin finder started: GPIO 40 blinks 1x, GPIO 2 2x, GPIO 1 3x");
  }
  drawFinderButton();
}

void onPress(uint16_t x, uint16_t y) {
  if (y >= BUTTON_TOP) toggleFinder();
}

void onTouch(uint16_t x, uint16_t y) {
  if (y > DRAW_TOP + 6 && y < DRAW_BOTTOM - 6 && x > 22 && x < TFT_WIDTH - 22) {
    gfx->fillCircle(x, y, 5, ACCENT);
  }
  line(DRAW_BOTTOM + 4, 1, MUTED, "Last touch: x=" + String(x) + " y=" + String(y));
}

}  // namespace

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println();
  Serial.println("Kitchen scale - stage 0 board check - v" FIRMWARE_VERSION);
  Serial.printf("Chip: %s rev %d, %d cores, %lu MHz\n", ESP.getChipModel(), ESP.getChipRevision(),
                ESP.getChipCores(), (unsigned long)ESP.getCpuFreqMHz());
  Serial.printf("Flash: %lu bytes, PSRAM: %lu bytes (%lu free)\n", (unsigned long)ESP.getFlashChipSize(),
                (unsigned long)ESP.getPsramSize(), (unsigned long)ESP.getFreePsram());

  if (!gfx->begin()) {
    Serial.println("Screen: begin() failed");
  } else {
    Serial.println("Screen: started");
  }
  pinMode(PIN_TFT_BACKLIGHT, OUTPUT);
  digitalWrite(PIN_TFT_BACKLIGHT, HIGH);

  touchAddress = touchBegin(PIN_TOUCH_SDA, PIN_TOUCH_SCL);
  if (touchAddress) {
    Serial.printf("Touch: GT911 at 0x%02X\n", touchAddress);
  } else {
    Serial.println("Touch: GT911 not found at 0x5D or 0x14");
  }

  drawStaticScreen();
}

void loop() {
  TouchPoint p = touchRead();
  if (p.fresh) {
    if (p.touched) {
      if (!wasTouched) {
        Serial.printf("Touch at x=%u y=%u\n", p.x, p.y);
        onPress(p.x, p.y);
      }
      onTouch(p.x, p.y);
    }
    wasTouched = p.touched;
  }
  // Typing "p" in the Serial Monitor also toggles it, in case touch turns out rotated.
  while (Serial.available()) {
    if (Serial.read() == 'p') toggleFinder();
  }
  if (finder.update(millis())) {
    Serial.printf("Pin finder: GPIO %u (%u blink(s))\n", finder.activePin(), finder.activeBlinks());
    drawFinderButton();
  }
  delay(10);
}
