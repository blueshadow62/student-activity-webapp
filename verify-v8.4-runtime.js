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
  [
    'Code.gs', 'CentralData.gs', 'PersonalStorage.gs', 'AssignmentRequests.gs',
    'AdminPortal.gs', 'CourseGroups.gs', 'PersonalRouting.gs',
  ],
  [
    'APP_CONFIG', 'CENTRAL_CONFIG', 'CENTRAL_TEACHER_ASSIGNMENT_HEADERS',
    'CENTRAL_STUDENT_HEADERS', 'RECORD_HEADERS', 'PERSONAL_RECORD_HEADERS',
    'CENTRAL_GROUP_HEADERS',
  ],
);
// formatDateTime_ 이 부르는데 빈 Session·Utilities 스텁에는 없다.
app.Session.getScriptTimeZone = () => 'Asia/Seoul';
app.Utilities.formatDate = (date) => date.toISOString();

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
        getValue: () => { const row = block()[0]; return row ? row[0] : ''; },
        getDisplayValues: () => block().map((row) => row.map(
          (cell) => (cell instanceof Date ? cell.toISOString() : String(cell ?? '')),
        )),
        // 실제 시트는 기존 데이터보다 뒤쪽 행에 써도 그냥 자란다. 새 행을
        // append 하는 코드(예: upsertCentralGroupName_ 의 새 그룹 추가)를
        // 시험하려면 흉내도 똑같이 자라야 한다.
        growTo(rowIndex) {
          while (grid.length <= rowIndex) grid.push([]);
        },
        setValue(value) {
          this.growTo(startRow - 1);
          grid[startRow - 1][startColumn - 1] = value;
        },
        setValues(values) {
          values.forEach((row, rowIndex) => {
            this.growTo(startRow - 1 + rowIndex);
            row.forEach((cell, columnIndex) => {
              grid[startRow - 1 + rowIndex][startColumn - 1 + columnIndex] = cell;
            });
          });
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

test(28, '그룹 담당 활성 상태 변경이 기존 그룹명을 보존한다', () => {
  const originals = {
    requireAdmin_: app.requireAdmin_,
    withCentralWriteLock_: app.withCentralWriteLock_,
    normalizeCentralKey_: app.normalizeCentralKey_,
    getRequiredCentralAssignmentSheet_: app.getRequiredCentralAssignmentSheet_,
    readCentralTeacherAssignments_: app.readCentralTeacherAssignments_,
    centralGroupNameFor_: app.centralGroupNameFor_,
    clearCentralTeacherAssignmentCache_: app.clearCentralTeacherAssignmentCache_,
  };
  const writes = [];
  const sheet = {
    getParent: () => ({}),
    getRange: (row, column) => ({
      setValue(value) { writes.push({ row, column, value }); },
    }),
  };
  Object.assign(app, {
    requireAdmin_: () => {},
    withCentralWriteLock_: (run) => run(),
    normalizeCentralKey_: (key) => key,
    getRequiredCentralAssignmentSheet_: () => sheet,
    readCentralTeacherAssignments_: () => [{ ...GROUP_ASSIGNMENT, rowNumber: 2 }],
    centralGroupNameFor_: () => GROUP_ASSIGNMENT.groupName,
    clearCentralTeacherAssignmentCache_: () => {},
  });
  try {
    const result = app.setTeacherAssignmentActive('A-GRP', false);
    assert(
      writes[0].column === 8
        && writes[0].value === false
        && result.assignment.groupName === GROUP_ASSIGNMENT.groupName,
      '그룹 담당 상태만 바꾸지 못했거나 기존 그룹명이 사라졌습니다.',
    );
  } finally {
    Object.assign(app, originals);
  }
});

test(29, '서버 권한검사가 현재 학년도 담당키만 허용한다', () => {
  const originals = {
    normalizeCentralKey_: app.normalizeCentralKey_,
    getRequiredActiveUserEmail_: app.getRequiredActiveUserEmail_,
    getCurrentSchoolYear_: app.getCurrentSchoolYear_,
    readCentralTeacherAssignmentsCached_: app.readCentralTeacherAssignmentsCached_,
  };
  Object.assign(app, {
    normalizeCentralKey_: (key) => key,
    getRequiredActiveUserEmail_: () => CLASS_ASSIGNMENT.teacherEmail,
    getCurrentSchoolYear_: () => 2026,
    readCentralTeacherAssignmentsCached_: () => [
      CLASS_ASSIGNMENT,
      { ...CLASS_ASSIGNMENT, assignmentKey: 'A-OLD', schoolYear: 2025 },
    ],
  });
  try {
    assert(
      app.requireMyAssignment_('A-SUB').assignmentKey === 'A-SUB',
      '현재 학년도 담당키가 거부됩니다.',
    );
    let rejected = false;
    try {
      app.requireMyAssignment_('A-OLD');
    } catch (error) {
      rejected = true;
    }
    assert(rejected, '과거 학년도 담당키가 서버 권한검사를 통과합니다.');
  } finally {
    Object.assign(app, originals);
  }
});

test(30, '시트 전체 교체는 새 데이터 저장 후 남는 행을 지운다', () => {
  const events = [];
  const sheet = {
    getLastRow: () => 6,
    getRange: (row, column, rowCount, width) => ({
      setValues() { events.push(['write', row, rowCount, width]); },
      clearContent() { events.push(['clear', row, rowCount, width]); },
    }),
  };
  app.replaceCentralSheetRows_(sheet, 2, [['A', 1], ['B', 2], ['C', 3]]);
  assert(
    events[0][0] === 'write'
      && events[1][0] === 'clear'
      && events[1][1] === 5
      && events[1][2] === 2,
    '새 데이터를 쓰기 전에 기존 행을 지우거나 남는 행 범위가 잘못됐습니다.',
  );

  let clearedAfterFailure = false;
  const failingSheet = {
    getLastRow: () => 6,
    getRange: () => ({
      setValues() { throw new Error('WRITE_FAILED'); },
      clearContent() { clearedAfterFailure = true; },
    }),
  };
  try {
    app.replaceCentralSheetRows_(failingSheet, 2, [['A', 1]]);
  } catch (error) {
    assert(error.message === 'WRITE_FAILED', '예상한 쓰기 실패가 아닙니다.');
  }
  assert(!clearedAfterFailure, '새 데이터 쓰기 실패 뒤 기존 행을 지웠습니다.');
});

// --- 공동교육과정 학생 삭제 ------------------------------------------------

function withExternalRemovalStubs(studentRows, groupMembers, body) {
  const sheet = writableSheet(app.CENTRAL_STUDENT_HEADERS, studentRows);
  const replaced = [];
  const original = {
    requireMyGroupAssignment_: app.requireMyGroupAssignment_,
    normalizeCentralKey_: app.normalizeCentralKey_,
    withCentralWriteLock_: app.withCentralWriteLock_,
    readCentralGroupMembersCached_: app.readCentralGroupMembersCached_,
    getRequiredCentralStudentSheet_: app.getRequiredCentralStudentSheet_,
    replaceCentralGroupMembers_: app.replaceCentralGroupMembers_,
    clearCentralStudentCache_: app.clearCentralStudentCache_,
  };
  app.requireMyGroupAssignment_ = () => GROUP_ASSIGNMENT;
  app.normalizeCentralKey_ = (key) => key;
  app.withCentralWriteLock_ = (callback) => callback();
  app.readCentralGroupMembersCached_ = () => new Map(
    Object.keys(groupMembers).map((key) => [key, new Set(groupMembers[key])]),
  );
  app.getRequiredCentralStudentSheet_ = () => sheet;
  app.replaceCentralGroupMembers_ = (key, keys) => { replaced.push([key, keys]); };
  app.clearCentralStudentCache_ = () => {};
  try {
    return body(sheet, replaced);
  } finally {
    Object.keys(original).forEach((name) => { app[name] = original[name]; });
  }
}

function externalStudentRow(studentKey, name) {
  return [studentKey, 2026, 2, 0, 99, name, '공동', true, '', ''];
}

function rejectsRemoval(studentRows, groupMembers) {
  return withExternalRemovalStubs(studentRows, groupMembers, (sheet) => {
    let rejected = false;
    try {
      app.removeExternalStudentFromMyGroup('A-GRP', 'STU-X');
    } catch (error) {
      rejected = true;
    }
    return rejected && sheet.grid[1][7] === true;
  });
}

test(31, '내 그룹의 공동교육과정 학생을 삭제한다', () => {
  withExternalRemovalStubs(
    [externalStudentRow('STU-X', '진현정')],
    { 'A-GRP': ['STU-X', 'STU-Y'] },
    (sheet, replaced) => {
      const result = app.removeExternalStudentFromMyGroup('A-GRP', 'STU-X');
      assert(result.name === '진현정', '삭제한 학생 이름이 돌아오지 않습니다.');
      assert(sheet.grid[1][7] === false, '학생이 중앙 명단에서 꺼지지 않았습니다.');
      assert(
        replaced.length === 1 && replaced[0][1].join() === 'STU-Y',
        '편성 명단에서 그 학생만 빠지지 않았습니다.',
      );
    },
  );
});

test(32, '우리 학교 학생은 교사가 삭제하지 못한다', () => {
  assert(
    rejectsRemoval(
      // 반 3, 학적상태 재학 = 우리 학교 학생
      [['STU-X', 2026, 2, 3, 12, '홍길동', '재학', true, '', '']],
      { 'A-GRP': ['STU-X'] },
    ),
    '교사가 우리 학교 학생을 중앙 명단에서 지울 수 있습니다.',
  );
});

test(33, '다른 그룹에도 편성된 학생은 삭제하지 못한다', () => {
  assert(
    rejectsRemoval(
      [externalStudentRow('STU-X', '진현정')],
      { 'A-GRP': ['STU-X'], 'A-OTHER': ['STU-X'] },
    ),
    '다른 교사의 그룹에 있는 학생까지 지웁니다.',
  );
});

test(34, '내 그룹에 없는 학생은 삭제하지 못한다', () => {
  assert(
    rejectsRemoval(
      [externalStudentRow('STU-X', '진현정')],
      { 'A-OTHER': ['STU-X'] },
    ),
    '내 그룹에 편성되지 않은 학생까지 지웁니다.',
  );
});

// --- 개인 스프레드시트 시트 순서 --------------------------------------------

function fakeSpreadsheet(sheetNames) {
  const order = sheetNames.slice();
  let active = null;
  return {
    order,
    getSheetByName(name) {
      if (!order.includes(name)) return null;
      return { getName: () => name, getIndex: () => order.indexOf(name) + 1 };
    },
    setActiveSheet(sheet) { active = sheet.getName(); },
    moveActiveSheet(position) {
      order.splice(order.indexOf(active), 1);
      order.splice(position - 1, 0, active);
    },
  };
}

test(35, '개인 파일 시트를 활동기록·보관·설정·삭제 순으로 놓는다', () => {
  const spreadsheet = fakeSpreadsheet(['설정', '활동기록', '활동기록보관', '삭제기록']);
  app.orderPersonalSheets_(spreadsheet);
  assert(
    spreadsheet.order.join() === '활동기록,활동기록보관,설정,삭제기록',
    `시트 순서가 ${spreadsheet.order.join()} 입니다.`,
  );
});

test(36, '순서가 이미 맞으면 시트를 건드리지 않는다', () => {
  const spreadsheet = fakeSpreadsheet(['활동기록', '활동기록보관', '설정', '삭제기록']);
  let moved = false;
  spreadsheet.moveActiveSheet = () => { moved = true; };
  app.orderPersonalSheets_(spreadsheet);
  assert(!moved, '순서가 맞는데도 매번 시트를 옮깁니다.');
});

// --- 왕복 횟수 -------------------------------------------------------------

// Apps Script 가 느린 이유는 계산이 아니라 구글 서버 왕복 횟수다. 행마다 setValue
// 를 부르는 방식으로 되돌아가면 이 시험이 잡는다.
function countingSheet(headers, rows) {
  const sheet = writableSheet(headers, rows);
  const originalGetRange = sheet.getRange;
  sheet.calls = 0;
  sheet.getRange = function (...args) {
    const range = originalGetRange.apply(sheet, args);
    return new Proxy(range, {
      get(target, key) {
        if (typeof target[key] === 'function') {
          sheet.calls += 1;
          return target[key].bind(target);
        }
        return target[key];
      },
    });
  };
  return sheet;
}

test(37, '학생 180명을 꺼도 왕복이 열 손가락 안이다', () => {
  const rows = [];
  for (let index = 0; index < 180; index += 1) {
    rows.push(centralStudentRow(`S-${index}`, 2026, 3));
  }
  const sheet = countingSheet(app.CENTRAL_STUDENT_HEADERS, rows);
  const changed = app.deactivateCentralRows_(
    sheet, rows.map((row, index) => index + 2),
  );
  assert(changed === 180, `${changed}명만 껐습니다.`);
  assert(
    sheet.calls <= 10,
    `왕복이 ${sheet.calls}번입니다. 행마다 따로 쓰고 있습니다.`,
  );
  assert(
    sheet.grid.slice(1).every((row) => row[7] === false),
    '꺼지지 않은 학생이 있습니다.',
  );
});

test(38, '지정하지 않은 행의 사용 값은 그대로 둔다', () => {
  const sheet = countingSheet(app.CENTRAL_STUDENT_HEADERS, [
    centralStudentRow('S-1', 2026, 3),
    centralStudentRow('S-2', 2027, 3),
  ]);
  app.deactivateCentralRows_(sheet, [2]);
  assert(sheet.grid[1][7] === false, '지정한 행이 꺼지지 않았습니다.');
  assert(sheet.grid[2][7] === true, '열을 통째로 되쓰면서 남의 행까지 껐습니다.');
});

test(39, '중앙 스프레드시트는 한 실행에서 한 번만 연다', () => {
  const original = {
    getCentralConfiguration_: app.getCentralConfiguration_,
    isValidCentralDriveId_: app.isValidCentralDriveId_,
    SpreadsheetApp: app.SpreadsheetApp,
  };
  let opens = 0;
  app.getCentralConfiguration_ = () => ({ databaseId: 'FILE-1' });
  app.isValidCentralDriveId_ = () => true;
  app.SpreadsheetApp = { openById(id) { opens += 1; return { id }; } };
  try {
    app.getCentralDatabase_();
    app.getCentralDatabase_();
    app.getCentralDatabase_();
    assert(opens === 1, `파일을 ${opens}번 열었습니다.`);
    // 관리자가 중앙 자료를 바꾸면 기억한 것을 버리고 새로 열어야 한다.
    app.getCentralConfiguration_ = () => ({ databaseId: 'FILE-2' });
    assert(app.getCentralDatabase_().id === 'FILE-2', '바뀐 중앙 자료를 열지 않습니다.');
  } finally {
    Object.keys(original).forEach((name) => { app[name] = original[name]; });
  }
});

test(40, '설정값은 한 번에 받아 온다', () => {
  const original = app.PropertiesService;
  let single = 0;
  let bulk = 0;
  app.PropertiesService = {
    getScriptProperties: () => ({
      getProperty() { single += 1; return ''; },
      getProperties() { bulk += 1; return {}; },
    }),
  };
  try {
    app.getCentralConfiguration_();
    assert(bulk === 1 && single === 0, `한 항목씩 ${single}번 읽고 있습니다.`);
  } finally {
    app.PropertiesService = original;
  }
});

// --- 업데이트 알림 ---------------------------------------------------------

// 버전 비교는 Index.html 안에 있어 vm 으로 못 불러온다. 함수 본문만 떼어 내
// 실제로 실행한다. 글자 비교로 되돌아가면 1.10.0 이 1.9.0 보다 낮다고 나온다.
const clientSource = fs.readFileSync(path.join(__dirname, 'Index.html'), 'utf8');

function clientFunction(name) {
  const marker = `function ${name}(`;
  const start = clientSource.indexOf(marker);
  assert(start >= 0, `${name} 를 찾을 수 없습니다.`);
  let depth = 0;
  for (let index = clientSource.indexOf('{', start); index < clientSource.length; index += 1) {
    if (clientSource[index] === '{') depth += 1;
    if (clientSource[index] === '}') {
      depth -= 1;
      if (depth === 0) {
        // eslint-disable-next-line no-new-func
        return new Function(`return (${clientSource.slice(start, index + 1)})`)();
      }
    }
  }
  throw new Error(`${name} 본문이 닫히지 않았습니다.`);
}

test(41, '버전 비교가 자리마다 숫자로 이뤄진다', () => {
  const compare = clientFunction('compareVersions_');
  assert(compare('1.10.0', '1.9.0') > 0, '1.10.0 을 1.9.0 보다 낮게 봅니다.');
  assert(compare('2.0.0', '1.9.9') > 0, '앞자리가 큰 버전을 낮게 봅니다.');
  assert(compare('1.0.0', '1.0.0') === 0, '같은 버전을 다르게 봅니다.');
  assert(compare('1.0.0', '1.0.1') < 0, '더 낮은 버전을 최신으로 봅니다.');
  assert(compare('1.0', '1.0.0') === 0, '자리가 빠진 버전을 다르게 봅니다.');
});

test(42, '현재 앱 버전이 비교 가능한 형식이다', () => {
  const version = String(app.APP_CONFIG.version);
  assert(
    /^\d+\.\d+\.\d+$/.test(version),
    `앱 버전 '${version}'은 릴리스 태그와 견줄 수 없는 형식입니다.`,
  );
});

test(43, '업데이트 확인은 관리자 화면에서만 하고 실패해도 조용하다', () => {
  const body = clientSource.slice(
    clientSource.indexOf('async function checkForUpdate_'),
    clientSource.indexOf('function compareVersions_'),
  );
  assert(body.includes('catch'), '확인 실패가 관리자 화면 오류로 번집니다.');
  assert(
    body.includes('RELEASE_REPOSITORY_URL'),
    '릴리스 주소를 확인하지 않고 링크로 겁니다.',
  );
  // 교사 화면(renderPersonalBootstrap)에서는 부르지 않아야 한다. 학교 전체가
  // 한 IP로 나가면 GitHub 호출 한도에 걸린다.
  const personal = clientSource.slice(
    clientSource.indexOf('function renderPersonalBootstrap'),
    clientSource.indexOf('function renderPreviousYearNotice_'),
  );
  assert(
    !personal.includes('checkForUpdate_'),
    '교사 화면에서도 GitHub에 버전을 묻고 있습니다.',
  );
});

// --- 신청 이력의 현재 상태 --------------------------------------------------

function storedRequest(overrides) {
  return Object.assign({
    requestKey: 'REQ-1',
    teacherEmail: 'kim@school.hs.kr',
    schoolYear: 2026,
    grade: 2,
    classNumber: 3,
    subject: '문학',
    assignmentType: '교과',
    groupName: '',
    status: 'APPROVED',
    requestedAt: new Date().toISOString(),
    processedAt: '',
    processedBy: '',
    reason: '',
    assignmentKey: 'A-1',
  }, overrides || {});
}

function liveAssignment(overrides) {
  return Object.assign({
    assignmentKey: 'A-1', teacherEmail: 'kim@school.hs.kr', active: true,
  }, overrides || {});
}

test(44, '관리자가 담당을 삭제하면 신청 이력에 삭제됨이 붙는다', () => {
  const label = app.toPublicAssignmentRequest_(storedRequest(), false, []).statusLabel;
  assert(label === '승인 · 삭제됨', `삭제된 담당인데 라벨이 '${label}'입니다.`);
});

test(45, '관리자가 담당을 비활성화하면 신청 이력에 비활성화됨이 붙는다', () => {
  const label = app.toPublicAssignmentRequest_(
    storedRequest(), false, [liveAssignment({ active: false })],
  ).statusLabel;
  assert(label === '승인 · 비활성화됨', `비활성 담당인데 라벨이 '${label}'입니다.`);
});

test(46, '담당이 살아 있으면 신청 이력 라벨을 그대로 둔다', () => {
  const label = app.toPublicAssignmentRequest_(
    storedRequest(), false, [liveAssignment()],
  ).statusLabel;
  assert(label === '승인', `살아 있는 담당인데 라벨이 '${label}'입니다.`);
});

test(47, '다른 교사의 같은 담당키는 내 상태 판정에 섞이지 않는다', () => {
  const label = app.toPublicAssignmentRequest_(
    storedRequest(), false, [liveAssignment({ teacherEmail: 'other@school.hs.kr' })],
  ).statusLabel;
  assert(label === '승인 · 삭제됨', '다른 교사의 담당을 내 것으로 착각합니다.');
});

test(48, '대기·거부 신청은 현재 상태를 확인하지 않는다', () => {
  const label = app.toPublicAssignmentRequest_(
    storedRequest({ status: 'PENDING', assignmentKey: '' }), false, [],
  ).statusLabel;
  assert(label === '승인 대기', `대기 신청인데 라벨이 '${label}'입니다.`);
});

// --- 수강 그룹 다학년 편성 ---------------------------------------------------

test(49, '함께 듣는 학년 목록을 정리한다', () => {
  assert(
    app.normalizeCentralGroupGradeList_('').length === 0,
    '비워 두면 빈 목록이어야 하는데 아닙니다.',
  );
  assert(
    app.normalizeCentralGroupGradeList_('3, 2, 3').join(',') === '2,3',
    '중복 제거·오름차순 정렬이 되지 않습니다.',
  );
  let rejected = false;
  try {
    app.normalizeCentralGroupGradeList_('4');
  } catch (error) {
    rejected = true;
  }
  assert(rejected, '존재하지 않는 학년(4)을 받아들입니다.');
});

test(50, '학급 단위 담당은 학년이 하나뿐이다', () => {
  const grades = app.centralAssignmentGrades_({
    grade: 2, assignmentType: '교과', assignmentKey: 'A-SUB',
  });
  assert(grades.join(',') === '2', `학급 단위인데 학년이 [${grades}]입니다.`);
});

test(51, '수강 그룹은 기본 학년에 추가 학년을 합친다', () => {
  const original = app.readCentralGroupGradesCached_;
  app.readCentralGroupGradesCached_ = () => new Map([['A-GRP', [3]]]);
  try {
    const grades = app.centralAssignmentGrades_({
      grade: 2, assignmentType: '그룹', assignmentKey: 'A-GRP',
    });
    assert(grades.join(',') === '2,3', `합쳐진 학년이 [${grades}]입니다.`);
  } finally {
    app.readCentralGroupGradesCached_ = original;
  }
});

test(52, '추가 학년 조회가 실패해도 기본 학년만으로 동작한다', () => {
  const original = app.readCentralGroupGradesCached_;
  app.readCentralGroupGradesCached_ = () => { throw new Error('SHEET_ERROR'); };
  try {
    const grades = app.centralAssignmentGrades_({
      grade: 2, assignmentType: '그룹', assignmentKey: 'A-GRP',
    });
    assert(grades.join(',') === '2', `조회 실패 시에도 학년이 [${grades}]입니다.`);
  } finally {
    app.readCentralGroupGradesCached_ = original;
  }
});

test(53, '편성 후보가 추가 학년 학생까지 포함한다', () => {
  const original = {
    readCentralStudentsCached_: app.readCentralStudentsCached_,
    readCentralGroupGradesCached_: app.readCentralGroupGradesCached_,
  };
  app.readCentralStudentsCached_ = () => [
    { active: true, schoolYear: 2026, grade: 2, studentKey: 'S-2' },
    { active: true, schoolYear: 2026, grade: 3, studentKey: 'S-3' },
    { active: true, schoolYear: 2026, grade: 1, studentKey: 'S-1' },
  ];
  app.readCentralGroupGradesCached_ = () => new Map([['A-GRP', [3]]]);
  try {
    const keys = app.centralGroupCandidateStudents_({
      schoolYear: 2026, grade: 2, assignmentType: '그룹', assignmentKey: 'A-GRP',
    }).map((student) => student.studentKey);
    assert(keys.includes('S-2') && keys.includes('S-3'), `2·3학년이 모두 후보여야 하는데 [${keys}]입니다.`);
    assert(!keys.includes('S-1'), `1학년까지 후보에 들어옵니다: [${keys}]`);
  } finally {
    app.readCentralStudentsCached_ = original.readCentralStudentsCached_;
    app.readCentralGroupGradesCached_ = original.readCentralGroupGradesCached_;
  }
});

test(54, '그룹명·추가 학년 저장이 5번째 칸에 · 로 이어 적는다', () => {
  const sheet = writableSheet(
    ['담당키', '그룹명', '생성일시', '수정일시', '추가학년'], [],
  );
  const original = {
    getRequiredCentralGroupSheet_: app.getRequiredCentralGroupSheet_,
    clearCentralGroupCache_: app.clearCentralGroupCache_,
  };
  app.getRequiredCentralGroupSheet_ = () => sheet;
  app.clearCentralGroupCache_ = () => {};
  try {
    app.upsertCentralGroupName_('A-GRP', '심화국어', [2, 3]);
    assert(sheet.grid[1][0] === 'A-GRP', '담당키가 저장되지 않습니다.');
    assert(sheet.grid[1][1] === '심화국어', '그룹명이 저장되지 않습니다.');
    assert(sheet.grid[1][4] === '2·3', `추가 학년이 '${sheet.grid[1][4]}'로 저장됩니다.`);
    assert(sheet.grid[0][4] === '추가학년', '5번째 칸 머리글이 없습니다.');
    // 다시 저장하면(수정) 같은 행을 덮어써야지 새 행을 만들면 안 된다.
    app.upsertCentralGroupName_('A-GRP', '심화국어 A', [3]);
    assert(sheet.grid.length === 2, '수정인데 새 행이 추가됩니다.');
    assert(sheet.grid[1][4] === '3', `수정 후 추가 학년이 '${sheet.grid[1][4]}'입니다.`);
  } finally {
    app.getRequiredCentralGroupSheet_ = original.getRequiredCentralGroupSheet_;
    app.clearCentralGroupCache_ = original.clearCentralGroupCache_;
  }
});

test(55, '추가 학년을 지정하지 않아도 그대로 동작한다(하위 호환)', () => {
  const sheet = writableSheet(
    ['담당키', '그룹명', '생성일시', '수정일시', '추가학년'], [],
  );
  const original = {
    getRequiredCentralGroupSheet_: app.getRequiredCentralGroupSheet_,
    clearCentralGroupCache_: app.clearCentralGroupCache_,
  };
  app.getRequiredCentralGroupSheet_ = () => sheet;
  app.clearCentralGroupCache_ = () => {};
  try {
    app.upsertCentralGroupName_('A-SUB-GRP', '단일학년그룹');
    assert(sheet.grid[1][4] === '', `추가 학년을 안 줬는데 '${sheet.grid[1][4]}'가 저장됩니다.`);
  } finally {
    app.getRequiredCentralGroupSheet_ = original.getRequiredCentralGroupSheet_;
    app.clearCentralGroupCache_ = original.clearCentralGroupCache_;
  }
});

test(56, '학생 조회 화면 라벨이 여러 학년을 함께 보여준다', () => {
  const original = app.centralGroupNameFor_;
  app.centralGroupNameFor_ = () => '심화국어';
  const gradesOriginal = app.centralAssignmentGrades_;
  app.centralAssignmentGrades_ = () => [2, 3];
  try {
    const label = app.toPublicCentralAssignment_({
      schoolYear: 2026, grade: 2, classNumber: 0, subject: '심화국어',
      assignmentType: '그룹', assignmentKey: 'A-GRP',
    }).label;
    assert(label.includes('2·3학년'), `라벨에 여러 학년이 안 보입니다: '${label}'`);
  } finally {
    app.centralGroupNameFor_ = original;
    app.centralAssignmentGrades_ = gradesOriginal;
  }
});

test(57, '추가 학년 칸이 없는 기존 학교의 수강그룹 시트도 계속 유효하다', () => {
  // 5번째 칸을 CENTRAL_GROUP_HEADERS 에 넣으면 검증 기준이 5칸이 되어, 배포된
  // 지 오래된 학교의 4칸짜리 수강그룹 시트가 전부 CENTRAL_SCHEMA_INVALID 로
  // 막힌다. 그런 실수를 하지 않았는지 여기서 직접 확인한다.
  const legacySheet = writableSheet(['담당키', '그룹명', '생성일시', '수정일시'], []);
  assert(
    app.centralHeadersMatch_(legacySheet, app.CENTRAL_GROUP_HEADERS),
    '추가 학년 칸이 없는 기존 수강그룹 시트가 더 이상 유효하지 않다고 판정합니다.',
  );
});

// --- 관리자 기본 진입 화면 ---------------------------------------------------

// getAppBootstrapState 는 설치 상태·계정 조회·관리자 대시보드까지 여러 실제
// 함수를 부른다. 여기서 확인하려는 건 모드 분기 하나뿐이라 나머지는 갈아 끼운다.
function withAdminBootstrapDeps(dashboard, run) {
  const original = {
    getSchoolInstallationState_: app.getSchoolInstallationState_,
    getRequiredActiveUserEmail_: app.getRequiredActiveUserEmail_,
    isAdminEmail_: app.isAdminEmail_,
    buildAdminDashboard_: app.buildAdminDashboard_,
    buildPersonalModeBootstrap_: app.buildPersonalModeBootstrap_,
  };
  app.getSchoolInstallationState_ = () => ({ ready: true, schoolName: '테스트고' });
  app.getRequiredActiveUserEmail_ = () => 'admin@school.hs.kr';
  app.isAdminEmail_ = () => true;
  app.buildAdminDashboard_ = dashboard;
  app.buildPersonalModeBootstrap_ = (role) => ({ mode: 'PERSONAL_USER', role });
  try {
    return run();
  } finally {
    Object.assign(app, original);
  }
}

test(58, '관리자가 모드를 지정하지 않으면 개인 이용자 화면으로 간다', () => {
  const result = withAdminBootstrapDeps(
    () => { throw new Error('관리자 포털이 기본으로 열리면 안 됩니다'); },
    () => app.getAppBootstrapState(''),
  );
  assert(result.mode === 'PERSONAL_USER', '모드 미지정 관리자 접속이 개인 이용자 화면으로 가지 않습니다.');
});

test(59, '관리자가 관리자 포털을 명시적으로 요청하면 그대로 연다', () => {
  const result = withAdminBootstrapDeps(
    () => ({ studentCount: 0 }),
    () => app.getAppBootstrapState('ADMIN_PORTAL'),
  );
  assert(result.mode === 'ADMIN_PORTAL', '명시적으로 요청한 관리자 포털이 열리지 않습니다.');
});

// --- 담당 신청 교사 이름 / 관리자 알림 켜고 끄기 ------------------------------

test(60, '담당 신청 이름이 비어 있으면 거부한다', () => {
  let rejected = false;
  try {
    app.normalizeAssignmentRequestTeacherName_('   ');
  } catch (error) {
    rejected = /이름/.test(error.message);
  }
  assert(rejected, '빈 이름을 그대로 통과시킵니다.');
});

test(61, '담당 신청 이름은 앞뒤 공백을 지우고 길이 제한을 둔다', () => {
  assert(
    app.normalizeAssignmentRequestTeacherName_('  홍길동  ') === '홍길동',
    '이름의 앞뒤 공백을 지우지 않습니다.',
  );
  let rejected = false;
  try {
    app.normalizeAssignmentRequestTeacherName_('가'.repeat(51));
  } catch (error) {
    rejected = true;
  }
  assert(rejected, '51자 이름을 그대로 통과시킵니다.');
});

test(62, '관리자용 신청 조회에 교사 이름이 함께 담긴다', () => {
  const request = {
    requestKey: 'REQ-1', schoolYear: 2026, grade: 2, classNumber: 3,
    subject: '물리학Ⅰ', assignmentType: '교과', groupName: '', status: 'PENDING',
    requestedAt: new Date('2026-03-01T00:00:00Z').toISOString(), processedAt: '',
    reason: '', teacherEmail: 'teacher@school.hs.kr', teacherName: '홍길동',
  };
  const publicView = app.toPublicAssignmentRequest_(request, true);
  assert(publicView.teacherName === '홍길동', '관리자 조회에 교사 이름이 없습니다.');
  const teacherView = app.toPublicAssignmentRequest_(request, false);
  assert(teacherView.teacherName === undefined, '본인 조회에는 이름을 노출할 필요가 없습니다.');
});

function notifyPolicyStore() {
  const store = new Map();
  return {
    store,
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => store.get(key) || '',
        setProperty: (key, value) => { store.set(key, value); },
        deleteProperty: (key) => { store.delete(key); },
      }),
    },
  };
}

