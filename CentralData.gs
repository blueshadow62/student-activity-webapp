// © 2026 류기현(부산 동아공고). CC BY-NC-SA 4.0(저작자표시-비영리-동일조건변경허락).
// https://creativecommons.org/licenses/by-nc-sa/4.0/deed.ko
// 문의: https://github.com/blueshadow62/student-activity-webapp/issues

const CENTRAL_CONFIG = Object.freeze({
  databaseIdProperty: 'CENTRAL_DATABASE_FILE_ID',
  photoFolderIdProperty: 'CENTRAL_PHOTO_FOLDER_ID',
  adminEmailsProperty: 'ADMIN_EMAILS',
  staffGroupEmailProperty: 'STAFF_GROUP_EMAIL',
  schemaVersionProperty: 'CENTRAL_SCHEMA_VERSION',
  legacyDatabaseIdProperty: 'STUDENT_ACTIVITY_DATABASE_SPREADSHEET_ID',
  schemaVersion: '5',
  studentSheetName: '학생목록',
  legacyStudentSheetName: '데이터베이스',
  photoSheetName: '사진정보',
  legacyPhotoSheetName: '학생사진',
  teacherAssignmentSheetName: '교사담당',
  assignmentRequestSheetName: '담당신청',
  groupSheetName: '수강그룹',
  groupMemberSheetName: '수강그룹원',
  appSettingsSheetName: '앱설정',
  subjectCatalogSheetName: '과목목록',
  achievementStandardSheetName: '성취기준',
  maxAssignmentsPerUser: 30,
  maxClassNumbersPerBatch: 20,
  maxStudentResults: 50,
  maxPhotoBatchSize: 6,
  maxPhotoResponseChars: 900000,
  maxPhotoBytes: 512 * 1024,
  maxGroupCandidates: 400,
  maxGroupMembers: 100,
  maxGroupNameLength: 50,
  externalClassNumber: 0,
  externalStudentNumberStart: 99,
  maxCsvLength: 2 * 1024 * 1024,
  cacheSeconds: 300,
  photoCacheSeconds: 6 * 60 * 60,
  lockTimeoutMs: 30000,
});

const CENTRAL_STUDENT_HEADERS = Object.freeze([
  '학생키', '학년도', '학년', '반', '번호', '이름', '학적상태', '사용',
  '생성일시', '수정일시',
]);
const CENTRAL_LEGACY_STUDENT_HEADERS = Object.freeze([
  '학년', '반', '번호', '이름', '학적상태', '학생ID', '학년도',
]);
const CENTRAL_PHOTO_HEADERS = Object.freeze([
  '학생ID', '학년도', '사진키', '사진파일ID', '파일명', 'MIME유형',
  '파일수정일시', '동기화일시',
]);
const CENTRAL_TEACHER_ASSIGNMENT_HEADERS = Object.freeze([
  '담당키', '교사이메일', '학년도', '학년', '반', '과목', '담당유형', '사용',
  '생성일시', '수정일시', '교육과정', '과목키',
]);
const CENTRAL_ASSIGNMENT_REQUEST_HEADERS = Object.freeze([
  '신청키', '교사이메일', '학년도', '학년', '반', '과목', '상태',
  '신청일시', '처리일시', '처리자', '처리사유', '담당키', '교육과정', '과목키',
]);
const CENTRAL_GROUP_HEADERS = Object.freeze([
  '담당키', '그룹명', '생성일시', '수정일시',
]);
const CENTRAL_GROUP_MEMBER_HEADERS = Object.freeze([
  '담당키', '학생키', '추가일시',
]);
// 담당유형은 기존 교사담당 시트에 이미 있는 열이다. 지금까지 '교과' 하나만
// 쓰였고, 고교학점제 수강 그룹이 두 번째 값이 된다.
const CENTRAL_ASSIGNMENT_TYPES = Object.freeze({
  subject: '교과',
  group: '그룹',
});
const CENTRAL_APP_SETTING_HEADERS = Object.freeze(['항목', '값', '수정일시']);
const CENTRAL_SUBJECT_CATALOG_HEADERS = Object.freeze([
  '과목명', '축약코드', '학교급', '계열', '과목구분',
  '교육과정', '과목키',
]);
const CENTRAL_ACHIEVEMENT_STANDARD_HEADERS = Object.freeze([
  '코드', '과목명', '영역', '내용', '학교급', '계열',
  '교육과정', '과목키', '성취기준키',
]);
const SCHOOL_LEVELS = Object.freeze({
  elementary: '초등학교',
  middle: '중학교',
  high: '고등학교',
});
const CENTRAL_ROSTER_CSV_HEADERS = Object.freeze([
  '학년', '반', '번호', '이름', '학적상태',
]);
const CENTRAL_ALLOWED_PHOTO_MIME_TYPES = Object.freeze([
  'image/jpeg', 'image/png', 'image/webp',
]);

function normalizeSchoolLevel_(value, required) {
  const schoolLevel = String(value || '').trim().toLowerCase();
  if (!schoolLevel && !required) return '';
  if (!Object.prototype.hasOwnProperty.call(SCHOOL_LEVELS, schoolLevel)) {
    throw new Error('학교급을 초등학교, 중학교, 고등학교 중에서 선택해 주세요.');
  }
  return schoolLevel;
}

function schoolLevelLabel_(value) {
  const schoolLevel = normalizeSchoolLevel_(value, false);
  return schoolLevel ? SCHOOL_LEVELS[schoolLevel] : '';
}

// 고교는 2025 입학생부터 2022 개정 교육과정을 적용한다. 초·중학교는 현재
// 번들이 2022만 제공되므로 기존 동작을 그대로 유지한다.
function resolveCurriculumRevision_(schoolYear, grade, schoolLevel, value) {
  const explicit = String(value || '').trim();
  if (explicit === '2015' || explicit === '2022') return explicit;
  const normalizedLevel = normalizeSchoolLevel_(schoolLevel, false)
    || getConfiguredSchoolLevel_();
  if (normalizedLevel !== 'high') return '2022';
  return Number(schoolYear) - Number(grade) + 1 >= 2025 ? '2022' : '2015';
}

function curriculumRevisionLabel_(value) {
  return resolveCurriculumRevision_(0, 0, '', value) + ' 개정';
}

function curriculumSubjectKey_(revision, schoolLevel, track, subject) {
  return [revision, schoolLevel, track, subject].map(function (item) {
    return String(item || '').trim();
  }).join('|');
}

function normalizeAssignmentSubjectKey_(subject, curriculumRevision, value) {
  const provided = String(value || '').trim();
  const schoolLevel = getConfiguredSchoolLevel_();
  if (!schoolLevel) return provided;
  const candidates = getSubjectCatalogForSchoolLevel_(schoolLevel).filter(function (item) {
    return item.name === subject && item.curriculumRevision === curriculumRevision;
  });
  if (!provided) return candidates.length === 1 ? candidates[0].subjectKey : '';
  if (!candidates.some(function (item) { return item.subjectKey === provided; })) {
    throw new Error('선택한 교육과정의 과목을 다시 확인해 주세요.');
  }
  return provided;
}

let configuredSchoolLevelMemo_ = null;

function getConfiguredSchoolLevel_() {
  if (configuredSchoolLevelMemo_ !== null) return configuredSchoolLevelMemo_;
  try {
    if (
      !PropertiesService
        || typeof PropertiesService.getScriptProperties !== 'function'
    ) {
      configuredSchoolLevelMemo_ = '';
      return configuredSchoolLevelMemo_;
    }
    configuredSchoolLevelMemo_ = normalizeSchoolLevel_(
      PropertiesService.getScriptProperties().getProperty('SCHOOL_LEVEL'),
      false
    );
    return configuredSchoolLevelMemo_;
  } catch (error) {
    // 학교급 설정을 읽지 못해도 기존 1~3학년 기능은 계속 동작해야 한다.
    configuredSchoolLevelMemo_ = '';
    return configuredSchoolLevelMemo_;
  }
}

function setConfiguredSchoolLevelMemo_(value) {
  configuredSchoolLevelMemo_ = normalizeSchoolLevel_(value, false);
}

function getAllowedGrades_() {
  return getConfiguredSchoolLevel_() === 'elementary'
    ? [1, 2, 3, 4, 5, 6]
    : APP_CONFIG.allowedGrades.slice();
}

// 과목 목록은 이제 관리자가 올린 JSON으로 중앙 '과목목록' 시트를 채운다.
// 이 함수 이름은 예전 번들 시절 이름을 그대로 쓰지만(호출부가 많아 유지),
// 읽는 곳은 시트다. 설치 전이거나 승인 전 교사처럼 중앙 자료에 접근할 수
// 없는 상태에서도 부팅 자체는 실패하면 안 되므로 실패 시 빈 배열로 넘어간다.
let bundledSubjectCatalogMemo_ = null;

function readBundledSubjectCatalog_() {
  if (bundledSubjectCatalogMemo_ !== null) return bundledSubjectCatalogMemo_;
  try {
    const sheet = getCentralDatabase_().getSheetByName(
      CENTRAL_CONFIG.subjectCatalogSheetName
    );
    if (!sheet || sheet.getLastRow() < 2) {
      bundledSubjectCatalogMemo_ = [];
      return bundledSubjectCatalogMemo_;
    }
    const rows = sheet.getRange(
      2, 1, sheet.getLastRow() - 1, CENTRAL_SUBJECT_CATALOG_HEADERS.length
    ).getValues();
    bundledSubjectCatalogMemo_ = rows.map(function (row) {
      return {
        name: String(row[0] || '').trim(),
        abbreviation: String(row[1] || '').trim(),
        schoolLevel: String(row[2] || '').trim(),
        track: String(row[3] || '').trim(),
        category: String(row[4] || '').trim(),
        curriculumRevision: String(row[5] || '').trim(),
        subjectKey: String(row[6] || '').trim(),
      };
    }).filter(function (item) { return Boolean(item.name); });
  } catch (error) {
    bundledSubjectCatalogMemo_ = [];
  }
  return bundledSubjectCatalogMemo_;
}

function getSubjectCatalogForSchoolLevel_(schoolLevel) {
  const normalized = normalizeSchoolLevel_(schoolLevel, false);
  if (!normalized) return [];
  var result = readBundledSubjectCatalog_().filter(function (item) {
    return String(item && item.schoolLevel || '').trim() === normalized;
  }).map(function (item) {
    return {
      name: String(item.name || '').trim(),
      abbreviation: String(item.abbreviation || '').trim(),
      track: String(item.track || '').trim(),
      category: String(item.category || '').trim(),
      curriculumRevision: String(item.curriculumRevision || '2022').trim(),
      subjectKey: String(item.subjectKey || '').trim(),
    };
  }).filter(function (item) { return Boolean(item.name); });
  if (result.length > 0) {
    try {
      CacheService.getScriptCache().put(
        'subjectCatalog_' + normalized, JSON.stringify(result), 21600
      );
    } catch (_) {}
  }
  return result;
}

function getSubjectCatalogCached() {
  var schoolLevel = getConfiguredSchoolLevel_();
  if (!schoolLevel) return [];
  try {
    var cached = CacheService.getScriptCache().get('subjectCatalog_' + schoolLevel);
    if (cached) return JSON.parse(cached);
  } catch (_) {}
  return [];
}

function getSubjectCatalog() {
  const schoolLevel = getConfiguredSchoolLevel_();
  return {
    schoolLevel: schoolLevel,
    schoolLevelLabel: schoolLevelLabel_(schoolLevel),
    subjects: getSubjectCatalogForSchoolLevel_(schoolLevel),
  };
}

