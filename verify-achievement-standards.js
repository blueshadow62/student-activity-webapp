'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const file = process.argv[2] || path.join(__dirname, 'StandardsData.gs');
const source = fs.readFileSync(file, 'utf8');
const context = {};
vm.createContext(context);
vm.runInContext(`${source}\nthis.subjects = JSON.parse(STANDARDS_SUBJECTS); this.data = Object.fromEntries(Object.entries(STANDARDS_DATA).map(([key, value]) => [key, JSON.parse(value)]));`, context, { filename: file });

const levels = ['elementary', 'middle', 'high'];
const codePattern = /^\[(?:\d{1,2}[가-힣A-Za-z][가-힣A-Za-z0-9()]*-\d{2}(?:-\d{2})?|(?:[가-힣A-Za-z]{2,}|\d+[가-힣A-Za-z]+)\s+\d{2}-\d{2}(?:-\d{2})?)\]$/;
const samples = ['[2바01-01]', '[9국01-01]', '[10공국1-01-01]', '[성직 01-01]'];
const seen = new Set();
const codes = new Map();

if (!Array.isArray(context.subjects)) throw new Error('STANDARDS_SUBJECTS must be an array.');
for (const level of levels) {
  if (!Array.isArray(context.data[level]) || !context.data[level].length) throw new Error(`${level} data is empty.`);
  for (const record of context.data[level]) {
    if (!codePattern.test(record.code)) throw new Error(`unsupported code: ${record.code}`);
    if (!record.subject || !record.text || !record.text.trim()) throw new Error(`missing subject/text: ${record.code}`);
    const key = [level, record.track || '', record.subject, record.domain || '', record.code, record.text].join('\0');
    if (seen.has(key)) throw new Error(`duplicate code: ${key}`);
    seen.add(key);
    const codeKey = `${level}\0${record.code}`;
    codes.set(codeKey, (codes.get(codeKey) || 0) + 1);
  }
}
for (const code of samples) if (![...codes.keys()].some((key) => key.endsWith(`\0${code}`))) throw new Error(`known sample missing: ${code}`);
for (const subject of context.subjects) {
  if (!levels.includes(subject.schoolLevel) || !subject.name || !subject.abbreviation) throw new Error(`invalid subject catalog item: ${JSON.stringify(subject)}`);
}
if (!context.subjects.some((subject) => subject.name === '3D 프린터 개발')) {
  throw new Error('numeric-leading subject was not preserved: 3D 프린터 개발');
}
console.log(`achievement standards OK: elementary=${context.data.elementary.length}, middle=${context.data.middle.length}, high=${context.data.high.length}, subjects=${context.subjects.length}, globalCodeCollisions=${[...codes.values()].filter((count) => count > 1).length}`);
