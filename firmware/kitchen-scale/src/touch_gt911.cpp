#include "touch_gt911.h"

#include <Arduino.h>
#include <Wire.h>

namespace {

const uint16_t REG_STATUS = 0x814E;  // bit 7 = new data, bits 0-3 = number of points
const uint16_t REG_POINT1 = 0x8150;  // x low, x high, y low, y high

uint8_t address = 0;

bool selectRegister(uint16_t reg) {
  Wire.beginTransmission(address);
  Wire.write(reg >> 8);
  Wire.write(reg & 0xFF);
  return Wire.endTransmission(false) == 0;
}

bool readBytes(uint16_t reg, uint8_t *buf, uint8_t len) {
  if (!selectRegister(reg)) return false;
  if (Wire.requestFrom(address, len) != len) return false;
  for (uint8_t i = 0; i < len; i++) buf[i] = Wire.read();
  return true;
}

void clearStatus() {
  Wire.beginTransmission(address);
  Wire.write(REG_STATUS >> 8);
  Wire.write(REG_STATUS & 0xFF);
  Wire.write(0);
  Wire.endTransmission();
}

}  // namespace

uint8_t touchBegin(int sda, int scl) {
  Wire.begin(sda, scl, 400000);
  // Without a reset line the chip keeps whichever address it chose at power-up.
  for (uint8_t candidate : {0x5D, 0x14}) {
    Wire.beginTransmission(candidate);
    if (Wire.endTransmission() == 0) {
      address = candidate;
      return address;
    }
  }
  return 0;
}

TouchPoint touchRead() {
  TouchPoint point = {false, false, 0, 0};
  if (!address) return point;
  uint8_t status = 0;
  if (!readBytes(REG_STATUS, &status, 1)) return point;
  if (!(status & 0x80)) return point;  // no new data since the last read
  point.fresh = true;
  uint8_t count = status & 0x0F;
  if (count > 0) {
    uint8_t data[4];
    if (readBytes(REG_POINT1, data, sizeof data)) {
      point.touched = true;
      point.x = data[0] | (data[1] << 8);
      point.y = data[2] | (data[3] << 8);
    }
  }
  clearStatus();
  return point;
}
