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
const standardsElementary = read('StandardsData_elementary.gs');
const standardsMiddle = read('StandardsData_middle.gs');
const standardsHigh = read('StandardsData_high.gs');

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
  assert(code.includes("version: '2.0.0'"), '앱 버전이 2.0.0이 아닙니다.');
  assert(central.includes("schemaVersion: '5'"), '중앙 스키마가 5가 아닙니다.');
  assert(installation.includes("schoolLevelProperty: 'SCHOOL_LEVEL'"), '학교급 속성이 없습니다.');
});

test('중앙 과목·성취기준 시트 계약', () => {
  assert(central.includes("subjectCatalogSheetName: '과목목록'"), '과목목록 시트가 없습니다.');
  assert(central.includes("achievementStandardSheetName: '성취기준'"), '성취기준 시트가 없습니다.');
  assert(central.includes("'과목명', '축약코드', '학교급', '계열', '과목구분'"), '과목목록 헤더가 다릅니다.');
  assert(central.includes("'코드', '과목명', '영역', '내용', '학교급', '계열'"), '성취기준 헤더가 다릅니다.');
  assert(central.includes("'생성일시', '수정일시', '교육과정', '과목키'"), '교사담당 교육과정·과목키 열이 없습니다.');
  assert(central.includes("'담당키', '교육과정', '과목키'"), '담당신청 교육과정·과목키 열이 없습니다.');
});

