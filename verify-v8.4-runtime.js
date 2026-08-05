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
  ['Code.gs', 'CentralData.gs', 'PersonalStorage.gs', 'AssignmentRequests.gs', 'AdminPortal.gs'],
  [
    'APP_CONFIG', 'CENTRAL_CONFIG', 'CENTRAL_TEACHER_ASSIGNMENT_HEADERS',
    'CENTRAL_STUDENT_HEADERS', 'RECORD_HEADERS', 'PERSONAL_RECORD_HEADERS',
  ],
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

// --- 활동기록 담당키 --------------------------------------------------------

const GROUP_ASSIGNMENT = {
  assignmentKey: 'A-GRP',
  schoolYear: 2026,
  grade: 2,
  classNumber: 0,
  subject: '물리학Ⅰ',
  assignmentType: '그룹',
  isGroup: true,
  groupName: '물리 3반군',
};
const CLASS_ASSIGNMENT = {
  assignmentKey: 'A-SUB',
  schoolYear: 2026,
  grade: 2,
  classNumber: 3,
  subject: '물리학Ⅰ',
  assignmentType: '교과',
  isGroup: false,
  groupName: '',
};

// 그룹 기록은 담당 반이 0인데도 학생의 실제 반(7반)이 그대로 남는다. 이 어긋남이
// 담당키가 필요한 이유이므로 시험 자료에서도 일부러 어긋나게 둔다.
function recordRow(studentClassNumber, assignmentKey) {
  return [
    'REC-1', new Date('2026-05-01T01:00:00Z'), 2, studentClassNumber, 12,
    '홍길동', '재학', '칭찬·긍정', '탐구·문제해결', '물리학Ⅰ', '메모',
    '교사A', new Date('2026-05-01T01:00:00Z'), 'STU-1', 2026, assignmentKey,
  ];
}

function withStubbedAssignments(mine, run) {
  const originalGetMyAssignments = app.getMyAssignments;
  const originalRequireMyAssignment = app.requireMyAssignment_;
  app.getMyAssignments = () => mine;
  app.requireMyAssignment_ = (key) => {
    const found = mine.find((item) => item.assignmentKey === key);
    if (!found) throw new Error('ASSIGNMENT_FORBIDDEN');
    return found;
  };
  try {
    return run();
  } finally {
    app.getMyAssignments = originalGetMyAssignments;
    app.requireMyAssignment_ = originalRequireMyAssignment;
  }
}

function searchRecordRows(mine, rows) {
  const originalReadStudents = app.readCentralStudentsCached_;
  app.readCentralStudentsCached_ = () => [];
  try {
    return app.readCentralFilteredPersonalRecords_(
      [{ sheet: fakeSheet(app.RECORD_HEADERS, rows), archived: false }],
      mine,
      { limit: 50 },
      { email: 'teacher@school.hs.kr', author: '교사A' },
    );
  } finally {
    app.readCentralStudentsCached_ = originalReadStudents;
  }
}

test(7, '활동기록 머리글 끝에 담당키가 있다', () => {
  assert(
    app.RECORD_HEADERS[15] === '담당키',
    '활동기록에 담당키 열이 없습니다.',
  );
});

test(8, '개인 저장소 머리글이 활동기록 머리글과 같다', () => {
  assert(
    app.PERSONAL_RECORD_HEADERS.join('') === app.RECORD_HEADERS.join(''),
    '새로 만드는 개인 스프레드시트의 머리글이 활동기록 머리글과 다릅니다.',
  );
});

test(9, '담당키가 있으면 학년·반이 달라도 그 담당으로 판정한다', () => {
  const assignment = withStubbedAssignments(
    [GROUP_ASSIGNMENT],
    () => app.requireAssignmentForRecordSnapshot_(recordRow(7, 'A-GRP'), ''),
  );
  assert(
    assignment.assignmentKey === 'A-GRP',
    '그룹 기록을 수정·삭제할 수 없습니다. 담당 반 0과 학생 반이 달라 막힙니다.',
  );
});

test(10, '담당키가 있어도 내 담당이 아니면 거부한다', () => {
  let rejected = false;
  withStubbedAssignments([GROUP_ASSIGNMENT], () => {
    try {
      app.requireAssignmentForRecordSnapshot_(recordRow(7, 'A-OTHER'), '');
    } catch (error) {
      rejected = true;
    }
  });
  assert(rejected, '남의 담당키가 적힌 기록까지 통과합니다.');
});

test(11, '담당키가 빈 옛 기록은 학년·반·과목으로 판정한다', () => {
  const assignment = withStubbedAssignments(
    [CLASS_ASSIGNMENT],
    () => app.requireAssignmentForRecordSnapshot_(recordRow(3, ''), ''),
  );
  assert(
    assignment.assignmentKey === 'A-SUB',
    '담당키가 없던 기존 기록을 더 이상 수정·삭제할 수 없습니다.',
  );
});

