// © 2026 류기현(부산 동아공고). CC BY-NC-SA 4.0(저작자표시-비영리-동일조건변경허락).
// https://creativecommons.org/licenses/by-nc-sa/4.0/deed.ko  문의: ryu1912@naver.com

const APP_CONFIG = Object.freeze({
  version: '8.4.0-cp5',
  recordSheetName: '활동기록',
  archivedRecordSheetName: '활동기록보관',
  deletedRecordSheetName: '삭제기록',
  settingsSheetName: '설정',
  allowedGrades: Object.freeze([1, 2, 3]),
  studentStatuses: Object.freeze(['재학', '위탁', '전학', '자퇴']),
  recordableStudentStatuses: Object.freeze(['재학', '위탁']),
  categories: Object.freeze(['칭찬·긍정', '지도 필요·부정']),
  maxStudentNameLength: 50,
  maxStudentNumber: 999,
  maxSubjectLength: 50,
  maxMemoLength: 2000,
  maxDeleteReasonLength: 200,
  maxRecentRecords: 20,
  maxRecordSearchResults: 100,
  maxStudentSearchResults: 50,
  maxAssignments: 10,
  cacheSeconds: 300,
});

const LEGACY_RECORD_HEADERS = Object.freeze([
  '기록ID', '기록일시', '학년', '반', '번호', '이름', '학적상태',
  '구분', '역량', '과목', '내용메모', '작성자', '수정일시',
]);
const RECORD_HEADERS = Object.freeze([
  ...LEGACY_RECORD_HEADERS, '학생ID', '학년도',
]);
const LEGACY_DELETED_RECORD_HEADERS = Object.freeze([
  ...LEGACY_RECORD_HEADERS, '삭제일시', '삭제자', '삭제사유',
]);
const DELETED_RECORD_HEADERS = Object.freeze([
  ...LEGACY_DELETED_RECORD_HEADERS, '학생ID', '학년도',
]);
const COMPETENCY_HEADERS = Object.freeze(['구분', '역량', '설명', '사용', '정렬']);
const SUBJECT_HEADERS = Object.freeze(['학년', '기본과목']);

const DEFAULT_COMPETENCIES = Object.freeze([
  ['칭찬·긍정', '학업태도·성실성', '수업과 과제를 꾸준하고 책임감 있게 수행하는 태도', true, 10],
  ['칭찬·긍정', '자기주도·성찰', '목표와 전략을 스스로 세우고 과정을 점검·개선하는 힘', true, 20],
  ['칭찬·긍정', '탐구·문제해결', '호기심을 바탕으로 질문하고 근거를 찾아 해결하는 힘', true, 30],
  ['칭찬·긍정', '비판적·창의적 사고', '자료를 비판적으로 해석하고 융합해 새로운 의미를 만드는 힘', true, 40],
  ['칭찬·긍정', '지식정보·디지털 활용', '자료와 매체를 수집·분석·평가해 적절히 활용하는 힘', true, 50],
  ['칭찬·긍정', '의사소통·표현', '경청하고 생각과 감정을 말·글·매체로 효과적으로 표현하는 힘', true, 60],
  ['칭찬·긍정', '협업·대인관계', '다양한 구성원과 역할을 나누고 공동 목표를 이루는 힘', true, 70],
  ['칭찬·긍정', '배려·나눔', '타인을 존중하고 공감하며 배려와 나눔을 실천하는 태도', true, 80],
  ['칭찬·긍정', '공동체·규칙준수', '공동체의 규칙과 책임을 이해하고 적극적으로 참여하는 태도', true, 90],
  ['칭찬·긍정', '리더십', '구성원의 참여를 이끌고 공동 과정을 조정하는 힘', true, 100],
  ['칭찬·긍정', '진로탐색·도전', '관심 분야를 탐색하고 목표를 향해 도전하며 성장하는 태도', true, 110],
  ['칭찬·긍정', '문화감수성·인문소양', '문학·예술과 다양한 가치를 공감적으로 이해하고 향유하는 힘', true, 120],
  ['지도 필요·부정', '학업태도', '수업 참여, 과제 수행, 준비 상태에 관한 지도', true, 210],
  ['지도 필요·부정', '자기관리', '시간, 준비물, 감정, 생활 습관에 관한 지도', true, 220],
  ['지도 필요·부정', '교우관계', '또래 관계와 갈등 상황에 관한 지도', true, 230],
  ['지도 필요·부정', '의사소통', '경청, 표현 방식, 언어 사용에 관한 지도', true, 240],
  ['지도 필요·부정', '협업·참여', '모둠 역할과 공동 활동 참여에 관한 지도', true, 250],
  ['지도 필요·부정', '배려·공감', '타인 존중과 공감 행동에 관한 지도', true, 260],
  ['지도 필요·부정', '규칙준수', '교실 및 학교 규칙 준수에 관한 지도', true, 270],
  ['지도 필요·부정', '안전·생활지도', '안전 수칙과 기본 생활 태도에 관한 지도', true, 280],
  ['지도 필요·부정', '기타', '다른 항목에 속하지 않는 관찰', true, 290],
]);

const DEFAULT_SUBJECTS = Object.freeze([
  [2, '문학'],
  [3, '실용국어'],
]);

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('학생 활동 기록')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

function getAppBootstrapState(requestedMode) {
  const installation = getSchoolInstallationState_();
  if (!installation.ready) {
    const installationRole = installation.adminConfigured
      ? getCurrentUserRole_()
      : 'UNCONFIGURED';
    return {
      version: APP_CONFIG.version,
      role: installationRole,
      mode: 'INSTALLATION',
      installation: installation,
    };
  }
  // 역할 판정에 이미 확인한 이메일을 화면 표시에도 재사용한다.
  // 표시용 조회를 따로 만들면 부가 기능 실패가 앱 접속까지 막을 수 있다.
  const userEmail = getRequiredActiveUserEmail_();
  const role = isAdminEmail_(userEmail) ? 'ADMIN' : 'USER';
  const requested = String(requestedMode || '').trim();
  if (requested === 'ADMIN_PORTAL' && role !== 'ADMIN') {
    throw createCentralError_(
      'ADMIN_REQUIRED',
      '관리자 권한이 필요한 화면입니다.'
    );
  }
  if (role === 'ADMIN' && requested !== 'PERSONAL_USER') {
    return {
      version: APP_CONFIG.version,
      role: role,
      mode: 'ADMIN_PORTAL',
      userEmail: userEmail,
      schoolName: installation.schoolName,
      dashboard: buildAdminDashboard_(),
    };
  }
  // 설치할 때 입력한 학교명은 어느 학교 자료를 보고 있는지 알려 준다.
  // 여러 학교가 같은 코드를 각자 배포하므로 화면에 드러나야 한다.
  const personal = buildPersonalModeBootstrap_(role);
  personal.userEmail = userEmail;
  personal.schoolName = installation.schoolName;
  return personal;
}