test(63, '담당 신청 알림은 기본으로 켜져 있다(기존 배포 호환)', () => {
  const original = { PropertiesService: app.PropertiesService, requireAdmin_: app.requireAdmin_ };
  const { PropertiesService } = notifyPolicyStore();
  app.PropertiesService = PropertiesService;
  app.requireAdmin_ = () => {};
  try {
    assert(
      app.getAssignmentRequestNotifyPolicy().enabled === true,
      '속성이 없는 기존 배포에서 알림이 기본으로 꺼져 있습니다.',
    );
  } finally {
    Object.assign(app, original);
  }
});

test(64, '알림을 끄면 관리자에게 메일을 보내지 않고, 켜면 보낸다', () => {
  const original = {
    PropertiesService: app.PropertiesService,
    getCentralConfiguration_: app.getCentralConfiguration_,
    notifyTeacherByEmail_: app.notifyTeacherByEmail_,
  };
  const { store, PropertiesService } = notifyPolicyStore();
  app.PropertiesService = PropertiesService;
  app.getCentralConfiguration_ = () => ({ adminEmails: ['admin@school.hs.kr'] });
  let sent = 0;
  app.notifyTeacherByEmail_ = () => { sent += 1; };
  const created = [{
    schoolYear: 2026, grade: 2, classNumber: 3, subject: '물리학Ⅰ',
    assignmentType: '교과', groupName: '', teacherName: '홍길동',
  }];
  try {
    store.set('ASSIGNMENT_REQUEST_NOTIFY_ADMINS', 'false');
    app.notifyAdminsOfNewAssignmentRequest_('teacher@school.hs.kr', created);
    assert(sent === 0, '알림을 껐는데도 메일을 보냅니다.');

    store.set('ASSIGNMENT_REQUEST_NOTIFY_ADMINS', 'true');
    app.notifyAdminsOfNewAssignmentRequest_('teacher@school.hs.kr', created);
    assert(sent === 1, '알림을 켰는데도 메일을 보내지 않습니다.');
  } finally {
    Object.assign(app, original);
  }
});