function getRequiredActiveUserEmail_() {
  const email = normalizeCentralEmail_(
    Session.getActiveUser().getEmail()
  );
  if (!email) {
    throw createCentralError_(
      'LOGIN_REQUIRED',
      '로그인 계정을 확인할 수 없습니다.'
    );
  }
  return email;
}

function getCurrentUserRole_() {
  const email = getRequiredActiveUserEmail_();
  return isAdminEmail_(email) ? 'ADMIN' : 'USER';
}

function isAdminEmail_(email) {
  const normalized = normalizeCentralEmail_(email);
  if (!normalized) return false;
  return getCentralConfiguration_().adminEmails.includes(normalized);
}

function requireAdmin_() {
  const email = getRequiredActiveUserEmail_();
  if (!isAdminEmail_(email)) {
    throw createCentralError_(
      'ADMIN_REQUIRED',
      '관리자 권한이 필요한 작업입니다.'
    );
  }
  return {
    email: email,
    role: 'ADMIN',
  };
}

// getProperty 는 부를 때마다 왕복한다. 여기서만 여섯 번을 부르고 이 함수 자체가
// 요청마다 여러 번 불리므로, 한 번에 전부 받아 온다. 저장된 값을 그때그때 읽는
// 것은 그대로라 설치·초기화 중에 값이 바뀌어도 다음 호출이 새 값을 본다.
function getCentralConfiguration_() {
  const properties = PropertiesService.getScriptProperties().getProperties();
  const databaseId = String(
    properties[CENTRAL_CONFIG.databaseIdProperty]
      || properties[CENTRAL_CONFIG.legacyDatabaseIdProperty]
      || ''
  ).trim();
  const photoFolderId = String(
    properties[CENTRAL_CONFIG.photoFolderIdProperty] || ''
  ).trim();
  const adminEmails = parseCentralEmailList_(
    properties[CENTRAL_CONFIG.adminEmailsProperty]
  );
  return {
    databaseId: databaseId,
    photoFolderId: photoFolderId,
    adminEmails: adminEmails,
    staffGroupConfigured: Boolean(
      normalizeCentralEmail_(
        properties[CENTRAL_CONFIG.staffGroupEmailProperty]
      )
    ),
    schemaVersion: String(
      properties[CENTRAL_CONFIG.schemaVersionProperty]
        || CENTRAL_CONFIG.schemaVersion
    ).trim(),
  };
}

function parseCentralEmailList_(value) {
  return Array.from(new Set(
    String(value || '')
      .split(/[\s,;]+/)
      .map(normalizeCentralEmail_)
      .filter(Boolean)
  ));
}

function normalizeCentralEmail_(value) {
  return String(value || '').trim().toLowerCase();
}

function isValidCentralEmail_(value) {
  const email = normalizeCentralEmail_(value);
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
}

function isValidCentralDriveId_(value) {
  return /^[A-Za-z0-9_-]{10,}$/.test(String(value || '').trim());
}

// 시트 하나를 얻을 때마다 이 함수가 불려서, 한 요청에서 파일을 열 번 넘게 다시
// 여는 일이 있었다. 한 실행 안에서는 기억해 두고 다시 쓴다. 파일 ID를 열쇠로
// 삼았으므로 관리자가 중앙 자료를 바꾸면 저절로 다시 연다.
let centralDatabaseMemo_ = null;

function getCentralDatabase_(configuration) {
  const config = configuration || getCentralConfiguration_();
  if (!isValidCentralDriveId_(config.databaseId)) {
    throw createCentralError_(
      'CENTRAL_DATABASE_NOT_CONFIGURED',
      '관리자 중앙 데이터베이스가 설정되지 않았습니다.'
    );
  }
  if (centralDatabaseMemo_ && centralDatabaseMemo_.id === config.databaseId) {
    return centralDatabaseMemo_.spreadsheet;
  }
  try {
    const spreadsheet = SpreadsheetApp.openById(config.databaseId);
    centralDatabaseMemo_ = { id: config.databaseId, spreadsheet: spreadsheet };
    return spreadsheet;
  } catch (error) {
    throw createCentralError_(
      'CENTRAL_DATABASE_ACCESS_DENIED',
      centralSharedAccessMessage_()
    );
  }
}

function getCentralPhotoFolder_(configuration) {
  const config = configuration || getCentralConfiguration_();
  if (!isValidCentralDriveId_(config.photoFolderId)) {
    throw createCentralError_(
      'CENTRAL_PHOTO_FOLDER_NOT_CONFIGURED',
      '관리자 중앙 사진 폴더가 설정되지 않았습니다.'
    );
  }
  try {
    const folder = DriveApp.getFolderById(config.photoFolderId);
    if (folder.isTrashed()) {
      throw new Error('TRASHED');
    }
    return folder;
  } catch (error) {
    throw createCentralError_(
      'CENTRAL_PHOTO_FOLDER_ACCESS_DENIED',
      centralSharedAccessMessage_()
    );
  }
}

function centralSharedAccessMessage_() {
  return '학교 공통 학생 자료에 접근할 권한이 없습니다. '
    + '관리자에게 중앙 자료 공유 및 접근 권한을 확인해 달라고 요청하세요.';
}

// 승인된 교사에게만 개별 보기 권한을 부여한다. 링크 전체 공개나 편집 권한은
// 부여하지 않는다.
function grantCentralAccessToTeachers_(teacherEmails) {
  if (!teacherEmails.length) return;
  const config = getCentralConfiguration_();
  const spreadsheet = getCentralDatabase_(config);
  const folder = getCentralPhotoFolder_(config);
  const failures = [];
  teacherEmails.forEach(function (email) {
    try {
      addCentralViewerQuietly_(spreadsheet, email);
    } catch (error) {
      failures.push(`${email}: 중앙 데이터베이스 공유 실패`);
    }
    try {
      addCentralViewerQuietly_(folder, email);
    } catch (error) {
      failures.push(`${email}: 중앙 사진 폴더 공유 실패`);
    }
  });
  if (failures.length) {
    throw createCentralError_(
      'CENTRAL_SHARE_FAILED',
      `중앙 자료 공유에 실패해 담당 승인을 완료하지 않았습니다: ${failures.join(', ')}`
    );
  }
}

// 개별 보기 권한을 주되 Drive 기본 공유 알림 메일은 보내지 않는다.
// 앱이 이미 승인 안내 메일을 보내므로 중복이고, Drive 알림의 '열기' 버튼은
// 교사를 앱 대신 원본 폴더로 보내 담당 학급 필터를 우회하게 만든다.
// DriveApp 기본 공유에는 알림을 끄는 옵션이 없어 Drive 고급 서비스를 쓴다.
function addCentralViewerQuietly_(resource, email) {
  try {
    Drive.Permissions.create(
      { role: 'reader', type: 'user', emailAddress: email },
      resource.getId(),
      { sendNotificationEmail: false }
    );
    return;
  } catch (error) {
    // ponytail: 고급 Drive 서비스를 쓸 수 없는 프로젝트에서는 알림 메일을
    // 감수하고 DriveApp으로 되돌아간다. 알림보다 승인 실패가 더 나쁘다.
    // 이 경로를 계속 타면 매니페스트의 enabledAdvancedServices를 확인한다.
  }
  resource.addViewer(email);
}

// 해지된 교사의 중앙 자료 개별 보기 권한만 제거한다. 다른 교사의 담당·권한과
// 신청·승인 이력, 개인 기록은 건드리지 않는다.
function revokeCentralAccessFromTeacher_(teacherEmail) {
  const config = getCentralConfiguration_();
  const spreadsheet = getCentralDatabase_(config);
  const folder = getCentralPhotoFolder_(config);
  try {
    spreadsheet.removeViewer(teacherEmail);
  } catch (error) {
    // 제거 호출 결과와 실제 권한 상태가 다를 수 있어 아래에서 다시 확인한다.
  }
  try {
    folder.removeViewer(teacherEmail);
  } catch (error) {
    // 제거 호출 결과와 실제 권한 상태가 다를 수 있어 아래에서 다시 확인한다.
  }
  const spreadsheetAccess = getCentralResourceAccessState_(
    spreadsheet,
    teacherEmail
  );
  const photoFolderAccess = getCentralResourceAccessState_(
    folder,
    teacherEmail
  );
  const spreadsheetRevoked = isCentralResourceAccessRevoked_(
    spreadsheetAccess
  );
  const photoFolderRevoked = isCentralResourceAccessRevoked_(
    photoFolderAccess
  );
  const failureDetails = [];
  appendCentralAccessFailureDetail_(
    failureDetails,
    '중앙 데이터베이스',
    spreadsheetAccess
  );
  appendCentralAccessFailureDetail_(
    failureDetails,
    '중앙 사진 폴더',
    photoFolderAccess
  );
  return {
    spreadsheetRevoked: spreadsheetRevoked,
    photoFolderRevoked: photoFolderRevoked,
    accessRevoked: spreadsheetRevoked && photoFolderRevoked,
    failureDetails: failureDetails,
    warning: centralSharingBreadthWarning_(config),
  };
}

function getCentralResourceAccessState_(resource, teacherEmail) {
  try {
    const owner = resource.getOwner();
    const ownerEmail = owner
      ? normalizeCentralEmail_(owner.getEmail()) : '';
    const editors = resource.getEditors().map(function (user) {
      return normalizeCentralEmail_(user.getEmail());
    });
    const viewers = resource.getViewers().map(function (user) {
      return normalizeCentralEmail_(user.getEmail());
    });
    return {
      verified: true,
      viewerRemaining: viewers.includes(teacherEmail),
      elevatedAccessRemaining:
        ownerEmail === teacherEmail || editors.includes(teacherEmail),
    };
  } catch (error) {
    return {
      verified: false,
      viewerRemaining: false,
      elevatedAccessRemaining: false,
    };
  }
}

function isCentralResourceAccessRevoked_(access) {
  return access.verified
    && !access.viewerRemaining
    && !access.elevatedAccessRemaining;
}

function appendCentralAccessFailureDetail_(details, resourceName, access) {
  if (!access.verified) {
    details.push(`${resourceName} 권한 상태를 확인하지 못했습니다.`);
    return;
  }
  if (access.elevatedAccessRemaining) {
    details.push(
      `${resourceName}에 소유자 또는 편집자 권한이 남아 있습니다.`
    );
  } else if (access.viewerRemaining) {
    details.push(`${resourceName} 보기 권한이 남아 있습니다.`);
  }
}

// 메일 발송 실패가 승인·거부·해지 처리 자체를 막지 않도록 항상 흡수한다.
function notifyTeacherByEmail_(teacherEmail, subject, body) {
  if (!isValidCentralEmail_(teacherEmail)) return;
  try {
    MailApp.sendEmail(teacherEmail, subject, body);
  } catch (error) {
    // 메일 발송 실패는 별도로 재시도하지 않고 조용히 넘어간다.
  }
}

// 링크·그룹·도메인 단위 공유가 남아 있으면 개별 해지만으로는 접근을 완전히
// 막지 못할 수 있으므로 관리자에게 경고 문구를 반환한다.
function centralSharingBreadthWarning_(config) {
  try {
    const spreadsheetAccess = DriveApp.getFileById(config.databaseId).getSharingAccess();
    const folderAccess = DriveApp.getFolderById(config.photoFolderId).getSharingAccess();
    const broad = [spreadsheetAccess, folderAccess].some(function (access) {
      return access !== DriveApp.Access.PRIVATE;
    });
    return broad
      ? '중앙 자료가 링크 또는 그룹·도메인 공유로 열려 있어 개별 해지만으로는 '
        + '완전히 차단되지 않을 수 있습니다. Drive 공유 설정을 확인해 주세요.'
      : '';
  } catch (error) {
    return '';
  }
}

function getCentralConnectionState_(includeCounts) {
  return getCentralConnectionContext_(includeCounts).state;
}

