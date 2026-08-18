'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const read = (name) => fs.readFileSync(path.join(__dirname, name), 'utf8');
const central = read('CentralData.gs');
const admin = read('AdminPortal.gs');
const requests = read('AssignmentRequests.gs');
const code = read('Code.gs');
const html = read('Index.html');
const tests = [];

function test(number, name, check) {
  tests.push({ number, name, check });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
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

function has(text, pattern) {
  return typeof pattern === 'string' ? text.includes(pattern) : pattern.test(text);
}

test(1, '체크포인트 2.5 회귀 91/91', () => {
  const output = childProcess.execFileSync(
    process.execPath,
    [path.join(__dirname, 'verify-v8.4-cp2.5.js')],
    { cwd: root, encoding: 'utf8' },
  );
  assert(output.includes('RESULT 91/91'), '체크포인트 2.5 회귀가 통과하지 않았습니다.');
});
// 개발 중 체크포인트 표시(8.4.0-cp2.6 등)는 1.0.0 공개 릴리스에서 뗐다. 업데이트
// 알림이 이 값을 릴리스 태그와 자리마다 숫자로 견주므로 순수 semver 여야 한다.
test(2, '앱 버전이 semver 형식', () => {
  assert(/version: '\d+\.\d+\.\d+'/.test(code), '앱 버전이 semver 형식이 아닙니다.');
});
test(3, '중앙 스키마 버전 5', () => {
  assert(central.includes("schemaVersion: '5'"), '중앙 스키마 버전이 5가 아닙니다.');
});
test(4, '담당신청 시트 정의·초기화', () => {
  assert(central.includes("assignmentRequestSheetName: '담당신청'"), '담당신청 시트명이 없습니다.');
  assert(admin.includes('CENTRAL_ASSIGNMENT_REQUEST_HEADERS'), '담당신청 시트 초기화가 없습니다.');
});
test(5, '관리자 일괄 등록 권한 검사', () => {
  assert(/^\s*requireAdmin_\(\);/.test(functionBody(admin, 'saveTeacherAssignmentsBatch')), '일괄 등록 관리자 검사가 없습니다.');
});
test(6, '여러 반 정규화·중복 제거·상한', () => {
  const body = functionBody(central, 'normalizeCentralClassNumberList_');
  assert(body.includes('new Set') && body.includes('maxClassNumbersPerBatch'), '여러 반 정규화가 불완전합니다.');
});
test(7, '일괄 등록 단일 잠금·일괄 쓰기', () => {
  const body = functionBody(admin, 'saveTeacherAssignmentsBatch');
  assert(body.includes('withCentralWriteLock_') && body.includes('.setValues('), '일괄 등록 원자성이 없습니다.');
});
test(8, '일괄 등록 중복 전체 차단', () => {
  const body = functionBody(admin, 'saveTeacherAssignmentsBatch');
  assert(body.includes('duplicates.length') && body.includes('이미 등록된 담당 반'), '일괄 중복 차단이 없습니다.');
});
test(9, '교사 신청 이메일은 서버에서만 결정', () => {
  const body = functionBody(requests, 'submitMyAssignmentRequest');
  assert(body.includes('getRequiredActiveUserEmail_()'), '현재 사용자 이메일 확인이 없습니다.');
  assert(!body.includes('value.teacherEmail'), '클라이언트 이메일을 신뢰합니다.');
});
test(10, '교사 신청은 중앙 시트에 직접 쓰지 않음', () => {
  const body = functionBody(requests, 'submitMyAssignmentRequest');
  assert(body.includes('writeStoredAssignmentRequestsForUser_'), 'Script Properties 저장이 없습니다.');
  assert(!body.includes('getRequiredCentralAssignmentRequestSheet_'), '교사가 중앙 신청 시트에 직접 씁니다.');
});
test(11, '교사별 신청 키 비식별 해시', () => {
  const body = functionBody(requests, 'assignmentRequestPropertyKey_');
  assert(body.includes('centralHash_') && !body.includes('+ teacherEmail'), '교사별 저장 키가 해시되지 않았습니다.');
});
test(12, '신청은 승인 대기로 생성', () => {
  const body = functionBody(requests, 'submitMyAssignmentRequest');
  assert(body.includes('CENTRAL_ASSIGNMENT_REQUEST_STATUS.pending'), '승인 대기 상태 생성이 없습니다.');
  assert(!body.includes('buildTeacherAssignmentRow_'), '신청 즉시 담당 권한을 부여합니다.');
});
test(13, '승인 전 기존 담당 조회 경로 불변', () => {
  const assignmentBody = functionBody(
    central,
    'getMyAssignmentsFromCentralSheet_'
  );
  assert(assignmentBody.includes('readCentralTeacherAssignmentsCached_'), '승인된 중앙 담당 조회가 없습니다.');
  assert(!assignmentBody.includes('AssignmentRequest'), '대기 신청을 담당 권한으로 사용합니다.');
});
test(14, '관리자 신청 목록 권한 검사', () => {
  assert(/^\s*requireAdmin_\(\);/.test(functionBody(requests, 'getAdminAssignmentRequests')), '신청 목록 관리자 검사가 없습니다.');
});
test(15, '승인·거부 관리자 권한 검사', () => {
  const publicBody = functionBody(requests, 'reviewAssignmentRequest');
  const sharedBody = functionBody(requests, 'reviewAssignmentRequests_');
  assert(publicBody.includes('reviewAssignmentRequests_') && /^\s*requireAdmin_\(\);/.test(sharedBody), '신청 처리 관리자 검사가 없습니다.');
});
test(16, '승인 시 담당 수업 생성', () => {
  const body = functionBody(requests, 'reviewAssignmentRequests_');
  assert(body.includes('buildTeacherAssignmentRow_') && body.includes('assignmentSheet.getRange'), '승인 시 담당 생성이 없습니다.');
});
test(17, '거부 사유 필수', () => {
  const body = functionBody(requests, 'normalizeAssignmentRequestReason_');
  assert(body.includes('required && !reason'), '거부 사유 필수 검사가 없습니다.');
});
test(18, '처리 이력 중앙 감사 시트 기록', () => {
  const body = functionBody(requests, 'reviewAssignmentRequests_');
  assert(body.includes('buildCentralAssignmentRequestRow_') && body.includes('auditSheet.getRange'), '승인·거부 감사 기록이 없습니다.');
});
test(19, '관리자 입력 순서 학년·과목·반', () => {
  const body = functionBody(html, 'editAssignment');
  const subjectPrompt = body.indexOf('담당 과목을 검색하거나 직접 입력하세요.');
  assert(body.indexOf("showPrompt('담당 학년'") < subjectPrompt, '학년보다 과목이 먼저입니다.');
  assert(subjectPrompt < body.indexOf('담당 반(여러 반은 쉼표로 구분)'), '과목보다 반이 먼저입니다.');
});
test(20, '관리자 여러 반 일괄 호출', () => {
  const body = functionBody(html, 'editAssignment');
  assert(body.includes('saveTeacherAssignmentsBatch') && body.includes('classNumbers'), '관리자 여러 반 일괄 호출이 없습니다.');
});
test(21, '교사 자기 신청 화면·여러 반 입력', () => {
  assert(html.includes('id="assignmentRequestCard"') && html.includes('id="requestClasses"'), '교사 신청 화면이 없습니다.');
  assert(!/<input[^>]+id="requestTeacherEmail"/i.test(html), '교사 신청 화면에 이메일 입력란이 있습니다.');
});
test(22, '관리자 승인·거부 화면', () => {
  assert(html.includes('data-approve-request') && html.includes('data-reject-request'), '관리자 승인·거부 버튼이 없습니다.');
});
test(23, '클라이언트·서버 함수 계약', () => {
  ['saveTeacherAssignmentsBatch', 'getAdminAssignmentRequests', 'reviewAssignmentRequest', 'approveAssignmentRequestsBatch', 'submitMyAssignmentRequest', 'getMyAssignmentRequests'].forEach((name) => {
    assert(functionBody(`${admin}\n${requests}`, name), `서버 함수 없음: ${name}`);
    assert(html.includes(`${name}:()`), `클라이언트 호출 없음: ${name}`);
  });
});
test(24, '담당신청 시트가 중앙 스키마에 포함', () => {
  const body = functionBody(central, 'inspectCentralSchema_');
  assert(body.includes('assignmentRequestReady') && body.includes('assignmentRequestSheet'), '담당신청 스키마 검사가 없습니다.');
});
test(25, 'git diff --check 통과', () => {
  childProcess.execFileSync('git', ['diff', '--check'], { cwd: root, encoding: 'utf8' });
});
test(26, '잘못된 반 토큰 전체 차단', () => {
  const body = functionBody(central, 'normalizeCentralClassNumberList_');
  assert(
    body.includes('parsed.some')
      && body.includes('!Number.isFinite(item)')
      && body.includes('!Number.isInteger(item)'),
    '잘못된 반 입력이 조용히 누락될 수 있습니다.',
  );
});
test(27, '중앙 초기화가 현재 스키마 버전을 기록', () => {
  const body = functionBody(admin, 'initializeCentralDataSchema');
  assert(
    body.includes("'schemaVersion'")
      && body.includes('CENTRAL_CONFIG.schemaVersion')
      && !body.includes('getCentralConfiguration_().schemaVersion'),
    '구버전 Script Property 값이 중앙 스키마 버전으로 기록될 수 있습니다.',
  );
});
// 개인 DB에는 학생 명단 시트 자체를 두지 않는다(중앙 자료에서만 읽는다).
// 시트가 없으므로 '빈 명단 허용'은 구조적으로 보장된다.
test(28, '개인 DB에 학생 명단·사진 시트 없음', () => {
  const storage = read('PersonalStorage.gs');
  const routing = read('PersonalRouting.gs');
  assert(
    !/function ensureDatabaseSchema_|function validateDatabaseSheet_|function readStudents_/.test(code),
    '개인 학생 명단 시트를 다루는 함수가 남아 있습니다.',
  );
  assert(
    !/students:\s*'데이터베이스'|photos:\s*'학생사진'/.test(storage),
    '개인 스프레드시트 스키마에 학생 명단·사진 시트가 남아 있습니다.',
  );
  assert(
    !functionBody(routing, 'personalRoutingSheetNames_').includes('databaseSheetName'),
    '개인 스프레드시트 초기화 목록에 학생 명단 시트가 남아 있습니다.',
  );
});
test(29, '오류 화면에서 모드 전환 버튼 숨김', () => {
  const resetBody = functionBody(html, 'resetClientData');
  const errorBody = functionBody(html, 'showError');
  assert(
    resetBody.includes("$('toPersonalButton').classList.add('hidden')")
      && resetBody.includes("$('toAdminButton').classList.add('hidden')")
      && errorBody.includes("$('toPersonalButton').classList.add('hidden')")
      && errorBody.includes("$('toAdminButton').classList.add('hidden')"),
    '오류 화면에서 이전 모드 버튼이 남을 수 있습니다.',
  );
});
test(30, '관리자 학생 요약·사진 상태 캐시 필터 UI', () => {
  const studentBody = functionBody(html, 'loadAdminStudents');
  const photoBody = functionBody(html, 'renderPhotoStatus');
  assert(
    html.includes('id="adminStudentSummary"')
      && studentBody.includes('result.students')
      && studentBody.includes('summary.totalCount')
      && studentBody.includes('summary.activeCount')
      && studentBody.includes('summary.filteredCount'),
    '학생 요약 DOM 또는 새 조회 계약 처리가 없습니다.',
  );
  assert(
    html.includes('id="photoStatusFilter"')
      && photoBody.includes('state.adminPhotoStatus')
      && photoBody.includes("selectedStatus === 'ALL' || row.status === selectedStatus")
      && !photoBody.includes('callServer('),
    '사진 상태 필터가 캐시를 즉시 필터링하지 않습니다.',
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
if (tests.length !== 30) {
  console.error(`FAIL expected 30 tests, got ${tests.length}`);
  process.exitCode = 1;
}
