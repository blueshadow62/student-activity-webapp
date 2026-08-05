'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const gsFiles = fs.readdirSync(__dirname)
  .filter((name) => name.endsWith('.gs'))
  .sort();
const sources = Object.fromEntries(gsFiles.map((name) => [
  name,
  fs.readFileSync(path.join(__dirname, name), 'utf8'),
]));
const serverCode = gsFiles.map((name) => sources[name]).join('\n');
const html = fs.readFileSync(path.join(__dirname, 'Index.html'), 'utf8');
const manifestText = fs.readFileSync(path.join(__dirname, 'appsscript.json'), 'utf8');
const manifest = JSON.parse(manifestText);
const clientScripts = [...html.matchAll(
  /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi
)].map((match) => match[1]);
const clientCode = clientScripts.join('\n');
const tests = [];

function test(number, name, check) {
  tests.push({ number, name, check });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function has(text, pattern) {
  return typeof pattern === 'string' ? text.includes(pattern) : pattern.test(text);
}

function functionBody(source, name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  if (start < 0) return '';
  const brace = source.indexOf('{', start);
  let depth = 0;
  for (let index = brace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(brace + 1, index);
    }
  }
  return '';
}

function assertFunction(name, sourceName) {
  assert(
    functionBody(sources[sourceName], name),
    `${sourceName}에 ${name} 함수가 없습니다.`
  );
}

function assertAdminGuard(name, sourceName) {
  const body = functionBody(sources[sourceName], name);
  assert(body, `${name} 함수가 없습니다.`);
  assert(
    /^\s*requireAdmin_\(\);/.test(body),
    `${name} 함수 시작 부분에 requireAdmin_()가 없습니다.`
  );
}

function runNode(relativePath) {
  return childProcess.execFileSync(
    process.execPath,
    [path.join(root, relativePath)],
    { cwd: root, encoding: 'utf8' }
  );
}

function createRoleHarness(initialEmail) {
  let email = initialEmail;
  const scriptProperties = new Map([
    ['ADMIN_EMAILS', ' Admin@School.test ; second@school.test '],
  ]);
  const factory = new Function(
    'Session',
    'PropertiesService',
    'SpreadsheetApp',
    'DriveApp',
    'CacheService',
    'LockService',
    'Utilities',
    'APP_CONFIG',
    'isEnabled_',
    'getCurrentSchoolYear_',
    `${sources['CentralData.gs']}
     return {
       isAdminEmail_,
       getCurrentUserRole_,
       requireAdmin_,
       getCentralConfiguration_
     };`
  );
  const harness = factory(
    { getActiveUser: () => ({ getEmail: () => email }) },
    {
      getScriptProperties: () => ({
        getProperty: (key) => scriptProperties.get(key) || '',
        // 설정값을 한 항목씩이 아니라 한 번에 받아 오는 경로도 흉내 낸다.
        getProperties: () => Object.fromEntries(scriptProperties),
      }),
      getUserProperties: () => ({
        getProperty: () => '',
        setProperty: () => {},
      }),
    },
    {},
    {},
    {},
    {},
    { computeDigest: () => [], DigestAlgorithm: { SHA_256: 'SHA_256' } },
    {
      allowedGrades: [1, 2, 3],
      maxStudentNumber: 999,
      maxStudentNameLength: 50,
      maxSubjectLength: 50,
      studentStatuses: ['재학', '위탁', '전학', '자퇴'],
      recordableStudentStatuses: ['재학', '위탁'],
    },
    (value) => Boolean(value),
    () => 2026
  );
  return {
    ...harness,
    setEmail: (value) => { email = value; },
  };
}

const adminFunctions = [
  ['getAdminDashboard', 'AdminPortal.gs'],
  ['initializeCentralDataSchema', 'AdminPortal.gs'],
  ['getAdminStudents', 'AdminPortal.gs'],
  ['addCentralStudent', 'AdminPortal.gs'],
  ['updateCentralStudent', 'AdminPortal.gs'],
  ['deleteCentralStudent', 'AdminPortal.gs'],
  ['deactivateCentralStudentsByYear', 'AdminPortal.gs'],
  ['resetCentralStudentList', 'AdminPortal.gs'],
  ['previewCentralStudentCsv', 'AdminPortal.gs'],
  ['importCentralStudentCsv', 'AdminPortal.gs'],
  ['exportCentralStudentCsv', 'AdminPortal.gs'],
  ['getAdminTeacherAssignments', 'AdminPortal.gs'],
  ['saveTeacherAssignment', 'AdminPortal.gs'],
  ['setTeacherAssignmentActive', 'AdminPortal.gs'],
  ['getAdminPhotoStatus', 'AdminPortal.gs'],
  ['syncCentralStudentPhotos', 'AdminPortal.gs'],
];