function buildPersonalModeBootstrap_(role) {
  const result = {
    version: APP_CONFIG.version,
    role: role,
    mode: 'PERSONAL_USER',
    central: null,
    storage: null,
    assignments: [],
    competencies: [],
    categories: APP_CONFIG.categories.slice(),
    recordableStudentStatuses: APP_CONFIG.recordableStudentStatuses.slice(),
    currentSchoolYear: getCurrentSchoolYear_(),
  };
  // 담당 수업 신청은 승인 전 교사도 할 수 있어야 하는데, 승인돼야 중앙
  // 자료 접근 권한이 생긴다. 승인 전 교사가 중앙 스프레드시트를 열려고
  // 시도하면(0건 접근 권한) Apps Script가 일반 예외가 아니라 이 함수
  // 호출 자체를 실패시키는 경우가 있어, 개인 저장소 준비까지 통째로
  // 막힐 수 있다. 그래서 중앙 자료 상태 확인은 이 함수에서 아예 빼고
  // getPersonalCentralStatus()로 완전히 분리한다.
  const preparedStorage = preparePersonalStorageContext_();
  result.storage = preparedStorage.storage;
  if (!preparedStorage.storage.ok) return result;
  const spreadsheet = preparedStorage.context.database.spreadsheet;
  ensurePersonalApplicationSchema_(spreadsheet);
  const settingsSheet = ensureSettingsSheet_(spreadsheet);
  ensureRecordSheet_(spreadsheet);
  ensureArchivedRecordSheet_(spreadsheet);
  ensureDeletedRecordSheet_(spreadsheet);
  const settings = readSettingsCached_(spreadsheet, settingsSheet);
  result.competencies = settings.competencies;
  return result;
}

// 중앙 자료 연결 상태와 담당 목록은 부트스트랩과 별도 호출로 분리한다.
// 승인 전 교사가 중앙 스프레드시트를 열려는 시도 자체가 호출을 실패시킬
// 수 있는데, 별도 호출이면 이 실패가 개인 저장소·신청 화면까지 끌고
// 내려가지 않는다. 클라이언트는 이 호출의 실패를 치명적 오류로 취급하지
// 않고 "중앙 자료 접근 불가"로 우아하게 표시한다.
function getPersonalCentralStatus() {
  const centralContext = getCentralConnectionContext_(false);
  const central = centralContext.state;
  const result = { central: central, assignments: [] };
  if (central.ready && centralContext.schema) {
    result.assignments = getMyAssignmentsFromCentralSheet_(
      centralContext.schema.assignmentSheet
    );
  }
  return result;
}

function searchStudents(options) {
  const value = options || {};
  if (!value.assignmentKey) {
    throw createCentralError_(
      'ASSIGNMENT_REQUIRED',
      '담당 수업을 먼저 선택해 주세요.'
    );
  }
  return getStudentsForMyAssignment(value.assignmentKey, {
    query: value.query,
    limit: value.limit,
    offset: value.offset,
  });
}

// 현재 사용자의 개인 기록만 보관 이동한다. 아직 화면 진입점이 없어
// google.script.run 으로만 호출되며, 남의 자료에는 접근하지 않는다.
function archivePreviousSchoolYearRecords() {
  return withAppLock_(function () {
    const spreadsheet = getAppSpreadsheet_();
    const recordSheet = ensureRecordSheet_(spreadsheet);
    const archiveSheet = ensureArchivedRecordSheet_(spreadsheet);
    const rowCount = recordSheet.getLastRow() - 1;
    const currentSchoolYear = getCurrentSchoolYear_();
    if (rowCount <= 0) {
      return { ok: true, archivedRows: 0, currentSchoolYear: currentSchoolYear };
    }

    const rows = recordSheet.getRange(2, 1, rowCount, RECORD_HEADERS.length).getValues();
    const archivedRows = rows.filter(function (row) {
      const schoolYear = Number(row[14]);
      return Number.isInteger(schoolYear) && schoolYear < currentSchoolYear;
    });
    if (archivedRows.length === 0) {
      return { ok: true, archivedRows: 0, currentSchoolYear: currentSchoolYear };
    }
    const activeRows = rows.filter(function (row) {
      const schoolYear = Number(row[14]);
      return !Number.isInteger(schoolYear) || schoolYear >= currentSchoolYear;
    });
    const archiveStartRow = archiveSheet.getLastRow() + 1;
    archiveSheet
      .getRange(archiveStartRow, 1, archivedRows.length, RECORD_HEADERS.length)
      .setValues(archivedRows);
    recordSheet.getRange(2, 1, rowCount, RECORD_HEADERS.length).clearContent();
    if (activeRows.length > 0) {
      recordSheet.getRange(2, 1, activeRows.length, RECORD_HEADERS.length).setValues(activeRows);
    }
    return {
      ok: true,
      archivedRows: archivedRows.length,
      currentSchoolYear: currentSchoolYear,
    };
  });
}

