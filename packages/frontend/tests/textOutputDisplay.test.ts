import assert from 'node:assert/strict';
import test from 'node:test';
import {
  countTextOutputLines,
  normalizeTextOutputDisplayConfig,
  normalizeTextOutputMaxLines,
  truncateTextOutputToMaxLines,
} from '../src/utils/textOutputDisplay.ts';

test('normalizeTextOutputDisplayConfig applies defaults and clamps invalid values', () => {
  assert.deepEqual(normalizeTextOutputDisplayConfig(undefined), {
    displayTextOutputs: false,
    maxLines: 8,
    overflowMode: 'cap',
  });

  assert.deepEqual(normalizeTextOutputDisplayConfig({
    displayTextOutputs: true,
    textOutputMaxLines: 0,
    textOutputOverflowMode: 'scroll',
  }), {
    displayTextOutputs: true,
    maxLines: 1,
    overflowMode: 'scroll',
  });

  assert.equal(normalizeTextOutputMaxLines(999), 200);
});

test('countTextOutputLines counts newline-delimited lines including trailing blank lines', () => {
  assert.equal(countTextOutputLines(''), 0);
  assert.equal(countTextOutputLines('alpha'), 1);
  assert.equal(countTextOutputLines('alpha\nbeta\n'), 3);
});

test('truncateTextOutputToMaxLines preserves whitespace and blank lines up to the cap', () => {
  assert.equal(truncateTextOutputToMaxLines('   ', 1), '   ');
  assert.equal(truncateTextOutputToMaxLines('alpha\nbeta\ngamma', 2), 'alpha\nbeta');
  assert.equal(truncateTextOutputToMaxLines('alpha\n\nbeta', 2), 'alpha\n');
});