function getCentralConnectionContext_(includeCounts) {
  const config = getCentralConfiguration_();
  const state = {
    ready: false,
    database: {
      configured: isValidCentralDriveId_(config.databaseId),
      accessible: false,
      schemaReady: false,
      schemaDetails: null,
      status: 'NOT_READY',
    },
    photoFolder: {
      configured: isValidCentralDriveId_(config.photoFolderId),
      accessible: false,
      status: 'NOT_READY',
    },
    adminConfigured: config.adminEmails.length > 0,
    staffGroupConfigured: config.staffGroupConfigured,
    schemaVersion: config.schemaVersion || CENTRAL_CONFIG.schemaVersion,
    counts: {
      students: 0,
      photos: 0,
      assignments: 0,
      subjects: 0,
      standards: 0,
    },
    message: '',
  };

  let spreadsheet = null;
  let schema = null;
  try {
    spreadsheet = getCentralDatabase_(config);
    state.database.accessible = true;
    schema = inspectCentralSchema_(spreadsheet);
    state.database.schemaReady = schema.ready;
    state.database.schemaDetails = schema;
    state.database.status = schema.ready ? 'READY' : 'SCHEMA_REQUIRED';
    if (includeCounts) {
      state.counts.students = schema.studentSheet
        ? readCentralStudents_(schema.studentSheet, true).length
        : 0;
      state.counts.photos = schema.photoSheet
        ? readCentralPhotoRows_(schema.photoSheet).size
        : 0;
      state.counts.assignments = schema.assignmentSheet
        ? readCentralTeacherAssignments_(schema.assignmentSheet, true).length
        : 0;
      state.counts.subjects = schema.subjectCatalogSheet
        ? Math.max(schema.subjectCatalogSheet.getLastRow() - 1, 0)
        : 0;
      state.counts.standards = schema.achievementStandardSheet
        ? Math.max(schema.achievementStandardSheet.getLastRow() - 1, 0)
        : 0;
    }
  } catch (error) {
    state.database.status = centralErrorCode_(error);
  }

  try {
    getCentralPhotoFolder_(config);
    state.photoFolder.accessible = true;
    state.photoFolder.status = 'READY';
  } catch (error) {
    state.photoFolder.status = centralErrorCode_(error);
  }

  state.ready = Boolean(
    state.database.accessible
      && state.database.schemaReady
      && state.photoFolder.accessible
      && state.adminConfigured
  );
  state.message = state.ready
    ? '학교 공통 학생·사진 자료가 준비되었습니다.'
    : centralConnectionStatusMessage_(state);
  return {
    state: state,
    schema: schema,
  };
}

function centralConnectionStatusMessage_(state) {
  if (!state.adminConfigured) {
    return '관리자 계정 목록이 설정되지 않았습니다.';
  }
  if (!state.database.configured) {
    return '관리자 중앙 데이터베이스가 설정되지 않았습니다.';
  }
  if (!state.database.accessible) {
    return centralSharedAccessMessage_();
  }
  if (!state.database.schemaReady) {
    return centralSchemaMissingMessage_(state.database.schemaDetails);
  }
  if (!state.photoFolder.configured) {
    return '관리자 중앙 사진 폴더가 설정되지 않았습니다.';
  }
  if (!state.photoFolder.accessible) {
    return centralSharedAccessMessage_();
  }
  return '학교 공통 자료 연결 상태를 확인해 주세요.';
}

function centralSchemaMissingMessage_(schema) {
  if (!schema) {
    return '중앙 시트 점검·생성을 눌러 주세요.';
  }
  const missing = [];
  if (!schema.studentReady) missing.push(CENTRAL_CONFIG.studentSheetName);
  if (!schema.photoReady) missing.push(CENTRAL_CONFIG.photoSheetName);
  if (!schema.assignmentReady) missing.push(CENTRAL_CONFIG.teacherAssignmentSheetName);
  if (!schema.assignmentRequestReady) missing.push(CENTRAL_CONFIG.assignmentRequestSheetName);
  if (!schema.appSettingsReady) missing.push(CENTRAL_CONFIG.appSettingsSheetName);
  if (!schema.subjectCatalogReady) missing.push(CENTRAL_CONFIG.subjectCatalogSheetName);
  if (!schema.achievementStandardReady) missing.push(CENTRAL_CONFIG.achievementStandardSheetName);
  return missing.length
    ? `중앙 시트 점검·생성을 눌러 주세요. (${missing.join(', ')} 시트 필요)`
    : '중앙 시트 점검·생성을 눌러 주세요.';
}

function inspectCentralSchema_(spreadsheet) {
  const schoolLevel = getConfiguredSchoolLevel_();
  const studentSheet = getCentralStudentSheet_(spreadsheet, false);
  const photoSheet = getCentralPhotoSheet_(spreadsheet, false);
  const assignmentSheet = spreadsheet.getSheetByName(
    CENTRAL_CONFIG.teacherAssignmentSheetName
  );
  const assignmentRequestSheet = spreadsheet.getSheetByName(
    CENTRAL_CONFIG.assignmentRequestSheetName
  );
  const appSettingsSheet = spreadsheet.getSheetByName(
    CENTRAL_CONFIG.appSettingsSheetName
  );
  const subjectCatalogSheet = spreadsheet.getSheetByName(
    CENTRAL_CONFIG.subjectCatalogSheetName
  );
  const achievementStandardSheet = spreadsheet.getSheetByName(
    CENTRAL_CONFIG.achievementStandardSheetName
  );
  const studentReady = Boolean(
    studentSheet && isSupportedCentralStudentSheet_(studentSheet)
  );
  const photoReady = Boolean(
    photoSheet
      && centralHeadersMatch_(photoSheet, CENTRAL_PHOTO_HEADERS)
  );
  const assignmentReady = Boolean(
    assignmentSheet
      && centralHeadersMatch_(
        assignmentSheet,
        CENTRAL_TEACHER_ASSIGNMENT_HEADERS
      )
  );
  const assignmentRequestReady = Boolean(
    assignmentRequestSheet
      && centralHeadersMatch_(
        assignmentRequestSheet,
        CENTRAL_ASSIGNMENT_REQUEST_HEADERS
      )
  );
  const appSettingsReady = Boolean(
    appSettingsSheet
      && centralHeadersMatch_(
        appSettingsSheet,
        CENTRAL_APP_SETTING_HEADERS
      )
  );
  const subjectCatalogReady = Boolean(
    subjectCatalogSheet
      && centralHeadersMatch_(
        subjectCatalogSheet,
        CENTRAL_SUBJECT_CATALOG_HEADERS
      )
      && subjectCatalogSheet.getLastRow() > 1
  );
  const achievementStandardReady = Boolean(
    achievementStandardSheet
      && centralHeadersMatch_(
        achievementStandardSheet,
        CENTRAL_ACHIEVEMENT_STANDARD_HEADERS
      )
      && achievementStandardSheet.getLastRow() > 1
  );
  // SCHOOL_LEVEL이 없는 기존 설치는 새 기능을 사용하지 않을 뿐 기존 중앙
  // 기능은 계속 준비 상태여야 한다. 학교급을 정한 뒤부터 두 시트를 요구한다.
  const standardsReady = !schoolLevel
    || (subjectCatalogReady && achievementStandardReady);
  return {
    ready: studentReady
      && photoReady
      && assignmentReady
      && assignmentRequestReady
      && appSettingsReady
      && standardsReady,
    studentReady: studentReady,
    photoReady: photoReady,
    assignmentReady: assignmentReady,
    assignmentRequestReady: assignmentRequestReady,
    appSettingsReady: appSettingsReady,
    subjectCatalogReady: subjectCatalogReady,
    achievementStandardReady: achievementStandardReady,
    standardsReady: standardsReady,
    studentSheet: studentSheet,
    photoSheet: photoSheet,
    assignmentSheet: assignmentSheet,
    assignmentRequestSheet: assignmentRequestSheet,
    appSettingsSheet: appSettingsSheet,
    subjectCatalogSheet: subjectCatalogSheet,
    achievementStandardSheet: achievementStandardSheet,
  };
}

function getCentralStudentSheet_(spreadsheet, createIfMissing) {
  const canonical = spreadsheet.getSheetByName(
    CENTRAL_CONFIG.studentSheetName
  );
  if (canonical) return canonical;
  const legacy = spreadsheet.getSheetByName(
    CENTRAL_CONFIG.legacyStudentSheetName
  );
  if (legacy) return legacy;
  if (!createIfMissing) return null;
  const sheet = spreadsheet.insertSheet(CENTRAL_CONFIG.studentSheetName);
  initializeCentralSheet_(
    sheet,
    CENTRAL_STUDENT_HEADERS,
    '#1a73e8'
  );
  return sheet;
}

function getRequiredCentralStudentSheet_() {
  const spreadsheet = getCentralDatabase_();
  const sheet = getCentralStudentSheet_(spreadsheet, false);
  if (!sheet || !isSupportedCentralStudentSheet_(sheet)) {
    throw createCentralError_(
      'CENTRAL_SCHEMA_INVALID',
      '중앙 학생목록 시트의 머리글을 확인해 주세요.'
    );
  }
  return sheet;
}

function getRequiredCentralPhotoSheet_() {
  const sheet = getCentralPhotoSheet_(getCentralDatabase_(), false);
  if (!sheet || !centralHeadersMatch_(sheet, CENTRAL_PHOTO_HEADERS)) {
    throw createCentralError_(
      'CENTRAL_SCHEMA_INVALID',
      '중앙 사진정보 시트의 머리글을 확인해 주세요.'
    );
  }
  return sheet;
}

function getCentralPhotoSheet_(spreadsheet, createIfMissing) {
  const canonical = spreadsheet.getSheetByName(
    CENTRAL_CONFIG.photoSheetName
  );
  if (canonical) return canonical;
  const legacy = spreadsheet.getSheetByName(
    CENTRAL_CONFIG.legacyPhotoSheetName
  );
  if (legacy) return legacy;
  if (!createIfMissing) return null;
  const sheet = spreadsheet.insertSheet(CENTRAL_CONFIG.photoSheetName);
  initializeCentralSheet_(sheet, CENTRAL_PHOTO_HEADERS, '#5f6368');
  return sheet;
}

function getRequiredCentralAssignmentSheet_() {
  const sheet = getCentralDatabase_().getSheetByName(
    CENTRAL_CONFIG.teacherAssignmentSheetName
  );
  if (
    !sheet
      || !centralHeadersMatch_(
        sheet,
        CENTRAL_TEACHER_ASSIGNMENT_HEADERS
      )
  ) {
    throw createCentralError_(
      'CENTRAL_SCHEMA_INVALID',
      '중앙 교사담당 시트를 관리자가 먼저 준비해야 합니다.'
    );
  }
  return sheet;
}

function getRequiredCentralAssignmentRequestSheet_() {
  const sheet = getCentralDatabase_().getSheetByName(
    CENTRAL_CONFIG.assignmentRequestSheetName
  );
  if (
    !sheet
      || !centralHeadersMatch_(
        sheet,
        CENTRAL_ASSIGNMENT_REQUEST_HEADERS
      )
  ) {
    throw createCentralError_(
      'CENTRAL_SCHEMA_INVALID',
      '중앙 담당신청 시트를 관리자가 먼저 준비해야 합니다.'
    );
  }
  return sheet;
}

function getRequiredCentralAchievementStandardSheet_() {
  const sheet = getCentralDatabase_().getSheetByName(
    CENTRAL_CONFIG.achievementStandardSheetName
  );
  if (
    !sheet
      || !centralHeadersMatch_(
        sheet,
        CENTRAL_ACHIEVEMENT_STANDARD_HEADERS
      )
  ) {
    throw createCentralError_(
      'CENTRAL_SCHEMA_INVALID',
      '중앙 성취기준 시트를 관리자가 먼저 준비해야 합니다.'
    );
  }
  return sheet;
}