function saveRecord(payload) {
  return withPersonalDatabaseLock_(function () {
    const context = getPersonalRecordContext_();
    const identity = resolveUserIdentity_();
    const normalized = validateCentralRecordPayload_(payload, context.settingsSheet);
    const now = new Date();
    const recordId = Utilities.getUuid();
    const recordedAuthor = getIdentityAuthor_(identity);
    const nextRow = context.recordSheet.getLastRow() + 1;
    context.recordSheet.getRange(nextRow, 1, 1, RECORD_HEADERS.length).setValues([[
      recordId,
      now,
      normalized.student.grade,
      normalized.student.classNumber,
      normalized.student.studentNumber,
      sanitizeSpreadsheetText_(normalized.student.name),
      sanitizeSpreadsheetText_(normalized.student.status),
      normalized.category,
      sanitizeSpreadsheetText_(normalized.competencies.join('\n')),
      sanitizeSpreadsheetText_(normalized.subject),
      sanitizeSpreadsheetText_(normalized.memo),
      sanitizeSpreadsheetText_(recordedAuthor),
      now,
      normalized.student.studentId,
      normalized.student.schoolYear,
    ]]);
    formatRecordRow_(context.recordSheet, nextRow);

    return {
      ok: true,
      savedRecord: {
        id: recordId,
        recordedAt: formatDateTime_(now, ''),
        schoolYear: normalized.student.schoolYear,
        category: normalized.category,
        competencies: normalized.competencies.slice(),
        subject: normalized.subject,
        memo: normalized.memo,
        canEdit: canDeleteRecord_(recordedAuthor, identity),
        canDelete: canDeleteRecord_(recordedAuthor, identity),
      },
    };
  });
}

function updateRecord(recordId, patch) {
  return withPersonalDatabaseLock_(function () {
    const context = getPersonalRecordContext_();
    const identity = resolveUserIdentity_();
    const recordSheets = [context.recordSheet, context.archiveSheet];
    const located = findRecordRow_(recordSheets, recordId);
    requireDeletePermission_(located.displayValues[11], identity);
    const assignment = requireAssignmentForRecordSnapshot_(
      located.values,
      patch && patch.assignmentKey
    );
    const student = getCentralStudentByKey_(
      String(located.values[13] || ''),
      true
    );
    requireCentralStudentAssignment_(student, assignment);
    const normalized = validateCentralRecordPayload_(
      {
        assignmentKey: assignment.assignmentKey,
        studentKey: student.studentKey,
        category: patch && patch.category != null
          ? patch.category
          : located.displayValues[7],
        competencies: patch && patch.competencies != null
          ? patch.competencies
          : String(located.displayValues[8] || '')
            .split('\n')
            .filter(Boolean),
        subject: patch && patch.subject != null
          ? patch.subject
          : located.displayValues[9],
        memo: patch && patch.memo != null
          ? patch.memo
          : located.displayValues[10],
      },
      context.settingsSheet
    );
    const now = new Date();
    located.sheet
      .getRange(located.rowNumber, 8, 1, 6)
      .setValues([[
        normalized.category,
        sanitizeSpreadsheetText_(normalized.competencies.join('\n')),
        sanitizeSpreadsheetText_(normalized.subject),
        sanitizeSpreadsheetText_(normalized.memo),
        located.values[11],
        now,
      ]]);
    formatRecordRow_(located.sheet, located.rowNumber);
    return {
      ok: true,
      recentRecords: readRecentRecords_(
        recordSheets,
        student,
        5,
        identity
      ),
    };
  });
}

function getRecentRecords(studentKey, assignmentKey, limit) {
  const context = getPersonalRecordContext_();
  const identity = resolveUserIdentity_();
  const assignment = requireMyAssignment_(assignmentKey);
  const student = getCentralStudentByKey_(studentKey, true);
  requireCentralStudentAssignment_(student, assignment);
  const safeLimit = Math.min(
    Math.max(Number(limit) || 5, 1),
    APP_CONFIG.maxRecentRecords,
  );
  return readRecentRecords_(
    [context.recordSheet, context.archiveSheet],
    centralStudentToLegacyStudent_(student),
    safeLimit,
    identity
  );
}

function searchRecords(options) {
  const context = getPersonalRecordContext_();
  const identity = resolveUserIdentity_();
  const criteria = normalizeRecordSearchOptions_(options);
  const assignments = getMyAssignments();
  if (criteria.studentId) {
    const assignment = requireMyAssignment_(
      options && options.assignmentKey
    );
    const selectedStudent = getCentralStudentByKey_(
      criteria.studentId,
      true
    );
    requireCentralStudentAssignment_(selectedStudent, assignment);
  }

  const sources = [];
  if (criteria.archiveState !== 'archived') {
    sources.push({
      sheet: context.recordSheet,
      archived: false,
    });
  }
  if (criteria.archiveState !== 'active') {
    sources.push({
      sheet: context.archiveSheet,
      archived: true,
    });
  }
  return readCentralFilteredPersonalRecords_(
    sources,
    assignments,
    criteria,
    identity
  );
}

function deleteRecord(recordId, reason) {
  return withPersonalDatabaseLock_(function () {
    const context = getPersonalRecordContext_();
    const recordSheets = [
      context.recordSheet,
      context.archiveSheet,
    ];
    const identity = resolveUserIdentity_();

    const located = findRecordRow_(recordSheets, recordId);
    requireAssignmentForRecordSnapshot_(located.values, '');
    const studentSnapshot = {
      studentId: String(located.values[13]),
      schoolYear: Number(located.values[14]),
      grade: Number(located.values[2]),
      classNumber: Number(located.values[3]),
      studentNumber: Number(located.values[4]),
      name: String(located.displayValues[5]),
      status: String(located.displayValues[6]),
    };
    requireDeletePermission_(located.displayValues[11], identity);

    const safeReason = normalizeDeleteReason_(reason);
    const now = new Date();
    const deletedBy = getIdentityAuthor_(identity);
    const deletedRow = [
      ...located.values.slice(0, LEGACY_RECORD_HEADERS.length),
      now,
      sanitizeSpreadsheetText_(deletedBy),
      sanitizeSpreadsheetText_(safeReason),
      located.values[13],
      located.values[14],
    ];
    const nextDeletedRow = context.deletedRecordSheet.getLastRow() + 1;
    context.deletedRecordSheet
      .getRange(nextDeletedRow, 1, 1, DELETED_RECORD_HEADERS.length)
      .setValues([deletedRow]);
    formatDeletedRecordRow_(context.deletedRecordSheet, nextDeletedRow);

    // 보존에 성공한 뒤 원본을 제거해 예기치 않은 데이터 유실을 피한다.
    located.sheet.deleteRow(located.rowNumber);
    return {
      ok: true,
      recentRecords: readRecentRecords_(
        recordSheets,
        studentSnapshot,
        5,
        identity
      ),
    };
  });
}

