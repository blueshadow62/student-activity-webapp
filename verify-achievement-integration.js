const fs = require('fs');
const vm = require('vm');

const read = file => fs.readFileSync(file, 'utf8');
const code = read('Code.gs');
const central = read('CentralData.gs');
const admin = read('AdminPortal.gs');
const installation = read('InstallationSetup.gs');
const personal = read('PersonalStorage.gs');
const requests = read('AssignmentRequests.gs');
const groups = read('CourseGroups.gs');
const schoolSetup = read('SchoolSetup.gs');
const html = read('Index.html');
const standardsData = read('StandardsData.gs');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function functionBody(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert(start >= 0, `${name} 함수를 찾을 수 없습니다.`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(open + 1, index);
  }
  throw new Error(`${name} 함수 본문이 닫히지 않았습니다.`);
}

function test(name, callback) {
  try {
    callback();
    passed += 1;
    console.log(`PASS ${passed}. ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

test('버전과 학교급 속성', () => {
  assert(code.includes("version: '1.2.0'"), '앱 버전이 1.2.0이 아닙니다.');
  assert(central.includes("schemaVersion: '4'"), '중앙 스키마가 4가 아닙니다.');
  assert(installation.includes("schoolLevelProperty: 'SCHOOL_LEVEL'"), '학교급 속성이 없습니다.');
});

test('중앙 과목·성취기준 시트 계약', () => {
  assert(central.includes("subjectCatalogSheetName: '과목목록'"), '과목목록 시트가 없습니다.');
  assert(central.includes("achievementStandardSheetName: '성취기준'"), '성취기준 시트가 없습니다.');
  assert(central.includes("'과목명', '축약코드', '학교급', '계열', '과목구분'"), '과목목록 헤더가 다릅니다.');
  assert(central.includes("'코드', '과목명', '영역', '내용', '학교급', '계열'"), '성취기준 헤더가 다릅니다.');
});

test('인코딩된 성취기준 번들을 학교급별로 런타임 복원', () => {
  const standardsContext = {};
  vm.createContext(standardsContext);
  vm.runInContext(`${standardsData}\nthis.standardsData = STANDARDS_DATA;`, standardsContext);
  const loadStandards = new Function(
    'schoolLevel',
    'normalizeSchoolLevel_',
    'schoolLevelLabel_',
    'STANDARDS_DATA',
    'bundledStandardsMemo_',
    functionBody(central, 'bundledStandardsForSchoolLevel_')
  );
  ['elementary', 'middle', 'high'].forEach(schoolLevel => {
    const result = loadStandards(
      schoolLevel,
      value => value,
      value => value,
      standardsContext.standardsData,
      {}
    );
    assert(Array.isArray(result), `${schoolLevel} 성취기준이 배열로 복원되지 않습니다.`);
    assert(result.length > 0, `${schoolLevel} 성취기준이 비어 있습니다.`);
    assert(result[0].code && result[0].subject && result[0].text, `${schoolLevel} 성취기준 필드가 불완전합니다.`);
  });
});

test('학교급 없는 기존 설치 호환', () => {
  const body = functionBody(central, 'inspectCentralSchema_');
  assert(body.includes('const standardsReady = !schoolLevel'), '학교급 미설정 폴백이 없습니다.');
  assert(body.includes('&& standardsReady'), '학교급 설정 뒤 새 시트를 검사하지 않습니다.');
});

test('관리자만 학교급 데이터를 교체', () => {
  const body = functionBody(admin, 'configureSchoolStandards');
  assert(/^\s*requireAdmin_\(\);/.test(body), '관리자 권한 검사가 첫 단계가 아닙니다.');
  assert(body.includes('replaceCentralStandardsData_'), '중앙 데이터 교체가 없습니다.');
  assert(body.includes('schoolLevelProperty'), '학교급 속성 저장이 없습니다.');
});

test('일반 중앙 스키마 점검은 기존 성취기준 데이터를 덮어쓰지 않음', () => {
  const body = functionBody(admin, 'initializeCentralDataSchema');
  assert(
    body.includes('if (!subjectCatalogSheet && !achievementStandardSheet)'),
    '두 시트가 없을 때만 최초 적재하는 조건이 없습니다.'
  );
  assert(
    body.includes('subjectCatalogSheet.getLastRow() < 2'),
    '부분 적재 상태를 감지하지 않습니다.'
  );
});

test('성취기준 조회는 현재 담당 과목만 허용', () => {
  const body = functionBody(central, 'getStandardsForSubject');
  assert(body.includes('getMyAssignments()'), '현재 담당 목록을 확인하지 않습니다.');
  assert(body.includes("'ASSIGNMENT_FORBIDDEN'"), '비담당 과목 차단이 없습니다.');
  assert(body.includes('readAchievementStandardsForSubject_'), '중앙 성취기준 조회가 없습니다.');
});

test('활동기록 끝 열 확장과 개인 헤더 일치', () => {
  assert(
    /\.\.\.LEGACY_RECORD_HEADERS, '학생ID', '학년도', '담당키', '성취기준'/.test(code),
    '활동기록 끝 열이 담당키·성취기준 순서가 아닙니다.'
  );
  assert(personal.includes("'담당키', '성취기준'"), '개인 저장소 헤더가 다릅니다.');
  assert(code.includes('assertCompatibleExtensionHeaders_'), '호환 확장 검사가 없습니다.');
});

test('기록 저장·수정·조회에 성취기준 포함', () => {
  assert(functionBody(code, 'saveRecord').includes('normalized.achievementStandard'), '저장 행에 성취기준이 없습니다.');
  assert(functionBody(code, 'updateRecord').includes('patch.achievementStandard'), '수정 입력을 받지 않습니다.');
  assert(functionBody(code, 'readRecentRecords_').includes('achievementStandard'), '최근 기록 응답에 없습니다.');
  assert(functionBody(code, 'readCentralFilteredPersonalRecords_').includes('achievementStandard'), '검색 응답에 없습니다.');
});

test('삭제 감사기록에도 성취기준 보존', () => {
  assert(
    /\.\.\.LEGACY_DELETED_RECORD_HEADERS, '학생ID', '학년도', '성취기준'/.test(code),
    '삭제기록 끝 열에 성취기준이 없습니다.'
  );
  assert(
    functionBody(code, 'deleteRecord').includes('located.values[16]'),
    '삭제 시 기존 성취기준을 감사 행에 복사하지 않습니다.'
  );
});

test('기존 성취기준을 바꾸지 않는 수정은 원문을 보존', () => {
  assert(
    functionBody(code, 'updateRecord').includes('preservedAchievementStandard'),
    '기존 성취기준 보존 옵션이 없습니다.'
  );
  assert(
    functionBody(code, 'validateCentralRecordPayload_')
      .includes('preservedAchievementStandard === null'),
    '변경한 성취기준만 중앙 원본과 재검증하지 않습니다.'
  );
});

test('성취기준 저장값 서버 재검증', () => {
  const body = functionBody(code, 'validateCentralRecordPayload_');
  assert(body.includes('resolveAchievementStandard_'), '담당 과목 성취기준 검증이 없습니다.');
  assert(functionBody(central, 'resolveAchievementStandard_').includes('readAchievementStandardsForSubject_'), '중앙 원본과 대조하지 않습니다.');
});

test('개인 고정 목록 API와 담당 소유권 검사', () => {
  ['getPinnedStandardsForAssignment', 'pinStandardForAssignment', 'unpinStandardForAssignment']
    .forEach(name => {
      assert(functionBody(code, name).includes('requireMyAssignment_'), `${name}에 담당 검사가 없습니다.`);
    });
  assert(personal.includes("'담당키', '성취기준키', '고정일시'"), '고정 목록 헤더가 없습니다.');
  assert(functionBody(central, 'achievementStandardKey_').includes('standard.text'), '내부 키가 원문을 구분하지 않습니다.');
});

test('초등학교만 1~6학년 허용', () => {
  const body = functionBody(central, 'getAllowedGrades_');
  assert(body.includes("=== 'elementary'"), '초등학교 분기가 없습니다.');
  assert(body.includes('[1, 2, 3, 4, 5, 6]'), '초등 학년 범위가 1~6이 아닙니다.');
  [admin, requests, groups, schoolSetup].forEach(source => {
    assert(source.includes('getAllowedGrades_()'), '서버 학년 검증 일부가 학교급 범위를 쓰지 않습니다.');
  });
});

test('설치 화면 학교급 필수 전달', () => {
  assert(html.includes('id="installationSchoolLevel"'), '설치 학교급 선택이 없습니다.');
  ['provisionSchool', 'connectExistingSchool'].forEach(name => {
    const body = functionBody(html, name);
    assert(body.includes("$('installationSchoolLevel').value"), `${name}이 학교급을 읽지 않습니다.`);
    assert(body.includes('schoolLevel: schoolLevel'), `${name}이 학교급을 서버에 보내지 않습니다.`);
  });
});

test('과목 자유 입력·검색·고등 계열 필터', () => {
  assert(html.includes('id="requestSubject" list="requestSubjectOptions"'), '과목 datalist 연결이 없습니다.');
  assert(html.includes('id="requestTrackFilter"'), '계열 필터가 없습니다.');
  const body = functionBody(html, 'renderSubjectCatalog_');
  assert(body.includes("schoolLevel === 'high'"), '고등학교 조건이 없습니다.');
  assert(body.includes('item.track === selectedTrack'), '계열 필터링이 없습니다.');
});

test('성취기준 비차단 백그라운드 로딩', () => {
  const selectBody = functionBody(html, 'selectAssignmentClass_');
  assert(selectBody.includes('loadAchievementStandards_(assignment);'), '수업 선택 시 로딩을 시작하지 않습니다.');
  assert(!selectBody.includes('await loadAchievementStandards_'), '성취기준 로딩이 수업 선택을 막습니다.');
  const loadBody = functionBody(html, 'loadAchievementStandards_');
  assert(loadBody.includes('Promise.all(['), '성취기준·고정 목록을 병렬 요청하지 않습니다.');
  assert(loadBody.includes('standardsRequestGeneration'), '이전 요청 무효화가 없습니다.');
  assert(loadBody.includes('cacheable:false'), '일시적 조회 실패를 빈 결과로 캐시합니다.');
});

test('성취기준 검색·고정 UI와 기록 payload', () => {
  assert(html.includes('id="recordAchievementStandard" list="achievementStandardOptions"'), '성취기준 검색 입력이 없습니다.');
  assert(html.includes('id="toggleStandardPinButton"'), '고정 버튼이 없습니다.');
  const saveBody = functionBody(html, 'saveActivityRecord');
  assert(saveBody.includes("achievementStandard:$('recordAchievementStandard').value"), '저장·수정 payload에 성취기준이 없습니다.');
});

test('클라이언트 서버 라우팅', () => {
  const body = functionBody(html, 'callServer');
  [
    'configureSchoolStandards',
    'getStandardsForSubject',
    'getPinnedStandardsForAssignment',
    'pinStandardForAssignment',
    'unpinStandardForAssignment',
  ].forEach(name => assert(body.includes(`${name}:()`), `${name} 라우팅이 없습니다.`));
});

test('Index 인라인 JavaScript 구문', () => {
  const script = html.match(/<script>([\s\S]*?)<\/script>/);
  assert(script, '인라인 스크립트를 찾을 수 없습니다.');
  new vm.Script(script[1]);
});

console.log(`RESULT ${passed}/${passed + failed}`);
if (failed) process.exit(1);