const bundledStandardsMemo_ = {};

function bundledStandardsForSchoolLevel_(schoolLevel) {
  const normalized = normalizeSchoolLevel_(schoolLevel, true);
  if (!Object.prototype.hasOwnProperty.call(bundledStandardsMemo_, normalized)) {
    const raw = getBundledStandardsRaw_(normalized);
    bundledStandardsMemo_[normalized] = Array.isArray(raw) ? raw : JSON.parse(String(raw || '[]'));
    if (!Array.isArray(bundledStandardsMemo_[normalized])) {
      throw new Error(`${schoolLevelLabel_(normalized)} 성취기준 번들 형식이 올바르지 않습니다.`);
    }
  }
  return bundledStandardsMemo_[normalized];
}

// StandardsData.gs used to bundle every school level's achievement standards
// (~29MB) alongside STANDARDS_SUBJECTS, so Apps Script re-parsed all of it on
// every request even though this data is only read when an admin runs
// "성취기준 데이터 설정". Each level now lives in its own file
// (StandardsData_elementary.gs 등) behind a global const, loaded lazily here.
// typeof is required (not hasOwnProperty) because these are undeclared
// globals when a level's file is excluded via .claspignore, and referencing
// an undeclared global directly throws a ReferenceError in Apps Script.
function getBundledStandardsRaw_(schoolLevel) {
  const lookup = {
    elementary: typeof STANDARDS_DATA_ELEMENTARY !== 'undefined' ? STANDARDS_DATA_ELEMENTARY : undefined,
    middle: typeof STANDARDS_DATA_MIDDLE !== 'undefined' ? STANDARDS_DATA_MIDDLE : undefined,
    high: typeof STANDARDS_DATA_HIGH !== 'undefined' ? STANDARDS_DATA_HIGH : undefined,
  };
  if (lookup[schoolLevel] == null) {
    throw new Error(`${schoolLevelLabel_(schoolLevel)} 성취기준 번들을 찾을 수 없습니다.`);
  }
  return lookup[schoolLevel];
}

// replaceCentralStandardsData_ 전용 원본 번들 읽기. readBundledSubjectCatalog_는
// 이제 '과목목록' 시트에서 읽는데, 이 함수는 그 시트를 새로 채워 넣는 쪽이라
// 시트를 거치면 지우기 전의 낡은(또는 아직 없는) 값을 읽게 된다.
function bundledSubjectCatalogForSchoolLevel_(schoolLevel) {
  const normalized = normalizeSchoolLevel_(schoolLevel, false);
  if (!normalized) return [];
  const raw = typeof STANDARDS_SUBJECTS === 'undefined'
    ? []
    : Array.isArray(STANDARDS_SUBJECTS)
      ? STANDARDS_SUBJECTS
      : JSON.parse(String(STANDARDS_SUBJECTS || '[]'));
  return raw.filter(function (item) {
    return String(item && item.schoolLevel || '').trim() === normalized;
  }).map(function (item) {
    return {
      name: String(item.name || '').trim(),
      abbreviation: String(item.abbreviation || '').trim(),
      track: String(item.track || '').trim(),
      category: String(item.category || '').trim(),
      curriculumRevision: String(item.curriculumRevision || '2022').trim(),
      subjectKey: String(item.subjectKey || '').trim(),
    };
  }).filter(function (item) { return Boolean(item.name); });
}

function replaceCentralStandardsData_(spreadsheet, schoolLevel) {
  const normalized = normalizeSchoolLevel_(schoolLevel, true);
  const subjects = bundledSubjectCatalogForSchoolLevel_(normalized);
  var standards;
  try {
    standards = bundledStandardsForSchoolLevel_(normalized);
  } catch (bundleError) {
    var existingSubjectSheet = spreadsheet.getSheetByName(
      CENTRAL_CONFIG.subjectCatalogSheetName
    );
    var existingStandardSheet = spreadsheet.getSheetByName(
      CENTRAL_CONFIG.achievementStandardSheetName
    );
    if (
      existingSubjectSheet && existingSubjectSheet.getLastRow() > 1
        && existingStandardSheet && existingStandardSheet.getLastRow() > 1
    ) {
      return {
        schoolLevel: normalized,
        subjectCount: existingSubjectSheet.getLastRow() - 1,
        standardCount: existingStandardSheet.getLastRow() - 1,
      };
    }
    throw bundleError;
  }
  if (!subjects.length || !standards.length) {
    throw new Error(`${schoolLevelLabel_(normalized)} 과목·성취기준 데이터가 비어 있습니다.`);
  }
  const trackBySubject = new Map(subjects.map(function (subject) {
    return [`${subject.curriculumRevision}|${subject.name}`, subject.track];
  }));
  const subjectRows = subjects.map(function (subject) {
    const revision = String(subject.curriculumRevision || '2022').trim();
    return [
      subject.name,
      subject.abbreviation,
      normalized,
      subject.track,
      subject.category,
      revision,
      subject.subjectKey || curriculumSubjectKey_(
        revision, normalized, subject.track, subject.name
      ),
    ];
  });
  const standardRows = standards.map(function (standard) {
    const subject = String(standard.subject || '').trim();
    const code = String(standard.code || '').trim();
    const text = String(standard.text || '').trim();
    const revision = String(standard.curriculumRevision || '2022').trim();
    if (!subject || !text || (revision !== '2015' && revision !== '2022')) {
      throw new Error('성취기준 번들에 교육과정·과목·내용이 비어 있는 항목이 있습니다.');
    }
    const track = String(standard.track || trackBySubject.get(
      `${revision}|${subject}`
    ) || '').trim();
    const subjectKey = String(standard.subjectKey || curriculumSubjectKey_(
      revision, normalized, track, subject
    )).trim();
    const standardKey = String(standard.standardKey || achievementStandardKey_({
      curriculumRevision: revision, subject: subject, domain: standard.domain,
      code: code, text: text,
    })).trim();
    return [
      code,
      subject,
      String(standard.domain || '').trim(),
      text,
      normalized,
      track,
      revision,
      subjectKey,
      standardKey,
    ];
  });
  const subjectSheet = prepareCentralStagedReplacementSheet_(
    spreadsheet, CENTRAL_CONFIG.subjectCatalogSheetName,
    CENTRAL_SUBJECT_CATALOG_HEADERS,
    '#1565c0'
  );
  const standardSheet = prepareCentralStagedReplacementSheet_(
    spreadsheet, CENTRAL_CONFIG.achievementStandardSheetName,
    CENTRAL_ACHIEVEMENT_STANDARD_HEADERS,
    '#6a1b9a'
  );
  writeCentralRowsInBatches_(subjectSheet, subjectRows);
  writeCentralRowsInBatches_(standardSheet, standardRows);
  if (subjectSheet.getLastRow() !== subjectRows.length + 1
      || standardSheet.getLastRow() !== standardRows.length + 1) {
    throw new Error('임시 성취기준 시트 검증에 실패했습니다. 기존 시트는 유지됩니다.');
  }
  subjectSheet.autoResizeColumns(1, CENTRAL_SUBJECT_CATALOG_HEADERS.length);
  standardSheet.setColumnWidth(1, 150);
  standardSheet.setColumnWidth(2, 180);
  standardSheet.setColumnWidth(3, 180);
  standardSheet.setColumnWidth(4, 520);
  standardSheet.getRange(
    2,
    3,
    Math.max(standardRows.length, 1),
    2
  ).setWrap(true);
  promoteCentralStagedReplacementSheets_(spreadsheet, [
    { sheet: subjectSheet, name: CENTRAL_CONFIG.subjectCatalogSheetName },
    { sheet: standardSheet, name: CENTRAL_CONFIG.achievementStandardSheetName },
  ]);
  return {
    schoolLevel: normalized,
    subjectCount: subjectRows.length,
    standardCount: standardRows.length,
  };
}

function importStandardsFromJson_(spreadsheet, jsonText) {
  var parsed = JSON.parse(jsonText);
  if (!parsed || !parsed.meta || !Array.isArray(parsed.subjects) || !Array.isArray(parsed.standards)) {
    throw new Error('JSON 형식이 올바르지 않습니다. meta, subjects, standards 필드가 필요합니다.');
  }
  var schoolLevel = normalizeSchoolLevel_(parsed.meta.schoolLevel, true);
  var subjectRows = parsed.subjects.map(function (s) {
    return [
      String(s.name || '').trim(), String(s.abbreviation || '').trim(),
      schoolLevel, String(s.track || '').trim(), String(s.category || '').trim(),
      String(s.curriculumRevision || '').trim(), String(s.subjectKey || '').trim(),
    ];
  }).filter(function (r) { return Boolean(r[0]); });
  var standardRows = parsed.standards.map(function (s) {
    return [
      String(s.code || '').trim(), String(s.subject || '').trim(),
      String(s.domain || '').trim(), String(s.text || '').trim(),
      schoolLevel, String(s.track || '').trim(),
      String(s.curriculumRevision || '').trim(), String(s.subjectKey || '').trim(),
      String(s.standardKey || '').trim(),
    ];
  }).filter(function (r) { return Boolean(r[1]) && Boolean(r[3]); });
  var subjectSheet = spreadsheet.getSheetByName(CENTRAL_CONFIG.subjectCatalogSheetName);
  if (!subjectSheet) {
    subjectSheet = spreadsheet.insertSheet(CENTRAL_CONFIG.subjectCatalogSheetName);
    initializeCentralSheet_(subjectSheet, CENTRAL_SUBJECT_CATALOG_HEADERS, '#1565c0');
  }
  var standardSheet = spreadsheet.getSheetByName(CENTRAL_CONFIG.achievementStandardSheetName);
  if (!standardSheet) {
    standardSheet = spreadsheet.insertSheet(CENTRAL_CONFIG.achievementStandardSheetName);
    initializeCentralSheet_(standardSheet, CENTRAL_ACHIEVEMENT_STANDARD_HEADERS, '#6a1b9a');
  }
  var existingSubjectKeys = new Set();
  if (subjectSheet.getLastRow() > 1) {
    subjectSheet.getRange(2, 7, subjectSheet.getLastRow() - 1, 1)
      .getValues().forEach(function (r) { existingSubjectKeys.add(String(r[0]).trim()); });
  }
  var existingStandardKeys = new Set();
  if (standardSheet.getLastRow() > 1) {
    standardSheet.getRange(2, 9, standardSheet.getLastRow() - 1, 1)
      .getValues().forEach(function (r) { existingStandardKeys.add(String(r[0]).trim()); });
  }
  var newSubjects = subjectRows.filter(function (r) { return !existingSubjectKeys.has(r[6]); });
  var newStandards = standardRows.filter(function (r) { return !existingStandardKeys.has(r[8]); });
  if (newSubjects.length > 0) {
    var sStart = subjectSheet.getLastRow() + 1;
    subjectSheet.getRange(sStart, 1, newSubjects.length, newSubjects[0].length).setValues(newSubjects);
  }
  if (newStandards.length > 0) {
    var tStart = standardSheet.getLastRow() + 1;
    standardSheet.getRange(tStart, 1, newStandards.length, newStandards[0].length).setValues(newStandards);
  }
  bundledSubjectCatalogMemo_ = null;
  return {
    schoolLevel: schoolLevel,
    description: String(parsed.meta.description || ''),
    subjectCount: newSubjects.length,
    standardCount: newStandards.length,
    skippedSubjects: subjectRows.length - newSubjects.length,
    skippedStandards: standardRows.length - newStandards.length,
  };
}

