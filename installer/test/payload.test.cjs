'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PAYLOAD_FILES } = require('../lib/constants.cjs');
const {
  assertSafeWorkDirectory,
  copyPayload,
  listUnexpectedPayloadFiles,
} = require('../lib/payload.cjs');

test('payload whitelist contains only deployable Apps Script files', () => {
  assert.equal(PAYLOAD_FILES.length, 12);
  assert.equal(PAYLOAD_FILES.includes('.clasp.json'), false);
  assert.equal(PAYLOAD_FILES.some((name) => name.startsWith('verify-')), false);
  assert.equal(PAYLOAD_FILES.some((name) => name.startsWith('docs')), false);
});

test('electron build packages exactly the payload whitelist', () => {
  const packageJson = require('../package.json');
  const packagedFiles = packageJson.build.extraResources
    .map((entry) => entry.to)
    .filter((destination) => destination.startsWith('payload/'))
    .map((destination) => destination.slice('payload/'.length))
    .sort();
  assert.deepEqual(packagedFiles, PAYLOAD_FILES.slice().sort());
});

test('copyPayload removes generated starter files but preserves project link', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-installer-test-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const payloadDir = path.join(root, 'payload');
  const installationsRoot = path.join(root, 'installations');
  const projectDir = path.join(installationsRoot, '0123456789ab');
  fs.mkdirSync(payloadDir);
  fs.mkdirSync(projectDir, { recursive: true });
  for (const fileName of PAYLOAD_FILES) fs.writeFileSync(path.join(payloadDir, fileName), fileName);
  fs.writeFileSync(path.join(projectDir, '.clasp.json'), '{"scriptId":"safe"}');
  fs.writeFileSync(path.join(projectDir, 'Code.js'), 'starter');

  copyPayload(payloadDir, projectDir, installationsRoot);

  assert.equal(fs.existsSync(path.join(projectDir, 'Code.js')), false);
  assert.equal(fs.existsSync(path.join(projectDir, '.clasp.json')), true);
  assert.deepEqual(listUnexpectedPayloadFiles(payloadDir), []);
});

test('work directory must be a real generated child of the installations root', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-installer-test-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const installationsRoot = path.join(root, 'installations');
  const validWorkDir = path.join(installationsRoot, '0123456789ab');
  fs.mkdirSync(validWorkDir, { recursive: true });

  assert.equal(assertSafeWorkDirectory(installationsRoot, validWorkDir), path.resolve(validWorkDir));
  [
    installationsRoot,
    root,
    path.join(root, 'outside'),
    path.join(installationsRoot, 'not-generated'),
    path.join(validWorkDir, 'nested'),
  ].forEach((candidate) => {
    assert.throws(
      () => assertSafeWorkDirectory(installationsRoot, candidate),
      /안전하지 않은 설치 작업 폴더/
    );
  });
});

test('copyPayload rejects an outside project directory without deleting it', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-installer-test-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const payloadDir = path.join(root, 'payload');
  const installationsRoot = path.join(root, 'installations');
  const outsideDir = path.join(root, 'outside');
  const markerPath = path.join(outsideDir, 'keep.txt');
  fs.mkdirSync(payloadDir);
  fs.mkdirSync(installationsRoot);
  fs.mkdirSync(outsideDir);
  for (const fileName of PAYLOAD_FILES) fs.writeFileSync(path.join(payloadDir, fileName), fileName);
  fs.writeFileSync(markerPath, 'keep');

  assert.throws(
    () => copyPayload(payloadDir, outsideDir, installationsRoot),
    /안전하지 않은 설치 작업 폴더/
  );
  assert.equal(fs.readFileSync(markerPath, 'utf8'), 'keep');
});

test('work directory rejects a junction or symbolic link', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-installer-test-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const installationsRoot = path.join(root, 'installations');
  const outsideDir = path.join(root, 'outside');
  const linkedWorkDir = path.join(installationsRoot, '0123456789ab');
  fs.mkdirSync(installationsRoot);
  fs.mkdirSync(outsideDir);
  fs.writeFileSync(path.join(outsideDir, 'keep.txt'), 'keep');
  fs.symlinkSync(
    outsideDir,
    linkedWorkDir,
    process.platform === 'win32' ? 'junction' : 'dir'
  );

  assert.throws(
    () => assertSafeWorkDirectory(installationsRoot, linkedWorkDir),
    /안전하지 않은 설치 작업 폴더/
  );
  assert.equal(fs.readFileSync(path.join(outsideDir, 'keep.txt'), 'utf8'), 'keep');
});

test('unexpected payload files are detected', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-installer-test-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const fileName of PAYLOAD_FILES) fs.writeFileSync(path.join(root, fileName), fileName);
  fs.writeFileSync(path.join(root, '.clasp.json'), 'secret');
  assert.deepEqual(listUnexpectedPayloadFiles(root), ['.clasp.json']);
});
