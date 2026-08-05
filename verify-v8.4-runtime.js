'use strict';

// 다른 verify-*.js 는 소스에 특정 문자열이 있는지만 본다. 그래서 "쓸 때는 반 0을
// 허용하면서 읽을 때는 버리는" 모순처럼, 코드는 다 있는데 기능이 죽는 결함을
// 통째로 놓쳤다. 이 파일은 .gs 를 실제로 불러와 함수를 호출해서 확인한다.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const tests = [];

function test(number, name, check) {
  tests.push({ number, name, check });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// Apps Script 전역은 파일을 불러오는 시점에는 쓰이지 않는다. 아래 테스트가
// 호출하는 함수는 순수 함수이거나 fakeSheet 를 인자로 받으므로 빈 껍데기면 된다.
// function 선언은 저절로 전역 객체에 붙지만 const 선언은 그렇지 않다. 테스트에서
// 꺼내 쓸 상수는 constantNames 로 받아 다리를 놓아 준다.
function loadAppsScript(fileNames, constantNames) {
  const sandbox = {
    console,
    Session: {},
    CacheService: {},
    PropertiesService: {},
    SpreadsheetApp: {},
    DriveApp: {},
    Drive: {},
    Utilities: {},
    MailApp: {},
    LockService: {},
    ScriptApp: {},
    HtmlService: {},
    Logger: { log() {} },
  };
  vm.createContext(sandbox);
  fileNames.forEach((name) => {
    vm.runInContext(
      fs.readFileSync(path.join(__dirname, name), 'utf8'),
      sandbox,
      { filename: name },
    );
  });
  vm.runInContext(
    constantNames
      .map((name) => `globalThis.${name} = ${name};`)
      .join('\n'),
    sandbox,
    { filename: 'expose-constants' },
  );
  return sandbox;
}

const app = loadAppsScript(
  ['Code.gs', 'CentralData.gs'],
  ['APP_CONFIG', 'CENTRAL_CONFIG', 'CENTRAL_TEACHER_ASSIGNMENT_HEADERS'],
);

// 머리글 1행 + 자료 행으로 이루어진 시트 흉내. getRange 좌표는 1부터 센다.
function fakeSheet(headers, rows) {
  const grid = [headers.slice()].concat(rows.map((row) => row.slice()));
  return {
    getLastRow: () => grid.length,
    getLastColumn: () => headers.length,
    getRange(startRow, startColumn, numRows, numColumns) {
      const block = grid
        .slice(startRow - 1, startRow - 1 + numRows)
        .map((row) => row.slice(startColumn - 1, startColumn - 1 + numColumns));
      return {
        getValues: () => block,
        getDisplayValues: () => block.map((row) => row.map(
          (cell) => (cell instanceof Date ? cell.toISOString() : String(cell ?? '')),
        )),
      };
    },
  };
}

function assignmentRow(assignmentKey, classNumber, assignmentType) {
  return [
    assignmentKey, 'teacher@school.hs.kr', 2026, 2, classNumber,
    '물리학Ⅰ', assignmentType, true, '', '',
  ];
}

function readAssignmentKeys(rows) {
  return app
    .readCentralTeacherAssignments_(
      fakeSheet(app.CENTRAL_TEACHER_ASSIGNMENT_HEADERS, rows),
      true,
    )
    .map((assignment) => assignment.assignmentKey);
}

function student(classNumber, status) {
  return {
    studentKey: 'STU-1',
    schoolYear: 2026,
    grade: 2,
    classNumber,
    studentNumber: 99,
    name: '홍길동',
    status,
  };
}

test(1, '그룹 담당(반 0)이 중앙 담당 조회에 남는다', () => {
  assert(
    readAssignmentKeys([assignmentRow('A-GRP', 0, '그룹')]).includes('A-GRP'),
    '수강 그룹 담당이 조회 단계에서 제거됩니다. 승인해도 담당 목록에 뜨지 않습니다.',
  );
});

test(2, '학급 단위 담당은 그대로 조회된다', () => {
  assert(
    readAssignmentKeys([assignmentRow('A-SUB', 3, '교과')]).includes('A-SUB'),
    '기존 학급 단위 담당이 조회되지 않습니다.',
  );
});

test(3, '교과 담당인데 반이 0인 행은 계속 걸러진다', () => {
  assert(
    !readAssignmentKeys([assignmentRow('A-BAD', 0, '교과')]).includes('A-BAD'),
    '반이 비어 버린 교과 담당까지 통과합니다. 그룹일 때만 열어 줘야 합니다.',
  );
});

test(4, '공동교육과정 학생(반 0)이 유효 학생으로 남는다', () => {
  assert(
    app.isValidCentralStudent_(student(0, '공동')),
    '타교생을 추가해도 조회 단계에서 사라집니다.',
  );
});

test(5, '재학생은 그대로 유효하다', () => {
  assert(
    app.isValidCentralStudent_(student(3, '재학')),
    '기존 재학생이 조회되지 않습니다.',
  );
});

test(6, '재학인데 반이 0인 행은 계속 걸러진다', () => {
  assert(
    !app.isValidCentralStudent_(student(0, '재학')),
    '반이 비어 버린 재학생까지 통과합니다. 공동일 때만 열어 줘야 합니다.',
  );
});

let passed = 0;
for (const item of tests.sort((left, right) => left.number - right.number)) {
  try {
    item.check();
    passed += 1;
    console.log(`PASS ${item.number}. ${item.name}`);
  } catch (error) {
    console.error(`FAIL ${item.number}. ${item.name}: ${error.message}`);
    process.exitCode = 1;
  }
}
console.log(`RESULT ${passed}/${tests.length}`);
if (tests.length !== 6) {
  console.error(`FAIL expected 6 tests, got ${tests.length}`);
  process.exitCode = 1;
}