function prepareCentralStagedReplacementSheet_(spreadsheet, sheetName, headers, color) {
  const stagedName = `${sheetName}__준비_${Utilities.getUuid().slice(0, 8)}`;
  const sheet = spreadsheet.insertSheet(stagedName);
  initializeCentralSheet_(sheet, headers, color);
  return sheet;
}

function promoteCentralStagedReplacementSheets_(spreadsheet, entries) {
  const stamp = `${Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMddHHmmss')}_${new Date().getTime()}`;
  const renamed = [];
  try {
    entries.forEach(function (entry, index) {
      const previous = spreadsheet.getSheetByName(entry.name);
      if (!previous) return;
      const backupName = `${entry.name}__백업_${stamp}_${index + 1}`;
      previous.setName(backupName);
      renamed.push({ sheet: previous, name: entry.name });
    });
    entries.forEach(function (entry) { entry.sheet.setName(entry.name); });
  } catch (error) {
    // 승격 중 실패하면 기존 시트 이름을 되돌려 운영 데이터를 즉시 복구한다.
    entries.forEach(function (entry) {
      if (entry.sheet.getName() === entry.name) {
        entry.sheet.setName(`${entry.name}__실패_${stamp}`);
      }
    });
    renamed.forEach(function (item) { item.sheet.setName(item.name); });
    throw error;
  }
}

function writeCentralRowsInBatches_(sheet, rows) {
  if (!rows.length) return;
  const requiredRows = rows.length + 1;
  const requiredColumns = rows[0].length;
  if (sheet.getMaxRows() < requiredRows) {
    sheet.insertRowsAfter(
      sheet.getMaxRows(),
      requiredRows - sheet.getMaxRows()
    );
  }
  if (sheet.getMaxColumns() < requiredColumns) {
    sheet.insertColumnsAfter(
      sheet.getMaxColumns(),
      requiredColumns - sheet.getMaxColumns()
    );
  }
  const batchSize = 5000;
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    sheet.getRange(offset + 2, 1, batch.length, batch[0].length).setValues(batch);
  }
}

function getStandardsForAssignment(assignmentKey) {
  const assignment = requireMyAssignment_(assignmentKey);
  return readAchievementStandardsForSubject_(
    assignment.subject, assignment.curriculumRevision, assignment.subjectKey
  );
}

// 구 클라이언트 호환용이다. 새 흐름은 반드시 담당키 API를 사용한다.
function getStandardsForSubject(subject) {
  const assignment = getMyAssignments().find(function (item) {
    return item.subject === String(subject || '').trim();
  });
  if (!assignment) throw createCentralError_('ASSIGNMENT_FORBIDDEN', '현재 담당 중인 과목의 성취기준만 조회할 수 있습니다.');
  return getStandardsForAssignment(assignment.assignmentKey);
}

function readAchievementStandardsForSubject_(subject, curriculumRevision, subjectKey) {
  const schoolLevel = getConfiguredSchoolLevel_();
  if (!schoolLevel) return [];
  const sheet = getRequiredCentralAchievementStandardSheet_();
  const rowCount = sheet.getLastRow() - 1;
  if (rowCount <= 0) return [];
  const matches = sheet
    .getRange(2, 2, rowCount, 1)
    .createTextFinder(subject)
    .matchEntireCell(true)
    .findAll();
  if (!matches.length) return [];
  const rowNumbers = matches.map(function (match) { return match.getRow(); })
    .sort(function (left, right) { return left - right; });
  const groups = [];
  rowNumbers.forEach(function (rowNumber) {
    const last = groups[groups.length - 1];
    if (last && rowNumber === last.end + 1) {
      last.end = rowNumber;
    } else {
      groups.push({ start: rowNumber, end: rowNumber });
    }
  });
  const standards = [];
  groups.forEach(function (group) {
    sheet.getRange(
      group.start,
      1,
      group.end - group.start + 1,
      CENTRAL_ACHIEVEMENT_STANDARD_HEADERS.length
    ).getDisplayValues().forEach(function (row) {
      if (String(row[1] || '').trim() !== subject) return;
      if (String(row[4] || '').trim() !== schoolLevel) return;
      if (String(row[6] || '2022').trim() !== curriculumRevision) return;
      if (subjectKey && String(row[7] || '').trim() !== subjectKey) return;
      standards.push({
        code: String(row[0] || '').trim(),
        subject: String(row[1] || '').trim(),
        domain: String(row[2] || '').trim(),
        text: String(row[3] || '').trim(),
        curriculumRevision: String(row[6] || '2022').trim(),
        subjectKey: String(row[7] || '').trim(),
        standardKey: String(row[8] || '').trim(),
      });
    });
  });
  const filtered = standards.filter(function (standard) {
    return standard.text;
  }).map(function (standard) {
    return {
      ...standard,
      key: standard.standardKey || achievementStandardKey_(standard),
    };
  });
  // v4/v5 초기 행처럼 과목키가 없는 기존 담당은 교육과정+과목명으로 조회한다.
  // 여러 계열에 반복 수록된 공통 과목은 사용자에게 같은 기준이므로 표시 내용
  // 기준으로 한 번만 남겨 기존 행도 중복 없이 사용할 수 있게 한다.
  const unique = subjectKey ? filtered : [...new Map(filtered.map(function (standard) {
    return [[standard.code, standard.domain, standard.text].join('\0'), standard];
  })).values()];
  return unique.sort(function (left, right) {
    return left.code.localeCompare(right.code, 'ko')
      || left.domain.localeCompare(right.domain, 'ko')
      || left.text.localeCompare(right.text, 'ko');
  });
}

function achievementStandardKey_(standard) {
  return JSON.stringify([
    String(standard && standard.curriculumRevision || '2022').trim(),
    String(standard && standard.subject || '').trim(),
    String(standard && standard.domain || '').trim(),
    String(standard && standard.code || '').trim(),
    String(standard && standard.text || '').trim(),
  ]);
}

function achievementStandardDisplay_(standard) {
  return `${standard.code} ${standard.text}`.trim();
}

function resolveAchievementStandard_(subject, value, curriculumRevision, subjectKey) {
  const input = String(value || '').trim();
  if (!input) return null;
  const standards = readAchievementStandardsForSubject_(
    subject, curriculumRevision || '2022', subjectKey || ''
  );
  const keyMatch = standards.find(function (item) {
    return item.key === input;
  });
  if (keyMatch) return keyMatch;
  const displayMatches = standards.filter(function (item) {
    return achievementStandardDisplay_(item) === input;
  });
  // 영역만 다르고 코드·원문이 같은 행은 사용자에게 같은 기준으로 보인다.
  // 정렬된 첫 행을 택해도 저장되는 표시값은 동일하다.
  if (displayMatches.length) return displayMatches[0];
  const codeMatch = input.match(/^\s*(\[[^\]]+\])\s*$/);
  const codeMatches = codeMatch
    ? standards.filter(function (item) { return item.code === codeMatch[1].trim(); })
    : [];
  if (codeMatches.length === 1) return codeMatches[0];
  if (codeMatches.length > 1) {
    throw new Error('같은 코드의 성취기준이 여러 개입니다. 코드와 문장이 함께 표시된 항목을 골라 주세요.');
  }
  throw new Error('선택한 과목에 포함된 성취기준을 목록에서 골라 주세요.');
}

function normalizeCentralClassNumberList_(value) {
  const raw = (Array.isArray(value)
    ? value
    : String(value || '').split(/[\s,;]+/))
    .filter(function (item) { return String(item || '').trim(); });
  if (!raw.length) {
    throw new Error('담당 반을 하나 이상 입력해 주세요.');
  }
  const parsed = raw.map(function (item) { return Number(item); });
  if (
    parsed.some(function (item) {
      return !Number.isFinite(item)
        || !Number.isInteger(item)
        || item < 1
        || item > 99;
    })
  ) {
    throw new Error('담당 반은 1~99 사이의 정수로 입력해 주세요.');
  }
  const classNumbers = Array.from(new Set(parsed));
  if (classNumbers.length > CENTRAL_CONFIG.maxClassNumbersPerBatch) {
    throw new Error(
      `담당 반은 한 번에 ${CENTRAL_CONFIG.maxClassNumbersPerBatch}개까지 입력할 수 있습니다.`
    );
  }
  return classNumbers.sort(function (left, right) { return left - right; });
}

function isSupportedCentralStudentSheet_(sheet) {
  return centralHeadersMatch_(sheet, CENTRAL_STUDENT_HEADERS)
    || centralHeadersMatch_(sheet, CENTRAL_LEGACY_STUDENT_HEADERS);
}

function centralHeadersMatch_(sheet, expected) {
  if (!sheet || sheet.getLastColumn() < expected.length) return false;
  const actual = sheet
    .getRange(1, 1, 1, expected.length)
    .getDisplayValues()[0]
    .map(function (value) { return String(value || '').trim(); });
  return expected.every(function (header, index) {
    return actual[index] === header;
  });
}

// 운영 중인 v4 시트는 뒤에 열만 보태야 기존 열 번호와 행 데이터를 보존한다.
function ensureCentralTrailingHeaders_(sheet, headers, color, backfill) {
  if (centralHeadersMatch_(sheet, headers)) return sheet;
  const actual = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0]
    .map(function (value) { return String(value || '').trim(); });
  let previousWidth = actual.length;
  while (previousWidth > 0 && !actual[previousWidth - 1]) previousWidth -= 1;
  const currentHeaders = actual.slice(0, previousWidth);
  if (previousWidth > headers.length || !currentHeaders.every(function (value, index) {
    return value === headers[index];
  })) {
    throw createCentralError_('CENTRAL_SCHEMA_INVALID', `'${sheet.getName()}' 시트의 머리글을 확인해 주세요.`);
  }
  const missing = headers.slice(previousWidth);
  if (sheet.getMaxColumns() < headers.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
  }
  sheet.getRange(1, previousWidth + 1, 1, missing.length).setValues([missing])
    .setBackground(color).setFontColor('#ffffff').setFontWeight('bold');
  if (typeof backfill === 'function' && sheet.getLastRow() > 1) backfill(sheet, previousWidth);
  return sheet;
}

function backfillAssignmentCurriculumRevision_(sheet, previousWidth) {
  const curriculumColumn = sheet.getRange(1, 1, 1, sheet.getLastColumn())
    .getDisplayValues()[0].findIndex(function (value) {
      return String(value || '').trim() === '교육과정';
    }) + 1;
  if (!curriculumColumn || curriculumColumn <= previousWidth) return;
  const rowCount = sheet.getLastRow() - 1;
  const values = sheet.getRange(2, 1, rowCount, 4).getValues();
  sheet.getRange(2, curriculumColumn, rowCount, 1).setValues(values.map(function (row) {
    return [resolveCurriculumRevision_(row[2], row[3])];
  }));
}

function initializeCentralSheet_(sheet, headers, color) {
  sheet.clear();
  sheet.setFrozenRows(1);
  sheet.setHiddenGridlines(true);
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet
    .getRange(1, 1, 1, headers.length)
    .setBackground(color)
    .setFontColor('#ffffff')
    .setFontWeight('bold');
}