function getPersonalRecordContext_() {
  const spreadsheet = getAppSpreadsheet_();
  const settingsSheet = requirePersonalRecordSheetHandle_(
    spreadsheet, APP_CONFIG.settingsSheetName
  );
  const recordSheet = requirePersonalRecordSheetHandle_(
    spreadsheet, APP_CONFIG.recordSheetName
  );
  const archiveSheet = requirePersonalRecordSheetHandle_(
    spreadsheet, APP_CONFIG.archivedRecordSheetName
  );
  const deletedRecordSheet = requirePersonalRecordSheetHandle_(
    spreadsheet, APP_CONFIG.deletedRecordSheetName
  );

  // 머리글 검사는 시트 4개마다 원격 호출이 드는데, 저장·조회·삭제
  // 요청마다 매번 다시 확인할 필요는 없다. 짧은 기간 동안 재확인을
  // 건너뛰고, 스키마가 실제로 바뀌는 시점(ensurePersonalApplicationSchema_)
  // 에는 표식을 지워 다음 요청이 다시 검사하게 한다.
  if (!isPersonalRecordSchemaVerifiedRecently_(spreadsheet)) {
    assertHeaders_(
      settingsSheet, 1, 1, COMPETENCY_HEADERS, APP_CONFIG.settingsSheetName
    );
    assertHeaders_(
      settingsSheet, 1, 7, SUBJECT_HEADERS, APP_CONFIG.settingsSheetName
    );
    assertHeaders_(
      recordSheet, 1, 1, RECORD_HEADERS, APP_CONFIG.recordSheetName
    );
    assertHeaders_(
      archiveSheet, 1, 1, RECORD_HEADERS, APP_CONFIG.archivedRecordSheetName
    );
    assertHeaders_(
      deletedRecordSheet,
      1,
      1,
      DELETED_RECORD_HEADERS,
      APP_CONFIG.deletedRecordSheetName
    );
    markPersonalRecordSchemaVerified_(spreadsheet);
  }

  return {
    spreadsheet: spreadsheet,
    settingsSheet: settingsSheet,
    recordSheet: recordSheet,
    archiveSheet: archiveSheet,
    deletedRecordSheet: deletedRecordSheet,
  };
}

function requirePersonalRecordSheetHandle_(spreadsheet, sheetName) {
  const sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    throw new Error(`'${sheetName}' 시트를 찾을 수 없습니다. 웹앱을 새로고침해 주세요.`);
  }
  return sheet;
}

const PERSONAL_RECORD_SCHEMA_CACHE_SECONDS = 120;

function personalRecordSchemaCacheKey_(spreadsheet) {
  return `personal-record-schema:${APP_CONFIG.version}:${spreadsheet.getId()}`;
}

function isPersonalRecordSchemaVerifiedRecently_(spreadsheet) {
  try {
    return Boolean(
      CacheService.getUserCache().get(personalRecordSchemaCacheKey_(spreadsheet))
    );
  } catch (error) {
    return false;
  }
}

function markPersonalRecordSchemaVerified_(spreadsheet) {
  try {
    CacheService.getUserCache().put(
      personalRecordSchemaCacheKey_(spreadsheet),
      '1',
      PERSONAL_RECORD_SCHEMA_CACHE_SECONDS
    );
  } catch (error) {
    // 캐시 실패 시에도 이번 요청은 이미 검증을 마쳤으므로 계속 진행한다.
  }
}

function clearPersonalRecordSchemaVerification_(spreadsheet) {
  try {
    CacheService.getUserCache().remove(personalRecordSchemaCacheKey_(spreadsheet));
  } catch (error) {
    // 캐시 제거 실패는 다음 만료 시점에 자연히 복구된다.
  }
}

function validateCentralRecordPayload_(payload, settingsSheet) {
  const value = payload || {};
  const assignment = requireMyAssignment_(value.assignmentKey);
  const student = getCentralStudentByKey_(
    value.studentKey || value.studentId,
    false
  );
  requireCentralStudentAssignment_(student, assignment);
  requireRecordableStudent_(centralStudentToLegacyStudent_(student));
  const category = String(value.category || '').trim();
  if (!APP_CONFIG.categories.includes(category)) {
    throw new Error('기록 구분을 선택해 주세요.');
  }
  if (!Array.isArray(value.competencies)) {
    throw new Error('역량 선택값이 올바르지 않습니다.');
  }
  const settings = readCompetencies_(settingsSheet);
  const allowedCompetencies = new Set(
    (settings[category] || []).map(function (item) { return item.label; })
  );
  const competencies = Array.from(new Set(value.competencies.map(function (item) {
    return String(item || '').trim();
  }).filter(Boolean)));
  if (
    competencies.length === 0
      || competencies.some(function (item) { return !allowedCompetencies.has(item); })
  ) {
    throw new Error('선택한 구분에 맞는 역량을 하나 이상 선택해 주세요.');
  }
  const memo = String(value.memo || '').trim();
  if (memo.length > APP_CONFIG.maxMemoLength) {
    throw new Error(`내용 메모는 ${APP_CONFIG.maxMemoLength}자 이내로 입력해 주세요.`);
  }
  return {
    assignment: assignment,
    student: centralStudentToLegacyStudent_(student),
    category: category,
    competencies: competencies,
    subject: assignment.subject,
    memo: memo,
  };
}

function centralStudentToLegacyStudent_(student) {
  return {
    studentId: student.studentKey,
    studentKey: student.studentKey,
    schoolYear: student.schoolYear,
    grade: student.grade,
    classNumber: student.classNumber,
    studentNumber: student.studentNumber,
    name: student.name,
    status: student.status,
    active: student.active,
  };
}

function requireAssignmentForRecordSnapshot_(row, requestedAssignmentKey) {
  const assignments = getMyAssignments();
  const requested = String(requestedAssignmentKey || '').trim();
  const assignment = requested
    ? requireMyAssignment_(requested)
    : assignments.find(function (candidate) {
      return candidate.schoolYear === Number(row[14])
        && candidate.grade === Number(row[2])
        && candidate.classNumber === Number(row[3])
        && candidate.subject === String(row[9] || '').trim();
    });
  if (
    !assignment
      || assignment.schoolYear !== Number(row[14])
      || assignment.grade !== Number(row[2])
      || assignment.classNumber !== Number(row[3])
      || assignment.subject !== String(row[9] || '').trim()
  ) {
    throw createCentralError_(
      'ASSIGNMENT_FORBIDDEN',
      '현재 담당 수업에 포함된 기록이 아닙니다.'
    );
  }
  return assignment;
}

