'use strict';

// CHANGELOG.md 맨 위 항목(최신 버전)을 README.md의 <!-- changelog:start/end -->
// 블록에 그대로 옮겨 적는다. 사람이 그 블록을 손으로 고치면 다음 실행 때
// 덮어써진다 — CHANGELOG.md만 고치면 된다.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const changelogPath = path.join(root, 'CHANGELOG.md');
const readmePath = path.join(root, 'README.md');

function latestChangelogEntry(changelog) {
  const lines = changelog.split('\n');
  const start = lines.findIndex((line) => line.startsWith('## '));
  if (start === -1) throw new Error('CHANGELOG.md에 "## " 버전 항목이 없습니다.');
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i].startsWith('## ')) { end = i; break; }
  }
  const version = lines[start].replace(/^## /, '').trim();
  const body = lines.slice(start + 1, end).join('\n').trim();
  return { version, body };
}

function buildBlock(entry) {
  return [
    '<!-- changelog:start -->',
    '<!-- 이 블록은 scripts/sync-readme-changelog.js가 CHANGELOG.md 최상단 항목으로',
    '     자동 갱신한다. 손으로 고치지 마라. -->',
    `## 최신 버전: v${entry.version}`,
    '',
    entry.body,
    '',
    '전체 변경 이력은 [CHANGELOG.md](CHANGELOG.md)에 있다.',
    '<!-- changelog:end -->',
  ].join('\n');
}

function main() {
  const changelog = fs.readFileSync(changelogPath, 'utf8');
  const readme = fs.readFileSync(readmePath, 'utf8');
  const entry = latestChangelogEntry(changelog);
  const block = buildBlock(entry);
  const markerPattern = /<!-- changelog:start -->[\s\S]*?<!-- changelog:end -->/;
  if (!markerPattern.test(readme)) {
    throw new Error('README.md에 <!-- changelog:start/end --> 표시가 없습니다.');
  }
  const updated = readme.replace(markerPattern, block);
  if (updated === readme) {
    console.log('README.md가 이미 최신 CHANGELOG 항목과 같습니다.');
    return;
  }
  fs.writeFileSync(readmePath, updated);
  console.log(`README.md를 CHANGELOG.md의 v${entry.version} 항목으로 갱신했습니다.`);
}

main();