function readCentralStudents_(sheet, includeInactive) {
  const canonical = centralHeadersMatch_(sheet, CENTRAL_STUDENT_HEADERS);
  const legacy = !canonical
    && centralHeadersMatch_(sheet, CENTRAL_LEGACY_STUDENT_HEADERS);
  if (!canonical && !legacy) {
    throw createCentralError_(
      'CENTRAL_SCHEMA_INVALID',
      '중앙 학생목록 시트의 머리글을 확인해 주세요.'
    );
  }
  const rowCount = sheet.getLastRow() - 1;
  if (rowCount <= 0) return [];
  const width = canonical
    ? CENTRAL_STUDENT_HEADERS.length
    : CENTRAL_LEGACY_STUDENT_HEADERS.length;
  const values = sheet.getRange(2, 1, rowCount, width).getValues();
  const displayValues = sheet
    .getRange(2, 1, rowCount, width)
    .getDisplayValues();
  const students = [];
  values.forEach(function (row, index) {
    const display = displayValues[index];
    const student = canonical
      ? {
        studentKey: String(display[0] || '').trim(),
        schoolYear: Number(row[1]),
        grade: Number(row[2]),
        classNumber: Number(row[3]),
        studentNumber: Number(row[4]),
        name: String(display[5] || '').trim(),
        status: String(display[6] || '').trim(),
        active: isEnabled_(row[7]),
        createdAt: row[8],
        updatedAt: row[9],
        rowNumber: index + 2,
        schema: 'canonical',
      }
      : {
        studentKey: String(display[5] || '').trim(),
        schoolYear: Number(row[6]),
        grade: Number(row[0]),
        classNumber: Number(row[1]),
        studentNumber: Number(row[2]),
        name: String(display[3] || '').trim(),
        status: String(display[4] || '').trim(),
        active: true,
        createdAt: null,
        updatedAt: null,
        rowNumber: index + 2,
        schema: 'legacy',
      };
    if (!isValidCentralStudent_(student)) return;
    if (!includeInactive && !student.active) return;
    students.push(student);
  });
  return students.sort(compareCentralStudents_);
}

function readCentralStudentsCached_() {
  const spreadsheet = getCentralDatabase_();
  const sheet = getCentralStudentSheet_(spreadsheet, false);
  if (!sheet || !isSupportedCentralStudentSheet_(sheet)) {
    throw createCentralError_(
      'CENTRAL_SCHEMA_INVALID',
      '중앙 학생목록 시트를 확인해 주세요.'
    );
  }
  const cache = CacheService.getScriptCache();
  const key = centralCacheKey_(spreadsheet, 'students');
  const cached = cache.get(key);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (error) {
      // 손상된 캐시는 중앙 원본에서 다시 만든다.
    }
  }
  const students = readCentralStudents_(sheet, true).map(function (student) {
    return {
      studentKey: student.studentKey,
      schoolYear: student.schoolYear,
      grade: student.grade,
      classNumber: student.classNumber,
      studentNumber: student.studentNumber,
      name: student.name,
      status: student.status,
      active: student.active,
    };
  });
  const json = JSON.stringify(students);
  if (json.length <= 90000) {
    try {
      cache.put(key, json, CENTRAL_CONFIG.cacheSeconds);
    } catch (error) {
      // 캐시는 성능 최적화이므로 실패해도 원본 결과를 사용한다.
    }
  }
  return students;
}

function clearCentralStudentCache_() {
  clearCentralReadCache_('students');
}

function clearCentralTeacherAssignmentCache_(spreadsheet) {
  clearCentralReadCache_('teacher-assignments', spreadsheet);
}

function clearCentralPhotoRowsCache_(spreadsheet) {
  clearCentralReadCache_('photo-rows', spreadsheet);
}

// 수강그룹·수강그룹원은 나중에 추가된 시트라 기존 설치에는 없을 수 있다.
// 그때는 관리자에게 무엇을 하면 되는지 알려 준다. 머리글 대조는 기존 중앙
// 시트와 같은 규약을 따른다.
function getRequiredCentralSheetByName_(sheetName, headers) {
  const sheet = getCentralDatabase_().getSheetByName(sheetName);
  if (!sheet) {
    throw createCentralError_(
      'CENTRAL_SCHEMA_INVALID',
      `중앙 '${sheetName}' 시트가 없습니다. 관리자에게 중앙 시트 점검·생성 실행을 요청해 주세요.`
    );
  }
  if (!centralHeadersMatch_(sheet, headers)) {
    throw createCentralError_(
      'CENTRAL_SCHEMA_INVALID',
      `중앙 '${sheetName}' 시트의 머리글을 확인해 주세요.`
    );
  }
  return sheet;
}

function getRequiredCentralGroupSheet_() {
  return getRequiredCentralSheetByName_(
    CENTRAL_CONFIG.groupSheetName,
    CENTRAL_GROUP_HEADERS
  );
}

function getRequiredCentralGroupMemberSheet_() {
  return getRequiredCentralSheetByName_(
    CENTRAL_CONFIG.groupMemberSheetName,
    CENTRAL_GROUP_MEMBER_HEADERS
  );
}

// 두 시트 모두 첫 열이 담당키이고 둘째 열만 다르다(그룹명 / 학생키).
// 읽기·캐시 규약이 같아 한 함수로 처리한다.
function readCentralGroupRows_(sheet, headers, suffix) {
  const cache = CacheService.getScriptCache();
  const key = centralCacheKey_(sheet.getParent(), suffix);
  const cached = cache.get(key);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (error) {
      // 손상된 캐시는 중앙 원본에서 다시 만든다.
    }
  }
  const rowCount = sheet.getLastRow() - 1;
  const rows = [];
  if (rowCount > 0) {
    sheet.getRange(2, 1, rowCount, headers.length)
      .getDisplayValues()
      .forEach(function (row) {
        const assignmentKey = String(row[0] || '').trim();
        if (assignmentKey) {
          rows.push([assignmentKey, String(row[1] || '').trim()]);
        }
      });
  }
  const json = JSON.stringify(rows);
  if (json.length <= 90000) {
    try {
      cache.put(key, json, CENTRAL_CONFIG.cacheSeconds);
    } catch (error) {
      // 캐시는 성능 최적화이므로 실패해도 원본 결과를 사용한다.
    }
  }
  return rows;
}

// centralStudentBelongsToAssignment_ 가 학생 한 명마다 이 함수를 부른다. 그때마다
// 시트 핸들을 다시 얻고 캐시를 다시 풀면 한 반(수백 명) 조회가 멈춘 것처럼 느려져
// 화면이 계속 로딩 상태로 남는다. 한 번의 실행 안에서는 기억해 두고 다시 쓴다.
let centralGroupNamesMemo_ = null;
let centralGroupMembersMemo_ = null;
let centralGroupGradesMemo_ = null;

function readCentralGroupNamesCached_() {
  if (!centralGroupNamesMemo_) {
    centralGroupNamesMemo_ = new Map(readCentralGroupRows_(
      getRequiredCentralGroupSheet_(),
      CENTRAL_GROUP_HEADERS,
      'group-names'
    ));
  }
  return centralGroupNamesMemo_;
}

function readCentralGroupMembersCached_() {
  if (centralGroupMembersMemo_) return centralGroupMembersMemo_;
  const result = new Map();
  readCentralGroupRows_(
    getRequiredCentralGroupMemberSheet_(),
    CENTRAL_GROUP_MEMBER_HEADERS,
    'group-members'
  ).forEach(function (pair) {
    if (!pair[1]) return;
    if (!result.has(pair[0])) result.set(pair[0], new Set());
    result.get(pair[0]).add(pair[1]);
  });
  centralGroupMembersMemo_ = result;
  return result;
}

// 고교학점제 수강 그룹은 여러 학년이 함께 듣는 경우가 흔한데, 담당 한 건에는
// 학년 칸이 하나뿐이다(교사담당 시트 열 순서를 바꾸면 기존 학교의 시트와
// 어긋난다). 그래서 첫 학년만 그 칸에 두고, 나머지 학년은 수강그룹 시트의
// 5번째 칸에 '·'로 이어 적는다. 기존에 만들어진 학교의 수강그룹 시트는 이
// 칸이 없는데, centralHeadersMatch_ 는 시트에 선언보다 열이 남는 것만 보므로
// 검증에는 걸리지 않는다 — 그냥 비어 있는 칸으로 취급된다.
function readCentralGroupGradesCached_() {
  if (centralGroupGradesMemo_) return centralGroupGradesMemo_;
  const sheet = getRequiredCentralGroupSheet_();
  const cache = CacheService.getScriptCache();
  const key = centralCacheKey_(sheet.getParent(), 'group-grades');
  let rows = null;
  const cached = cache.get(key);
  if (cached) {
    try {
      rows = JSON.parse(cached);
    } catch (error) {
      rows = null;
    }
  }
  if (!rows) {
    rows = [];
    const rowCount = sheet.getLastRow() - 1;
    if (rowCount > 0 && sheet.getLastColumn() >= 5) {
      sheet.getRange(2, 1, rowCount, 5).getDisplayValues().forEach(function (row) {
        const assignmentKey = String(row[0] || '').trim();
        const extra = String(row[4] || '').trim();
        if (assignmentKey && extra) rows.push([assignmentKey, extra]);
      });
    }
    const json = JSON.stringify(rows);
    if (json.length <= 90000) {
      try {
        cache.put(key, json, CENTRAL_CONFIG.cacheSeconds);
      } catch (error) {
        // 캐시 실패해도 원본 결과를 그대로 쓴다.
      }
    }
  }
  centralGroupGradesMemo_ = new Map(rows.map(function (pair) {
    return [pair[0], pair[1].split('·').map(Number).filter(function (grade) {
      return getAllowedGrades_().includes(grade);
    })];
  }));
  return centralGroupGradesMemo_;
}

// 담당의 기본 학년에, 그룹이면 수강그룹 시트에 적힌 추가 학년까지 합친다.
// 조회에 실패해도(시트 접근권 없음 등) 기본 학년만으로 동작해야 하므로 조용히
// 넘어간다.
function centralAssignmentGrades_(assignment) {
  const grades = [Number(assignment.grade)];
  if (centralAssignmentIsGroup_(assignment)) {
    try {
      (readCentralGroupGradesCached_().get(assignment.assignmentKey) || [])
        .forEach(function (grade) {
          if (!grades.includes(grade)) grades.push(grade);
        });
    } catch (error) {
      // 기본 학년만으로도 조회는 계속 동작해야 한다.
    }
  }
  return grades.sort(function (left, right) { return left - right; });
}

function clearCentralGroupCache_(spreadsheet) {
  centralGroupNamesMemo_ = null;
  centralGroupMembersMemo_ = null;
  centralGroupGradesMemo_ = null;
  clearCentralReadCache_('group-names', spreadsheet);
  clearCentralReadCache_('group-members', spreadsheet);
  clearCentralReadCache_('group-grades', spreadsheet);
}

function clearCentralReadCache_(suffix, spreadsheet) {
  try {
    const target = spreadsheet || getCentralDatabase_();
    CacheService.getScriptCache().remove(
      centralCacheKey_(target, suffix)
    );
  } catch (error) {
    // 변경 자체가 성공한 뒤 캐시 정리 실패는 다음 만료로 복구한다.
  }
}

function getCentralStudentByKey_(studentKey, includeInactive) {
  const key = normalizeCentralKey_(studentKey, '학생키');
  const student = readCentralStudentsCached_().find(function (candidate) {
    return candidate.studentKey === key
      && (includeInactive || candidate.active);
  });
  if (!student) {
    throw createCentralError_(
      'STUDENT_NOT_FOUND',
      '중앙 학생목록에서 학생을 찾을 수 없습니다.'
    );
  }
  return student;
}

function isValidCentralStudent_(student) {
  return Boolean(
    student.studentKey
      && student.studentKey.length <= 100
      && Number.isInteger(student.schoolYear)
      && student.schoolYear >= 2000
      && student.schoolYear <= 2100
      && getAllowedGrades_().includes(student.grade)
      && Number.isInteger(student.classNumber)
      // 공동교육과정 타교생은 우리 학교 어느 반도 아니라서 반을 0으로 쓴다.
      // 쓰는 쪽(normalizeCentralStudentPayload_)과 짝을 맞춰야 조회에서
      // 사라지지 않는다.
      && (student.classNumber > 0
        || (student.status === '공동'
          && student.classNumber === CENTRAL_CONFIG.externalClassNumber))
      && Number.isInteger(student.studentNumber)
      && student.studentNumber > 0
      && student.studentNumber <= APP_CONFIG.maxStudentNumber
      && student.name
      && APP_CONFIG.studentStatuses.includes(student.status)
  );
}

