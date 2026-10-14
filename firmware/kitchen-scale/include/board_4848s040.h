// Pin map of the Guition ESP32-4848S040 (ESP32-S3 N16R8, 480x480 ST7701S, GT911 touch).
// Sources and confidence: docs/kitchen-scale/README.md → Hardware facts.
// Screen values match Arduino_GFX's own ESP32_4848S040_86BOX_GUITION preset.
#pragma once

// Screen: RGB parallel bus (data + timing) and the ST7701's 3-wire setup bus.
#define PIN_TFT_DE 18
#define PIN_TFT_VSYNC 17
#define PIN_TFT_HSYNC 16
#define PIN_TFT_PCLK 21
#define PIN_TFT_R0 11
#define PIN_TFT_R1 12
#define PIN_TFT_R2 13
#define PIN_TFT_R3 14
#define PIN_TFT_R4 0
#define PIN_TFT_G0 8
#define PIN_TFT_G1 20
#define PIN_TFT_G2 3
#define PIN_TFT_G3 46
#define PIN_TFT_G4 9
#define PIN_TFT_G5 10
#define PIN_TFT_B0 4
#define PIN_TFT_B1 5
#define PIN_TFT_B2 6
#define PIN_TFT_B3 7
#define PIN_TFT_B4 15
#define PIN_TFT_SETUP_CS 39
#define PIN_TFT_SETUP_SCK 48
#define PIN_TFT_SETUP_SDA 47
#define PIN_TFT_BACKLIGHT 38
#define TFT_WIDTH 480
#define TFT_HEIGHT 480
// The preset's speed; one project saw glitches at 16 MHz.
#define TFT_PIXEL_CLOCK_HZ 12000000

// Touch: GT911 on I2C. Its reset and interrupt lines are not wired to the ESP32.
#define PIN_TOUCH_SDA 19
#define PIN_TOUCH_SCL 45

// Candidate free pins, unconfirmed on our board:
// 40/2/1 drive the relays (or audio) and are likely the unlabelled pins on header H1;
// 41/42 belong to the SD card slot.
#define PIN_FREE_A 40
#define PIN_FREE_B 2
#define PIN_FREE_C 1