test('인코딩된 성취기준 번들을 학교급별로 런타임 복원', () => {
  const standardsContext = {};
  vm.createContext(standardsContext);
  // 학교급별 파일은 각자 전역 상수(STANDARDS_DATA_ELEMENTARY 등)로만 존재하고
  // 더 이상 하나의 STANDARDS_DATA 객체로 묶이지 않으므로, 실제 CentralData.gs
  // 함수 본문(bundledStandardsForSchoolLevel_와 getBundledStandardsRaw_)을
  // 그대로 vm 컨텍스트에 정의해 실제 조회 경로를 그대로 검증한다.
  vm.runInContext(
    [
      standardsData, standardsElementary, standardsMiddle, standardsHigh,
      'function normalizeSchoolLevel_(v) { return v; }',
      'function schoolLevelLabel_(v) { return v; }',
      'const bundledStandardsMemo_ = {};',
      `function getBundledStandardsRaw_(schoolLevel) {${functionBody(central, 'getBundledStandardsRaw_')}}`,
      `function bundledStandardsForSchoolLevel_(schoolLevel) {${functionBody(central, 'bundledStandardsForSchoolLevel_')}}`,
    ].join('\n'),
    standardsContext
  );
  ['elementary', 'middle', 'high'].forEach(schoolLevel => {
    const result = standardsContext.bundledStandardsForSchoolLevel_(schoolLevel);
    assert(Array.isArray(result), `${schoolLevel} 성취기준이 배열로 복원되지 않습니다.`);
    assert(result.length > 0, `${schoolLevel} 성취기준이 비어 있습니다.`);
    assert(
      Object.prototype.hasOwnProperty.call(result[0], 'code')
        && result[0].subject
        && result[0].text
        && result[0].curriculumRevision
        && result[0].subjectKey
        && result[0].standardKey,
      `${schoolLevel} 성취기준 필드가 불완전합니다.`,
    );
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

test('성취기준 조회는 담당키와 교육과정으로 분리', () => {
  const body = functionBody(central, 'getStandardsForAssignment');
  assert(body.includes('requireMyAssignment_(assignmentKey)'), '담당키 소유권을 확인하지 않습니다.');
  assert(body.includes('assignment.curriculumRevision'), '담당 수업의 교육과정을 조회에 넘기지 않습니다.');
  assert(body.includes('assignment.subjectKey'), '담당 수업의 과목키를 조회에 넘기지 않습니다.');
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
  assert(body.includes("item.category === '보통교과'"), '보통교과 상시 포함 조건이 없습니다.');
  assert(html.includes('전문교과 계열(선택)'), '전문교과 전용 필터 문구가 없습니다.');
  assert(
    functionBody(html, 'selectedCatalogSubject_').includes('matches.length === 1'),
    '계열 공통 동명 과목을 임의의 첫 과목키로 고릅니다.',
  );
  assert(
    functionBody(html, 'normalizeSubjectSearchText_').includes("replace(/\\s+/g, '')"),
    '과목 검색이 공백 차이를 정규화하지 않습니다.',
  );
  const normalizeBody = functionBody(admin, 'normalizeTeacherAssignmentPayload_');
  assert(
    normalizeBody.includes('requestedCurriculumRevision')
      && normalizeBody.includes('requestedCurriculumRevision !== curriculumRevision'),
    '서버가 자동 판정과 다른 교육과정 값을 거부하지 않습니다.',
  );
});

test('고교 입학연도로 2015·2022 교육과정을 분리하고 동명 과목을 섞지 않음', () => {
  const script = html.match(/<script>([\s\S]*?)<\/script>/);
  assert(script, '인라인 스크립트를 찾을 수 없습니다.');
  const elements = {
    requestTrackFilter:{value:'', classList:{toggle() {}}, innerHTML:''},
    requestSchoolYear:{value:'2026'}, requestGrade:{value:'3'},
    requestSubject:{value:'', placeholder:''}, requestSubjectOptions:{innerHTML:''},
    requestCurriculumStatus:{textContent:''}, requestTrackField:{classList:{toggle() {}}},
  };
  const context = {
    document:{
      addEventListener() {}, getElementById:id => elements[id] || (elements[id] = {}),
      querySelectorAll:() => [], querySelector:() => null,
    },
    window:{}, sessionStorage:{getItem() { return ''; }, setItem() {}},
    console, setTimeout, clearTimeout,
  };
  vm.createContext(context);
  vm.runInContext(`${script[1]}\nthis.uiTest = {state, curriculumRevisionFor_, subjectCatalogFor_, renderSubjectCatalog_, standardDisplay_};`, context);
  context.uiTest.state.bootstrap = {
    schoolLevel:'high',
    subjectCatalog:[
      {name:'실용 국어', category:'보통교과', track:'보통교과', curriculumRevision:'2015', subjectKey:'2015|high|보통교과|실용 국어'},
      {name:'전기 회로', category:'전문교과', track:'전기·전자', curriculumRevision:'2015', subjectKey:'2015|high|전기·전자|전기 회로'},
      {name:'기계 제도', category:'전문교과', track:'기계', curriculumRevision:'2015', subjectKey:'2015|high|기계|기계 제도'},
      {name:'전기 회로', category:'전문교과', track:'전기·전자', curriculumRevision:'2022', subjectKey:'2022|high|전기·전자|전기 회로'},
    ],
  };
  assert(context.uiTest.curriculumRevisionFor_('2026', '3') === '2015', '2026학년도 3학년이 2015 개정이 아닙니다.');
  assert(context.uiTest.curriculumRevisionFor_('2026', '2') === '2022', '2026학년도 2학년이 2022 개정이 아닙니다.');
  assert(context.uiTest.curriculumRevisionFor_('2025', '1') === '2022', '2025학년도 1학년 경계가 2022 개정이 아닙니다.');
  assert(context.uiTest.curriculumRevisionFor_('2027', '3') === '2022', '2027학년도 3학년 경계가 2022 개정이 아닙니다.');
  assert(context.uiTest.subjectCatalogFor_('2026', '3')[0].subjectKey.startsWith('2015|'), '2015 동명 과목이 분리되지 않습니다.');
  assert(context.uiTest.subjectCatalogFor_('2026', '2').every(item => item.subjectKey.startsWith('2022|')), '2022 동명 과목이 분리되지 않습니다.');
  assert(context.uiTest.standardDisplay_({domain:'설계', text:'회로를 분석한다.'}) === '회로를 분석한다.', '코드 없는 기준에 내부 키 또는 가짜 코드가 표시됩니다.');

  elements.requestSubject.value = '실용국어';
  context.uiTest.renderSubjectCatalog_();
  assert(elements.requestSubjectOptions.innerHTML.includes('실용 국어'), '공백 없는 입력으로 실용 국어를 찾지 못합니다.');
  elements.requestTrackFilter.value = '전기·전자';
  elements.requestSubject.value = '';
  context.uiTest.renderSubjectCatalog_();
  assert(elements.requestSubjectOptions.innerHTML.includes('실용 국어'), '전문계열 선택 시 보통교과가 사라집니다.');
  assert(elements.requestSubjectOptions.innerHTML.includes('전기 회로'), '선택한 전문계열 과목이 사라집니다.');
  assert(!elements.requestSubjectOptions.innerHTML.includes('기계 제도'), '선택하지 않은 전문계열 과목이 남습니다.');
  assert(!elements.requestTrackFilter.innerHTML.includes('보통교과'), '보통교과가 전문계열 선택지에 노출됩니다.');

  context.uiTest.state.bootstrap.subjectCatalog = Array.from({length:150}, (_, index) => ({
    name:`과목 ${index}`, curriculumRevision:'2022', subjectKey:`2022|${index}`
  })).concat({name:'정확한 과목', curriculumRevision:'2022', subjectKey:'2022|exact'});
  elements.requestGrade.value = '2';
  elements.requestSubject.value = '정확한';
  context.uiTest.renderSubjectCatalog_();
  assert(elements.requestSubjectOptions.innerHTML.includes('정확한 과목'), '입력한 정확한 과목 후보가 표시되지 않습니다.');
  elements.requestSubject.value = '';
  context.uiTest.renderSubjectCatalog_();
  assert((elements.requestSubjectOptions.innerHTML.match(/<option/g) || []).length <= 100, '빈 검색에서 과도한 datalist 후보를 렌더링합니다.');
});

test('성취기준 비차단 백그라운드 로딩', () => {
  const selectBody = functionBody(html, 'selectAssignmentClass_');
  assert(selectBody.includes('loadAchievementStandards_(assignment);'), '수업 선택 시 로딩을 시작하지 않습니다.');
  assert(!selectBody.includes('await loadAchievementStandards_'), '성취기준 로딩이 수업 선택을 막습니다.');
  const loadBody = functionBody(html, 'loadAchievementStandards_');
  assert(loadBody.includes('Promise.all(['), '성취기준·고정 목록을 병렬 요청하지 않습니다.');
  assert(loadBody.includes('standardsRequestGeneration'), '이전 요청 무효화가 없습니다.');
  assert(loadBody.includes('cacheable:false'), '일시적 조회 실패를 빈 결과로 캐시합니다.');
  assert(loadBody.includes("callServer('getStandardsForAssignment', assignmentKey)"), '담당키 기반 성취기준 조회가 아닙니다.');
  assert(loadBody.includes('standardsCacheKey'), '교육과정·수업 분리 캐시 키가 없습니다.');
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
    'getStandardsForAssignment',
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