function toPublicCentralStudent_(student) {
  return {
    studentKey: student.studentKey,
    studentId: student.studentKey,
    schoolYear: student.schoolYear,
    grade: student.grade,
    classNumber: student.classNumber,
    studentNumber: student.studentNumber,
    name: student.name,
    status: student.status,
    active: Boolean(student.active),
    recordable: Boolean(
      student.active
        && APP_CONFIG.recordableStudentStatuses.includes(student.status)
    ),
  };
}

function compareCentralStudents_(left, right) {
  return left.schoolYear - right.schoolYear
    || left.grade - right.grade
    || left.classNumber - right.classNumber
    || left.studentNumber - right.studentNumber
    || left.name.localeCompare(right.name, 'ko');
}

function readCentralTeacherAssignments_(sheet, includeInactive) {
  if (
    !centralHeadersMatch_(
      sheet,
      CENTRAL_TEACHER_ASSIGNMENT_HEADERS
    )
  ) {
    throw createCentralError_(
      'CENTRAL_SCHEMA_INVALID',
      '중앙 교사담당 시트의 머리글을 확인해 주세요.'
    );
  }
  const rowCount = sheet.getLastRow() - 1;
  if (rowCount <= 0) return [];
  const values = sheet
    .getRange(
      2,
      1,
      rowCount,
      CENTRAL_TEACHER_ASSIGNMENT_HEADERS.length
    )
    .getValues();
  const displayValues = sheet
    .getRange(
      2,
      1,
      rowCount,
      CENTRAL_TEACHER_ASSIGNMENT_HEADERS.length
    )
    .getDisplayValues();
  return values.map(function (row, index) {
    const display = displayValues[index];
    return {
      assignmentKey: String(display[0] || '').trim(),
      teacherEmail: normalizeCentralEmail_(display[1]),
      schoolYear: Number(row[2]),
      grade: Number(row[3]),
      classNumber: Number(row[4]),
      subject: String(display[5] || '').trim(),
      assignmentType: String(display[6] || '교과').trim(),
      active: isEnabled_(row[7]),
      createdAt: row[8],
      updatedAt: row[9],
      curriculumRevision: resolveCurriculumRevision_(
        row[2], row[3], '', display[10]
      ),
      subjectKey: String(display[11] || '').trim(),
      rowNumber: index + 2,
    };
  }).filter(function (assignment) {
    return assignment.assignmentKey
      && isValidCentralEmail_(assignment.teacherEmail)
      && Number.isInteger(assignment.schoolYear)
      && getAllowedGrades_().includes(assignment.grade)
      && Number.isInteger(assignment.classNumber)
      // 수강 그룹 담당도 반을 0으로 쓴다. 쓰는 쪽
      // (normalizeTeacherAssignmentPayload_)과 짝을 맞추지 않으면 승인이
      // 성공해도 담당 목록에서 통째로 사라진다.
      && (assignment.classNumber > 0
        || (centralAssignmentIsGroup_(assignment)
          && assignment.classNumber === CENTRAL_CONFIG.externalClassNumber))
      && assignment.subject
      && (includeInactive || assignment.active);
  }).sort(compareCentralAssignments_);
}

function readCentralTeacherAssignmentsCached_(includeInactive, preparedSheet) {
  const sheet = preparedSheet || getRequiredCentralAssignmentSheet_();
  const cache = CacheService.getScriptCache();
  const key = centralCacheKey_(sheet.getParent(), 'teacher-assignments');
  let assignments = null;
  const cached = cache.get(key);
  if (cached) {
    try {
      assignments = JSON.parse(cached);
    } catch (error) {
      cache.remove(key);
    }
  }
  if (!assignments) {
    assignments = readCentralTeacherAssignments_(sheet, true);
    const json = JSON.stringify(assignments);
    if (json.length <= 90000) {
      try {
        cache.put(key, json, CENTRAL_CONFIG.cacheSeconds);
      } catch (error) {
        // 캐시 실패 시에도 중앙 시트 조회 결과를 사용한다.
      }
    }
  }
  return includeInactive
    ? assignments
    : assignments.filter(function (assignment) {
      return assignment.active;
    });
}

function compareCentralAssignments_(left, right) {
  return left.schoolYear - right.schoolYear
    || left.grade - right.grade
    || left.classNumber - right.classNumber
    || left.subject.localeCompare(right.subject, 'ko')
    || left.teacherEmail.localeCompare(right.teacherEmail);
}

function toPublicCentralAssignment_(assignment) {
  const isGroup = centralAssignmentIsGroup_(assignment);
  const groupName = isGroup
    ? centralGroupNameFor_(assignment.assignmentKey)
    : '';
  // 학급 단위는 학년이 항상 하나뿐이라 [assignment.grade] 그대로다. 그룹만
  // centralAssignmentGrades_ 로 추가 학년까지 합쳐서 화면에 '2·3학년'처럼
  // 보여준다.
  const grades = isGroup
    ? centralAssignmentGrades_(assignment)
    : [assignment.grade];
  const gradeLabel = `${grades.join('·')}학년`;
  return {
    assignmentKey: assignment.assignmentKey,
    schoolYear: assignment.schoolYear,
    grade: assignment.grade,
    grades: grades,
    classNumber: assignment.classNumber,
    subject: assignment.subject,
    assignmentType: assignment.assignmentType,
    curriculumRevision: assignment.curriculumRevision,
    curriculumRevisionLabel: curriculumRevisionLabel_(assignment.curriculumRevision),
    subjectKey: assignment.subjectKey || '',
    isGroup: isGroup,
    groupName: groupName,
    // 그룹 담당의 반은 0으로만 기록되므로 화면에 반 번호를 보여줄 이유가 없다.
    label: isGroup
      ? `${assignment.schoolYear}학년도 ${gradeLabel} `
        + `${groupName || '이름 없는 그룹'} ${assignment.subject}`
      : `${assignment.schoolYear}학년도 ${gradeLabel} `
        + `${assignment.classNumber}반 ${assignment.subject}`,
  };
}

function getMyAssignments() {
  return getMyAssignmentsFromCentralSheet_();
}

function getMyAssignmentsFromCentralSheet_(assignmentSheet) {
  const email = getRequiredActiveUserEmail_();
  return readCentralTeacherAssignmentsCached_(false, assignmentSheet)
    .filter(function (assignment) {
      return assignment.teacherEmail === email
        && assignment.schoolYear === getCurrentSchoolYear_();
    })
    .slice(0, CENTRAL_CONFIG.maxAssignmentsPerUser)
    .map(toPublicCentralAssignment_);
}

// 비활성까지 센다. 관리자가 새 학년도 정리로 지난 담당을 꺼 버리면 오히려
// 안내가 가장 필요한 시점에 근거가 사라지기 때문이다.
// 행마다 setValue 를 부르면 학생 180명을 끄는 데 왕복이 360번 든다. 열을 통째로
// 한 번 읽어 메모리에서 고치고 한 번 되쓰면 4번으로 끝난다. 건드리지 않는 행은
// 읽은 값을 그대로 되쓰므로 값이 바뀌지 않는다.
// 학생목록·교사담당 시트 모두 8열이 '사용', 10열이 '수정일시'다.
function deactivateCentralRows_(sheet, rowNumbers) {
  if (!rowNumbers.length) return 0;
  const rowCount = sheet.getLastRow() - 1;
  if (rowCount <= 0) return 0;
  const activeRange = sheet.getRange(2, 8, rowCount, 1);
  const updatedRange = sheet.getRange(2, 10, rowCount, 1);
  const activeValues = activeRange.getValues();
  const updatedValues = updatedRange.getValues();
  const now = new Date();
  let changed = 0;
  rowNumbers.forEach(function (rowNumber) {
    const index = rowNumber - 2;
    if (index < 0 || index >= rowCount) return;
    activeValues[index][0] = false;
    updatedValues[index][0] = now;
    changed += 1;
  });
  activeRange.setValues(activeValues);
  updatedRange.setValues(updatedValues);
  return changed;
}

function countMyPreviousAssignments_(assignmentSheet) {
  const email = getRequiredActiveUserEmail_();
  const currentSchoolYear = getCurrentSchoolYear_();
  return readCentralTeacherAssignmentsCached_(true, assignmentSheet)
    .filter(function (assignment) {
      return assignment.teacherEmail === email
        && assignment.schoolYear < currentSchoolYear;
    }).length;
}

function requireMyAssignment_(assignmentKey) {
  const key = normalizeCentralKey_(assignmentKey, '담당키');
  const email = getRequiredActiveUserEmail_();
  const schoolYear = getCurrentSchoolYear_();
  const assignment = readCentralTeacherAssignmentsCached_(false)
    .find(function (candidate) {
    return candidate.assignmentKey === key
      && candidate.teacherEmail === email
      && candidate.schoolYear === schoolYear;
  });
  if (!assignment) {
    throw createCentralError_(
      'ASSIGNMENT_FORBIDDEN',
      '현재 계정에 허용된 담당 수업이 아닙니다.'
    );
  }
  return assignment;
}

function getStudentsForMyAssignment(assignmentKey, options) {
  const assignment = requireMyAssignment_(assignmentKey);
  const criteria = normalizeCentralStudentQuery_(options);
  const photoRows = readCentralPhotoRowsCached_();
  return readCentralStudentsCached_()
    .filter(function (student) {
      return student.active
        && centralStudentBelongsToAssignment_(student, assignment)
        && (!criteria.query
          || student.name.toLocaleLowerCase('ko')
            .includes(criteria.query));
    })
    .sort(compareCentralStudents_)
    .slice(criteria.offset, criteria.offset + criteria.limit)
    .map(function (student) {
      const publicStudent = toPublicCentralStudent_(student);
      publicStudent.photoAvailable = photoRows.has(student.studentKey);
      return publicStudent;
    });
}

function normalizeCentralStudentQuery_(options) {
  const value = options || {};
  const query = String(value.query || '')
    .trim()
    .toLocaleLowerCase('ko')
    .slice(0, 50);
  const limit = Math.min(
    Math.max(Number(value.limit) || CENTRAL_CONFIG.maxStudentResults, 1),
    CENTRAL_CONFIG.maxStudentResults
  );
  const offset = Math.min(
    Math.max(Number(value.offset) || 0, 0),
    5000
  );
  return {
    query: query,
    limit: limit,
    offset: offset,
  };
}

function centralAssignmentIsGroup_(assignment) {
  return String(assignment && assignment.assignmentType || '').trim()
    === CENTRAL_ASSIGNMENT_TYPES.group;
}

// 고교학점제 수강 그룹은 학급으로 묶이지 않아 학년도·학년·반 대조로 판정할 수
// 없다. 담당유형 하나로 여기서 갈라 두면 이 함수를 거치는 학생 조회·사진 조회·
// 기록 저장·수정·삭제·검색이 모두 같은 규칙을 따르므로 다른 경로는 손대지 않는다.
function centralStudentBelongsToAssignment_(student, assignment) {
  if (centralAssignmentIsGroup_(assignment)) {
    const members = readCentralGroupMembersCached_()
      .get(assignment.assignmentKey);
    return Boolean(members && members.has(student.studentKey));
  }
  return Number(student.schoolYear) === Number(assignment.schoolYear)
    && Number(student.grade) === Number(assignment.grade)
    && Number(student.classNumber) === Number(assignment.classNumber);
}