test(12, '기록 검색이 담당키로 그룹 기록을 찾는다', () => {
  assert(
    searchRecordRows([GROUP_ASSIGNMENT], [recordRow(7, 'A-GRP')]).length === 1,
    '그룹 기록이 기록 검색에서 누락됩니다.',
  );
});

test(13, '기록 검색이 담당키 빈 옛 기록도 찾는다', () => {
  assert(
    searchRecordRows([CLASS_ASSIGNMENT], [recordRow(3, '')]).length === 1,
    '담당키가 없던 기존 기록이 기록 검색에서 사라집니다.',
  );
});

// --- 개인 데이터 폴더 이름 --------------------------------------------------

// getSchoolInstallationState_ 는 InstallationSetup.gs 에 있고 Script Properties 를
// 읽는다. 여기서는 학교명만 필요하므로 갈아 끼운다.
function withSchoolName(schoolName, run) {
  const original = app.getSchoolInstallationState_;
  app.getSchoolInstallationState_ = () => ({ schoolName });
  try {
    return run();
  } finally {
    app.getSchoolInstallationState_ = original;
  }
}

test(14, '개인 폴더 이름이 파일명과 같은 규칙을 쓴다', () => {
  const folderName = withSchoolName('동아공고', () => app.personalAppFolderName_());
  assert(
    folderName === '동아공고_학생 활동 기록 데이터',
    `개인 폴더 이름이 '학교명_학생 활동 기록 데이터'가 아닙니다: ${folderName}`,
  );
  const fileName = withSchoolName('동아공고', () => app.personalDatabaseName_(2026));
  assert(
    fileName.startsWith(folderName),
    '파일명이 폴더명과 같은 규칙으로 시작하지 않습니다.',
  );
});

test(15, '개인 폴더 이름에 연도를 붙이지 않는다', () => {
  const folderName = withSchoolName('동아공고', () => app.personalAppFolderName_());
  assert(
    !/\d{4}/.test(folderName),
    '한 폴더에 여러 학년도 파일이 들어가는데 폴더 이름에 연도가 붙었습니다.',
  );
});

test(16, '학교명이 없으면 예전 폴더 이름을 그대로 쓴다', () => {
  const folderName = withSchoolName('', () => app.personalAppFolderName_());
  assert(
    folderName === '학생 활동 기록 웹앱 데이터',
    '설치 전에는 예전 폴더 이름을 유지해야 합니다.',
  );
});

test(17, '폴더를 이름으로 찾을 때 예전 이름도 함께 본다', () => {
  const names = withSchoolName('동아공고', () => app.personalAppFolderNames_());
  assert(
    names.includes('동아공고_학생 활동 기록 데이터')
      && names.includes('학생 활동 기록 웹앱 데이터'),
    '예전 이름을 함께 찾지 않아 기존 교사의 폴더가 고아가 됩니다.',
  );
  const legacyOnly = withSchoolName('', () => app.personalAppFolderNames_());
  assert(legacyOnly.length === 1, '같은 이름을 두 번 찾습니다.');
});

// --- 그룹원 조회 횟수 --------------------------------------------------------

test(18, '그룹원 명단은 한 실행에서 한 번만 읽는다', () => {
  const originals = {
    readCentralGroupRows_: app.readCentralGroupRows_,
    clearCentralReadCache_: app.clearCentralReadCache_,
    getRequiredCentralGroupMemberSheet_: app.getRequiredCentralGroupMemberSheet_,
  };
  let reads = 0;
  app.readCentralGroupRows_ = () => { reads += 1; return [['A-GRP', 'STU-1']]; };
  app.clearCentralReadCache_ = () => {};
  app.getRequiredCentralGroupMemberSheet_ = () => ({ getParent: () => ({}) });
  try {
    app.clearCentralGroupCache_({});
    // centralStudentBelongsToAssignment_ 가 학생 한 명마다 부르는 자리다.
    for (let index = 0; index < 200; index += 1) app.readCentralGroupMembersCached_();
    assert(
      reads === 1,
      `학생 수만큼 그룹원 시트를 다시 읽습니다(${reads}회). 조회가 멈춘 것처럼 느려집니다.`,
    );
    app.clearCentralGroupCache_({});
    app.readCentralGroupMembersCached_();
    assert(reads === 2, '편성을 저장한 뒤에도 옛 명단을 계속 씁니다.');
  } finally {
    Object.keys(originals).forEach((name) => { app[name] = originals[name]; });
  }
});

// --- 담당 신청 허용 범위 -----------------------------------------------------