test(1, '관리자 이메일 정확 일치', () => {
  const h = createRoleHarness('admin@school.test');
  assert(h.isAdminEmail_('admin@school.test'), '정확 일치 관리자를 인식하지 못했습니다.');
});
test(2, '관리자 이메일 대소문자 정규화', () => {
  const h = createRoleHarness('ADMIN@SCHOOL.TEST');
  assert(h.getCurrentUserRole_() === 'ADMIN', '대소문자 정규화가 적용되지 않았습니다.');
});
test(3, '부분 문자열 관리자 판정 금지', () => {
  const h = createRoleHarness('xadmin@school.test');
  assert(!h.isAdminEmail_('xadmin@school.test'), '부분 문자열을 관리자로 인식했습니다.');
});
test(4, '일반 사용자는 USER 판정', () => {
  assert(createRoleHarness('teacher@school.test').getCurrentUserRole_() === 'USER', 'USER 판정 실패');
});
test(5, '이메일 공백 시 차단', () => {
  const h = createRoleHarness('');
  let blocked = false;
  try { h.getCurrentUserRole_(); } catch (error) { blocked = /로그인/.test(error.message); }
  assert(blocked, '빈 이메일이 차단되지 않았습니다.');
});
test(6, '클라이언트 isAdmin=true 무시', () => {
  assert(!/isAdmin\s*[:=]/.test(functionBody(sources['Code.gs'], 'getAppBootstrapState')), '클라이언트 isAdmin을 사용합니다.');
});
test(7, '일반 사용자 관리자 함수 호출 차단', () => {
  const h = createRoleHarness('teacher@school.test');
  let blocked = false;
  try { h.requireAdmin_(); } catch (error) { blocked = /관리자/.test(error.message); }
  assert(blocked, '일반 사용자의 관리자 호출이 차단되지 않았습니다.');
});
test(8, '관리자 함수마다 requireAdmin_ 적용', () => adminFunctions.forEach(([name, file]) => assertAdminGuard(name, file)));
test(9, '관리자는 관리자 포털 기본 진입', () => {
  const body = functionBody(sources['Code.gs'], 'getAppBootstrapState');
  assert(has(body, "role === 'ADMIN'") && has(body, "mode: 'ADMIN_PORTAL'"), '관리자 기본 모드가 아닙니다.');
  assert(
    has(body, 'const userEmail = getRequiredActiveUserEmail_()')
      && has(body, "const role = isAdminEmail_(userEmail) ? 'ADMIN' : 'USER'")
      && has(body, 'userEmail: userEmail')
      && has(body, 'personal.userEmail = userEmail'),
    '기존 인증 이메일이 관리자·개인 화면에 재사용되지 않습니다.'
  );
  assert(
    has(html, 'id="userEmailLabel"')
      && has(functionBody(clientCode, 'renderBootstrap'), '접속 계정: ${userEmail}')
      && !has(serverCode, 'getCurrentUserEmailSafe_')
      && !has(html, 'AccountChooser'),
    '접속 계정 표시 또는 계정 전환 차단 계약이 올바르지 않습니다.'
  );
});
test(10, '일반 사용자는 개인 포털 기본 진입', () => {
  assert(has(functionBody(sources['Code.gs'], 'buildPersonalModeBootstrap_'), "mode: 'PERSONAL_USER'"), '개인 포털 반환이 없습니다.');
});
test(11, '관리자 개인 모드 전환·새로고침 유지·공통 진행 표시', () => {
  const loadBody = functionBody(clientCode, 'loadApp');
  assert(has(functionBody(sources['Code.gs'], 'getAppBootstrapState'), "requested !== 'PERSONAL_USER'"), '관리자 개인 모드가 없습니다.');
  assert(has(html, '개인 이용자 모드로 전환'), '전환 버튼이 없습니다.');
  assert(
    has(clientCode, "sessionStorage.getItem('student-activity:last-mode')")
      && has(loadBody, "state.role === 'ADMIN' && state.mode === 'PERSONAL_USER'")
      && has(loadBody, "sessionStorage.setItem('student-activity:last-mode', 'PERSONAL_USER')")
      && has(loadBody, "sessionStorage.removeItem('student-activity:last-mode')"),
    '관리자 개인 이용자 모드가 새로고침 후 유지되지 않습니다.'
  );
  assert(
    has(html, '처리 중입니다.')
      && has(html, 'class="loading-progress"')
      && has(html, 'class="loading-progress-bar"')
      && has(html, '@keyframes loading-progress')
      && !/자료를 (불러오|저장하)는 중입니다/.test(html),
    '공통 처리 문구 또는 가로형 무한 진행 막대가 없습니다.'
  );
});
test(12, '일반 사용자 관리자 모드 전환 차단', () => {
  assert(has(functionBody(sources['Code.gs'], 'getAppBootstrapState'), "requested === 'ADMIN_PORTAL' && role !== 'ADMIN'"), '서버 차단이 없습니다.');
});

test(13, '중앙 DB ID 클라이언트 미노출', () => assert(!has(html, 'CENTRAL_DATABASE_FILE_ID'), '중앙 DB ID 속성이 HTML에 있습니다.'));
test(14, '중앙 사진 폴더 ID 클라이언트 미노출', () => assert(!has(html, 'CENTRAL_PHOTO_FOLDER_ID'), '중앙 사진 폴더 ID 속성이 HTML에 있습니다.'));
test(15, '관리자 이메일 목록 클라이언트 미노출', () => assert(!has(html, 'ADMIN_EMAILS'), '관리자 목록이 HTML에 있습니다.'));
test(16, '일반 사용자 중앙 설정 수정 차단', () => {
  assert(!/function\s+setCentral(Configuration|Properties)/.test(serverCode), '일반 공개 중앙 설정 변경 함수가 있습니다.');
});
test(17, '중앙 DB 미설정 오류', () => assert(has(sources['CentralData.gs'], 'CENTRAL_DATABASE_NOT_CONFIGURED'), '오류 구분이 없습니다.'));
test(18, '중앙 DB 접근 불가 오류', () => assert(has(sources['CentralData.gs'], 'CENTRAL_DATABASE_ACCESS_DENIED'), '오류 구분이 없습니다.'));
test(19, '중앙 사진 폴더 접근 불가 오류', () => assert(has(sources['CentralData.gs'], 'CENTRAL_PHOTO_FOLDER_ACCESS_DENIED'), '오류 구분이 없습니다.'));

