import test from 'node:test';
import assert from 'node:assert/strict';
import { toHumanReadableDiagnosticsMessage } from '../src/utils/diagnostics.ts';

test('toHumanReadableDiagnosticsMessage maps payload-too-large errors to user-facing text', () => {
  const message = toHumanReadableDiagnosticsMessage(
    'PayloadTooLargeError: request entity too large\n    at readStream (/tmp/file.js:10:1)'
  );

  assert.equal(
    message,
    'The request is too large for the backend. Reduce the graph payload and try again.'
  );
});

test('toHumanReadableDiagnosticsMessage maps backend 5xx to user-facing text', () => {
  const message = toHumanReadableDiagnosticsMessage('Request failed with status code 500');

  assert.equal(
    message,
    'The backend failed while processing the request. Please try again.'
  );
});

test('toHumanReadableDiagnosticsMessage avoids returning programmer details', () => {
  const message = toHumanReadableDiagnosticsMessage(
    'TypeError: Cannot read properties of undefined (reading "foo")'
  );

  assert.equal(message, 'The backend request failed. Please try again.');
});