function savePolicy(payload) {
  const originals = {
    requireAdmin_: app.requireAdmin_,
    PropertiesService: app.PropertiesService,
  };
  const store = new Map();
  app.requireAdmin_ = () => {};
  app.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (key) => store.get(key) || '',
      setProperty: (key, value) => { store.set(key, value); },
      deleteProperty: (key) => { store.delete(key); },
    }),
  };
  try {
    return { result: app.saveAssignmentRequestPolicy(payload), store };
  } finally {
    Object.keys(originals).forEach((name) => { app[name] = originals[name]; });
  }
}

function policyRejects(payload) {
  try {
    savePolicy(payload);
    return '';
  } catch (error) {
    return error.message;
  }
}

test(19, '학교 도메인은 허용 목록으로 저장된다', () => {
  const { result, store } = savePolicy({ restricted: true, allowList: '@school.hs.kr' });
  assert(result.restricted && result.allowList === '@school.hs.kr', '도메인이 저장되지 않습니다.');
  assert(
    store.get('ALLOWED_TEACHER_EMAILS') === '@school.hs.kr',
    'requireAllowedTeacherEmail_ 가 읽는 속성에 저장되지 않습니다.',
  );
});

test(20, '공용 메일 도메인은 통째로 허용하지 못한다', () => {
  ['@gmail.com', '@naver.com', '@daum.net'].forEach((domain) => {
    assert(
      policyRejects({ restricted: true, allowList: domain }),
      `${domain} 을 통째로 허용하면 제한이 아니라 전 세계에 열어 주는 것입니다.`,
    );
  });
  // 개별 이메일은 사람이 특정되므로 공용 메일이어도 막지 않는다.
  assert(
    !policyRejects({ restricted: true, allowList: 'kim@gmail.com' }),
    '개별 이메일 지정까지 막고 있습니다.',
  );
});

test(21, '제한을 끄면 속성을 지운다', () => {
  const { store } = savePolicy({ restricted: false, allowList: '@school.hs.kr' });
  assert(
    !store.has('ALLOWED_TEACHER_EMAILS'),
    '제한을 꺼도 옛 목록이 남아 교사가 계속 막힙니다.',
  );
});

test(22, '빈 목록으로 제한을 켤 수 없다', () => {
  assert(
    policyRejects({ restricted: true, allowList: '   ' }),
    '빈 목록으로 제한을 켜면 아무도 신청할 수 없게 됩니다.',
  );
  assert(
    policyRejects({ restricted: true, allowList: '@school' }),
    '점 없는 도메인이 통과합니다.',
  );
});

// fakeSheet 는 읽기 전용이다. 새 학년도 정리는 칸을 실제로 바꾸므로 쓰기와
// 행 삭제까지 흉내 내는 시트가 따로 필요하다.
function writableSheet(headers, rows) {
  const grid = [headers.slice()].concat(rows.map((row) => row.slice()));
  return {
    grid,
    getParent: () => ({}),
    getLastRow: () => grid.length,
    getLastColumn: () => headers.length,
    deleteRow(rowNumber) { grid.splice(rowNumber - 1, 1); },
    getRange(startRow, startColumn, numRows, numColumns) {
      const rowCount = numRows == null ? 1 : numRows;
      const columnCount = numColumns == null ? 1 : numColumns;
      const block = () => grid
        .slice(startRow - 1, startRow - 1 + rowCount)
        .map((row) => row.slice(startColumn - 1, startColumn - 1 + columnCount));
      return {
        getValues: block,
        getDisplayValues: () => block().map((row) => row.map(
          (cell) => (cell instanceof Date ? cell.toISOString() : String(cell ?? '')),
        )),
        setValue(value) { grid[startRow - 1][startColumn - 1] = value; },
        setValues(values) {
          values.forEach((row, rowIndex) => row.forEach((cell, columnIndex) => {
            grid[startRow - 1 + rowIndex][startColumn - 1 + columnIndex] = cell;
          }));
        },
      };
    },
  };
}

function centralStudentRow(studentKey, schoolYear, classNumber) {
  return [studentKey, schoolYear, 1, classNumber, 5, '홍길동', '재학', true, '', ''];
}

function centralAssignmentRow(assignmentKey, schoolYear) {
  return [
    assignmentKey, 'kim@school.hs.kr', schoolYear, 1, 3, '국어', '교과', true, '', '',
  ];
}