test(20, '현재 이메일 기반 담당 목록 조회', () => {
  const body = functionBody(
    sources['CentralData.gs'],
    'getMyAssignmentsFromCentralSheet_'
  );
  assert(
    has(body, 'getRequiredActiveUserEmail_()')
      && has(body, 'assignment.teacherEmail === email')
      && has(body, 'readCentralTeacherAssignmentsCached_(false'),
    '현재 이메일 필터 또는 담당 단기 캐시가 없습니다.'
  );
});
test(21, 'A의 담당 목록과 B의 담당 목록 분리', () => assert(has(functionBody(sources['CentralData.gs'], 'requireMyAssignment_'), 'candidate.teacherEmail === email'), '담당 소유자 검사가 없습니다.'));
test(22, '비활성 담당 제외', () => assert(has(functionBody(sources['CentralData.gs'], 'getMyAssignmentsFromCentralSheet_'), 'readCentralTeacherAssignmentsCached_(false'), '비활성 담당이 제외되지 않습니다.'));
test(23, '조작된 assignmentKey 차단', () => assert(has(sources['CentralData.gs'], 'ASSIGNMENT_FORBIDDEN'), '조작 키 차단 오류가 없습니다.'));
test(24, '다른 교사의 assignmentKey 차단', () => assert(has(functionBody(sources['CentralData.gs'], 'requireMyAssignment_'), 'candidate.teacherEmail === email'), '교사 소유 검사가 없습니다.'));
test(25, '담당 없음 안내', () => assert(has(html, '등록된 담당 수업이 없습니다'), '담당 없음 안내가 없습니다.'));
test(26, '담당 학년도 필터', () => assert(has(functionBody(sources['CentralData.gs'], 'centralStudentBelongsToAssignment_'), 'student.schoolYear'), '학년도 필터가 없습니다.'));
test(27, '담당 학년·반 필터', () => {
  const body = functionBody(sources['CentralData.gs'], 'centralStudentBelongsToAssignment_');
  assert(has(body, 'student.grade') && has(body, 'student.classNumber'), '학년·반 필터가 없습니다.');
});
test(28, '담당 과목 필터', () => assert(has(functionBody(sources['Code.gs'], 'validateCentralRecordPayload_'), 'assignment.subject'), '과목을 담당 항목에서 결정하지 않습니다.'));
test(29, '승인 담당 자동 사용·선택 상태 제거', () => {
  const server = sources['Code.gs'] + sources['CentralData.gs'];
  assert(!has(server, 'selectedAssignments'), '폐기된 선택 담당 응답이 남아 있습니다.');
  assert(!has(server, 'saveSelectedAssignments'), '폐기된 선택 담당 저장 함수가 남아 있습니다.');
  assert(!has(server, 'readValidatedSelectedAssignments_'), '폐기된 선택 담당 검증 함수가 남아 있습니다.');
});

