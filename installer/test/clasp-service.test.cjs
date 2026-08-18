'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { buildClaspCommandArgs } = require('../lib/clasp-service.cjs');

test('clasp receives an auth JSON file instead of its parent directory', () => {
  const authFilePath = path.join('user-data', 'auth', '.clasprc.json');
  const commandArgs = buildClaspCommandArgs(
    'clasp-cli.js',
    authFilePath,
    ['login']
  );

  assert.deepEqual(commandArgs, [
    'clasp-cli.js',
    '-A',
    authFilePath,
    'login',
  ]);
  assert.notEqual(commandArgs[2], path.dirname(authFilePath));
});
