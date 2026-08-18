'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { PAYLOAD_FILES } = require('./constants.cjs');

const WORK_DIRECTORY_NAME_PATTERN = /^[0-9a-f]{12}$/;

function assertInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('작업 폴더 밖의 파일에는 접근할 수 없습니다.');
  }
}

function assertSafeWorkDirectory(installationsRoot, workDir) {
  if (typeof installationsRoot !== 'string' || typeof workDir !== 'string') {
    throw new Error('안전하지 않은 설치 작업 폴더입니다. 새 설치를 시작해 주세요.');
  }
  const resolvedRoot = path.resolve(installationsRoot);
  const resolvedWorkDir = path.resolve(workDir);
  const relative = path.relative(resolvedRoot, resolvedWorkDir);
  if (!WORK_DIRECTORY_NAME_PATTERN.test(relative)) {
    throw new Error('안전하지 않은 설치 작업 폴더입니다. 새 설치를 시작해 주세요.');
  }
  if (!fs.existsSync(resolvedRoot)) {
    throw new Error('안전하지 않은 설치 작업 폴더입니다. 새 설치를 시작해 주세요.');
  }
  const rootStats = fs.lstatSync(resolvedRoot);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new Error('안전하지 않은 설치 작업 폴더입니다. 새 설치를 시작해 주세요.');
  }
  if (fs.existsSync(resolvedWorkDir)) {
    const workDirStats = fs.lstatSync(resolvedWorkDir);
    if (!workDirStats.isDirectory() || workDirStats.isSymbolicLink()) {
      throw new Error('안전하지 않은 설치 작업 폴더입니다. 새 설치를 시작해 주세요.');
    }
    const realRelative = path.relative(
      fs.realpathSync.native(resolvedRoot),
      fs.realpathSync.native(resolvedWorkDir)
    );
    if (!WORK_DIRECTORY_NAME_PATTERN.test(realRelative)) {
      throw new Error('안전하지 않은 설치 작업 폴더입니다. 새 설치를 시작해 주세요.');
    }
  }
  return resolvedWorkDir;
}

function cleanProjectDirectory(projectDir, installationsRoot) {
  const safeProjectDir = assertSafeWorkDirectory(installationsRoot, projectDir);
  for (const entry of fs.readdirSync(safeProjectDir, { withFileTypes: true })) {
    if (entry.name === '.clasp.json') continue;
    const target = path.join(safeProjectDir, entry.name);
    assertInside(safeProjectDir, target);
    fs.rmSync(target, { recursive: true, force: true });
  }
}

function copyPayload(payloadDir, projectDir, installationsRoot) {
  const safeProjectDir = assertSafeWorkDirectory(installationsRoot, projectDir);
  cleanProjectDirectory(safeProjectDir, installationsRoot);
  for (const fileName of PAYLOAD_FILES) {
    const source = path.join(payloadDir, fileName);
    const destination = path.join(safeProjectDir, fileName);
    if (!fs.existsSync(source)) {
      throw new Error(`설치 파일이 누락되었습니다: ${fileName}`);
    }
    fs.copyFileSync(source, destination);
  }
}

function listUnexpectedPayloadFiles(payloadDir) {
  const actual = fs.readdirSync(payloadDir).sort();
  const allowed = new Set(PAYLOAD_FILES);
  return actual.filter((fileName) => !allowed.has(fileName));
}

module.exports = {
  assertInside,
  assertSafeWorkDirectory,
  cleanProjectDirectory,
  copyPayload,
  listUnexpectedPayloadFiles,
};
