'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { redactSensitive } = require('../lib/redaction.cjs');

test('redacts emails, ids, and OAuth tokens from errors', () => {
  const input = 'owner@example.com AKfyabcdefghijklmnopqr abcdefghijklmnopqrstuvwxyz_123456789012345 access_token=secret';
  const output = redactSensitive(input);
  assert.equal(output.includes('owner@example.com'), false);
  assert.equal(output.includes('AKfyabcdefghijklmnopqr'), false);
  assert.equal(output.includes('abcdefghijklmnopqrstuvwxyz_123456789012345'), false);
  assert.equal(output.includes('access_token=secret'), false);
});
