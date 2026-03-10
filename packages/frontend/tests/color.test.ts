import test from 'node:test';
import assert from 'node:assert/strict';
import {
  colorStringToPixi,
  hsvToRgbChannels,
  normalizeColorString,
  normalizeHexColor,
  normalizeColorWithOpacity,
  hexColorToNumber,
  rgbChannelsToHsv,
} from '../src/utils/color.ts';

test('normalizeHexColor accepts and normalizes hex values', () => {
  assert.equal(normalizeHexColor('#A1B2C3', '#ffffff'), '#a1b2c3');
});

test('normalizeHexColor maps legacy drawing color names', () => {
  assert.equal(normalizeHexColor('white', '#000000'), '#ffffff');
  assert.equal(normalizeHexColor('green', '#000000'), '#22c55e');
  assert.equal(normalizeHexColor('red', '#000000'), '#ef4444');
});

test('normalizeHexColor falls back for invalid values', () => {
  assert.equal(normalizeHexColor('not-a-color', '#123456'), '#123456');
});

test('hexColorToNumber returns integer RGB color value', () => {
  assert.equal(hexColorToNumber('#ff00aa', '#ffffff'), 0xff00aa);
});

test('normalizeColorWithOpacity accepts rgba input', () => {
  const color = normalizeColorWithOpacity('rgba(255, 0, 170, 0.4)', '#ffffff');
  assert.equal(color.hex, '#ff00aa');
  assert.equal(color.alpha, 0.4);
});

test('normalizeColorWithOpacity accepts hex with alpha channel', () => {
  const color = normalizeColorWithOpacity('#33669980', '#ffffff');
  assert.equal(color.hex, '#336699');
  assert.equal(color.alpha, 128 / 255);
});

test('normalizeColorString preserves opacity in rgba output', () => {
  assert.equal(normalizeColorString('rgba(255, 0, 0, 0.25)', '#ffffff'), 'rgba(255, 0, 0, 0.25)');
});

test('colorStringToPixi returns both color integer and alpha', () => {
  const pixiColor = colorStringToPixi('rgba(0, 128, 255, 0.5)', '#ffffff');
  assert.equal(pixiColor.color, 0x0080ff);
  assert.equal(pixiColor.alpha, 0.5);
});

test('rgbChannelsToHsv resolves canonical hue/saturation/value for primary colors', () => {
  assert.deepEqual(rgbChannelsToHsv({ r: 255, g: 0, b: 0 }), { h: 0, s: 1, v: 1 });
  assert.deepEqual(rgbChannelsToHsv({ r: 0, g: 255, b: 0 }), { h: 120, s: 1, v: 1 });
  assert.deepEqual(rgbChannelsToHsv({ r: 0, g: 0, b: 255 }), { h: 240, s: 1, v: 1 });
});

test('rgbChannelsToHsv treats grayscale colors as zero-saturation values', () => {
  const hsv = rgbChannelsToHsv({ r: 128, g: 128, b: 128 });
  assert.equal(hsv.h, 0);
  assert.equal(hsv.s, 0);
  assert.equal(hsv.v, 128 / 255);
});

test('hsvToRgbChannels converts hue, saturation, and value back to rgb channels', () => {
  assert.deepEqual(hsvToRgbChannels({ h: 120, s: 1, v: 1 }), { r: 0, g: 255, b: 0 });
  assert.deepEqual(hsvToRgbChannels({ h: 240, s: 1, v: 1 }), { r: 0, g: 0, b: 255 });
  assert.deepEqual(hsvToRgbChannels({ h: 360, s: 1, v: 1 }), { r: 255, g: 0, b: 0 });
});