test(65, '승인된 담당 화면 이름은 가장 최근 신청 이력에서 가져온다', () => {
  const original = { PropertiesService: app.PropertiesService };
  const requestsByKey = {
    ASSIGNMENT_REQUESTS_teacherA: JSON.stringify([
      {
        requestKey: 'R1', teacherEmail: 'a@school.hs.kr', teacherName: '김철수',
        schoolYear: 2026, grade: 1, classNumber: 1, subject: '문학',
        status: 'APPROVED', requestedAt: '2026-08-01T00:00:00.000Z',
      },
      {
        requestKey: 'R0', teacherEmail: 'a@school.hs.kr', teacherName: '옛이름',
        schoolYear: 2025, grade: 1, classNumber: 1, subject: '문학',
        status: 'APPROVED', requestedAt: '2025-08-01T00:00:00.000Z',
      },
    ]),
    ASSIGNMENT_REQUESTS_teacherB: JSON.stringify([
      {
        requestKey: 'R2', teacherEmail: 'b@school.hs.kr', teacherName: '',
        schoolYear: 2026, grade: 2, classNumber: 2, subject: '수학',
        status: 'APPROVED', requestedAt: '2026-08-01T00:00:00.000Z',
      },
    ]),
  };
  app.PropertiesService = {
    getScriptProperties: () => ({ getProperties: () => requestsByKey }),
  };
  try {
    const names = app.latestTeacherNamesByEmail_();
    assert(names.get('a@school.hs.kr') === '김철수', '가장 최근 신청의 이름을 쓰지 않습니다.');
    assert(!names.has('b@school.hs.kr'), '이름이 없던 신청에 빈 값을 채우면 안 됩니다.');
  } finally {
    Object.assign(app, original);
  }
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
if (tests.length !== 65) {
  console.error(`FAIL expected 65 tests, got ${tests.length}`);
  process.exitCode = 1;
}