// 그룹명은 신설 시트에 있다. 아직 시트를 만들지 않은 설치에서 담당 목록 전체가
// 실패하지 않도록 조회 실패를 흡수한다.
function centralGroupNameFor_(assignmentKey) {
  try {
    return readCentralGroupNamesCached_().get(assignmentKey) || '';
  } catch (error) {
    return '';
  }
}

function requireCentralStudentAssignment_(student, assignment) {
  if (!centralStudentBelongsToAssignment_(student, assignment)) {
    throw createCentralError_(
      'STUDENT_FORBIDDEN',
      '현재 담당 수업에 포함되지 않은 학생입니다.'
    );
  }
}

function getStudentPhotosForMyAssignment(assignmentKey, studentKeys) {
  const assignment = requireMyAssignment_(assignmentKey);
  const keys = normalizeCentralStudentKeyList_(studentKeys);
  const studentsByKey = new Map(
    readCentralStudentsCached_().map(function (student) {
      return [student.studentKey, student];
    })
  );
  const students = keys.map(function (key) {
    const student = studentsByKey.get(key);
    if (
      !student
        || !student.active
        || !centralStudentBelongsToAssignment_(student, assignment)
    ) {
      throw createCentralError_(
        'STUDENT_FORBIDDEN',
        '현재 담당 수업에 포함되지 않은 학생 사진 요청입니다.'
      );
    }
    return student;
  });
  const photoRows = readCentralPhotoRowsCached_();
  const folder = getCentralPhotoFolder_();
  const photos = {};
  const versions = {};
  const missingStudentKeys = [];
  const deferredStudentKeys = [];
  let responseChars = 0;
  students.forEach(function (student) {
    const entry = photoRows.get(student.studentKey);
    if (!entry) {
      missingStudentKeys.push(student.studentKey);
      return;
    }
    try {
      const image = readCentralStudentPhoto_(student, entry, folder);
      if (
        responseChars + image.dataUrl.length
          > CENTRAL_CONFIG.maxPhotoResponseChars
      ) {
        deferredStudentKeys.push(student.studentKey);
        return;
      }
      photos[student.studentKey] = image.dataUrl;
      versions[student.studentKey] = image.version;
      responseChars += image.dataUrl.length;
    } catch (error) {
      missingStudentKeys.push(student.studentKey);
    }
  });
  return {
    photos: photos,
    photoVersions: versions,
    missingStudentKeys: missingStudentKeys,
    deferredStudentKeys: deferredStudentKeys,
  };
}

function normalizeCentralStudentKeyList_(value) {
  if (!Array.isArray(value)) {
    throw new Error('사진을 조회할 학생 목록이 올바르지 않습니다.');
  }
  const keys = Array.from(new Set(value.map(function (key) {
    return normalizeCentralKey_(key, '학생키');
  })));
  if (keys.length > CENTRAL_CONFIG.maxPhotoBatchSize) {
    throw new Error(
      `사진은 한 번에 ${CENTRAL_CONFIG.maxPhotoBatchSize}명까지 조회할 수 있습니다.`
    );
  }
  return keys;
}

function readCentralPhotoRows_(sheet) {
  if (!centralHeadersMatch_(sheet, CENTRAL_PHOTO_HEADERS)) {
    throw createCentralError_(
      'CENTRAL_SCHEMA_INVALID',
      '중앙 학생사진 시트의 머리글을 확인해 주세요.'
    );
  }
  const result = new Map();
  const rowCount = sheet.getLastRow() - 1;
  if (rowCount <= 0) return result;
  const values = sheet
    .getRange(2, 1, rowCount, CENTRAL_PHOTO_HEADERS.length)
    .getValues();
  const displayValues = sheet
    .getRange(2, 1, rowCount, CENTRAL_PHOTO_HEADERS.length)
    .getDisplayValues();
  values.forEach(function (row, index) {
    const display = displayValues[index];
    const studentKey = String(display[0] || '').trim();
    const fileId = String(display[3] || '').trim();
    if (!studentKey || !isValidCentralDriveId_(fileId)) return;
    result.set(studentKey, {
      studentKey: studentKey,
      schoolYear: Number(row[1]) || '',
      photoKey: String(display[2] || '').trim(),
      fileId: fileId,
      fileName: String(display[4] || '').trim(),
      mimeType: String(display[5] || '').trim().toLowerCase(),
      lastUpdated: row[6],
      synchronizedAt: row[7],
      rowNumber: index + 2,
    });
  });
  return result;
}

function readCentralPhotoRowsCached_() {
  const sheet = getRequiredCentralPhotoSheet_();
  const cache = CacheService.getScriptCache();
  const key = centralCacheKey_(sheet.getParent(), 'photo-rows');
  const cached = cache.get(key);
  if (cached) {
    try {
      return new Map(JSON.parse(cached).map(function (entry) {
        return [entry.studentKey, entry];
      }));
    } catch (error) {
      cache.remove(key);
    }
  }
  const rows = Array.from(readCentralPhotoRows_(sheet).values());
  const json = JSON.stringify(rows);
  if (json.length <= 90000) {
    try {
      cache.put(key, json, CENTRAL_CONFIG.cacheSeconds);
    } catch (error) {
      // 캐시 실패 시에도 중앙 시트 조회 결과를 사용한다.
    }
  }
  return new Map(rows.map(function (entry) {
    return [entry.studentKey, entry];
  }));
}

function readCentralStudentPhoto_(student, entry, folder) {
  if (
    !student
      || !entry
      || entry.studentKey !== student.studentKey
      || !isValidCentralDriveId_(entry.fileId)
  ) {
    throw createCentralError_(
      'PHOTO_LINK_INVALID',
      '학생 사진 연결정보가 올바르지 않습니다.'
    );
  }
  const cache = CacheService.getScriptCache();
  const snapshotVersion = centralPhotoEntryVersion_(entry);
  const fastCacheKey = snapshotVersion
    ? centralPhotoFastCacheKey_(
      student.studentKey,
      entry.fileId,
      snapshotVersion
    )
    : '';
  // 최근 Drive 검증 표식만 짧게 재사용하고 만료 후에는 원본 권한을 다시 확인한다.
  if (fastCacheKey) {
    const marker = String(cache.get(fastCacheKey) || '');
    const separator = marker.indexOf('|');
    if (separator > 0) {
      const version = marker.slice(0, separator);
      const cacheKey = marker.slice(separator + 1);
      const cached = cache.get(cacheKey);
      if (cached) {
        return { dataUrl: cached, version: version };
      }
    }
    if (marker) cache.remove(fastCacheKey);
  }
  let file;
  try {
    file = DriveApp.getFileById(entry.fileId);
  } catch (error) {
    throw createCentralError_(
      'PHOTO_LINK_INVALID',
      '학생 사진 연결정보를 확인할 수 없습니다.'
    );
  }
  if (
    file.isTrashed()
      || !centralFileBelongsToFolder_(file, folder.getId())
  ) {
    throw createCentralError_(
      'PHOTO_LINK_INVALID',
      '중앙 사진 폴더에 등록된 파일이 아닙니다.'
    );
  }
  const mimeType = String(
    file.getMimeType() || entry.mimeType || ''
  ).toLowerCase();
  if (!CENTRAL_ALLOWED_PHOTO_MIME_TYPES.includes(mimeType)) {
    throw createCentralError_(
      'PHOTO_MIME_INVALID',
      '지원하지 않는 학생 사진 형식입니다.'
    );
  }
  if (file.getSize() > CENTRAL_CONFIG.maxPhotoBytes) {
    throw createCentralError_(
      'PHOTO_TOO_LARGE',
      '웹용 학생 사진의 허용 용량을 초과했습니다.'
    );
  }
  const version = centralPhotoVersion_(entry, file);
  const cacheKey = centralPhotoCacheKey_(
    student.studentKey,
    entry.fileId,
    version
  );
  const cached = cache.get(cacheKey);
  if (cached) {
    putCentralPhotoFastCache_(
      cache,
      fastCacheKey,
      cacheKey,
      version
    );
    return { dataUrl: cached, version: version };
  }
  const blob = file.getBlob();
  const bytes = blob.getBytes();
  if (bytes.length > CENTRAL_CONFIG.maxPhotoBytes) {
    throw createCentralError_(
      'PHOTO_TOO_LARGE',
      '웹용 학생 사진의 허용 용량을 초과했습니다.'
    );
  }
  const dataUrl = `data:${mimeType};base64,${
    Utilities.base64Encode(bytes)
  }`;
  if (dataUrl.length <= 90000) {
    try {
      cache.put(
        cacheKey,
        dataUrl,
        CENTRAL_CONFIG.photoCacheSeconds
      );
      putCentralPhotoFastCache_(
        cache,
        fastCacheKey,
        cacheKey,
        version
      );
    } catch (error) {
      // 캐시 실패 시에도 현재 이미지 반환을 유지한다.
    }
  }
  return { dataUrl: dataUrl, version: version };
}

function putCentralPhotoFastCache_(cache, fastCacheKey, cacheKey, version) {
  if (!fastCacheKey) return;
  try {
    cache.put(
      fastCacheKey,
      `${version}|${cacheKey}`,
      CENTRAL_CONFIG.cacheSeconds
    );
  } catch (error) {
    // 단기 표식 실패 시 다음 요청에서 Drive 검증을 다시 수행한다.
  }
}

function centralFileBelongsToFolder_(file, folderId) {
  const parents = file.getParents();
  while (parents.hasNext()) {
    if (parents.next().getId() === folderId) return true;
  }
  return false;
}

function centralPhotoVersion_(entry, file) {
  const updated = file.getLastUpdated();
  const millis = updated instanceof Date
    ? updated.getTime()
    : new Date(entry.lastUpdated).getTime() || 0;
  return centralHash_(`${entry.studentKey}:${entry.fileId}:${millis}`)
    .slice(0, 16);
}

function centralPhotoEntryVersion_(entry) {
  const updated = entry && entry.lastUpdated;
  const millis = updated instanceof Date
    ? updated.getTime()
    : new Date(updated).getTime();
  if (!Number.isFinite(millis) || millis <= 0) return '';
  return centralHash_(`${entry.studentKey}:${entry.fileId}:${millis}`)
    .slice(0, 16);
}

function centralPhotoFastCacheKey_(studentKey, fileId, version) {
  return `central-photo-fast:${
    centralHash_(`${studentKey}:${fileId}:${version}`)
  }`;
}

function centralPhotoCacheKey_(studentKey, fileId, version) {
  return `central-photo:${
    centralHash_(`${studentKey}:${fileId}:${version}`)
  }`;
}

function centralCacheKey_(spreadsheet, suffix) {
  return `central:${
    centralHash_(
      `${spreadsheet.getId()}:${CENTRAL_CONFIG.schemaVersion}:${suffix}`
    )
  }`;
}

function centralHash_(value) {
  return Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value || ''),
    Utilities.Charset.UTF_8
  ).map(function (byte) {
    return ((byte + 256) % 256).toString(16).padStart(2, '0');
  }).join('');
}

function normalizeCentralKey_(value, label) {
  const key = String(value || '').trim();
  if (!key || key.length > 100) {
    throw new Error(`${label}가 올바르지 않습니다.`);
  }
  return key;
}

function withCentralWriteLock_(callback) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(CENTRAL_CONFIG.lockTimeoutMs)) {
    throw createCentralError_(
      'CENTRAL_LOCK_TIMEOUT',
      '다른 관리자가 중앙 자료를 수정 중입니다. 잠시 후 다시 시도해 주세요.'
    );
  }
  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}

function createCentralError_(code, message) {
  const error = new Error(message);
  error.centralCode = code;
  return error;
}

function centralErrorCode_(error) {
  return error && error.centralCode
    ? String(error.centralCode)
    : 'CENTRAL_ACCESS_ERROR';
}
