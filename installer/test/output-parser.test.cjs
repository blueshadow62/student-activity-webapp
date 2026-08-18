'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  findDeployment,
  isValidDeploymentId,
  isValidScriptId,
  parseJsonOutput,
} = require('../lib/output-parser.cjs');

test('parseJsonOutput parses clean clasp JSON', () => {
  assert.deepEqual(parseJsonOutput('{"scriptId":"abc"}'), { scriptId: 'abc' });
});

test('parseJsonOutput tolerates a notice before JSON', () => {
  assert.deepEqual(parseJsonOutput('Update available\n[{"deploymentId":"AKfy123"}]'), [{ deploymentId: 'AKfy123' }]);
});

test('findDeployment selects the matching description', () => {
  const match = findDeployment([
    { deploymentId: 'one', description: '다른 배포' },
    { deploymentId: 'two', description: '학생 활동 기록 최초 배포' },
  ], '학생 활동 기록 최초 배포');
  assert.equal(match.deploymentId, 'two');
});

test('identifier validation rejects URLs and accepts raw ids', () => {
  assert.equal(isValidScriptId('abc_def-12345678901234567890'), true);
  assert.equal(isValidScriptId('https://example.com/project'), false);
  assert.equal(isValidDeploymentId('AKfyabcdefghijklmnop'), true);
  assert.equal(isValidDeploymentId('not-a-deployment'), false);
});