function readCentralFilteredPersonalRecords_(
  sources,
  assignments,
  criteria,
  identity
) {
  const studentsByKey = new Map(
    readCentralStudentsCached_().map(function (student) {
      return [student.studentKey, student];
    })
  );
  const records = [];
  sources.forEach(function (source) {
    const rowCount = source.sheet.getLastRow() - 1;
    if (rowCount <= 0) return;
    const values = source.sheet
      .getRange(2, 1, rowCount, RECORD_HEADERS.length)
      .getValues();
    const displayValues = source.sheet
      .getRange(2, 1, rowCount, RECORD_HEADERS.length)
      .getDisplayValues();
    values.forEach(function (row, index) {
      const display = displayValues[index];
      const studentKey = String(row[13] || '').trim();
      const assignment = assignments.find(function (candidate) {
        return candidate.schoolYear === Number(row[14])
          && candidate.grade === Number(row[2])
          && candidate.classNumber === Number(row[3])
          && candidate.subject === String(display[9] || '').trim();
      });
      if (
        !assignment
          || (criteria.studentId && criteria.studentId !== studentKey)
          || (criteria.category && criteria.category !== display[7])
          || (criteria.subject && criteria.subject !== display[9])
      ) {
        return;
      }
      const recordedAtValue = row[1] instanceof Date
        ? row[1].getTime()
        : new Date(row[1]).getTime();
      if (
        !Number.isFinite(recordedAtValue)
          || (criteria.fromTime != null && recordedAtValue < criteria.fromTime)
          || (criteria.toTime != null && recordedAtValue >= criteria.toTime)
      ) {
        return;
      }
      const centralStudent = studentsByKey.get(studentKey);
      const displayStudent = centralStudent
        ? centralStudentToLegacyStudent_(centralStudent)
        : {
          studentId: studentKey,
          studentKey: studentKey,
          schoolYear: Number(row[14]) || '',
          grade: Number(row[2]),
          classNumber: Number(row[3]),
          studentNumber: Number(row[4]),
          name: String(display[5] || '').trim(),
          status: String(display[6] || '').trim(),
        };
      const recordedAuthor = String(display[11] || '').trim();
      records.push({
        id: String(row[0] || ''),
        recordedAtValue: recordedAtValue,
        recordedAt: formatDateTime_(row[1], display[1]),
        schoolYear: Number(row[14]) || '',
        student: toPublicStudent_(displayStudent),
        category: display[7],
        competencies: String(display[8] || '').split(/\r?\n/).filter(Boolean),
        subject: display[9],
        memo: display[10],
        archived: Boolean(source.archived),
        canEdit: canDeleteRecord_(recordedAuthor, identity),
        canDelete: canDeleteRecord_(recordedAuthor, identity),
      });
    });
  });
  return records.sort(function (left, right) {
    return right.recordedAtValue - left.recordedAtValue;
  }).slice(0, criteria.limit).map(function (record) {
    delete record.recordedAtValue;
    return record;
  });
}

function ensureSettingsSheet_(spreadsheet) {
  let sheet = spreadsheet.getSheetByName(APP_CONFIG.settingsSheetName);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(APP_CONFIG.settingsSheetName);
    initializeSettingsSheet_(sheet);
    return sheet;
  }
  if (sheet.getLastRow() === 0) {
    initializeSettingsSheet_(sheet);
    return sheet;
  }
  assertHeaders_(sheet, 1, 1, COMPETENCY_HEADERS, APP_CONFIG.settingsSheetName);
  assertHeaders_(sheet, 1, 7, SUBJECT_HEADERS, APP_CONFIG.settingsSheetName);
  return sheet;
}

function ensureRecordSheet_(spreadsheet) {
  let sheet = spreadsheet.getSheetByName(APP_CONFIG.recordSheetName);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(APP_CONFIG.recordSheetName);
    initializeRecordSheet_(sheet);
    return sheet;
  }
  if (sheet.getLastRow() === 0) {
    initializeRecordSheet_(sheet);
    return sheet;
  }
  migrateRecordSheet_(sheet, APP_CONFIG.recordSheetName);
  return sheet;
}

function ensureArchivedRecordSheet_(spreadsheet) {
  let sheet = spreadsheet.getSheetByName(APP_CONFIG.archivedRecordSheetName);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(APP_CONFIG.archivedRecordSheetName);
    initializeRecordSheet_(sheet);
    return sheet;
  }
  if (sheet.getLastRow() === 0) {
    initializeRecordSheet_(sheet);
    return sheet;
  }
  migrateRecordSheet_(sheet, APP_CONFIG.archivedRecordSheetName);
  return sheet;
}

function ensureDeletedRecordSheet_(spreadsheet) {
  let sheet = spreadsheet.getSheetByName(APP_CONFIG.deletedRecordSheetName);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(APP_CONFIG.deletedRecordSheetName);
    initializeDeletedRecordSheet_(sheet);
    return sheet;
  }
  if (sheet.getLastRow() === 0) {
    initializeDeletedRecordSheet_(sheet);
    return sheet;
  }
  migrateDeletedRecordSheet_(sheet);
  return sheet;
}

// 학생ID 열은 v8.4 기록에 항상 채워져 있다. v8.3 이전 기록만 합성 ID로 채운다.
function migrateRecordSheet_(sheet, label) {
  assertHeaders_(sheet, 1, 1, LEGACY_RECORD_HEADERS, label);
  ensureMinimumColumns_(sheet, RECORD_HEADERS.length);
  assertCompatibleExtensionHeaders_(sheet, 14, RECORD_HEADERS.slice(13), label);
  sheet.getRange(1, 1, 1, RECORD_HEADERS.length).setValues([RECORD_HEADERS]);
  styleHeader_(sheet.getRange(1, 1, 1, RECORD_HEADERS.length), '#1a73e8');
  const rowCount = sheet.getLastRow() - 1;
  if (rowCount <= 0) return;

  const rows = sheet.getRange(2, 1, rowCount, RECORD_HEADERS.length).getValues();
  const identityColumns = rows.map(function (row) {
    const schoolYear = normalizeSchoolYear_(row[14], schoolYearFromDate_(row[1]));
    const studentId = String(row[13] || '').trim()
      || `legacy-${Utilities.getUuid()}`;
    return [studentId, schoolYear];
  });
  sheet.getRange(2, 14, identityColumns.length, 2).setValues(identityColumns);
}