test(30, '중앙 학생목록 조회', () => assertFunction('readCentralStudents_', 'CentralData.gs'));
test(31, '담당 학급 학생만 반환', () => assert(has(functionBody(sources['CentralData.gs'], 'getStudentsForMyAssignment'), 'centralStudentBelongsToAssignment_'), '담당 학생 필터가 없습니다.'));
test(32, '다른 학급 학생 미반환', () => assert(has(functionBody(sources['CentralData.gs'], 'requireCentralStudentAssignment_'), 'STUDENT_FORBIDDEN'), '비담당 학생 차단이 없습니다.'));
test(33, '전체 학생 조회 함수 없음', () => assert(!/function\s+get(All|Entire)Students\s*\(/.test(serverCode), '전체 학생 공개 함수가 있습니다.'));
test(34, '학생 고유키 사용', () => assert(has(sources['CentralData.gs'], 'studentKey'), '학생키가 없습니다.'));
test(35, '학생 이름만으로 참조하지 않음', () => assert(has(functionBody(sources['Code.gs'], 'saveRecord'), 'validateCentralRecordPayload_'), '기록이 중앙 학생키 검증을 거치지 않습니다.'));
test(36, '일반 사용자 학생 추가 차단', () => assertAdminGuard('addCentralStudent', 'AdminPortal.gs'));
test(37, '일반 사용자 학생 수정 차단', () => assertAdminGuard('updateCentralStudent', 'AdminPortal.gs'));
test(38, '일반 사용자 학생 삭제 차단', () => assertAdminGuard('deleteCentralStudent', 'AdminPortal.gs'));
test(39, '관리자 학생 CRUD 허용', () => ['getAdminStudents','addCentralStudent','updateCentralStudent','deleteCentralStudent'].forEach(name => assertFunction(name, 'AdminPortal.gs')));
test(40, '학생 원본은 중앙 DB에만 저장', () => {
  const bodies = ['addCentralStudent','updateCentralStudent','deleteCentralStudent'].map(name => functionBody(sources['AdminPortal.gs'], name)).join('\n');
  assert(has(bodies, 'getRequiredCentralStudentSheet_') && !has(bodies, 'getAppSpreadsheet_'), '학생 CRUD 저장소가 중앙 DB로 고정되지 않았습니다.');
});

test(41, '담당 학생 사진 조회', () => assert(has(functionBody(sources['CentralData.gs'], 'getStudentPhotosForMyAssignment'), 'requireMyAssignment_'), '사진 담당 검사가 없습니다.'));
test(42, '비담당 학생 사진 요청 차단', () => assert(has(functionBody(sources['CentralData.gs'], 'getStudentPhotosForMyAssignment'), 'STUDENT_FORBIDDEN'), '비담당 사진 차단이 없습니다.'));
test(43, '사진정보 등록 여부·단기 캐시', () => {
  const listBody = functionBody(sources['CentralData.gs'], 'getStudentsForMyAssignment');
  const photoBody = functionBody(sources['CentralData.gs'], 'getStudentPhotosForMyAssignment');
  assert(
    has(listBody, 'readCentralPhotoRowsCached_()')
      && has(photoBody, 'readCentralPhotoRowsCached_()')
      && has(photoBody, 'photoRows.get'),
    '사진정보 등록 검사 또는 단기 캐시가 없습니다.'
  );
});
test(44, '중앙 사진 폴더 소속 검사', () => assert(has(functionBody(sources['CentralData.gs'], 'readCentralStudentPhoto_'), 'centralFileBelongsToFolder_'), '폴더 소속 검사가 없습니다.'));
test(45, '휴지통 파일 차단', () => assert(has(functionBody(sources['CentralData.gs'], 'readCentralStudentPhoto_'), 'file.isTrashed()'), '휴지통 검사가 없습니다.'));
test(46, '이미지 MIME 검사', () => assert(has(functionBody(sources['CentralData.gs'], 'readCentralStudentPhoto_'), 'CENTRAL_ALLOWED_PHOTO_MIME_TYPES'), 'MIME 검사가 없습니다.'));
test(47, '사진 파일 ID 미노출', () => assert(!/photoFileId|fileId/.test(clientCode), '사진 파일 ID가 클라이언트 계약에 있습니다.'));
test(48, '사진 Drive URL 미노출', () => assert(!/driveUrl|webContentLink|alternateLink/.test(clientCode), 'Drive URL이 클라이언트에 있습니다.'));
test(49, '사진 폴더 ID 미노출', () => assert(!has(clientCode, 'photoFolderId'), '사진 폴더 ID가 클라이언트에 있습니다.'));
test(50, '일반 사용자 사진 변경 차단', () => {
  assert(
    !/function\s+uploadStudentPhoto\s*\(|function\s+deleteStudentPhoto\s*\(/.test(serverCode),
    '개인 사진 업로드·삭제 서버 경로가 남아 있습니다.',
  );
  assert(
    !has(clientCode, 'uploadStudentPhoto') && !has(clientCode, 'deleteStudentPhoto'),
    '클라이언트에 개인 사진 변경 호출이 남아 있습니다.',
  );
});
test(51, '관리자 사진 관리 허용', () => {
  assertAdminGuard('getAdminPhotoStatus', 'AdminPortal.gs');
  assertAdminGuard('syncCentralStudentPhotos', 'AdminPortal.gs');
});
test(52, '사진을 개인 Drive에 자동 복사하지 않음', () => {
  const centralRead = functionBody(sources['CentralData.gs'], 'getStudentPhotosForMyAssignment');
  assert(!/createFile|makeCopy|createFolder/.test(centralRead), '중앙 사진 조회 중 개인 복사가 있습니다.');
  assert(!has(clientCode, 'buildStudentPhotoClassBundle'), '클라이언트에 묶음 복사가 남아 있습니다.');
});

test(53, '활동 기록 개인 DB·최근 기록 제한 범위 일괄 조회', () => {
  const personalContext = functionBody(sources['Code.gs'], 'getPersonalRecordContext_');
  const saveRecord = functionBody(sources['Code.gs'], 'saveRecord');
  const saveActivity = functionBody(clientCode, 'saveActivityRecord');
  const recentRecords = functionBody(sources['Code.gs'], 'readRecentRecords_');
  const recentRows = functionBody(sources['Code.gs'], 'readRecentRecordRows_');
  assert(has(personalContext, 'getAppSpreadsheet_()'), '개인 DB 라우팅이 없습니다.');
  assert(
    has(personalContext, 'requirePersonalRecordSheetHandle_(')
      && has(personalContext, 'assertHeaders_(')
      && !/ensure(DatabaseSchema|SettingsSheet|RecordSheet|ArchivedRecordSheet|DeletedRecordSheet)_/.test(personalContext),
    '일반 기록 요청이 기존 전체 시트 마이그레이션을 반복합니다.'
  );
  assert(
    has(saveRecord, 'savedRecord:')
      && has(saveRecord, 'recordId')
      && !has(saveRecord, 'readRecentRecords_(')
      && has(saveActivity, 'result.savedRecord')
      && has(saveActivity, 'state.records.filter(')
      && has(saveActivity, '.slice(0, 5)'),
    '저장 직후 최근 기록 전체를 다시 검색합니다.'
  );
  assert(
    has(recentRecords, 'readRecentRecordRows_(')
      && !has(recentRecords, 'getDisplayValues()')
      && has(recentRows, 'maxBatchSpan')
      && has(recentRows, 'span <= maxBatchSpan')
      && has(recentRows, '.getValues()'),
    '최근 기록을 제한된 범위에서 일괄 조회하지 않습니다.'
  );

  let rangeReads = 0;
  const readRows = new Function(
    'RECORD_HEADERS',
    `return function (recordSheet, matches) {${recentRows}};`
  )(new Array(15));
  const rows = readRows({
    getRange(firstRow, column, rowCount) {
      rangeReads += 1;
      assert(firstRow === 10 && column === 1 && rowCount === 3, '일괄 조회 범위가 올바르지 않습니다.');
      return {
        getValues() {
          return [['10행'], ['11행'], ['12행']];
        },
      };
    },
  }, [
    { getRow() { return 10; } },
    { getRow() { return 12; } },
  ]);
  assert(
    rangeReads === 1 && rows[0][0] === '10행' && rows[1][0] === '12행',
    '가까운 최근 기록이 한 번의 범위 읽기로 반환되지 않습니다.'
  );
});
test(54, '개인·중앙 부트스트랩 컨텍스트 재사용', () => {
  const body = functionBody(sources['Code.gs'], 'buildPersonalModeBootstrap_');
  const centralStatusBody = functionBody(
    sources['Code.gs'],
    'getPersonalCentralStatus'
  );
  const centralBody = functionBody(
    sources['CentralData.gs'],
    'getCentralConnectionContext_'
  );
  assert(
    has(body, 'preparePersonalStorageContext_()')
      && has(body, 'preparedStorage.context.database.spreadsheet')
      && !has(body, 'getCentralConnectionContext_')
      && has(centralStatusBody, 'getCentralConnectionContext_(false)')
      && has(centralStatusBody, 'centralContext.schema.assignmentSheet')
      && has(centralStatusBody, 'getMyAssignmentsFromCentralSheet_(')
      && has(centralBody, 'getCentralDatabase_(config)')
      && has(centralBody, 'inspectCentralSchema_(spreadsheet)')
      && has(centralBody, 'getCentralPhotoFolder_(config)')
      && !has(body, 'getAppSpreadsheet_()')
      && !has(body, 'getCentralDatabase_'),
    '개인 모드가 준비된 중앙·개인 리소스 컨텍스트를 재사용하지 않습니다.'
  );
});
test(55, '중앙 DB에 활동 기록 미저장', () => assert(!has(functionBody(sources['Code.gs'], 'saveRecord'), 'getCentralDatabase_'), '기록 저장이 중앙 DB를 엽니다.'));
test(56, '기록 저장 전 담당 학생 재검사', () => {
  const body = functionBody(sources['Code.gs'], 'validateCentralRecordPayload_');
  assert(has(body, 'requireMyAssignment_') && has(body, 'requireCentralStudentAssignment_'), '담당·학생 재검사가 없습니다.');
  assert(
    has(body, 'competencies.length === 0')
      && has(body, 'memo.length > APP_CONFIG.maxMemoLength')
      && !/if\s*\(\s*!memo/.test(body)
      && has(html, '내용 메모 (선택)'),
    '역량을 선택한 메모 없는 기록을 허용하지 않습니다.'
  );
});
test(57, '다른 교사 DB 접근 차단', () => assert(!/openById\s*\(\s*(payload|fileId|databaseId)/.test(sources['Code.gs']), '클라이언트 지정 개인 DB 접근이 있습니다.'));
test(58, 'studentKey 저장', () => assert(has(functionBody(sources['Code.gs'], 'saveRecord'), 'normalized.student.studentId'), '학생키 저장이 없습니다.'));
test(59, '이름·번호 스냅샷 저장', () => {
  const body = functionBody(sources['Code.gs'], 'saveRecord');
  assert(has(body, 'normalized.student.studentNumber') && has(body, 'normalized.student.name'), '스냅샷 저장이 없습니다.');
});
test(60, '중앙 학생 삭제 후 스냅샷 표시 가능', () => assert(has(functionBody(sources['Code.gs'], 'readCentralFilteredPersonalRecords_'), ': {') && has(functionBody(sources['Code.gs'], 'readCentralFilteredPersonalRecords_'), 'display[5]'), '스냅샷 대체 표시가 없습니다.'));
test(61, '기록 검색·필터 개인 격리', () => assert(has(functionBody(sources['Code.gs'], 'searchRecords'), 'getPersonalRecordContext_'), '개인 기록 검색 라우팅이 없습니다.'));
// 보관 시트로 옮기던 archivePreviousSchoolYearRecords 는 개인 DB가 학년도별 파일로
// 갈리면서 옮길 대상이 없어져 제거했다. 지켜야 할 성질(보관 기록도 개인 DB에만
// 있다)은 그대로라, 개인 기록 맥락이 보관 시트를 개인 파일에서 얻는지로 확인한다.
test(62, '보관 기록 개인 격리', () => assert(has(functionBody(sources['Code.gs'], 'getPersonalRecordContext_'), 'getAppSpreadsheet_') && has(functionBody(sources['Code.gs'], 'getPersonalRecordContext_'), 'archivedRecordSheetName'), '보관 기록이 개인 DB를 사용하지 않습니다.'));

test(63, '일반 사용자 학생 CSV 가져오기 제거', () => assert(!has(clientCode, 'previewStudentRosterCsv') && !has(clientCode, 'initializeSchoolDatabase'), '개인 CSV 흐름이 남아 있습니다.'));
test(64, '관리자 중앙 CSV 가져오기 유지', () => {
  assertAdminGuard('previewCentralStudentCsv', 'AdminPortal.gs');
  assertAdminGuard('importCentralStudentCsv', 'AdminPortal.gs');
});
test(65, '일반 사용자 전체 학생 CSV 내보내기 차단', () => assertAdminGuard('exportCentralStudentCsv', 'AdminPortal.gs'));
test(66, '관리자 비밀번호 역할 인증 제거', () => {
  const rolePath = functionBody(sources['Code.gs'], 'getAppBootstrapState')
    + functionBody(sources['CentralData.gs'], 'requireAdmin_');
  assert(!/password|비밀번호/i.test(rolePath), '역할 인증에 비밀번호가 사용됩니다.');
});
test(67, '사진 묶음 업로드 요구 제거', () => assert(!/type=["']file["'][^>]*accept=["'][^"']*(image|zip)/i.test(html), '개인 사진 업로드가 남아 있습니다.'));
test(68, '승인 수업 자동 사용·개인 탭 분리', () => {
  const events = functionBody(clientCode, 'bindEvents');
  const render = functionBody(clientCode, 'renderPersonalBootstrap');
  const activity = functionBody(clientCode, 'showActivityArea');
  const picker = functionBody(clientCode, 'renderAssignmentPicker_');
  const selectSubject = functionBody(clientCode, 'selectAssignmentSubject_');
  const selectGrade = functionBody(clientCode, 'selectAssignmentGrade_');
  const selectClass = functionBody(clientCode, 'selectAssignmentClass_');
  const loadStudents = functionBody(clientCode, 'loadStudents');
  assert(
    has(html, 'data-personal-tab="activity"')
      && has(html, 'data-personal-tab="request"'),
    '개인 이용자 탭이 분리되지 않았습니다.'
  );
  // 개인 저장소가 준비되지 않으면 기록 탭을 열 수 없으므로 조건이 함께 붙는다.
  // 저장소가 안 갖춰졌으면 그 탭을 최우선으로 연다.
  assert(
    /showPersonalTab\(!storageReady[^;]*'storage'[^;]*assignments\.length[^;]*\?\s*'activity'\s*:\s*'request'/.test(render),
    '승인 수업·저장소 상태에 따른 기본 탭 전환이 없습니다.'
  );
  assert(
    has(activity, 'state.bootstrap.assignments || []'),
    '승인된 담당 수업을 기록 화면에서 자동 사용하지 않습니다.'
  );
  assert(
    !has(html, '담당 수업 선택') && !has(clientCode, 'saveUserSettings'),
    '별도 담당 수업 선택·저장 단계가 남아 있습니다.'
  );
  assert(
    has(events, "$('refreshMyAssignmentRequestsButton').addEventListener('click', () => loadApp(state.mode))"),
    '신청 새로고침이 승인된 담당 수업을 다시 읽지 않습니다.'
  );
  assert(
    has(html, 'id="subjectButtons"')
      && has(html, 'id="gradeButtons"')
      && has(html, 'id="classButtons"')
      && !has(html, 'id="activityAssignment"')
      && has(picker, 'gradeOptions.length === 1')
      && has(picker, 'state.selectedGradeKey = gradeOptions[0].key')
      && has(functionBody(clientCode, 'assignmentGradeKey_'), 'assignment.schoolYear'),
    '과목·학년·반 버튼 선택 또는 단일 학년 자동 선택이 없습니다.'
  );
  assert(
    has(picker, 'assignmentGradeKey_(item) === state.selectedGradeKey')
      && has(selectSubject, "state.selectedAssignmentKey = ''")
      && has(selectGrade, "state.selectedAssignmentKey = ''")
      && has(selectClass, 'loadStudents()'),
    '선택한 과목·학년에 따른 반 필터 또는 선택 초기화가 없습니다.'
  );
  assert(
    loadStudents.indexOf('if (!assignmentKey)') < loadStudents.indexOf("callServer('searchStudents'")
      && has(loadStudents, 'renderStudentListLoading_()')
      && has(loadStudents, 'generation !== state.photoGeneration')
      && has(loadStudents, 'renderStudentListMessage_(safeErrorMessage(error), true)'),
    '반 선택 전 조회 차단, 목록 로딩·오류 또는 오래된 응답 차단이 없습니다.'
  );
});

test(69, '브라우저에 중앙 DB ID 없음', () => assert(!/CENTRAL_DATABASE|centralDatabaseId/i.test(clientCode), '중앙 DB ID가 있습니다.'));
test(70, '브라우저에 중앙 사진 폴더 ID 없음', () => assert(!/CENTRAL_PHOTO_FOLDER|centralPhotoFolderId/i.test(clientCode), '중앙 사진 폴더 ID가 있습니다.'));
test(71, '브라우저에 사진 파일 ID 없음', () => assert(!/photoFileId|fileId/i.test(clientCode), '사진 파일 ID가 있습니다.'));
test(72, '브라우저에 전체 학생목록 영속 저장 없음', () => assert(!/localStorage|indexedDB/.test(clientCode), '영속 학생 저장소를 사용합니다.'));
test(73, '계정 전환 시 이전 화면 데이터 제거', () => {
  const body = functionBody(clientCode, 'resetClientData');
  assert(
    has(body, 'state.students = []') && has(body, 'resetStudentPhotoLoading_(true)'),
    '화면 데이터 초기화가 부족합니다.'
  );
});
test(74, '전체 이메일 로그 없음', () => assert(!/(Logger\.log|console\.log)\s*\([^)]*email/i.test(serverCode + clientCode), '이메일 로그가 있습니다.'));
test(75, '전체 Drive ID 로그 없음', () => assert(!/(Logger\.log|console\.log)\s*\([^)]*(fileId|folderId|databaseId)/i.test(serverCode + clientCode), 'Drive ID 로그가 있습니다.'));
test(76, 'OAuth·PKCE 코드 없음', () => assert(!/PKCE|usercallback|oauth[_ -]?client|client_secret|code_verifier/i.test(serverCode + clientCode), '별도 OAuth 코드가 있습니다.'));
test(77, '이메일 인증번호 코드 없음', () => assert(!/verificationCode|emailCode|인증번호/.test(serverCode + clientCode), '이메일 인증번호 코드가 있습니다.'));
test(78, '중앙 자료 공유 코드는 지정된 승인·해지 함수에만 존재', () => {
  assert(
    !/addEditor|setSharing|setShareableByEditors|ANYONE_WITH_LINK/.test(serverCode),
    '편집 권한 부여나 링크 전체 공개 코드가 있습니다.',
  );
  const grantBody = functionBody(sources['CentralData.gs'], 'grantCentralAccessToTeachers_');
  const quietBody = functionBody(sources['CentralData.gs'], 'addCentralViewerQuietly_');
  const revokeBody = functionBody(sources['CentralData.gs'], 'revokeCentralAccessFromTeacher_');
  assert(
    grantBody.includes('addCentralViewerQuietly_(')
      && quietBody.includes('.addViewer(')
      && revokeBody.includes('.removeViewer('),
    '승인·해지 전용 함수에 개별 보기 권한 부여·제거 코드가 없습니다.',
  );
  assert(
    /role:\s*'reader'/.test(quietBody) && !/'writer'|'owner'|'fileOrganizer'/.test(quietBody),
    '개별 권한 부여가 보기 전용(reader)이 아닙니다.',
  );
  const outsideGrantRevoke = serverCode
    .replace(grantBody, '')
    .replace(quietBody, '')
    .replace(revokeBody, '');
  assert(
    !/addViewer|removeViewer|Drive\.Permissions/.test(outsideGrantRevoke),
    '지정된 승인·해지 함수 밖에서 Drive 보기 권한을 변경합니다.',
  );
});

// 검사 79·80(체크포인트 0·1 시제품)과 82(v8.3 비변경)는 개발 저장소에만 있던
// outputs/user-owned-drive-probe/ 와 v8.3 폴더를 검사하던 것이라 뺐다. 이 저장소는
// 배포하는 v8.4 파일만 담으므로 검사할 대상 자체가 없다.
test(81, '체크포인트 2 검증기 통과 또는 정책 갱신', () => assert(/policy-updated regression checks OK/.test(runNode('verify-v8.4.js')), '체크포인트 2 정책 갱신 실패'));
test(83, '.gs 구문·중복 함수 통과', () => {
  new Function(serverCode);
  const names = [...serverCode.matchAll(/^function\s+([A-Za-z0-9_]+)\s*\(/gm)]
    .map((match) => match[1]);
  const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
  assert(duplicates.length === 0, `중복 서버 함수: ${[...new Set(duplicates)].join(', ')}`);
});
test(84, 'HTML JavaScript 구문 통과', () => clientScripts.forEach((script) => new Function(script)));
test(85, 'appsscript.json 통과', () => {
  assert(manifest.runtimeVersion === 'V8', 'V8 manifest가 아닙니다.');
  assert(manifest.webapp.executeAs === 'USER_ACCESSING', 'USER_ACCESSING이 아닙니다.');
});
test(86, '공개 함수·클라이언트 호출 계약 일치', () => {
  const calls = [...clientCode.matchAll(/runner\.([A-Za-z0-9_]+)\s*\(/g)].map(match => match[1]);
  calls.forEach((name) => assert(new RegExp(`function\\s+${name}\\s*\\(`).test(serverCode), `서버 함수 없음: ${name}`));
});
test(87, '미정의 브라우저 함수 없음', () => {
  assert(clientScripts.length === 1, '예상하지 못한 스크립트 블록 수입니다.');
  new Function(clientCode);
  const ids = new Set([...html.matchAll(/\bid=["']([^"']+)["']/g)]
    .map((match) => match[1]));
  const referencedIds = [...clientCode.matchAll(/\$\(["']([^"']+)["']\)/g)]
    .map((match) => match[1]);
  referencedIds.forEach((id) => assert(ids.has(id), `HTML 요소 없음: ${id}`));
  const declaredFunctions = new Set(
    [...clientCode.matchAll(/function\s+([A-Za-z0-9_]+)\s*\(/g)]
      .map((match) => match[1])
  );
  const directHandlers = [...clientCode.matchAll(
    /addEventListener\([^,]+,\s*([A-Za-z0-9_]+)\s*\)/g
  )].map((match) => match[1]);
  directHandlers.forEach((name) => {
    assert(declaredFunctions.has(name), `이벤트 핸들러 함수 없음: ${name}`);
  });
});
test(88, 'git diff --check 통과', () => {
  childProcess.execFileSync('git', ['diff', '--check'], { cwd: root, encoding: 'utf8' });
});
test(89, '학생 명단 응답에 전체 사진 data URL 없음', () => {
  const body = functionBody(sources['CentralData.gs'], 'getStudentsForMyAssignment');
  assert(has(body, 'photoAvailable') && !has(body, 'dataUrl'), '학생 명단이 사진 존재 여부만 반환하지 않습니다.');
});
test(90, '사진 기본 꺼짐·가시 카드 지연 요청', () => {
  const loadBody = functionBody(clientCode, 'loadStudents');
  const pumpBody = functionBody(clientCode, 'pumpStudentPhotoQueue_');
  const resetBody = functionBody(clientCode, 'resetStudentPhotoLoading_');
  const queueBody = functionBody(clientCode, 'enqueueStudentPhoto_');
  const renderBody = functionBody(clientCode, 'renderStudents');
  const toggleBody = functionBody(clientCode, 'toggleStudentPhotos');
  const selectClassBody = functionBody(clientCode, 'selectAssignmentClass_');
  assert(!has(loadBody, 'getStudentPhotosForMyAssignment'), '학급 전체 사진 일괄 호출이 남아 있습니다.');
  assert(
    has(clientCode, 'IntersectionObserver')
      && has(pumpBody, 'getStudentPhotosForMyAssignment')
      && has(pumpBody, 'batch.length < 6')
      && has(pumpBody, 'state.activePhotoLoads < 2'),
    '가시 카드 최대 6명 배치 지연 로딩이 없습니다.'
  );
  assert(
    has(html, 'id="toggleStudentPhotosButton"')
      && has(html, 'aria-pressed="false"')
      && has(clientCode, 'photosEnabled:false')
      && has(queueBody, '!state.photosEnabled'),
    '사진이 기본 꺼짐 상태이거나 꺼진 상태의 요청 차단이 없습니다.'
  );
  assert(
    has(loadBody, 'resetStudentPhotoLoading_()')
      && has(resetBody, 'if (clearCache)')
      && has(toggleBody, 'resetStudentPhotoLoading_()')
      && !has(toggleBody, 'resetStudentPhotoLoading_(true)')
      && has(functionBody(clientCode, 'resetClientData'), 'resetStudentPhotoLoading_(true)'),
    '같은 접속 중 사진 재사용 또는 계정 전환 시 초기화가 올바르지 않습니다.'
  );
  assert(
    has(selectClassBody, 'assignment.assignmentKey !== state.selectedAssignmentKey')
      && has(selectClassBody, 'state.photosEnabled = false')
      && has(selectClassBody, "'사진 켜기'")
      && has(selectClassBody, "setAttribute('aria-pressed', 'false')"),
    '다른 반을 선택할 때 사진 표시가 기본 꺼짐 상태로 초기화되지 않습니다.'
  );
  assert(
    has(renderBody, "classList.toggle('photos-on'")
      && has(renderBody, "classList.toggle('photos-off'")
      && has(html, '.students.photos-on')
      && has(html, '.students.photos-off'),
    '사진 표시 상태에 따른 학생 카드 레이아웃 전환이 없습니다.'
  );
  assert(
    html.indexOf('id="studentQuery"') < html.indexOf('id="subjectButtons"')
      && has(html, 'activity-filter-row')
      && /id="loadStudentsButton"[^>]*>조회<\/button>/.test(html)
      && !has(html, '>학생 조회</button>'),
    '학생 검색과 수업 버튼이 구분되지 않았거나 조회 버튼 문구가 올바르지 않습니다.'
  );
});
test(91, '사진 요청은 허용된 studentKey만 가능', () => {
  const body = functionBody(sources['CentralData.gs'], 'getStudentPhotosForMyAssignment');
  assert(has(body, 'normalizeCentralStudentKeyList_') && has(body, 'STUDENT_FORBIDDEN'), '배치 사진 요청 검증이 없습니다.');
});
test(92, '사진 응답 식별자·Drive URL 미노출 유지', () => {
  const body = functionBody(sources['CentralData.gs'], 'getStudentPhotosForMyAssignment');
  assert(!/fileId|folderId|driveUrl|https?:\/\//i.test(body), '개별 사진 응답에 내부 식별자가 있습니다.');
});
test(93, '사진 없음 상태 정상 처리', () => {
  const body = functionBody(sources['CentralData.gs'], 'getStudentPhotosForMyAssignment');
  const pumpBody = functionBody(clientCode, 'pumpStudentPhotoQueue_');
  assert(
    has(body, 'missingStudentKeys')
      && has(clientCode, 'missingPhotos')
      && has(clientCode, 'photo-spinner')
      && has(clientCode, '로딩 중')
      && has(clientCode, '사진 없음')
      && has(clientCode, '불러오기 실패')
      && has(pumpBody, "updateStudentPhotoStatus_(studentKey, 'missing')")
      && has(pumpBody, "updateStudentPhotoStatus_(studentKey, 'error')"),
    '학생별 사진 로딩·없음·오류 상태 처리가 없습니다.'
  );
});
test(94, '동일 사진 반복 요청 캐시·응답 상한', () => {
  const body = functionBody(sources['CentralData.gs'], 'readCentralStudentPhoto_');
  assert(has(body, 'cache.get(cacheKey)') && has(body, 'cache.put('), '사진 서버 캐시가 없습니다.');
  const fastCacheIndex = body.indexOf('cache.get(fastCacheKey)');
  const driveFileIndex = body.indexOf('DriveApp.getFileById');
  assert(
    fastCacheIndex >= 0
      && driveFileIndex >= 0
      && fastCacheIndex < driveFileIndex,
    '검증된 반복 사진 캐시가 Drive 파일 조회보다 먼저 확인되지 않습니다.'
  );
  assert(
    has(body, 'putCentralPhotoFastCache_(')
      && has(functionBody(sources['CentralData.gs'], 'putCentralPhotoFastCache_'), 'CENTRAL_CONFIG.cacheSeconds'),
    '사진의 단기 검증 표식이 없거나 수명이 제한되지 않았습니다.'
  );
  assert(
    body.indexOf('putCentralPhotoFastCache_(')
      > body.indexOf('centralFileBelongsToFolder_('),
    'Drive 폴더 소속을 검증하기 전에 사진 빠른 캐시를 신뢰합니다.'
  );
  assert(
    !has(functionBody(sources['CentralData.gs'], 'centralPhotoCacheKey_'), 'getCentralDatabase_'),
    '사진 캐시 키를 만들 때 중앙 DB를 다시 엽니다.'
  );
  const batchBody = functionBody(sources['CentralData.gs'], 'getStudentPhotosForMyAssignment');
  assert(has(batchBody, 'maxPhotoResponseChars') && has(sources['CentralData.gs'], 'maxPhotoBatchSize: 6'), '사진 배치 응답 상한이 없습니다.');
  assert(
    has(functionBody(sources['CentralData.gs'], 'readCentralTeacherAssignmentsCached_'), 'CacheService.getScriptCache()')
      && has(functionBody(sources['CentralData.gs'], 'readCentralPhotoRowsCached_'), 'CacheService.getScriptCache()'),
    '담당 또는 사진정보 서버 캐시가 없습니다.'
  );
  const writes = sources['AdminPortal.gs'] + sources['AssignmentRequests.gs'];
  assert(
    has(writes, 'clearCentralTeacherAssignmentCache_(')
      && has(functionBody(sources['AdminPortal.gs'], 'syncCentralStudentPhotos'), 'clearCentralPhotoRowsCache_('),
    '담당 또는 사진정보 변경 후 캐시 무효화가 없습니다.'
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
if (tests.length !== 91) {
  console.error(`FAIL expected 91 tests, got ${tests.length}`);
  process.exitCode = 1;
}
