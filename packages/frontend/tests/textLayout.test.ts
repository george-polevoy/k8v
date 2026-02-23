import test from 'node:test';
import assert from 'node:assert/strict';
import { truncateTextToWidth } from '../src/utils/textLayout.ts';

function fixedWidthMeasure(text: string): number {
  return text.length * 10;
}

test('truncateTextToWidth returns original text when it fits', () => {
  const result = truncateTextToWidth('short', 80, fixedWidthMeasure);
  assert.equal(result, 'short');
});

test('truncateTextToWidth truncates and appends ellipsis when needed', () => {
  const result = truncateTextToWidth('this is a very long title', 120, fixedWidthMeasure);
  assert.equal(result, 'this is a...');
});

test('truncateTextToWidth returns empty when max width is smaller than ellipsis width', () => {
  const result = truncateTextToWidth('long', 20, fixedWidthMeasure);
  assert.equal(result, '');
});

test('truncateTextToWidth keeps max fitting prefix and ellipsis at exact boundary', () => {
  const result = truncateTextToWidth('abcdefghijk', 80, fixedWidthMeasure);
  assert.equal(result, 'abcde...');
});