function migrateDeletedRecordSheet_(sheet) {
  assertHeaders_(
    sheet,
    1,
    1,
    LEGACY_DELETED_RECORD_HEADERS,
    APP_CONFIG.deletedRecordSheetName,
  );
  ensureMinimumColumns_(sheet, DELETED_RECORD_HEADERS.length);
  assertCompatibleExtensionHeaders_(
    sheet,
    17,
    DELETED_RECORD_HEADERS.slice(16),
    APP_CONFIG.deletedRecordSheetName,
  );
  sheet.getRange(1, 1, 1, DELETED_RECORD_HEADERS.length).setValues([DELETED_RECORD_HEADERS]);
  styleHeader_(sheet.getRange(1, 1, 1, DELETED_RECORD_HEADERS.length), '#b3261e');
  const rowCount = sheet.getLastRow() - 1;
  if (rowCount <= 0) return;

  const rows = sheet.getRange(2, 1, rowCount, DELETED_RECORD_HEADERS.length).getValues();
  const identityColumns = rows.map(function (row) {
    const schoolYear = normalizeSchoolYear_(row[17], schoolYearFromDate_(row[1]));
    const studentId = String(row[16] || '').trim()
      || `legacy-${Utilities.getUuid()}`;
    return [studentId, schoolYear];
  });
  sheet.getRange(2, 17, identityColumns.length, 2).setValues(identityColumns);
}

function ensureMinimumColumns_(sheet, requiredColumns) {
  const missingColumns = requiredColumns - sheet.getMaxColumns();
  if (missingColumns > 0) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), missingColumns);
  }
}

function assertCompatibleExtensionHeaders_(sheet, startColumn, expectedHeaders, label) {
  const actualHeaders = sheet
    .getRange(1, startColumn, 1, expectedHeaders.length)
    .getDisplayValues()[0]
    .map(function (value) { return String(value).trim(); });
  expectedHeaders.forEach(function (expectedHeader, index) {
    const actualHeader = actualHeaders[index];
    if (actualHeader && actualHeader !== expectedHeader) {
      throw new Error(
        `'${label}' 시트 ${startColumn + index}열의 기존 머리글 '${actualHeader}' 때문에 자동 마이그레이션할 수 없습니다. 먼저 사본을 만든 뒤 열 위치를 확인해 주세요.`,
      );
    }
    if (actualHeader || sheet.getLastRow() < 2) return;
    const existingValues = sheet
      .getRange(2, startColumn + index, sheet.getLastRow() - 1, 1)
      .getDisplayValues();
    if (existingValues.some(function (row) { return String(row[0]).trim(); })) {
      throw new Error(
        `'${label}' 시트 ${startColumn + index}열에 머리글 없는 기존 데이터가 있어 자동 마이그레이션을 중단했습니다.`,
      );
    }
  });
}

function initializeSettingsSheet_(sheet) {
  sheet.clear();
  sheet.setFrozenRows(1);
  sheet.setHiddenGridlines(true);
  sheet.getRange(1, 1, 1, COMPETENCY_HEADERS.length).setValues([COMPETENCY_HEADERS]);
  sheet.getRange(1, 7, 1, SUBJECT_HEADERS.length).setValues([SUBJECT_HEADERS]);
  sheet.getRange(2, 4, DEFAULT_COMPETENCIES.length, 1).insertCheckboxes();
  sheet.getRange(2, 1, DEFAULT_COMPETENCIES.length, 5).setValues(DEFAULT_COMPETENCIES);
  sheet.getRange(2, 7, DEFAULT_SUBJECTS.length, 2).setValues(DEFAULT_SUBJECTS);
  styleHeader_(sheet.getRange(1, 1, 1, 5), '#137333');
  styleHeader_(sheet.getRange(1, 7, 1, 2), '#1a73e8');
  sheet.getRange(2, 3, DEFAULT_COMPETENCIES.length, 1).setWrap(true);
  [120, 180, 360, 70, 70, 24, 70, 140].forEach(function (width, index) {
    sheet.setColumnWidth(index + 1, width);
  });
}

function initializeRecordSheet_(sheet) {
  initializeLogSheet_(sheet, RECORD_HEADERS, '#1a73e8');
  const widths = [220, 150, 60, 60, 60, 110, 90, 120, 200, 120, 420, 180, 150, 260, 90];
  widths.forEach(function (width, index) { sheet.setColumnWidth(index + 1, width); });
  formatLogColumns_(sheet, 2, 13, 9, 3);
}

function initializeDeletedRecordSheet_(sheet) {
  initializeLogSheet_(sheet, DELETED_RECORD_HEADERS, '#b3261e');
  const widths = [220, 150, 60, 60, 60, 110, 90, 120, 200, 120, 420, 180, 150, 150, 180, 220, 260, 90];
  widths.forEach(function (width, index) { sheet.setColumnWidth(index + 1, width); });
  formatLogColumns_(sheet, 2, 13, 9, 3);
  sheet.getRange(2, 14, Math.max(sheet.getMaxRows() - 1, 1), 1)
    .setNumberFormat('yyyy-mm-dd hh:mm:ss');
}

function initializeLogSheet_(sheet, headers, color) {
  sheet.clear();
  sheet.setFrozenRows(1);
  sheet.setHiddenGridlines(true);
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  styleHeader_(sheet.getRange(1, 1, 1, headers.length), color);
}

function styleHeader_(range, color) {
  range
    .setBackground(color)
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setHorizontalAlignment('center');
}

function formatLogColumns_(sheet, recordedAtColumn, updatedAtColumn, wrapStartColumn, wrapColumnCount) {
  const rows = Math.max(sheet.getMaxRows() - 1, 1);
  sheet.getRange(2, recordedAtColumn, rows, 1).setNumberFormat('yyyy-mm-dd hh:mm:ss');
  sheet.getRange(2, updatedAtColumn, rows, 1).setNumberFormat('yyyy-mm-dd hh:mm:ss');
  sheet.getRange(2, wrapStartColumn, rows, wrapColumnCount).setWrap(true);
}

