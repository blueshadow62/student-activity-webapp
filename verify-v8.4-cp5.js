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
const groups = read('CourseGroups.gs');
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

test(1, '체크포인트 2.6 회귀 29/29', () => {
  const output = childProcess.execFileSync(
    process.execPath,
    [path.join(__dirname, 'verify-v8.4-cp2.6.js')],
    { cwd: root, encoding: 'utf8' },
  );
  assert(output.includes('RESULT 29/29'), '체크포인트 2.6 회귀가 통과하지 않았습니다.');
});
// 업데이트 알림이 이 값을 GitHub 릴리스 태그와 자리마다 숫자로 비교한다.
// 'cp5' 같은 꼬리가 붙으면 비교가 무너지므로 순수 semver 만 허용한다.
test(2, '앱 버전이 semver 형식', () => {
  const found = code.match(/version: '([^']+)'/);
  assert(found, '앱 버전을 찾을 수 없습니다.');
  assert(
    /^\d+\.\d+\.\d+$/.test(found[1]),
    `앱 버전 '${found[1]}'이 semver(1.0.0) 형식이 아닙니다.`,
  );
});
test(3, '승인된 교사 목록은 관리자 전용', () => {
  assert(/^\s*requireAdmin_\(\);/.test(functionBody(admin, 'getApprovedTeachers')), '승인 교사 목록에 관리자 검사가 없습니다.');
});
test(4, '승인된 교사 목록은 활성 담당만 이메일별로 집계', () => {
  const body = functionBody(admin, 'getApprovedTeachers');
  assert(body.includes('assignment.active') && body.includes('byEmail.set'), '활성 담당 기준 이메일 집계가 없습니다.');
});
test(5, '해지는 관리자 전용', () => {
  assert(/^\s*requireAdmin_\(\);/.test(functionBody(admin, 'revokeApprovedTeachersAccess')), '해지 함수에 관리자 검사가 없습니다.');
});
test(6, '해지 대상 없으면 오류', () => {
  const body = functionBody(admin, 'revokeApprovedTeachersAccess');
  assert(body.includes('rowsToDeactivate.length') && body.includes('해지할 활성 담당이 있는 교사를 찾을 수 없습니다'), '해지 대상 없음 검사가 없습니다.');
});
test(7, '해지는 선택 교사의 담당만 비활성화', () => {
  const body = functionBody(admin, 'revokeApprovedTeachersAccess');
  // 칸을 어떻게 쓰는지가 아니라 '고른 교사의 행만 끈다'는 성질을 본다. 열 단위
  // 일괄 쓰기로 바꾼 뒤에도 성질은 같아야 한다.
  assert(
    body.includes('emails.includes(assignment.teacherEmail)')
      && body.includes('deactivateCentralRows_('),
    '해지 시 선택 교사 담당 비활성화 로직이 없습니다.',
  );
  assert(
    !functionBody(central, 'deactivateCentralRows_').includes('deleteRow'),
    '일괄 비활성화가 행을 지웁니다.',
  );
});
test(8, '해지는 신청·승인 이력을 삭제하지 않음', () => {
  const body = functionBody(admin, 'revokeApprovedTeachersAccess');
  assert(
    !/deleteRow|assignmentRequestSheet|PersonalStorage|getPersonalRecordContext_/.test(body),
    '해지 처리가 신청 이력이나 개인 기록을 건드립니다.',
  );
});
test(9, '승인 시 중앙 자료 공유가 담당·감사 기록보다 먼저 실행', () => {
  const body = functionBody(requests, 'reviewAssignmentRequests_');
  const grantIndex = body.indexOf('grantCentralAccessToTeachers_');
  const writeIndex = body.indexOf('.setValues(');
  assert(grantIndex >= 0 && writeIndex >= 0 && grantIndex < writeIndex, '공유 실패 시 담당·감사 기록이 먼저 쓰일 수 있습니다.');
});
test(10, '공유 실패 시 승인 처리 중단', () => {
  const body = functionBody(central, 'grantCentralAccessToTeachers_');
  assert(body.includes('failures.length') && body.includes('throw createCentralError_'), '공유 실패를 무시하고 승인이 진행될 수 있습니다.');
});
test(11, '해지는 중앙 개별 보기 권한만 제거', () => {
  const body = functionBody(central, 'revokeCentralAccessFromTeacher_');
  assert(
    body.includes('spreadsheet.removeViewer(teacherEmail)') && body.includes('folder.removeViewer(teacherEmail)'),
    '해지 시 중앙 스프레드시트·사진 폴더 보기 권한 제거가 없습니다.',
  );
});
test(12, '공유 범위 초과 시 경고 반환', () => {
  const body = functionBody(central, 'centralSharingBreadthWarning_');
  assert(body.includes('DriveApp.Access.PRIVATE'), '링크·그룹 공유 경고 판정이 없습니다.');
});
test(13, '중앙 자료 공유 코드는 지정된 함수에만 존재', () => {
  assert(
    !/addEditor|setSharing|setShareableByEditors|ANYONE_WITH_LINK/.test(`${central}\n${admin}\n${requests}`),
    '편집 권한 부여나 링크 전체 공개 코드가 있습니다.',
  );
  const grantBody = functionBody(central, 'grantCentralAccessToTeachers_');
  const quietBody = functionBody(central, 'addCentralViewerQuietly_');
  const revokeBody = functionBody(central, 'revokeCentralAccessFromTeacher_');
  const outside = `${central}\n${admin}\n${requests}`
    .replace(grantBody, '')
    .replace(quietBody, '')
    .replace(revokeBody, '');
  assert(
    !/addViewer|removeViewer|Drive\.Permissions/.test(outside),
    '지정된 함수 밖에서 Drive 보기 권한을 변경합니다.',
  );
});
// Drive 기본 공유 알림은 앱의 승인 안내 메일과 중복이고, 알림의 '열기' 버튼이
// 교사를 담당 필터 없는 원본 폴더로 보낸다. 알림을 끄고 부여해야 한다.
test(24, '중앙 자료 공유 시 Drive 알림 메일 미발송', () => {
  const quietBody = functionBody(central, 'addCentralViewerQuietly_');
  assert(
    /sendNotificationEmail:\s*false/.test(quietBody),
    '개별 보기 권한 부여가 Drive 알림 메일을 끄지 않습니다.',
  );
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'appsscript.json'), 'utf8'));
  const services = (manifest.dependencies && manifest.dependencies.enabledAdvancedServices) || [];
  assert(
    services.some((service) => service.userSymbol === 'Drive'),
    '매니페스트에 Drive 고급 서비스가 없어 알림 끄기가 동작하지 않습니다.',
  );
});
test(14, '해지 확인 문구 입력 요구', () => {
  const body = functionBody(html, 'revokeApprovedTeachers_');
  assert(body.includes("typed !== '해지'"), '해지 전 확인 문구 입력이 없습니다.');
});
test(15, '체크박스 개별·일괄 선택 UI', () => {
  assert(
    html.includes('id="selectAllApprovedTeachers"') && html.includes('data-approved-teacher='),
    '승인 교사 체크박스 선택 UI가 없습니다.',
  );
  assert(html.includes('data-revoke-teacher='), '개별 해지 버튼이 없습니다.');
});
test(16, '클라이언트·서버 함수 계약', () => {
  ['getApprovedTeachers', 'revokeApprovedTeachersAccess'].forEach((name) => {
    assert(functionBody(admin, name), `서버 함수 없음: ${name}`);
    assert(html.includes(`${name}:()`), `클라이언트 호출 없음: ${name}`);
  });
});
test(17, '.gs 구문·중복 함수 통과', () => {
  const gsFiles = fs.readdirSync(__dirname).filter((name) => name.endsWith('.gs'));
  const serverCode = gsFiles
    .map((name) => fs.readFileSync(path.join(__dirname, name), 'utf8'))
    .join('\n');
  new Function(serverCode);
  const names = [...serverCode.matchAll(/^function\s+([A-Za-z0-9_]+)\s*\(/gm)].map((m) => m[1]);
  const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
  assert(duplicates.length === 0, `중복 서버 함수: ${[...new Set(duplicates)].join(', ')}`);
});
test(19, '죽은 개인 사진 시트·묶음·학교설정 스키마 제거', () => {
  assert(
    !fs.existsSync(path.join(__dirname, 'PhotoManager.gs'))
      && !fs.existsSync(path.join(__dirname, 'PhotoBundles.gs')),
    '죽은 PhotoManager.gs/PhotoBundles.gs가 여전히 존재합니다.',
  );
  const routing = fs.readFileSync(path.join(__dirname, 'PersonalRouting.gs'), 'utf8');
  assert(
    !/ensureStudentPhotoSheet_|ensureStudentPhotoBundleSheet_|ensureUserSettingsSheet_|ensureStudentChangeHistorySheet_|ensureSchoolConfigSheet_|ensureDatabaseChangeLogSheet_|getRegisteredPersonalBundleFile_/.test(routing),
    '개인 스프레드시트 초기화 경로에 더 이상 쓰이지 않는 시트 생성 호출이 남아 있습니다.',
  );
});
// getService().isEnabled()는 "웹앱이 배포되어 있는가"라서, 배포 후에는 편집기
// 실행까지 막아 최초 관리자 등록이 영구히 불가능해진다. 호출자 판정으로 대체한다.
test(23, '최초 관리자 등록이 배포 여부로 막히지 않음', () => {
  const setup = fs.readFileSync(path.join(__dirname, 'InstallationSetup.gs'), 'utf8');
  const body = functionBody(setup, 'registerInitialSchoolAdministrator');
  assert(
    !/getService\(\)\s*\.\s*isEnabled/.test(body),
    '배포 여부(getService().isEnabled())로 최초 관리자 등록을 막고 있습니다.',
  );
  assert(
    body.includes('requireScriptProjectEditor_()'),
    '최초 관리자 등록에 스크립트 편집 권한 확인이 없습니다.',
  );
  const guard = functionBody(setup, 'requireScriptProjectEditor_');
  assert(
    guard.includes('ScriptApp.getScriptId()')
      && guard.includes('getEditors()')
      && guard.includes('getOwner()'),
    '편집 권한 확인이 스크립트 프로젝트의 소유자·편집자를 보지 않습니다.',
  );
});
// 서버는 개인 저장소 실패 시 복구 동작을 함께 돌려주는데 화면에 배선되지
// 않으면 교사가 스스로 빠져나올 수 없다.
test(27, '개인 저장소 복구 경로가 화면에 배선됨', () => {
  assert(
    html.includes('resolvePersonalStorageIssue:()'),
    '복구 함수가 클라이언트 호출 목록에 없습니다.',
  );
  const recovery = functionBody(html, 'renderPersonalStorageRecovery');
  assert(
    recovery.includes('storage.actions') && recovery.includes('recoveryCandidates'),
    '서버가 준 복구 동작·후보를 화면에 그리지 않습니다.',
  );
  const resolve = functionBody(html, 'resolveStorageIssue');
  assert(
    resolve.includes("callServer(") && resolve.includes('resolvePersonalStorageIssue'),
    '복구 버튼이 서버 복구 함수를 호출하지 않습니다.',
  );
  const server = fs.readFileSync(path.join(__dirname, 'PersonalStorage.gs'), 'utf8');
  assert(
    /^\s*const userEmail = requireCurrentUserEmail_\(\);/m
      .test(functionBody(server, 'resolvePersonalStorageIssue')),
    '복구 함수가 현재 사용자 확인 없이 동작합니다.',
  );
});
// 링크로 개인 저장소를 연결할 때 본인 소유·앱 생성 파일 확인을 빼면 다른
// 교사의 개인 활동 기록을 가리키게 만들 수 있다.
test(28, '링크 연결은 본인 소유·앱 생성 파일만 허용', () => {
  const server = fs.readFileSync(path.join(__dirname, 'PersonalStorage.gs'), 'utf8');
  const body = functionBody(server, 'connectPersonalDatabaseByLink');
  assert(body, 'connectPersonalDatabaseByLink 함수가 없습니다.');
  assert(
    body.includes('requireCurrentUserEmail_()'),
    '링크 연결이 현재 사용자를 확인하지 않습니다.',
  );
  assert(
    body.includes('isPersonalDriveItemOwnedBy_('),
    '링크 연결이 파일 소유자를 확인하지 않습니다. 남의 개인 기록에 연결될 수 있습니다.',
  );
  assert(
    body.includes('validatePersonalDatabaseMetadata_('),
    '링크 연결이 이 앱이 만든 개인 저장소인지 확인하지 않습니다.',
  );
  assert(
    body.includes('isTrashed()'),
    '링크 연결이 휴지통 파일을 걸러내지 않습니다.',
  );
  assert(
    html.includes('connectPersonalDatabaseByLink:()'),
    '링크 연결이 클라이언트 호출 목록에 없습니다.',
  );
});
// 교사가 잘못 신청한 항목을 스스로 취소할 수 있어야 하며, 이미 처리된
// 신청(승인·거부)은 취소 대상에서 빠져야 한다.
test(29, '승인 대기 담당 신청만 취소 가능', () => {
  const singleBody = functionBody(requests, 'cancelMyAssignmentRequest');
  assert(singleBody, 'cancelMyAssignmentRequest 함수가 없습니다.');
  assert(
    singleBody.includes('cancelAssignmentRequestsBatch('),
    '단일 취소가 일괄 취소 로직을 재사용하지 않습니다.',
  );
  const body = functionBody(requests, 'cancelAssignmentRequestsBatch');
  assert(body, 'cancelAssignmentRequestsBatch 함수가 없습니다.');
  assert(
    body.includes('getRequiredActiveUserEmail_()'),
    '취소 함수가 현재 사용자를 확인하지 않습니다. 다른 교사의 신청을 취소할 수 있습니다.',
  );
  assert(
    body.includes("!== CENTRAL_ASSIGNMENT_REQUEST_STATUS.pending"),
    '승인·거부가 끝난 신청도 취소를 허용합니다.',
  );
  assert(
    html.includes('cancelMyAssignmentRequest:()') && html.includes('cancelAssignmentRequestsBatch:()'),
    '취소 함수가 클라이언트 호출 목록에 없습니다.',
  );
  assert(
    html.includes('data-cancel-request=') && html.includes('data-select-request='),
    '개별·일괄 취소 UI가 화면에 없습니다.',
  );
});
// 관리자가 승인 대기 신청을 놓치지 않도록 신청 시 메일로 알린다.
test(30, '담당 신청 시 관리자 메일 알림', () => {
  const submitBody = functionBody(requests, 'submitMyAssignmentRequest');
  assert(
    submitBody.includes('notifyAdminsOfNewAssignmentRequest_('),
    '담당 신청 제출이 관리자에게 메일로 알리지 않습니다.',
  );
  const notifyBody = functionBody(requests, 'notifyAdminsOfNewAssignmentRequest_');
  assert(
    notifyBody.includes('adminEmails') && notifyBody.includes('notifyTeacherByEmail_('),
    '관리자 알림이 관리자 이메일 목록으로 발송되지 않습니다.',
  );
  // withCentralWriteLock_ 실행 결과를 받은 뒤(잠금 밖에서) 호출해야 메일
  // 발송 지연이 쓰기 잠금을 오래 붙잡지 않는다.
  const lockEnd = submitBody.indexOf('});');
  const notifyIndex = submitBody.indexOf('notifyAdminsOfNewAssignmentRequest_(');
  assert(
    lockEnd >= 0 && notifyIndex > lockEnd,
    '관리자 알림이 쓰기 잠금 안에서 호출되어 지연될 수 있습니다.',
  );
});
// 담당 신청은 특정 중앙 교사담당 시트를 전제로 한다. 연결을 끊고 다른 중앙
// 자료를 붙이면 '승인' 이력만 남고 담당 행은 없어 거짓 상태가 된다.
test(26, '설치 초기화가 담당 신청 이력도 정리', () => {
  const setup = fs.readFileSync(path.join(__dirname, 'InstallationSetup.gs'), 'utf8');
  const body = functionBody(setup, 'resetSchoolInstallationConnections');
  assert(
    body.includes('clearStoredAssignmentRequests_('),
    '설치 초기화가 담당 신청 이력을 남겨 승인 상태가 거짓으로 남습니다.',
  );
  const clearBody = functionBody(requests, 'clearStoredAssignmentRequests_');
  assert(
    clearBody.includes('propertyPrefix') && clearBody.includes('deleteProperty'),
    '담당 신청 이력 정리가 저장 키를 지우지 않습니다.',
  );
  assert(
    /^\s*requireAdmin_\(\);/.test(body),
    '설치 초기화에 관리자 검사가 없습니다.',
  );
});
// 중앙 사진 폴더 주소는 관리자 전용 응답에만 담긴다. 교사 경로로 새면
// 담당 학급 필터를 우회해 전교생 사진 폴더를 직접 열 수 있다.
test(25, '사진 폴더 주소는 관리자 응답에만 존재', () => {
  const adminBody = functionBody(admin, 'getAdminPhotoStatus');
  assert(
    /^\s*requireAdmin_\(\);/.test(adminBody) && adminBody.includes('folderUrl'),
    '관리자 사진 현황이 관리자 검사를 거쳐 폴더 주소를 반환하지 않습니다.',
  );
  ['getStudentPhotosForMyAssignment'].forEach((name) => {
    const body = functionBody(central, name);
    assert(
      !/getUrl\(\)|folderUrl/.test(body),
      `교사용 사진 응답(${name})에 Drive 주소가 들어 있습니다.`,
    );
  });
});
// 증명사진은 중앙 폴더에서만 읽는다. 개인 Drive에 사진 폴더를 만들지 않는다.
test(22, '개인 Drive 사진 폴더 미생성', () => {
  const storage = fs.readFileSync(path.join(__dirname, 'PersonalStorage.gs'), 'utf8');
  const routing = fs.readFileSync(path.join(__dirname, 'PersonalRouting.gs'), 'utf8');
  assert(
    !/getOrCreatePersonalPhotoFolder_|personalPhotoFolderName_|photoFolderNamePrefix|photoFolderIdPropertyPrefix/.test(storage),
    '개인 사진 폴더 생성 경로가 남아 있습니다.',
  );
  assert(
    !/photoFolder/.test(routing),
    '개인 저장소 컨텍스트가 여전히 사진 폴더를 요구합니다.',
  );
});
test(18, 'git diff --check 통과', () => {
  childProcess.execFileSync('git', ['diff', '--check'], { cwd: root, encoding: 'utf8' });
});
test(20, '승인 전 교사도 담당 수업 신청 화면에 도달 가능', () => {
  const bootstrap = functionBody(code, 'buildPersonalModeBootstrap_');
  // 승인 전 교사가 0권한 상태로 중앙 스프레드시트를 열려는 시도 자체가
  // Apps Script 호출을 통째로 실패시킬 수 있어, 중앙 자료 확인은 부트스트랩
  // 함수 안에 전혀 없어야 한다(있으면 이 함수를 호출하는 즉시 실패할 위험).
  assert(
    !/getCentralConnectionContext_|central\.ready/.test(bootstrap)
      && bootstrap.includes('preparePersonalStorageContext_()'),
    '부트스트랩 함수가 여전히 중앙 자료를 직접 확인해 승인 전 교사 호출이 실패할 수 있습니다.',
  );
  const centralStatus = functionBody(code, 'getPersonalCentralStatus');
  assert(
    centralStatus.includes('getCentralConnectionContext_(false)')
      && centralStatus.includes('getMyAssignmentsFromCentralSheet_('),
    '중앙 자료 상태·담당 목록을 가져오는 별도 함수가 없습니다.',
  );
  // 담당 신청은 중앙 자료도 개인 저장소도 쓰지 않는다(중앙 시트·스크립트
  // 속성에만 기록). 둘 중 무엇이 실패해도 신청 화면은 열려야 교사가 승인을
  // 받아 빠져나올 수 있다.
  const render = functionBody(html, 'renderPersonalBootstrap');
  assert(
    !/if \(!connectionReady[^)]*\) return;/.test(render)
      && !/if \(!storageReady\) return;/.test(render),
    '중앙 자료·개인 저장소 실패가 담당 수업 신청 화면을 통째로 막습니다.',
  );
  assert(
    render.includes("$('assignmentRequestCard').classList.remove('hidden')"),
    '담당 수업 신청 카드가 항상 열리지 않습니다.',
  );
  const loadApp = functionBody(html, 'loadApp');
  const loadStatus = functionBody(html, 'loadPersonalCentralStatus_');
  assert(
    loadApp.includes("await loadPersonalCentralStatus_()")
      && loadStatus.includes("callServer('getPersonalCentralStatus')")
      && /catch\s*\(error\)\s*\{[\s\S]*state\.bootstrap\.central\s*=/.test(loadStatus),
    '클라이언트가 중앙 자료 상태 호출을 부트스트랩과 분리해 실패를 흡수하지 않습니다.',
  );
});
test(21, '담당 신청 시 중앙 접근 실패해도 신청 자체는 진행', () => {
  const body = functionBody(requests, 'submitMyAssignmentRequest');
  assert(
    /try\s*\{\s*assignments = readCentralTeacherAssignmentsCached_\(true\);\s*\}\s*catch/.test(body),
    '승인 전 교사의 신청이 중앙 접근 실패로 그대로 막힙니다.',
  );
});
// 관리자든 일반 교사든 처음 접속했다고 개인 저장소가 조용히 자동으로
// 생기면 안 된다. '새 개인 저장소 만들기' 버튼을 직접 눌러야 만들어져야
// 하고, 새로 만드는 파일 이름에는 학교명이 붙어야 헷갈리지 않는다.
test(31, '개인 저장소는 버튼을 눌러야 생성되고 파일명에 학교명 포함', () => {
  const storage = fs.readFileSync(path.join(__dirname, 'PersonalStorage.gs'), 'utf8');
  const getOrCreateBody = functionBody(storage, 'getOrCreatePersonalDatabase_');
  assert(
    !getOrCreateBody.includes('createPersonalDatabase_('),
    '개인 데이터베이스가 없을 때 자동으로 만들어져 버튼 없이도 생성됩니다.',
  );
  const nameBody = functionBody(storage, 'personalDatabaseName_');
  assert(
    nameBody.includes('getSchoolInstallationState_()')
      && nameBody.includes('.schoolName'),
    '개인 데이터베이스 파일명에 학교명이 들어가지 않습니다.',
  );
  const resolveBody = functionBody(storage, 'resolvePersonalStorageIssue');
  assert(
    /createNewDatabase[\s\S]*?createPersonalDatabase_\(/.test(resolveBody),
    "'새 개인 저장소 만들기' 버튼을 눌러도 실제로 파일을 만들지 않습니다.",
  );
  const clearBody = functionBody(storage, 'clearUnavailablePersonalDatabaseLink_');
  assert(
    !/if \(!token\) \{\s*throw/.test(clearBody),
    '정리할 대상이 없는 순수 최초 생성 상황에서도 오류를 던집니다.',
  );
});
// 신청이 여러 건 쌓이면 하나씩 취소하기 번거로우니 체크박스·전체 선택·
// 일괄 취소를 관리자 화면과 같은 방식으로 제공한다.
test(32, '내 담당 신청 체크박스·일괄 취소 UI', () => {
  const clientBody = functionBody(html, 'cancelSelectedMyAssignmentRequests_');
  assert(clientBody, 'cancelSelectedMyAssignmentRequests_ 함수가 없습니다.');
  assert(
    clientBody.includes('data-select-request') && clientBody.includes('cancelAssignmentRequestsBatch'),
    '일괄 취소가 선택된 신청 키를 모아 배치 호출을 하지 않습니다.',
  );
  assert(
    html.includes('id="selectAllMyAssignmentRequests"')
      && html.includes('id="cancelSelectedMyAssignmentRequestsButton"'),
    '전체 선택 체크박스 또는 일괄 취소 버튼이 화면에 없습니다.',
  );
  const bindBody = functionBody(html, 'bindEvents');
  assert(
    bindBody.includes("$('selectAllMyAssignmentRequests').addEventListener('change'"),
    '전체 선택 체크박스가 개별 체크박스와 연결되지 않습니다.',
  );
});
// 서버에만 있던 기록 수정 기능을 저장 폼 재사용으로 화면에 연결한다.
// 삭제와 같은 작성자 본인 검사를 그대로 타야 한다.
test(33, '기록 수정이 화면에 배선되고 작성자 검사를 그대로 씀', () => {
  const updateBody = functionBody(code, 'updateRecord');
  assert(
    updateBody.includes('requireDeletePermission_('),
    'updateRecord가 삭제와 같은 작성자 검사를 쓰지 않습니다.',
  );
  assert(
    html.includes('updateRecord:()'),
    'updateRecord가 클라이언트 호출 목록에 없습니다.',
  );
  assert(
    html.includes('data-edit-record='),
    '수정 버튼이 화면에 없습니다.',
  );
  const saveBody = functionBody(html, 'saveActivityRecord');
  assert(
    saveBody.includes('state.editingRecordId') && saveBody.includes("callServer('updateRecord'"),
    '저장 버튼이 수정 모드에서 updateRecord를 호출하지 않습니다.',
  );
});

test(34, '해지 후 중앙 자료 실제 접근 상태를 다시 확인', () => {
  const revokeBody = functionBody(central, 'revokeCentralAccessFromTeacher_');
  const accessBody = functionBody(central, 'getCentralResourceAccessState_');
  assert(
    revokeBody.includes('getCentralResourceAccessState_')
      && revokeBody.includes('accessRevoked')
      && revokeBody.includes('failureDetails'),
    '해지 결과에 실제 접근 상태 확인과 실패 상세가 없습니다.',
  );
  assert(
    accessBody.includes('getOwner()')
      && accessBody.includes('getEditors()')
      && accessBody.includes('getViewers()'),
    '중앙 자료의 소유자·편집자·보기 권한을 확인하지 않습니다.',
  );
});
test(35, 'Drive 권한 제거 재시도는 관리자 전용이며 활성 담당을 차단', () => {
  const body = functionBody(admin, 'retryApprovedTeacherAccessRevocation');
  assert(/^\s*requireAdmin_\(\);/.test(body), '재시도 함수에 관리자 검사가 없습니다.');
  assert(
    body.includes('teacherAssignments.some')
      && body.includes('assignment.active')
      && body.includes('활성 담당이 있는 교사는 권한 제거를 재시도할 수 없습니다'),
    '활성 담당 교사의 권한 제거 재시도를 차단하지 않습니다.',
  );
  assert(
    body.includes('revokeCentralAccessFromTeacher_(email)'),
    '재시도 함수가 중앙 자료 권한 제거 함수를 호출하지 않습니다.',
  );
});
test(36, '해지 실패를 관리자에게 자원별로 표시', () => {
  const revokeBody = functionBody(html, 'revokeApprovedTeachers_');
  const formatBody = functionBody(html, 'formatAccessRevocationFailure_');
  assert(
    revokeBody.includes('!item.accessRevoked')
      && revokeBody.includes('formatAccessRevocationFailure_'),
    '해지 실패 결과를 선별해 표시하지 않습니다.',
  );
  assert(
    formatBody.includes('failureDetails'),
    '중앙 DB·사진 폴더별 실패 상세를 표시하지 않습니다.',
  );
});
test(37, '비활성 교사 행에 Drive 권한 제거 재시도 제공', () => {
  const renderBody = functionBody(html, 'renderTeacherAssignmentGroups_');
  assert(
    renderBody.includes('data-retry-access-revocation')
      && html.includes('retryApprovedTeacherAccessRevocation_'),
    '비활성 교사 행의 권한 제거 재시도 UI가 없습니다.',
  );
});
test(38, '권한 제거 재시도 클라이언트·서버 계약', () => {
  assert(
    functionBody(admin, 'retryApprovedTeacherAccessRevocation'),
    '권한 제거 재시도 서버 함수가 없습니다.',
  );
  assert(
    html.includes('retryApprovedTeacherAccessRevocation:()'),
    '권한 제거 재시도 클라이언트 호출 계약이 없습니다.',
  );
});
test(39, '학년도 일괄 비활성화는 관리자 전용이며 구형 시트는 행 삭제', () => {
  const body = functionBody(admin, 'deactivateCentralStudentsByYear');
  assert(body, 'deactivateCentralStudentsByYear 함수가 없습니다.');
  assert(/^\s*requireAdmin_\(\);/.test(body), '학년도 일괄 비활성화에 관리자 검사가 없습니다.');
  assert(
    body.includes("student.schema === 'canonical'") && body.includes('legacyRowNumbers'),
    '신형·구형 시트를 구분해 처리하지 않습니다.',
  );
  assert(
    html.includes('deactivateCentralStudentsByYear:()') && html.includes('deactivateStudentsByYear_'),
    '학년도 일괄 비활성화가 화면에 배선되지 않았습니다.',
  );
});
test(40, '전체 학생목록 초기화는 관리자 전용이며 확인 후 삭제', () => {
  const body = functionBody(admin, 'resetCentralStudentList');
  assert(body, 'resetCentralStudentList 함수가 없습니다.');
  assert(/^\s*requireAdmin_\(\);/.test(body), '전체 초기화에 관리자 검사가 없습니다.');
  assert(
    body.includes('deleteRows('),
    '전체 초기화가 실제로 행을 삭제하지 않습니다.',
  );
  const clientBody = functionBody(html, 'resetStudentList_');
  assert(
    clientBody.includes('showConfirm(') && clientBody.includes('되돌릴 수 없습니다'),
    '전체 초기화 전에 되돌릴 수 없다는 확인창이 없습니다.',
  );
  assert(
    html.includes('resetCentralStudentList:()') && html.includes('class="danger">전체 학생목록 초기화'),
    '전체 초기화 버튼이 위험 표시 없이 배선되지 않았습니다.',
  );
});

test(41, '담당 신청은 처리 완료 건을 줄여서 보관', () => {
  const writeBody = functionBody(requests, 'writeStoredAssignmentRequestsForUser_');
  assert(
    writeBody.includes('pruneStoredAssignmentRequests_('),
    '신청 저장 경로가 처리 완료 건을 줄이지 않습니다.',
  );
  assert(
    writeBody.includes('JSON.stringify(retained)'),
    '줄이기 전 배열을 그대로 저장하고 있습니다.',
  );
  const pruneBody = functionBody(requests, 'pruneStoredAssignmentRequests_');
  assert(
    pruneBody.includes('CENTRAL_ASSIGNMENT_REQUEST_STATUS.pending')
      && pruneBody.includes('maxProcessedRetained'),
    '대기 중 신청 보존과 처리 완료 상한이 없습니다.',
  );
  assert(
    /pending\.concat\(processed\)/.test(pruneBody),
    '대기 중 신청을 모두 남기지 않습니다.',
  );
});
test(42, '담당 신청 허용 계정 관문은 기본 꺼짐', () => {
  assert(
    /^\s*const teacherEmail = getRequiredActiveUserEmail_\(\);\s*requireAllowedTeacherEmail_\(teacherEmail\);/
      .test(functionBody(requests, 'submitMyAssignmentRequest')),
    '담당 신청에 허용 계정 검사가 없습니다.',
  );
  const guardBody = functionBody(requests, 'requireAllowedTeacherEmail_');
  assert(
    guardBody.includes('if (!allowed.length) return;'),
    '허용 목록이 비었을 때 통과시키지 않아 최초 설치가 막힙니다.',
  );
  assert(
    guardBody.includes('allowed.includes(normalized)')
      && guardBody.includes('allowed.includes(domain)'),
    '이메일 전체와 도메인 지정을 함께 받지 않습니다.',
  );
  assert(
    guardBody.includes("'TEACHER_NOT_ALLOWED'"),
    '허용되지 않은 계정에 대한 오류 코드가 없습니다.',
  );
});
test(43, '개인 설정 캐시는 사용자별 캐시', () => {
  const readBody = functionBody(code, 'readSettingsCached_');
  const clearBody = functionBody(code, 'clearAppCaches_');
  assert(
    readBody.includes('CacheService.getUserCache()')
      && !readBody.includes('CacheService.getScriptCache()'),
    '개인 설정을 전 사용자 공용 캐시에서 읽고 있습니다.',
  );
  assert(
    clearBody.includes('CacheService.getUserCache()')
      && !clearBody.includes('CacheService.getScriptCache()'),
    '개인 설정 캐시를 지우는 쪽이 다른 캐시를 보고 있습니다.',
  );
});

test(44, '중앙 기본 시트 정리는 기본 이름·빈 시트만 대상', () => {
  assert(
    functionBody(admin, 'initializeCentralDataSchema').includes('removeCentralDefaultSheet_('),
    '중앙 스키마 준비가 기본 시트를 정리하지 않습니다.',
  );
  const body = functionBody(admin, 'removeCentralDefaultSheet_');
  assert(
    body.includes('/^(?:시트|Sheet)\\s?1$/'),
    '기본 시트 이름 확인이 없어 관리자가 만든 빈 탭까지 지울 수 있습니다.',
  );
  assert(
    body.includes('sheet.getLastRow() === 0') && body.includes('sheet.getLastColumn() === 0'),
    '내용이 있는 시트를 지울 수 있습니다.',
  );
  assert(
    body.includes('spreadsheet.getSheets().length > 1'),
    '마지막 남은 시트까지 지울 수 있습니다.',
  );
});

test(45, '수강 그룹 상수와 신설 시트 머리글', () => {
  assert(
    code.includes("studentStatuses: Object.freeze(['재학', '위탁', '전학', '자퇴', '공동'])"),
    '학적상태에 공동이 없습니다.',
  );
  assert(
    code.includes("recordableStudentStatuses: Object.freeze(['재학', '공동'])"),
    '기록 가능 상태가 재학·공동이 아닙니다.',
  );
  assert(
    central.includes("groupSheetName: '수강그룹'")
      && central.includes("groupMemberSheetName: '수강그룹원'"),
    '신설 시트 이름 상수가 없습니다.',
  );
  assert(
    central.includes('CENTRAL_GROUP_HEADERS')
      && central.includes('CENTRAL_GROUP_MEMBER_HEADERS'),
    '신설 시트 머리글 상수가 없습니다.',
  );
  assert(
    central.includes("subject: '교과'") && central.includes("group: '그룹'"),
    '담당유형 상수가 없습니다.',
  );
});
test(46, '기존 중앙 시트 머리글은 그대로', () => {
  assert(
    central.includes("'학생키', '학년도', '학년', '반', '번호', '이름', '학적상태', '사용',"),
    '중앙 학생목록 머리글이 바뀌었습니다.',
  );
  assert(
    central.includes("'담당키', '교사이메일', '학년도', '학년', '반', '과목', '담당유형', '사용',"),
    '중앙 교사담당 머리글이 바뀌었습니다.',
  );
  assert(
    central.includes("'신청키', '교사이메일', '학년도', '학년', '반', '과목', '상태',"),
    '중앙 담당신청 머리글이 바뀌었습니다.',
  );
});

test(47, '신설 시트를 중앙 스키마 준비가 만든다', () => {
  const body = functionBody(admin, 'initializeCentralDataSchema');
  assert(
    body.includes('CENTRAL_CONFIG.groupSheetName')
      && body.includes('CENTRAL_CONFIG.groupMemberSheetName'),
    '중앙 스키마 준비가 수강그룹 시트를 만들지 않습니다.',
  );
  assert(
    body.includes('CENTRAL_GROUP_HEADERS')
      && body.includes('CENTRAL_GROUP_MEMBER_HEADERS'),
    '신설 시트 머리글을 지정하지 않습니다.',
  );
});
test(48, '그룹원 조회는 캐시를 쓰고 변경 시 비운다', () => {
  assert(
    functionBody(central, 'readCentralGroupRows_').includes('CacheService.getScriptCache()'),
    '그룹 조회에 캐시가 없습니다.',
  );
  assert(
    functionBody(central, 'clearCentralGroupCache_').includes('clearCentralReadCache_('),
    '그룹 캐시를 비우는 함수가 없습니다.',
  );
  const guard = functionBody(central, 'getRequiredCentralSheetByName_');
  assert(
    guard.includes('중앙 시트 점검·생성'),
    '신설 시트가 없는 기존 설치에 안내가 없습니다.',
  );
});

test(49, '그룹 담당은 그룹원 명단으로 판정', () => {
  const body = functionBody(central, 'centralStudentBelongsToAssignment_');
  assert(body.includes('centralAssignmentIsGroup_('), '담당유형 분기가 없습니다.');
  assert(
    body.includes('readCentralGroupMembersCached_('),
    '그룹 담당이 그룹원 명단을 보지 않습니다.',
  );
  assert(
    body.includes('student.classNumber') && body.includes('assignment.classNumber'),
    '학급 단위 판정이 사라졌습니다.',
  );
});
test(50, '그룹 담당 라벨과 중복 검사', () => {
  assert(
    functionBody(central, 'toPublicCentralAssignment_').includes('centralAssignmentIsGroup_('),
    '그룹 담당 라벨이 반 번호를 그대로 보여줍니다.',
  );
  const dup = functionBody(admin, 'isDuplicateTeacherAssignment_');
  assert(dup.includes('groupName'), '같은 학년·과목의 다른 그룹이 중복으로 막힙니다.');
  assert(
    dup.includes('classNumber'),
    '학급 단위 중복 검사에서 반 비교가 사라졌습니다.',
  );
});

test(51, '그룹 신청과 승인', () => {
  assert(
    functionBody(requests, 'submitMyAssignmentRequest').includes('normalizeAssignmentRequestType_('),
    '신청이 담당유형을 정규화하지 않습니다.',
  );
  const typeBody = functionBody(requests, 'normalizeAssignmentRequestType_');
  assert(
    typeBody.includes('CENTRAL_ASSIGNMENT_TYPES.group')
      && typeBody.includes('maxGroupNameLength'),
    '그룹명 검증이 없습니다.',
  );
  assert(
    typeBody.includes('CENTRAL_CONFIG.externalClassNumber'),
    '그룹 신청이 반 0으로 고정되지 않습니다.',
  );
  assert(
    functionBody(requests, 'reviewAssignmentRequests_').includes('upsertCentralGroupName_('),
    '승인이 수강그룹 행을 만들지 않습니다.',
  );
  assert(
    functionBody(requests, 'toPublicAssignmentRequest_').includes('groupName'),
    '신청 목록에 그룹명이 실리지 않아 관리자가 무엇을 승인하는지 알 수 없습니다.',
  );
});
test(52, '그룹 담당은 반 0을 허용하고 학급 담당은 막는다', () => {
  const body = functionBody(admin, 'normalizeTeacherAssignmentPayload_');
  assert(
    body.includes('CENTRAL_ASSIGNMENT_TYPES.group'),
    '담당 정규화가 그룹 유형을 모릅니다.',
  );
  assert(
    body.includes('classNumber < 1'),
    '학급 단위 담당의 반 검사가 사라졌습니다.',
  );
  assert(body.includes('groupName'), '담당 정규화가 그룹명을 다루지 않습니다.');
});

test(53, '편성 함수는 본인 그룹 담당만 허용', () => {
  ['getMyGroupRoster', 'saveMyGroupRoster'].forEach((name) => {
    assert(
      functionBody(groups, name).includes('requireMyGroupAssignment_('),
      `${name} 에 그룹 담당 검사가 없습니다.`,
    );
  });
  const guard = functionBody(groups, 'requireMyGroupAssignment_');
  assert(
    guard.includes('requireMyAssignment_(') && guard.includes('centralAssignmentIsGroup_('),
    '그룹 담당 검사가 담당 소유·유형을 모두 보지 않습니다.',
  );
});
test(54, '편성 후보는 사진을 싣지 않고 상한이 있다', () => {
  const body = functionBody(groups, 'getMyGroupRoster');
  assert(
    !body.includes('photoAvailable') && !body.includes('readCentralPhotoRowsCached_'),
    '편성 후보 응답에 사진 정보가 실립니다.',
  );
  assert(body.includes('maxGroupCandidates'), '편성 후보 상한이 없습니다.');
  const save = functionBody(groups, 'saveMyGroupRoster');
  assert(save.includes('maxGroupMembers'), '그룹원 상한이 없습니다.');
  assert(
    save.includes('STUDENT_FORBIDDEN'),
    '담당 학년 밖 학생을 그룹에 넣는 것을 막지 않습니다.',
  );
  assert(
    save.includes('withCentralWriteLock_('),
    '그룹원 교체가 쓰기 잠금 없이 이뤄집니다.',
  );
});

test(55, '타교생 추가는 반 0과 학적상태 공동으로 고정', () => {
  const body = functionBody(groups, 'addExternalStudentToMyGroup');
  assert(
    body.includes('requireMyGroupAssignment_('),
    '타교생 추가에 그룹 담당 검사가 없습니다.',
  );
  assert(
    body.includes('CENTRAL_CONFIG.externalClassNumber'),
    '타교생 반이 0으로 고정되지 않습니다.',
  );
  assert(body.includes("'공동'"), '타교생 학적상태가 공동으로 고정되지 않습니다.');
  assert(
    body.includes('EXTERNAL_STUDENT_NUMBER_TAKEN'),
    '번호 충돌 검사가 없습니다.',
  );
  assert(
    body.includes('assignment.grade') && body.includes('assignment.schoolYear'),
    '타교생 학년이 담당 학년으로 고정되지 않습니다.',
  );
});
test(56, '타교생 번호는 99부터 역순으로 배정', () => {
  const pick = functionBody(groups, 'nextExternalStudentNumber_');
  assert(
    pick.includes('externalStudentNumberStart') && pick.includes('-= 1'),
    '번호를 99부터 역순으로 배정하지 않습니다.',
  );
  const normalize = functionBody(admin, 'normalizeCentralStudentPayload_');
  assert(
    normalize.includes('externalClassNumber'),
    '학생 정규화가 타교생 반 0을 허용하지 않습니다.',
  );
  assert(
    normalize.includes('classNumber < 1'),
    '일반 학생의 반 검사가 사라졌습니다.',
  );
});

test(57, '신청 화면에 담당 유형 선택', () => {
  assert(html.includes('id="requestAssignmentType"'), '담당 유형 선택 요소가 없습니다.');
  assert(html.includes('id="requestGroupName"'), '그룹명 입력 요소가 없습니다.');
  const body = functionBody(html, 'submitAssignmentRequest');
  assert(
    body.includes('assignmentType:') && body.includes('groupName:'),
    '신청 payload 에 유형·그룹명이 없습니다.',
  );
});

test(58, '편성 화면은 버튼 이동을 기본 경로로 둔다', () => {
  assert(
    html.includes('id="groupCandidateList"') && html.includes('id="groupMemberList"'),
    '좌우 편성 목록이 없습니다.',
  );
  assert(
    html.includes('id="groupAddSelected"') && html.includes('id="groupRemoveSelected"'),
    '체크 이동 버튼이 없습니다. 드래그만으로는 키보드·터치 사용자가 편성할 수 없습니다.',
  );
  assert(
    html.includes('dragstart') && html.includes("addEventListener('drop'"),
    '드래그앤드롭 배선이 없습니다.',
  );
  ['getMyGroupRoster', 'saveMyGroupRoster', 'addExternalStudentToMyGroup'].forEach((name) => {
    assert(functionBody(groups, name), `서버 함수 없음: ${name}`);
    assert(html.includes(`${name}:()`), `클라이언트 호출 없음: ${name}`);
  });
});
test(59, '그룹 담당은 반 번호 대신 그룹명을 보여준다', () => {
  const body = functionBody(html, 'renderAssignmentPicker_');
  assert(
    body.includes('isGroup'),
    '수업 선택 화면이 그룹 담당을 0반으로 표시합니다.',
  );
  assert(
    !body.includes('groupRosterPanel'),
    '편성 화면이 아직 활동 기록 탭에 붙어 있습니다.',
  );
});
test(60, '편성 화면은 담당 신청 탭에 있다', () => {
  const requestPanel = html.slice(
    html.indexOf('data-personal-panel="request"'),
    html.indexOf('data-personal-panel="activity"'),
  );
  assert(
    requestPanel.includes('id="groupRosterPanel"'),
    '편성 화면이 담당 신청 탭 안에 없습니다.',
  );
  const body = functionBody(html, 'renderGroupRosterSection_');
  assert(body, 'renderGroupRosterSection_ 함수가 없습니다.');
  assert(
    body.includes('item.isGroup') && body.includes('loadGroupRoster_('),
    '승인된 수강 그룹을 골라 편성을 불러오지 않습니다.',
  );
  // 목록에 수강 그룹만 담아야 학급 단위 수업이 선택지에 끼지 않는다.
  assert(
    html.includes('id="groupSelect"') && body.includes("$('groupSelect').innerHTML = groups.map("),
    '편성할 수업을 고르는 드롭다운이 없습니다.',
  );
  assert(
    !body.includes('groups.length < 2'),
    '그룹이 하나면 선택 칸을 숨겨, 무엇을 편성하는지 알 수 없습니다.',
  );
});
test(69, '편성 목록에 전체 선택 체크박스가 있다', () => {
  assert(
    html.includes('id="groupCandidateSelectAll"') && html.includes('id="groupMemberSelectAll"'),
    '후보·그룹원 목록에 전체 선택이 없습니다.',
  );
  const body = functionBody(html, 'renderGroupRoster_');
  assert(
    body.includes("$('groupMemberSelectAll').checked = false"),
    '목록을 다시 그린 뒤에도 전체 선택이 켜진 채로 남습니다.',
  );
});
test(61, '편성 목록에 학년을 보여준다', () => {
  const body = functionBody(html, 'renderGroupRoster_');
  assert(
    body.includes('student.grade') && body.includes('학년'),
    '편성 목록이 학년 없이 반·번호만 보여 줍니다.',
  );
});
test(62, '관리자가 만든 수강 그룹도 이름을 저장한다', () => {
  ['saveTeacherAssignment', 'saveTeacherAssignmentsBatch'].forEach((name) => {
    const body = functionBody(admin, name);
    assert(
      body.includes('centralAssignmentIsGroup_') && body.includes('upsertCentralGroupName_('),
      `${name} 이 그룹명을 수강그룹 시트에 남기지 않아 '이름 없는 그룹'이 됩니다.`,
    );
  });
});

test(63, '담당 사용 여부 전환은 다른 항목을 다시 검증하지 않는다', () => {
  const body = functionBody(admin, 'setTeacherAssignmentActive');
  assert(
    !body.includes('saveTeacherAssignment('),
    '사용 여부 전환이 저장 함수를 거쳐, 이름이 빈 수강 그룹은 비활성화조차 막힙니다.',
  );
  assert(
    body.includes('current.rowNumber') && body.includes('clearCentralTeacherAssignmentCache_'),
    '사용 칸만 고쳐 쓰고 캐시를 비우는 처리가 없습니다.',
  );
});
test(64, '관리자 담당 수정이 수강 그룹 이름을 함께 보낸다', () => {
  const body = functionBody(html, 'editAssignment');
  assert(
    body.includes('item.isGroup') && body.includes('groupName'),
    '그룹 담당을 수정할 때 이름을 묻지 않아 저장이 거부됩니다.',
  );
});
test(65, '교사 담당 표는 교사별로 접어서 보여 준다', () => {
  assert(html.includes('data-admin-tab="assignments">교사 관리<'), '탭 이름이 교사 관리가 아닙니다.');
  const body = functionBody(html, 'renderTeacherAssignmentGroups_');
  assert(
    body.includes('data-teacher-toggle') && body.includes('data-teacher-rows'),
    '교사 줄을 눌러 펼치는 구조가 없습니다.',
  );
  assert(
    /data-teacher-rows="\$\{escapeHtml\(teacherEmail\)\}"/.test(body)
      && body.includes('class="hidden" data-teacher-rows'),
    '하위 수업 줄이 기본으로 접혀 있지 않습니다.',
  );
  assert(
    body.includes('a.isGroup') && body.includes('groupName'),
    '관리자 표가 수강 그룹을 0반으로만 보여 줍니다.',
  );
});

test(66, '신청 승인 화면이 그룹은 반 번호 대신 그룹명을 보여준다', () => {
  const body = functionBody(html, 'loadAssignments');
  assert(
    body.includes('request.target'),
    '관리자가 어느 수강 그룹을 승인하는지 모른 채 0반만 보고 승인하게 됩니다.',
  );
});
test(67, '입력 창에 취소 버튼이 있다', () => {
  const body = functionBody(html, 'showModal_');
  assert(
    /opts\.type === 'confirm' \|\| opts\.type === 'prompt'/.test(body),
    '입력 창을 Esc 로만 닫을 수 있습니다.',
  );
  assert(
    /close\(opts\.type === 'prompt' \? null : false\)/.test(body),
    '입력 창의 취소가 빈 값이 아니라 취소로 전달되지 않습니다.',
  );
});
test(68, '담당 삭제는 관리자 전용이며 그룹 자료까지 정리한다', () => {
  assertAdminGuardIn_('deleteTeacherAssignment');
  const body = functionBody(admin, 'deleteTeacherAssignment');
  assert(body.includes('sheet.deleteRow('), '담당 행을 실제로 지우지 않습니다.');
  assert(
    body.includes('deleteCentralGroupRowsByKey_('),
    '그룹 담당을 지워도 그룹명·편성 명단이 죽은 자료로 남습니다.',
  );
  const cleanup = functionBody(admin, 'deleteCentralGroupRowsByKey_');
  assert(
    cleanup.includes('getRequiredCentralGroupSheet_')
      && cleanup.includes('getRequiredCentralGroupMemberSheet_')
      && cleanup.includes('index -= 1'),
    '그룹·그룹원 시트를 아래에서 위로 지우지 않습니다.',
  );
  assert(html.includes('data-delete-assignment='), '삭제 버튼이 없습니다.');
  assert(
    html.includes('deleteTeacherAssignment:()'),
    '삭제 함수가 클라이언트 호출 목록에 없습니다.',
  );
  const client = functionBody(html, 'renderTeacherAssignmentGroups_');
  assert(client.includes('showConfirm('), '삭제 전 확인 없이 지웁니다.');
});

test(70, '새 학년도 시작 버튼과 정리 항목 체크박스가 있다', () => {
  assert(html.includes('id="startSchoolYearButton"'), '새 학년도 시작 버튼이 없습니다.');
  assert(
    html.includes('id="deactivatePreviousStudents"')
      && html.includes('id="deactivatePreviousAssignments"'),
    '정리 항목을 고르는 체크박스가 없습니다.',
  );
  assert(
    html.includes('getSchoolYearTransition:()')
      && html.includes('runSchoolYearTransition:()'),
    '새 학년도 함수가 클라이언트 호출 목록에 없습니다.',
  );
});

test(71, '새 학년도 정리는 확인을 받고 비활성화만 한다', () => {
  const client = functionBody(html, 'runSchoolYearTransition_');
  assert(client.includes('showConfirm('), '확인 없이 지난 학년도 자료를 정리합니다.');
  const server = functionBody(admin, 'deactivatePreviousCentralStudents_');
  assert(
    !server.includes('deleteRows(') && server.includes('deactivateCentralRows_('),
    '지난 학년도 학생을 비활성화하지 않고 통째로 지웁니다.',
  );
  assertAdminGuardIn_('getSchoolYearTransition');
  assertAdminGuardIn_('runSchoolYearTransition');
});

test(72, '학년도가 넘어가 담당이 끊긴 교사에게 이유를 알린다', () => {
  assert(html.includes('id="previousYearNotice"'), '안내 문구 자리가 없습니다.');
  const client = functionBody(html, 'renderPreviousYearNotice_');
  assert(
    client.includes('previousAssignmentCount > 0'),
    '지난 담당이 있었는지 보지 않고 안내를 띄웁니다.',
  );
  assert(
    functionBody(code, 'getPersonalCentralStatus').includes('countMyPreviousAssignments_'),
    '서버가 지난 담당 수를 내려 주지 않습니다.',
  );
});

test(73, '공동교육과정 학생 삭제는 편성 화면에서 교사가 할 수 있다', () => {
  assert(html.includes('id="groupRemoveExternal"'), '삭제 버튼이 없습니다.');
  assert(
    html.includes('removeExternalStudentFromMyGroup:()'),
    '삭제 함수가 클라이언트 호출 목록에 없습니다.',
  );
  const client = functionBody(html, 'removeExternalGroupStudents_');
  assert(client.includes('showConfirm('), '확인 없이 학생을 지웁니다.');
  assert(
    client.includes("student.status !== '공동'"),
    '화면에서 공동교육과정 학생인지 보지 않고 보냅니다.',
  );
});

test(74, '공동교육과정 학생 삭제는 범위를 서버에서 다시 잠근다', () => {
  const server = functionBody(groups, 'removeExternalStudentFromMyGroup');
  assert(
    server.includes('requireMyGroupAssignment_('),
    '내 수강 그룹인지 확인하지 않습니다.',
  );
  assert(
    server.includes("student.status !== '공동'")
      && server.includes('externalClassNumber'),
    '서버가 공동교육과정 학생인지 다시 확인하지 않습니다.',
  );
  assert(
    server.includes('centralStudentIsInOtherGroup_('),
    '다른 그룹에도 편성된 학생인지 확인하지 않습니다.',
  );
  assert(
    !server.includes('deleteRow('),
    '학생 행을 되돌릴 수 없게 지웁니다. 사용 열만 꺼야 합니다.',
  );
});

test(75, '개인 파일 시트를 보는 순서대로 놓는다', () => {
  const routing = fs.readFileSync(path.join(__dirname, 'PersonalRouting.gs'), 'utf8');
  const body = functionBody(routing, 'orderPersonalSheets_');
  assert(
    body.indexOf('recordSheetName') < body.indexOf('archivedRecordSheetName')
      && body.indexOf('archivedRecordSheetName') < body.indexOf('settingsSheetName')
      && body.indexOf('settingsSheetName') < body.indexOf('deletedRecordSheetName'),
    '활동기록·활동기록보관·설정·삭제기록 순서가 아닙니다.',
  );
  assert(
    functionBody(routing, 'ensurePersonalApplicationSchema_')
      .includes('orderPersonalSheets_('),
    '시트 정렬이 스키마 준비 과정에서 호출되지 않습니다.',
  );
});

test(76, '빈 CSV 양식과 내보내기가 같은 열을 쓴다', () => {
  assert(html.includes('id="rosterTemplateButton"'), '빈 양식 받기 버튼이 없습니다.');
  assert(
    html.includes('getCentralRosterCsvTemplate:()'),
    '양식 함수가 클라이언트 호출 목록에 없습니다.',
  );
  // 양식과 내보내기가 서로 다른 열을 쓰면 받아서 채운 파일이 업로드에서 막힌다.
  // 둘 다 같은 상수 하나에서만 나오게 해 어긋날 수 없게 한다.
  assert(
    functionBody(admin, 'getCentralRosterCsvTemplate').includes('CENTRAL_ROSTER_CSV_HEADERS')
      && functionBody(admin, 'exportCentralStudentCsv').includes('CENTRAL_ROSTER_CSV_HEADERS')
      && functionBody(fs.readFileSync(path.join(__dirname, 'SchoolSetup.gs'), 'utf8'),
        'parseAndValidateRosterCsv_').includes('ROSTER_CSV_HEADERS'),
    '양식·내보내기·가져오기가 같은 머리글 상수를 쓰지 않습니다.',
  );
  assertAdminGuardIn_('getCentralRosterCsvTemplate');
});

test(77, '내 담당 신청 내역이 그룹 신청을 0반으로 보여주지 않는다', () => {
  const body = functionBody(html, 'loadMyAssignmentRequests');
  assert(
    body.includes('request.target'),
    '수강 그룹 신청이 목록에서 0반으로 표시됩니다.',
  );
});

test(78, '신청 이력이 담당 삭제·비활성화 상태를 함께 확인한다', () => {
  const body = functionBody(requests, 'getMyAssignmentRequests');
  assert(
    body.includes('readCentralTeacherAssignmentsCached_(true)'),
    '신청 이력을 지금 살아 있는 담당과 대조하지 않습니다.',
  );
  const publicBody = functionBody(requests, 'toPublicAssignmentRequest_');
  assert(
    publicBody.includes('myAssignmentRequestCurrentState_'),
    '신청 이력 라벨이 삭제·비활성화 상태를 반영하지 않습니다.',
  );
});

test(79, '수강 그룹이 여러 학년을 함께 받을 수 있다', () => {
  assert(
    html.includes('id="requestGroupGradesField"')
      && html.includes('id="requestGroupGrades"'),
    '신청 화면에 추가 학년 입력칸이 없습니다.',
  );
  const submitBody = functionBody(html, 'submitAssignmentRequest');
  assert(
    submitBody.includes('additionalGrades'),
    '신청 화면이 추가 학년을 서버로 보내지 않습니다.',
  );
  const editBody = functionBody(html, 'editAssignment');
  assert(
    editBody.includes('additionalGrades'),
    '관리자 수정 화면이 추가 학년을 다루지 않습니다.',
  );
  assert(
    functionBody(requests, 'normalizeAssignmentRequestType_')
      .includes('normalizeCentralGroupGradeList_'),
    '신청 접수가 추가 학년을 검증하지 않습니다.',
  );
  assert(
    functionBody(admin, 'saveTeacherAssignment').includes('normalizeCentralGroupGradeList_'),
    '관리자 직접 수정이 추가 학년을 저장하지 않습니다.',
  );
});

test(80, '편성 후보가 담당의 모든 학년을 본다', () => {
  const body = functionBody(groups, 'centralGroupCandidateStudents_');
  assert(
    body.includes('centralAssignmentGrades_'),
    '편성 후보 조회가 여러 학년을 보지 않고 담당의 기본 학년만 봅니다.',
  );
});

test(81, '추가 학년 칸은 기존 4칸 수강그룹 시트 검증을 넓히지 않는다', () => {
  // CENTRAL_GROUP_HEADERS 가 5칸이 되면 이미 배포된 학교의 4칸짜리 수강그룹
  // 시트가 전부 CENTRAL_SCHEMA_INVALID 로 막힌다. 이 검사가 실패하면 그
  // 사고가 난 것이다.
  const match = central.match(/const CENTRAL_GROUP_HEADERS = Object\.freeze\(\[([^\]]*)\]/);
  assert(match, 'CENTRAL_GROUP_HEADERS 선언을 찾을 수 없습니다.');
  const count = match[1].split(',').map((item) => item.trim()).filter(Boolean).length;
  assert(count === 4, `CENTRAL_GROUP_HEADERS 가 ${count}칸입니다. 4칸이어야 기존 학교 시트가 계속 유효합니다.`);
});

test(82, '담당 신청 폼에 이름 입력 칸이 있다', () => {
  assert(html.includes('id="requestTeacherName"'), '이름 입력 칸이 없습니다.');
  assert(
    functionBody(html, 'submitAssignmentRequest').includes('requestTeacherName'),
    '신청 제출이 이름 입력값을 서버로 보내지 않습니다.',
  );
  assert(
    functionBody(requests, 'submitMyAssignmentRequest').includes('normalizeAssignmentRequestTeacherName_'),
    '서버가 이름을 검증하지 않습니다.',
  );
});

test(83, '관리자 신청 목록에 교사 이름이 표시된다', () => {
  assert(
    functionBody(html, 'loadAssignments').includes('request.teacherName'),
    '관리자 화면이 교사 이름을 표시하지 않습니다.',
  );
  assert(
    functionBody(requests, 'toPublicAssignmentRequest_').includes('teacherName'),
    '서버가 관리자 조회에 이름을 포함하지 않습니다.',
  );
});

test(84, '담당 신청 알림 켜고 끄기 함수에 관리자 권한 검사가 있다', () => {
  ['getAssignmentRequestNotifyPolicy', 'saveAssignmentRequestNotifyPolicy'].forEach((name) => {
    assert(
      /^\s*requireAdmin_\(\);/.test(functionBody(requests, name)),
      `${name} 함수 시작 부분에 requireAdmin_()가 없습니다.`,
    );
  });
});

test(85, '담당 신청 알림 켜고 끄기가 클라이언트 요청 표에 등록되어 있다', () => {
  assert(
    html.includes('getAssignmentRequestNotifyPolicy:() =>')
      && html.includes('saveAssignmentRequestNotifyPolicy:() =>'),
    '새 서버 함수가 callServer 요청 표에 없어 호출할 수 없습니다.',
  );
});

function assertAdminGuardIn_(name) {
  assert(
    /^\s*requireAdmin_\(\);/.test(functionBody(admin, name)),
    `${name} 함수 시작 부분에 requireAdmin_()가 없습니다.`,
  );
}

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
if (tests.length !== 85) {
  console.error(`FAIL expected 85 tests, got ${tests.length}`);
  process.exitCode = 1;
}
