import test from 'node:test';
import assert from 'node:assert/strict';
import { hexColorToNumber, normalizeHexColor } from '../src/utils/color.ts';

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