function formatRecordRow_(sheet, rowNumber) {
  sheet.getRange(rowNumber, 2).setNumberFormat('yyyy-mm-dd hh:mm:ss');
  sheet.getRange(rowNumber, 9, 1, 3).setWrap(true);
  sheet.getRange(rowNumber, 13).setNumberFormat('yyyy-mm-dd hh:mm:ss');
}

function formatDeletedRecordRow_(sheet, rowNumber) {
  formatRecordRow_(sheet, rowNumber);
  sheet.getRange(rowNumber, 14).setNumberFormat('yyyy-mm-dd hh:mm:ss');
  sheet.getRange(rowNumber, 16).setWrap(true);
}

function toPublicStudent_(student) {
  return {
    studentId: student.studentId,
    schoolYear: student.schoolYear,
    grade: student.grade,
    classNumber: student.classNumber,
    studentNumber: student.studentNumber,
    name: student.name,
    status: student.status,
    recordable: isStudentRecordable_(student),
  };
}

function readCompetencies_(settingsSheet) {
  const grouped = Object.fromEntries(APP_CONFIG.categories.map(function (category) {
    return [category, []];
  }));
  const rowCount = settingsSheet.getLastRow() - 1;
  if (rowCount <= 0) {
    return grouped;
  }
  settingsSheet.getRange(2, 1, rowCount, COMPETENCY_HEADERS.length)
    .getValues()
    .forEach(function (row) {
      const category = String(row[0]).trim();
      const label = String(row[1]).trim();
      if (!grouped[category] || !label || !isEnabled_(row[3])) {
        return;
      }
      grouped[category].push({
        label: label,
        description: String(row[2]).trim(),
        order: Number(row[4]) || 9999,
      });
    });
  APP_CONFIG.categories.forEach(function (category) {
    grouped[category].sort(function (left, right) {
      return left.order - right.order || left.label.localeCompare(right.label, 'ko');
    });
  });
  return grouped;
}

function readSubjectDefaults_(settingsSheet) {
  const subjects = Object.fromEntries(DEFAULT_SUBJECTS.map(function (row) {
    return [String(row[0]), row[1]];
  }));
  const rowCount = settingsSheet.getLastRow() - 1;
  if (rowCount <= 0) {
    return subjects;
  }
  settingsSheet.getRange(2, 7, rowCount, SUBJECT_HEADERS.length)
    .getDisplayValues()
    .forEach(function (row) {
      const grade = Number(row[0]);
      const subject = String(row[1]).trim();
      if (APP_CONFIG.allowedGrades.includes(grade) && subject) {
        subjects[String(grade)] = subject;
      }
    });
  return subjects;
}

function readSettingsCached_(spreadsheet, settingsSheet) {
  // 개인 스프레드시트에서 읽은 값이므로 사용자별 캐시에 둔다. 아래
  // clearAppCaches_ 와 반드시 같은 캐시를 써야 설정 변경이 즉시 반영된다.
  const cache = CacheService.getUserCache();
  const cacheKey = cacheKey_(spreadsheet, 'settings');
  const cached = cache.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (error) {
      cache.remove(cacheKey);
    }
  }
  const settingsData = {
    competencies: readCompetencies_(settingsSheet),
    subjectsByGrade: readSubjectDefaults_(settingsSheet),
  };
  putJsonCache_(cache, cacheKey, settingsData);
  return settingsData;
}

function findRecordRow_(recordSheets, recordId) {
  const id = String(recordId || '').trim();
  if (!id || id.length > 100) {
    throw new Error('기록 식별정보가 올바르지 않습니다.');
  }
  for (const recordSheet of recordSheets) {
    const rowCount = recordSheet.getLastRow() - 1;
    if (rowCount <= 0) continue;
    const matches = recordSheet
      .getRange(2, 1, rowCount, 1)
      .createTextFinder(id)
      .matchEntireCell(true)
      .findAll();
    if (matches.length > 0) {
      const rowNumber = matches[0].getRow();
      const range = recordSheet.getRange(rowNumber, 1, 1, RECORD_HEADERS.length);
      return {
        sheet: recordSheet,
        rowNumber: rowNumber,
        values: range.getValues()[0],
        displayValues: range.getDisplayValues()[0],
      };
    }
  }
  throw new Error('이미 삭제되었거나 존재하지 않는 기록입니다.');
}

function readRecentRecords_(recordSheets, student, limit, identity) {
  const candidates = [];
  recordSheets.forEach(function (recordSheet) {
    const rowCount = recordSheet.getLastRow() - 1;
    if (rowCount <= 0) return;
    const matches = recordSheet
      .getRange(2, 14, rowCount, 1)
      .createTextFinder(student.studentId)
      .matchEntireCell(true)
      .findAll()
      .sort(function (left, right) { return left.getRow() - right.getRow(); })
      .slice(-limit);
    readRecentRecordRows_(recordSheet, matches).forEach(function (row) {
      const recordedAuthor = String(row[11] || '').trim();
      candidates.push({
        id: String(row[0]),
        recordedAtValue: row[1] instanceof Date ? row[1].getTime() : 0,
        recordedAt: formatDateTime_(row[1], String(row[1] || '')),
        schoolYear: Number(row[14]),
        category: String(row[7] || ''),
        competencies: String(row[8] || '').split(/\r?\n/).filter(Boolean),
        subject: String(row[9] || ''),
        memo: String(row[10] || ''),
        canEdit: canDeleteRecord_(recordedAuthor, identity),
        canDelete: canDeleteRecord_(recordedAuthor, identity),
      });
    });
  });
  return candidates
    .sort(function (left, right) { return right.recordedAtValue - left.recordedAtValue; })
    .slice(0, limit)
    .map(function (record) {
      delete record.recordedAtValue;
      return record;
    });
}