// 정리 함수는 시트·캐시 전역을 직접 부른다. 그 전역만 갈아 끼우고 진짜 함수를
// 그대로 호출해야 '체크한 것만 끈다'는 동작을 실제로 확인할 수 있다.
function withSchoolYearStubs(students, assignments, body) {
  const studentSheet = writableSheet(app.CENTRAL_STUDENT_HEADERS, students);
  const assignmentSheet = writableSheet(
    app.CENTRAL_TEACHER_ASSIGNMENT_HEADERS, assignments,
  );
  const original = {
    getRequiredCentralStudentSheet_: app.getRequiredCentralStudentSheet_,
    getRequiredCentralAssignmentSheet_: app.getRequiredCentralAssignmentSheet_,
    clearCentralStudentCache_: app.clearCentralStudentCache_,
    clearCentralTeacherAssignmentCache_: app.clearCentralTeacherAssignmentCache_,
    getCurrentSchoolYear_: app.getCurrentSchoolYear_,
    requireAdmin_: app.requireAdmin_,
    withCentralWriteLock_: app.withCentralWriteLock_,
  };
  app.getRequiredCentralStudentSheet_ = () => studentSheet;
  app.getRequiredCentralAssignmentSheet_ = () => assignmentSheet;
  app.clearCentralStudentCache_ = () => {};
  app.clearCentralTeacherAssignmentCache_ = () => {};
  app.getCurrentSchoolYear_ = () => 2027;
  app.requireAdmin_ = () => {};
  app.withCentralWriteLock_ = (callback) => callback();
  try {
    return body(studentSheet, assignmentSheet);
  } finally {
    Object.keys(original).forEach((name) => { app[name] = original[name]; });
  }
}

// '사용' 열은 8번째다.
function activeFlags(sheet) {
  return sheet.grid.slice(1).map((row) => row[7]);
}

test(23, '지난 학년도 학생만 비활성화한다', () => {
  withSchoolYearStubs(
    [
      centralStudentRow('S-2026', 2026, 3),
      centralStudentRow('S-2027', 2027, 3),
    ],
    [],
    (studentSheet) => {
      const count = app.deactivatePreviousCentralStudents_(2027);
      assert(count === 1, `지난 학년도 학생을 ${count}명으로 셌습니다.`);
      assert(activeFlags(studentSheet)[0] === false, '지난 학년도 학생이 켜진 채입니다.');
      assert(activeFlags(studentSheet)[1] === true, '올해 학생까지 꺼 버렸습니다.');
    },
  );
});

test(24, '지난 학년도 담당만 비활성화한다', () => {
  withSchoolYearStubs(
    [],
    [
      centralAssignmentRow('A-2026', 2026),
      centralAssignmentRow('A-2027', 2027),
    ],
    (studentSheet, assignmentSheet) => {
      const count = app.deactivatePreviousCentralAssignments_(2027);
      assert(count === 1, `지난 학년도 담당을 ${count}건으로 셌습니다.`);
      assert(activeFlags(assignmentSheet)[0] === false, '지난 학년도 담당이 켜진 채입니다.');
      assert(activeFlags(assignmentSheet)[1] === true, '올해 담당까지 꺼 버렸습니다.');
    },
  );
});

test(25, '체크하지 않은 항목은 건드리지 않는다', () => {
  withSchoolYearStubs(
    [centralStudentRow('S-2026', 2026, 3)],
    [centralAssignmentRow('A-2026', 2026)],
    (studentSheet, assignmentSheet) => {
      const result = app.runSchoolYearTransition({
        deactivateStudents: true, deactivateAssignments: false,
      });
      assert(result.studentCount === 1, '학생 정리 건수가 맞지 않습니다.');
      assert(result.assignmentCount === 0, '담당 정리 건수가 맞지 않습니다.');
      assert(activeFlags(studentSheet)[0] === false, '학생이 꺼지지 않았습니다.');
      assert(
        activeFlags(assignmentSheet)[0] === true,
        '체크하지 않은 담당까지 꺼 버렸습니다.',
      );
    },
  );
});

test(26, '이미 정리된 뒤 다시 눌러도 결과가 같다', () => {
  withSchoolYearStubs(
    [centralStudentRow('S-2026', 2026, 3)],
    [],
    () => {
      assert(app.deactivatePreviousCentralStudents_(2027) === 1, '첫 정리가 안 됩니다.');
      assert(
        app.deactivatePreviousCentralStudents_(2027) === 0,
        '이미 꺼진 학생을 다시 세고 있습니다.',
      );
    },
  );
});

test(27, '아무것도 고르지 않으면 정리를 막는다', () => {
  withSchoolYearStubs([], [], () => {
    let rejected = false;
    try {
      app.runSchoolYearTransition({
        deactivateStudents: false, deactivateAssignments: false,
      });
    } catch (error) {
      rejected = true;
    }
    assert(rejected, '아무것도 고르지 않았는데 정리가 실행됩니다.');
  });
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
if (tests.length !== 27) {
  console.error(`FAIL expected 27 tests, got ${tests.length}`);
  process.exitCode = 1;
}