function readRecentRecordRows_(recordSheet, matches) {
  const rowNumbers = matches.map(function (match) { return match.getRow(); });
  if (rowNumbers.length === 0) return [];

  const firstRow = rowNumbers[0];
  const lastRow = rowNumbers[rowNumbers.length - 1];
  const span = lastRow - firstRow + 1;
  const maxBatchSpan = 500;

  // ponytail: 큰 빈 구간까지 읽지 않는다. 이 폴백이 잦아지면 별도 인덱스를 검토한다.
  if (span <= maxBatchSpan) {
    const rows = recordSheet
      .getRange(firstRow, 1, span, RECORD_HEADERS.length)
      .getValues();
    return rowNumbers.map(function (rowNumber) {
      return rows[rowNumber - firstRow];
    });
  }

  return rowNumbers.map(function (rowNumber) {
    return recordSheet
      .getRange(rowNumber, 1, 1, RECORD_HEADERS.length)
      .getValues()[0];
  });
}

function normalizeRecordSearchOptions_(options) {
  const value = options || {};
  const studentId = String(value.studentId || '').trim();
  if (studentId.length > 100) {
    throw new Error('학생ID가 올바르지 않습니다.');
  }
  const category = String(value.category || '').trim();
  if (category && !APP_CONFIG.categories.includes(category)) {
    throw new Error('기록 구분 필터가 올바르지 않습니다.');
  }
  const subject = String(value.subject || '').trim();
  if (subject.length > APP_CONFIG.maxSubjectLength) {
    throw new Error('과목 필터가 너무 깁니다.');
  }
  const archiveState = ['active', 'archived', 'all'].includes(
    String(value.archiveState || '').trim()
  )
    ? String(value.archiveState).trim()
    : 'active';
  const fromDate = parseRecordSearchDate_(value.fromDate, false);
  const toDate = parseRecordSearchDate_(value.toDate, true);
  if (fromDate && toDate && fromDate.getTime() >= toDate.getTime()) {
    throw new Error('기록 조회 종료일은 시작일과 같거나 이후여야 합니다.');
  }
  return {
    studentId: studentId,
    category: category,
    subject: subject,
    archiveState: archiveState,
    fromTime: fromDate ? fromDate.getTime() : null,
    toTime: toDate ? toDate.getTime() : null,
    limit: Math.min(
      Math.max(Number(value.limit) || APP_CONFIG.maxRecordSearchResults, 1),
      APP_CONFIG.maxRecordSearchResults
    ),
  };
}

function parseRecordSearchDate_(value, exclusiveEnd) {
  const text = String(value || '').trim();
  if (!text) return null;
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new Error('기록 조회 날짜는 YYYY-MM-DD 형식으로 입력해 주세요.');
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year
      || date.getMonth() !== month - 1
      || date.getDate() !== day
  ) {
    throw new Error('기록 조회 날짜가 올바르지 않습니다.');
  }
  if (exclusiveEnd) date.setDate(date.getDate() + 1);
  return date;
}

function requireRecordableStudent_(student) {
  if (!isStudentRecordable_(student)) {
    throw new Error(`${student.status} 학생은 활동 기록을 새로 저장할 수 없습니다.`);
  }
}

function isStudentRecordable_(student) {
  return APP_CONFIG.recordableStudentStatuses.includes(student.status);
}

function requireDeletePermission_(recordedAuthor, identity) {
  if (!canDeleteRecord_(String(recordedAuthor || '').trim(), identity)) {
    throw new Error('다른 사용자가 작성한 기록은 삭제할 수 없습니다.');
  }
}

function canDeleteRecord_(recordedAuthor, identity) {
  if (!recordedAuthor) {
    return true;
  }
  return recordedAuthor === identity.email || recordedAuthor === identity.key;
}

function normalizeDeleteReason_(reason) {
  const text = String(reason || '웹앱에서 삭제').trim() || '웹앱에서 삭제';
  if (text.length > APP_CONFIG.maxDeleteReasonLength) {
    throw new Error(`삭제 사유는 ${APP_CONFIG.maxDeleteReasonLength}자 이내로 입력해 주세요.`);
  }
  return text;
}

function resolveUserIdentity_() {
  const email = requireCurrentUserEmail_();
  return { key: `email:${email}`, email: email, mode: 'account' };
}

function getIdentityAuthor_(identity) {
  return identity.email;
}

function assertHeaders_(sheet, row, column, expectedHeaders, label) {
  const actualHeaders = sheet.getRange(row, column, 1, expectedHeaders.length)
    .getDisplayValues()[0]
    .map(function (value) { return String(value).trim(); });
  const matches = expectedHeaders.every(function (header, index) {
    return actualHeaders[index] === header;
  });
  if (!matches) {
    throw new Error(`'${label}' 시트의 머리글을 확인해 주세요: ${expectedHeaders.join(', ')}`);
  }
}

function cacheKey_(spreadsheet, suffix) {
  return `student-activity:${APP_CONFIG.version}:${spreadsheet.getId()}:${suffix}`;
}

function putJsonCache_(cache, key, value) {
  const json = JSON.stringify(value);
  // CacheService 단일 항목 한도를 넘으면 캐시하지 않고 정상 조회를 유지한다.
  if (json.length <= 30000) {
    try {
      cache.put(key, json, APP_CONFIG.cacheSeconds);
    } catch (error) {
      // 캐시는 최적화 수단이므로 실패해도 원본 시트 조회는 계속한다.
    }
  }
}

function clearAppCaches_(spreadsheet) {
  CacheService.getUserCache().remove(cacheKey_(spreadsheet, 'settings'));
  clearPersonalRecordSchemaVerification_(spreadsheet);
}

function getCurrentSchoolYear_() {
  return schoolYearFromDate_(new Date());
}

function schoolYearFromDate_(value) {
  const date = value instanceof Date && !Number.isNaN(value.getTime()) ? value : new Date();
  const month = Number(Utilities.formatDate(date, Session.getScriptTimeZone(), 'M'));
  const year = Number(Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy'));
  return month >= 3 ? year : year - 1;
}

function normalizeSchoolYear_(value, fallback) {
  const schoolYear = Number(value);
  if (Number.isInteger(schoolYear) && schoolYear >= 2000 && schoolYear <= 2100) {
    return schoolYear;
  }
  return Number(fallback) || getCurrentSchoolYear_();
}

function withAppLock_(callback) {
  return withPersonalDatabaseLock_(callback);
}

function isEnabled_(value) {
  return value === true || /^(true|예|y|1|사용)$/i.test(String(value).trim());
}

function sanitizeSpreadsheetText_(value) {
  const text = String(value == null ? '' : value);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function formatDateTime_(value, fallback) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return fallback || '';
  }
  return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
}
