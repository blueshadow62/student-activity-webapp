// © 2026 류기현(부산 동아공고). CC BY-NC-SA 4.0(저작자표시-비영리-동일조건변경허락).
// https://creativecommons.org/licenses/by-nc-sa/4.0/deed.ko
// 문의: https://github.com/blueshadow62/student-activity-webapp/issues

const CENTRAL_ADMIN_CONFIG = Object.freeze({
  maxAssignmentResults: 500,
  maxPhotoStatusResults: 500,
  defaultAssignmentType: '교과',
});

function getAdminDashboard() {
  requireAdmin_();
  return buildAdminDashboard_();
}

function buildAdminDashboard_() {
  return {
    connection: getCentralConnectionState_(true),
    pendingAssignmentRequests: countPendingAssignmentRequests_(),
    appVersion: APP_CONFIG.version,
    mode: 'ADMIN_PORTAL',
  };
}

function countPendingAssignmentRequests_() {
  return readAllStoredAssignmentRequests_().filter(function (request) {
    return request.status === CENTRAL_ASSIGNMENT_REQUEST_STATUS.pending;
  }).length;
}

function initializeCentralDataSchema() {
  requireAdmin_();
  return withCentralWriteLock_(function () {
    const spreadsheet = getCentralDatabase_();
    let studentSheet = getCentralStudentSheet_(spreadsheet, false);
    if (!studentSheet) {
      studentSheet = spreadsheet.insertSheet(CENTRAL_CONFIG.studentSheetName);
      initializeCentralSheet_(studentSheet, CENTRAL_STUDENT_HEADERS, '#1a73e8');
    } else if (!isSupportedCentralStudentSheet_(studentSheet)) {
      throw createCentralError_(
        'CENTRAL_SCHEMA_INVALID',
        '기존 중앙 학생목록의 머리글을 먼저 확인해 주세요.'
      );
    }
    const photoSheet = getCentralPhotoSheet_(spreadsheet, true);
    if (!centralHeadersMatch_(photoSheet, CENTRAL_PHOTO_HEADERS)) {
      throw createCentralError_(
        'CENTRAL_SCHEMA_INVALID',
        '기존 중앙 사진정보의 머리글을 먼저 확인해 주세요.'
      );
    }
    ensureCentralAdminSheet_(
      spreadsheet,
      CENTRAL_CONFIG.teacherAssignmentSheetName,
      CENTRAL_TEACHER_ASSIGNMENT_HEADERS,
      '#188038'
    );
    ensureCentralAdminSheet_(
      spreadsheet,
      CENTRAL_CONFIG.assignmentRequestSheetName,
      CENTRAL_ASSIGNMENT_REQUEST_HEADERS,
      '#e37400'
    );
    ensureCentralAdminSheet_(
      spreadsheet,
      CENTRAL_CONFIG.groupSheetName,
      CENTRAL_GROUP_HEADERS,
      '#00838f'
    );
    ensureCentralAdminSheet_(
      spreadsheet,
      CENTRAL_CONFIG.groupMemberSheetName,
      CENTRAL_GROUP_MEMBER_HEADERS,
      '#5f6368'
    );
    const appSettings = ensureCentralAdminSheet_(
      spreadsheet,
      CENTRAL_CONFIG.appSettingsSheetName,
      CENTRAL_APP_SETTING_HEADERS,
      '#7b1fa2'
    );
    upsertCentralAppSetting_(
      appSettings,
      'schemaVersion',
      CENTRAL_CONFIG.schemaVersion
    );
    removeCentralDefaultSheet_(spreadsheet);
    clearCentralStudentCache_();
    clearCentralGroupCache_(spreadsheet);
    clearCentralTeacherAssignmentCache_(spreadsheet);
    clearCentralPhotoRowsCache_(spreadsheet);
    return buildAdminDashboard_();
  });
}

// SpreadsheetApp.create 가 만든 첫 시트는 중앙 시트를 모두 만든 뒤에도 빈 채로
// 남아 관리자에게 쓸모없는 탭으로 보인다. 개인 데이터베이스는
// removeUnusedPersonalDefaultSheets_() 가 같은 일을 한다.
// 다만 이 함수는 새로 만들 때뿐 아니라 기존 중앙 자료 재연결과 관리자의
// 중앙 시트 점검에서도 실행된다. 그래서 "빈 시트"가 아니라 "Apps Script 가
// 만든 기본 이름 그대로이면서 비어 있는 시트"만 지운다. 관리자가 직접 만든
// 빈 메모 탭을 말없이 지우지 않기 위해서다.
function removeCentralDefaultSheet_(spreadsheet) {
  const sheets = spreadsheet.getSheets();
  if (sheets.length <= 1) return;
  sheets.forEach(function (sheet) {
    if (
      /^(?:시트|Sheet)\s?1$/.test(sheet.getName())
        && sheet.getLastRow() === 0
        && sheet.getLastColumn() === 0
        && spreadsheet.getSheets().length > 1
    ) {
      spreadsheet.deleteSheet(sheet);
    }
  });
}

function ensureCentralAdminSheet_(spreadsheet, sheetName, headers, color) {
  let sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(sheetName);
    initializeCentralSheet_(sheet, headers, color);
    return sheet;
  }
  if (!centralHeadersMatch_(sheet, headers)) {
    throw createCentralError_(
      'CENTRAL_SCHEMA_INVALID',
      `'${sheetName}' 시트의 머리글을 확인해 주세요.`
    );
  }
  return sheet;
}

function upsertCentralAppSetting_(sheet, key, value) {
  const rowCount = sheet.getLastRow() - 1;
  const keys = rowCount > 0
    ? sheet.getRange(2, 1, rowCount, 1).getDisplayValues()
    : [];
  const index = keys.findIndex(function (row) {
    return String(row[0] || '').trim() === key;
  });
  const rowNumber = index >= 0 ? index + 2 : sheet.getLastRow() + 1;
  sheet.getRange(rowNumber, 1, 1, 3).setValues([[
    key,
    sanitizeSpreadsheetText_(value),
    new Date(),
  ]]);
}

function getAdminStudents(filters) {
  requireAdmin_();
  const criteria = normalizeAdminStudentFilters_(filters);
  return readCentralStudents_(
    getRequiredCentralStudentSheet_(),
    true
  ).filter(function (student) {
    return (!criteria.query
        || student.name.toLocaleLowerCase('ko').includes(criteria.query)
        || student.studentKey.toLowerCase().includes(criteria.query))
      && (!criteria.schoolYear || student.schoolYear === criteria.schoolYear)
      && (!criteria.grade || student.grade === criteria.grade)
      && (!criteria.classNumber || student.classNumber === criteria.classNumber)
      && (criteria.includeInactive || student.active);
  }).slice(0, criteria.limit).map(toPublicCentralStudent_);
}

function normalizeAdminStudentFilters_(filters) {
  const value = filters || {};
  const schoolYear = Number(value.schoolYear) || 0;
  const grade = Number(value.grade) || 0;
  const classNumber = Number(value.classNumber) || 0;
  return {
    query: String(value.query || '').trim().toLocaleLowerCase('ko').slice(0, 100),
    schoolYear: schoolYear,
    grade: grade,
    classNumber: classNumber,
    includeInactive: Boolean(value.includeInactive),
    limit: Math.min(
      Math.max(Number(value.limit) || CENTRAL_CONFIG.maxAdminStudentResults, 1),
      CENTRAL_CONFIG.maxAdminStudentResults
    ),
  };
}

function addCentralStudent(payload) {
  requireAdmin_();
  return withCentralWriteLock_(function () {
    const sheet = getRequiredCentralStudentSheet_();
    const student = normalizeCentralStudentPayload_(payload, null);
    return {
      ok: true,
      student: toPublicCentralStudent_(appendCentralStudentRow_(sheet, student)),
    };
  });
}

// 행을 쓰는 부분만 떼어낸다. 관리자 추가와 교사의 타교생 추가가 같은 중복
// 검사·시트 형식·캐시 정리를 쓰게 해서 두 경로가 어긋나지 않게 한다.
// 호출자가 쓰기 잠금과 권한 확인을 마친 뒤에 부른다.
function appendCentralStudentRow_(sheet, student) {
  assertNoCentralStudentDuplicate_(sheet, student, '');
  const now = new Date();
  const key = Utilities.getUuid();
  if (centralHeadersMatch_(sheet, CENTRAL_STUDENT_HEADERS)) {
    sheet.appendRow([
      key,
      student.schoolYear,
      student.grade,
      student.classNumber,
      student.studentNumber,
      sanitizeSpreadsheetText_(student.name),
      student.status,
      true,
      now,
      now,
    ]);
  } else {
    sheet.appendRow([
      student.grade,
      student.classNumber,
      student.studentNumber,
      sanitizeSpreadsheetText_(student.name),
      student.status,
      key,
      student.schoolYear,
    ]);
  }
  clearCentralStudentCache_();
  return { ...student, studentKey: key, active: true };
}

function updateCentralStudent(studentKey, payload) {
  requireAdmin_();
  return withCentralWriteLock_(function () {
    const sheet = getRequiredCentralStudentSheet_();
    const key = normalizeCentralKey_(studentKey, '학생키');
    const current = readCentralStudents_(sheet, true).find(function (student) {
      return student.studentKey === key;
    });
    if (!current) {
      throw createCentralError_('STUDENT_NOT_FOUND', '학생을 찾을 수 없습니다.');
    }
    const updated = normalizeCentralStudentPayload_(payload, current);
    assertNoCentralStudentDuplicate_(sheet, updated, key);
    if (current.schema === 'canonical') {
      sheet.getRange(current.rowNumber, 2, 1, 9).setValues([[
        updated.schoolYear,
        updated.grade,
        updated.classNumber,
        updated.studentNumber,
        sanitizeSpreadsheetText_(updated.name),
        updated.status,
        payload && payload.active == null ? current.active : Boolean(payload.active),
        current.createdAt || new Date(),
        new Date(),
      ]]);
    } else {
      sheet.getRange(
        current.rowNumber,
        1,
        1,
        CENTRAL_LEGACY_STUDENT_HEADERS.length
      ).setValues([[
        updated.grade,
        updated.classNumber,
        updated.studentNumber,
        sanitizeSpreadsheetText_(updated.name),
        updated.status,
        key,
        updated.schoolYear,
      ]]);
    }
    clearCentralStudentCache_();
    return {
      ok: true,
      student: toPublicCentralStudent_({
        ...current,
        ...updated,
        active: payload && payload.active == null
          ? current.active
          : Boolean(payload.active),
      }),
    };
  });
}

function deleteCentralStudent(studentKey) {
  requireAdmin_();
  return withCentralWriteLock_(function () {
    const sheet = getRequiredCentralStudentSheet_();
    const key = normalizeCentralKey_(studentKey, '학생키');
    const student = readCentralStudents_(sheet, true).find(function (candidate) {
      return candidate.studentKey === key;
    });
    if (!student) {
      throw createCentralError_('STUDENT_NOT_FOUND', '학생을 찾을 수 없습니다.');
    }
    if (student.schema === 'canonical') {
      sheet.getRange(student.rowNumber, 8).setValue(false);
      sheet.getRange(student.rowNumber, 10).setValue(new Date());
    } else {
      // v8.3 호환 시트는 사용 열이 없으므로 관리자 명시 요청일 때만 행을 제거한다.
      sheet.deleteRow(student.rowNumber);
    }
    clearCentralStudentCache_();
    return { ok: true, studentKey: key };
  });
}

// 새 학년도로 넘어갈 때 이전 학년도 명단을 한 번에 정리할 수 있어야 한다.
function deactivateCentralStudentsByYear(schoolYear) {
  requireAdmin_();
  const year = Number(schoolYear);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new Error('일괄 비활성화할 학년도를 확인해 주세요.');
  }
  return withCentralWriteLock_(function () {
    const sheet = getRequiredCentralStudentSheet_();
    const students = readCentralStudents_(sheet, true).filter(function (student) {
      return student.schoolYear === year;
    });
    if (!students.length) {
      throw createCentralError_(
        'STUDENT_NOT_FOUND',
        `${year}학년도 학생을 찾을 수 없습니다.`
      );
    }
    const now = new Date();
    const legacyRowNumbers = [];
    students.forEach(function (student) {
      if (student.schema === 'canonical') {
        sheet.getRange(student.rowNumber, 8).setValue(false);
        sheet.getRange(student.rowNumber, 10).setValue(now);
      } else {
        legacyRowNumbers.push(student.rowNumber);
      }
    });
    // 행을 지우면 이후 행 번호가 당겨지므로 큰 번호부터 지운다.
    legacyRowNumbers
      .sort(function (a, b) { return b - a; })
      .forEach(function (rowNumber) { sheet.deleteRow(rowNumber); });
    clearCentralStudentCache_();
    return { ok: true, schoolYear: year, count: students.length };
  });
}

// 배포 직후 연습용 명단을 지우고 실제 학교 명단을 새로 올릴 수 있어야 한다.
function resetCentralStudentList() {
  requireAdmin_();
  return withCentralWriteLock_(function () {
    const sheet = getRequiredCentralStudentSheet_();
    const rowCount = Math.max(sheet.getLastRow() - 1, 0);
    if (rowCount > 0) sheet.deleteRows(2, rowCount);
    clearCentralStudentCache_();
    return { ok: true, removedCount: rowCount };
  });
}

function normalizeCentralStudentPayload_(payload, current) {
  const value = payload || {};
  const student = {
    schoolYear: Number(
      value.schoolYear == null && current ? current.schoolYear : value.schoolYear
    ),
    grade: Number(value.grade == null && current ? current.grade : value.grade),
    classNumber: Number(
      value.classNumber == null && current ? current.classNumber : value.classNumber
    ),
    studentNumber: Number(
      value.studentNumber == null && current ? current.studentNumber : value.studentNumber
    ),
    name: String(value.name == null && current ? current.name : value.name || '').trim(),
    status: String(
      value.status == null && current ? current.status : value.status || '재학'
    ).trim(),
  };
  if (
    !Number.isInteger(student.schoolYear)
      || student.schoolYear < 2000
      || student.schoolYear > 2100
  ) {
    throw new Error('학년도를 확인해 주세요.');
  }
  if (!APP_CONFIG.allowedGrades.includes(student.grade)) {
    throw new Error('학년은 1·2·3 중에서 선택해 주세요.');
  }
  // 공동교육과정 타교생은 우리 학교 어느 반에도 속하지 않는다. 실제로 없는
  // 0반에 두어야 그 반 담임의 학생 목록에 모르는 학생이 나타나지 않는다.
  if (student.status === '공동') {
    if (student.classNumber !== CENTRAL_CONFIG.externalClassNumber) {
      throw new Error('공동교육과정 학생의 반은 0이어야 합니다.');
    }
  } else if (!Number.isInteger(student.classNumber) || student.classNumber < 1) {
    throw new Error('반은 1 이상의 정수여야 합니다.');
  }
  if (
    !Number.isInteger(student.studentNumber)
      || student.studentNumber < 1
      || student.studentNumber > APP_CONFIG.maxStudentNumber
  ) {
    throw new Error(`번호는 1~${APP_CONFIG.maxStudentNumber} 사이여야 합니다.`);
  }
  if (!student.name || student.name.length > APP_CONFIG.maxStudentNameLength) {
    throw new Error('학생 이름을 확인해 주세요.');
  }
  if (/^[=+\-@]/.test(student.name)) {
    throw new Error('학생 이름에는 수식을 입력할 수 없습니다.');
  }
  if (!APP_CONFIG.studentStatuses.includes(student.status)) {
    throw new Error('학적상태를 확인해 주세요.');
  }
  return student;
}

function assertNoCentralStudentDuplicate_(sheet, student, excludedKey) {
  const duplicate = readCentralStudents_(sheet, true).some(function (candidate) {
    return candidate.studentKey !== excludedKey
      && candidate.active
      && candidate.schoolYear === student.schoolYear
      && candidate.grade === student.grade
      && candidate.classNumber === student.classNumber
      && candidate.studentNumber === student.studentNumber;
  });
  if (duplicate) {
    throw new Error('같은 학년도·학년·반·번호의 학생이 이미 있습니다.');
  }
}

function previewCentralStudentCsv(csvText) {
  requireAdmin_();
  const students = parseAndValidateRosterCsv_(csvText);
  return {
    ok: true,
    count: students.length,
    sample: students.slice(0, 10),
  };
}

function importCentralStudentCsv(csvText, schoolYear) {
  requireAdmin_();
  const students = parseAndValidateRosterCsv_(csvText);
  const normalizedYear = normalizeSchoolYear_(schoolYear, getCurrentSchoolYear_());
  return withCentralWriteLock_(function () {
    const sheet = getRequiredCentralStudentSheet_();
    const oldStudents = readCentralStudents_(sheet, true);
    const existingStudentsByIdentity = new Map(oldStudents.map(function (student) {
      return [[
        student.schoolYear,
        student.grade,
        student.classNumber,
        student.studentNumber,
      ].join('-'), student];
    }));
    const now = new Date();
    const canonical = centralHeadersMatch_(sheet, CENTRAL_STUDENT_HEADERS);
    const preservedRows = oldStudents
      .filter(function (student) {
        return student.schoolYear !== normalizedYear;
      })
      .map(function (student) {
        return canonical
          ? [
            student.studentKey,
            student.schoolYear,
            student.grade,
            student.classNumber,
            student.studentNumber,
            sanitizeSpreadsheetText_(student.name),
            student.status,
            student.active,
            student.createdAt || now,
            student.updatedAt || now,
          ]
          : [
            student.grade,
            student.classNumber,
            student.studentNumber,
            sanitizeSpreadsheetText_(student.name),
            student.status,
            student.studentKey,
            student.schoolYear,
          ];
      });
    const importedRows = students.map(function (student) {
      const identity = [
        normalizedYear,
        student.grade,
        student.classNumber,
        student.studentNumber,
      ].join('-');
      const existing = existingStudentsByIdentity.get(identity);
      const key = existing ? existing.studentKey : Utilities.getUuid();
      return canonical
        ? [
          key,
          normalizedYear,
          student.grade,
          student.classNumber,
          student.studentNumber,
          sanitizeSpreadsheetText_(student.name),
          student.status,
          true,
          existing && existing.createdAt ? existing.createdAt : now,
          now,
        ]
        : [
          student.grade,
          student.classNumber,
          student.studentNumber,
          sanitizeSpreadsheetText_(student.name),
          student.status,
          key,
          normalizedYear,
        ];
    });
    const rows = preservedRows.concat(importedRows);
    clearCentralSheetRows_(sheet, canonical
      ? CENTRAL_STUDENT_HEADERS.length
      : CENTRAL_LEGACY_STUDENT_HEADERS.length);
    if (rows.length) {
      sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
    }
    clearCentralStudentCache_();
    return {
      ok: true,
      importedCount: importedRows.length,
      preservedOtherYearCount: preservedRows.length,
      schoolYear: normalizedYear,
    };
  });
}

function exportCentralStudentCsv(filters) {
  requireAdmin_();
  const criteria = normalizeAdminStudentFilters_({
    ...(filters || {}),
    includeInactive: true,
    limit: CENTRAL_CONFIG.maxCsvRows,
  });
  const rows = readCentralStudents_(
    getRequiredCentralStudentSheet_(),
    true
  ).filter(function (student) {
    return (!criteria.schoolYear || student.schoolYear === criteria.schoolYear)
      && (!criteria.grade || student.grade === criteria.grade)
      && (!criteria.classNumber || student.classNumber === criteria.classNumber);
  }).map(function (student) {
    return [
      student.grade,
      student.classNumber,
      student.studentNumber,
      student.name,
      student.status,
    ];
  });
  return [CENTRAL_ROSTER_CSV_HEADERS].concat(rows)
    .map(function (row) {
      return row.map(sanitizeCsvCell_).join(',');
    })
    .join('\r\n');
}

function clearCentralSheetRows_(sheet, width) {
  const count = sheet.getLastRow() - 1;
  if (count > 0) {
    sheet.getRange(2, 1, count, width).clearContent();
  }
}

function getAdminTeacherAssignments(filters) {
  requireAdmin_();
  const value = filters || {};
  const query = String(value.query || '').trim().toLowerCase();
  return readCentralTeacherAssignmentsCached_(true)
    .filter(function (assignment) {
    return !query
      || assignment.teacherEmail.includes(query)
      || assignment.subject.toLocaleLowerCase('ko').includes(query);
  }).slice(0, CENTRAL_ADMIN_CONFIG.maxAssignmentResults).map(function (assignment) {
    return {
      ...toPublicCentralAssignment_(assignment),
      teacherEmail: assignment.teacherEmail,
      active: assignment.active,
    };
  });
}

function getApprovedTeachers() {
  requireAdmin_();
  const byEmail = new Map();
  readCentralTeacherAssignmentsCached_(true).filter(function (assignment) {
    return assignment.active;
  }).forEach(function (assignment) {
    const entry = byEmail.get(assignment.teacherEmail) || {
      teacherEmail: assignment.teacherEmail,
      assignments: [],
      lastApprovedAt: null,
    };
    entry.assignments.push(toPublicCentralAssignment_(assignment));
    const updatedAt = assignment.updatedAt instanceof Date
      ? assignment.updatedAt
      : new Date(assignment.updatedAt);
    if (
      Number.isFinite(updatedAt.getTime())
        && (!entry.lastApprovedAt || updatedAt > entry.lastApprovedAt)
    ) {
      entry.lastApprovedAt = updatedAt;
    }
    byEmail.set(assignment.teacherEmail, entry);
  });
  return Array.from(byEmail.values())
    .sort(function (left, right) {
      return left.teacherEmail.localeCompare(right.teacherEmail);
    })
    .map(function (entry) {
      return {
        teacherEmail: entry.teacherEmail,
        assignmentCount: entry.assignments.length,
        assignments: entry.assignments,
        lastApprovedAt: entry.lastApprovedAt
          ? formatDateTime_(entry.lastApprovedAt, '') : '',
      };
    });
}

function revokeApprovedTeachersAccess(teacherEmails) {
  requireAdmin_();
  const emails = normalizeRevokeTeacherEmailList_(teacherEmails);
  const result = withCentralWriteLock_(function () {
    const sheet = getRequiredCentralAssignmentSheet_();
    const assignments = readCentralTeacherAssignments_(sheet, true);
    const now = new Date();
    const rowsToDeactivate = assignments.filter(function (assignment) {
      return assignment.active && emails.includes(assignment.teacherEmail);
    });
    if (!rowsToDeactivate.length) {
      throw new Error('해지할 활성 담당이 있는 교사를 찾을 수 없습니다.');
    }
    rowsToDeactivate.forEach(function (assignment) {
      sheet.getRange(assignment.rowNumber, 8).setValue(false);
      sheet.getRange(assignment.rowNumber, 10).setValue(now);
    });
    clearCentralTeacherAssignmentCache_(sheet.getParent());
    const results = emails.map(function (email) {
      return { teacherEmail: email, ...revokeCentralAccessFromTeacher_(email) };
    });
    return {
      ok: true,
      deactivatedCount: rowsToDeactivate.length,
      results: results,
    };
  });
  // 잠금 밖에서 보내 메일 발송 지연이 쓰기 잠금을 오래 붙잡지 않게 한다.
  emails.forEach(function (email) {
    const accessResult = result.results.find(function (item) {
      return item.teacherEmail === email;
    });
    notifyTeacherByEmail_(
      email,
      '[학생 활동 기록 웹앱] 담당 수업 해지 안내',
      accessResult && accessResult.accessRevoked
        ? '담당 수업과 중앙 자료 접근 권한이 해지되었습니다. 문의사항은 관리자에게 연락해 주세요.'
        : '담당 수업은 해지되었으며 중앙 자료 접근 권한은 관리자가 정리 중입니다. 문의사항은 관리자에게 연락해 주세요.'
    );
  });
  return result;
}

function retryApprovedTeacherAccessRevocation(teacherEmail) {
  requireAdmin_();
  const email = normalizeCentralEmail_(teacherEmail);
  if (!isValidCentralEmail_(email)) {
    throw new Error('권한 제거를 재시도할 교사 이메일을 확인해 주세요.');
  }
  return withCentralWriteLock_(function () {
    const assignments = readCentralTeacherAssignments_(
      getRequiredCentralAssignmentSheet_(),
      true
    );
    const teacherAssignments = assignments.filter(function (assignment) {
      return assignment.teacherEmail === email;
    });
    if (!teacherAssignments.length) {
      throw new Error('담당 이력에서 해당 교사를 찾을 수 없습니다.');
    }
    if (teacherAssignments.some(function (assignment) {
      return assignment.active;
    })) {
      throw new Error('활성 담당이 있는 교사는 권한 제거를 재시도할 수 없습니다.');
    }
    return {
      ok: true,
      teacherEmail: email,
      ...revokeCentralAccessFromTeacher_(email),
    };
  });
}

function normalizeRevokeTeacherEmailList_(value) {
  const emails = Array.from(new Set(
    (Array.isArray(value) ? value : [])
      .map(function (email) { return normalizeCentralEmail_(email); })
      .filter(isValidCentralEmail_)
  ));
  if (!emails.length) {
    throw new Error('해지할 교사를 하나 이상 선택해 주세요.');
  }
  if (emails.length > CENTRAL_ADMIN_CONFIG.maxAssignmentResults) {
    throw new Error('한 번에 해지할 교사 수가 너무 많습니다.');
  }
  return emails;
}

function saveTeacherAssignment(payload) {
  requireAdmin_();
  return withCentralWriteLock_(function () {
    const sheet = getRequiredCentralAssignmentSheet_();
    const assignments = readCentralTeacherAssignments_(sheet, true);
    const normalized = normalizeTeacherAssignmentPayload_(payload);
    const existing = normalized.assignmentKey
      ? assignments.find(function (assignment) {
        return assignment.assignmentKey === normalized.assignmentKey;
      })
      : null;
    if (normalized.assignmentKey && !existing) {
      throw new Error('수정할 담당 수업을 찾을 수 없습니다.');
    }
    const duplicate = assignments.some(function (assignment) {
      return isDuplicateTeacherAssignment_(
        assignment,
        normalized,
        normalized.assignmentKey
      );
    });
    if (duplicate) {
      throw new Error('같은 교사의 동일 담당 수업이 이미 등록되어 있습니다.');
    }
    const now = new Date();
    const key = normalized.assignmentKey || Utilities.getUuid();
    const row = buildTeacherAssignmentRow_(
      normalized,
      key,
      existing ? existing.createdAt : now,
      now
    );
    const rowNumber = existing ? existing.rowNumber : sheet.getLastRow() + 1;
    sheet.getRange(
      rowNumber,
      1,
      1,
      CENTRAL_TEACHER_ASSIGNMENT_HEADERS.length
    ).setValues([row]);
    // 그룹명은 교사담당 시트가 아니라 수강그룹 시트에 있다. 신청 승인 경로처럼
    // 여기서도 남겨야 관리자가 만든 그룹이 '이름 없는 그룹'이 되지 않는다.
    if (centralAssignmentIsGroup_(normalized)) {
      upsertCentralGroupName_(key, normalized.groupName);
    }
    clearCentralTeacherAssignmentCache_(sheet.getParent());
    return {
      ok: true,
      assignment: {
        ...toPublicCentralAssignment_({
          ...normalized,
          assignmentKey: key,
        }),
        teacherEmail: normalized.teacherEmail,
        active: normalized.active,
      },
    };
  });
}

function saveTeacherAssignmentsBatch(payload) {
  requireAdmin_();
  return withCentralWriteLock_(function () {
    const value = payload || {};
    const classNumbers = normalizeCentralClassNumberList_(
      value.classNumbers
    );
    const sheet = getRequiredCentralAssignmentSheet_();
    const assignments = readCentralTeacherAssignments_(sheet, true);
    const normalizedItems = classNumbers.map(function (classNumber) {
      return normalizeTeacherAssignmentPayload_({
        teacherEmail: value.teacherEmail,
        schoolYear: value.schoolYear,
        grade: value.grade,
        classNumber: classNumber,
        subject: value.subject,
        assignmentType: value.assignmentType,
        active: true,
      });
    });
    const duplicates = normalizedItems.filter(function (normalized) {
      return assignments.some(function (assignment) {
        return isDuplicateTeacherAssignment_(assignment, normalized, '');
      });
    }).map(function (normalized) { return normalized.classNumber; });
    if (duplicates.length) {
      throw new Error(
        `이미 등록된 담당 반이 있습니다: ${duplicates.join(', ')}반`
      );
    }
    const now = new Date();
    const created = normalizedItems.map(function (normalized) {
      const key = Utilities.getUuid();
      return {
        normalized: normalized,
        key: key,
        row: buildTeacherAssignmentRow_(normalized, key, now, now),
      };
    });
    sheet.getRange(
      sheet.getLastRow() + 1,
      1,
      created.length,
      CENTRAL_TEACHER_ASSIGNMENT_HEADERS.length
    ).setValues(created.map(function (item) { return item.row; }));
    created.forEach(function (item) {
      if (centralAssignmentIsGroup_(item.normalized)) {
        upsertCentralGroupName_(item.key, item.normalized.groupName);
      }
    });
    clearCentralTeacherAssignmentCache_(sheet.getParent());
    return {
      ok: true,
      count: created.length,
      assignments: created.map(function (item) {
        return {
          ...toPublicCentralAssignment_({
            ...item.normalized,
            assignmentKey: item.key,
          }),
          teacherEmail: item.normalized.teacherEmail,
          active: true,
        };
      }),
    };
  });
}

function isDuplicateTeacherAssignment_(assignment, normalized, excludedKey) {
  const sameBase = assignment.assignmentKey !== excludedKey
    && assignment.active
    && assignment.teacherEmail === normalized.teacherEmail
    && assignment.schoolYear === normalized.schoolYear
    && assignment.grade === normalized.grade
    && assignment.subject === normalized.subject;
  if (!sameBase) return false;
  const storedIsGroup = centralAssignmentIsGroup_(assignment);
  const incomingIsGroup = centralAssignmentIsGroup_(normalized);
  if (storedIsGroup !== incomingIsGroup) return false;
  // 그룹 담당은 반이 모두 0이라 반 비교로는 구별되지 않는다. 같은 학년·과목이라도
  // 이름이 다르면 다른 수업이므로 그룹명까지 봐야 한다.
  if (storedIsGroup) {
    const storedName = String(
      assignment.groupName
        || centralGroupNameFor_(assignment.assignmentKey)
    ).trim();
    return storedName === String(normalized.groupName || '').trim();
  }
  return assignment.classNumber === normalized.classNumber;
}

function buildTeacherAssignmentRow_(normalized, key, createdAt, updatedAt) {
  return [
    key,
    normalized.teacherEmail,
    normalized.schoolYear,
    normalized.grade,
    normalized.classNumber,
    sanitizeSpreadsheetText_(normalized.subject),
    sanitizeSpreadsheetText_(normalized.assignmentType),
    normalized.active,
    createdAt,
    updatedAt,
  ];
}

// 사용 여부만 바꾼다. saveTeacherAssignment 를 거치면 그룹명 같은 나머지 항목까지
// 다시 검증하는데, 그 값들은 이 시트에 없어서 되살릴 수 없다. 그래서 이름이 비어
// 버린 수강 그룹은 비활성화조차 못 하고 '이름을 입력해 주세요'로 막혔다.
function setTeacherAssignmentActive(assignmentKey, active) {
  requireAdmin_();
  const key = normalizeCentralKey_(assignmentKey, '담당키');
  return withCentralWriteLock_(function () {
    const sheet = getRequiredCentralAssignmentSheet_();
    const current = readCentralTeacherAssignments_(sheet, true)
      .find(function (assignment) {
        return assignment.assignmentKey === key;
      });
    if (!current) throw new Error('담당 수업을 찾을 수 없습니다.');
    sheet.getRange(current.rowNumber, 8).setValue(Boolean(active));
    sheet.getRange(current.rowNumber, 10).setValue(new Date());
    clearCentralTeacherAssignmentCache_(sheet.getParent());
    return {
      ok: true,
      assignment: {
        ...toPublicCentralAssignment_(current),
        teacherEmail: current.teacherEmail,
        active: Boolean(active),
      },
    };
  });
}

// 담당 행 자체를 지운다. 비활성화는 이력을 남기지만 잘못 만든 행은 목록에 계속
// 남아 헷갈린다. 교사의 개인 활동 기록은 각자 소유 파일에 있어 건드리지 않는다.
// 중앙 자료 보기 권한은 여기서 회수하지 않는다. 다른 담당이 남아 있을 수 있어
// 회수 여부는 `해지` 버튼에서 교사 단위로 판단한다.
function deleteTeacherAssignment(assignmentKey) {
  requireAdmin_();
  const key = normalizeCentralKey_(assignmentKey, '담당키');
  return withCentralWriteLock_(function () {
    const sheet = getRequiredCentralAssignmentSheet_();
    const current = readCentralTeacherAssignments_(sheet, true)
      .find(function (assignment) {
        return assignment.assignmentKey === key;
      });
    if (!current) throw new Error('담당 수업을 찾을 수 없습니다.');
    const wasGroup = centralAssignmentIsGroup_(current);
    sheet.deleteRow(current.rowNumber);
    clearCentralTeacherAssignmentCache_(sheet.getParent());
    if (wasGroup) deleteCentralGroupRowsByKey_(key);
    return { ok: true, wasGroup: wasGroup };
  });
}

// 아무나 주소를 만들 수 있는 공용 메일. 이런 도메인을 통째로 허용하면 제한이 아니라
// 전 세계에 열어 주는 셈이 된다. 개별 이메일 지정은 사람이 특정되므로 막지 않는다.
const CENTRAL_PUBLIC_EMAIL_DOMAINS = Object.freeze([
  'gmail.com', 'googlemail.com', 'naver.com', 'daum.net', 'hanmail.net',
  'nate.com', 'kakao.com', 'outlook.com', 'hotmail.com', 'live.com',
  'msn.com', 'yahoo.com', 'yahoo.co.kr', 'icloud.com', 'me.com',
  'proton.me', 'protonmail.com',
]);

function centralEmailDomain_(email) {
  const normalized = normalizeCentralEmail_(email);
  const index = normalized.indexOf('@');
  return index >= 0 ? normalized.slice(index) : '';
}

function isPublicCentralEmailDomain_(domain) {
  return CENTRAL_PUBLIC_EMAIL_DOMAINS.includes(
    String(domain || '').replace(/^@/, '').toLowerCase()
  );
}

function getAssignmentRequestPolicy() {
  requireAdmin_();
  const entries = parseCentralEmailList_(
    PropertiesService.getScriptProperties().getProperty(
      CENTRAL_ASSIGNMENT_REQUEST_CONFIG.allowedTeacherEmailsProperty
    )
  );
  const adminDomain = centralEmailDomain_(getRequiredActiveUserEmail_());
  return {
    restricted: entries.length > 0,
    allowList: entries.join(', '),
    adminDomain: adminDomain,
    // 관리자가 개인 메일 계정이면 그 도메인을 넣어 봐야 제한 효과가 없으므로
    // 화면에서 '내 도메인 넣기'를 권하지 않는다.
    adminDomainUsable: Boolean(adminDomain) && !isPublicCentralEmailDomain_(adminDomain),
  };
}

// 검사 자체는 requireAllowedTeacherEmail_ 가 이미 하고 있다. 이 함수는 그 함수가
// 읽는 Script Property 를 관리자가 화면에서 채울 수 있게 해 줄 뿐이다.
function saveAssignmentRequestPolicy(payload) {
  requireAdmin_();
  const value = payload || {};
  const properties = PropertiesService.getScriptProperties();
  const key = CENTRAL_ASSIGNMENT_REQUEST_CONFIG.allowedTeacherEmailsProperty;
  if (!value.restricted) {
    properties.deleteProperty(key);
    return { ok: true, restricted: false, allowList: '' };
  }
  const entries = parseCentralEmailList_(value.allowList);
  if (!entries.length) {
    throw new Error('허용할 도메인이나 이메일을 하나 이상 입력해 주세요.');
  }
  entries.forEach(function (entry) {
    if (entry.charAt(0) === '@') {
      if (isPublicCentralEmailDomain_(entry)) {
        throw new Error(
          `${entry}는 누구나 만들 수 있는 주소라 제한 효과가 없습니다. `
            + '학교가 관리하는 도메인을 넣거나, 개별 이메일을 하나씩 넣어 주세요.'
        );
      }
      if (!/^@[^@\s]+\.[^@\s]+$/.test(entry)) {
        throw new Error(`${entry} 형식을 확인해 주세요. 예: @school.hs.kr`);
      }
      return;
    }
    if (!isValidCentralEmail_(entry)) {
      throw new Error(
        `${entry} 형식을 확인해 주세요. 이메일이거나 @도메인이어야 합니다.`
      );
    }
  });
  properties.setProperty(key, entries.join(', '));
  return { ok: true, restricted: true, allowList: entries.join(', ') };
}

// 그룹명과 편성 명단은 담당키로만 연결된다. 담당을 지우고 남겨 두면 다시 쓰일 일이
// 없는 죽은 행이 되므로 함께 지운다.
function deleteCentralGroupRowsByKey_(assignmentKey) {
  [
    getRequiredCentralGroupSheet_(),
    getRequiredCentralGroupMemberSheet_(),
  ].forEach(function (sheet) {
    const rowCount = sheet.getLastRow() - 1;
    if (rowCount <= 0) return;
    const keys = sheet.getRange(2, 1, rowCount, 1).getDisplayValues();
    // 아래에서 위로 지워야 남은 행의 번호가 밀리지 않는다.
    for (let index = keys.length - 1; index >= 0; index -= 1) {
      if (String(keys[index][0] || '').trim() === assignmentKey) {
        sheet.deleteRow(index + 2);
      }
    }
    clearCentralGroupCache_(sheet.getParent());
  });
}

function normalizeTeacherAssignmentPayload_(payload) {
  const value = payload || {};
  const email = normalizeCentralEmail_(value.teacherEmail);
  const schoolYear = Number(value.schoolYear);
  const grade = Number(value.grade);
  const classNumber = Number(value.classNumber);
  const subject = String(value.subject || '').trim();
  const assignmentType = String(
    value.assignmentType || CENTRAL_ADMIN_CONFIG.defaultAssignmentType
  ).trim();
  if (!isValidCentralEmail_(email)) throw new Error('교사 이메일을 확인해 주세요.');
  if (!Number.isInteger(schoolYear) || schoolYear < 2000 || schoolYear > 2100) {
    throw new Error('학년도를 확인해 주세요.');
  }
  if (!APP_CONFIG.allowedGrades.includes(grade)) {
    throw new Error('담당 학년을 확인해 주세요.');
  }
  // 수강 그룹은 학급으로 묶이지 않아 반 번호가 없다. 실제로 없는 0반에 두어
  // 학급 단위 담당과 절대 겹치지 않게 한다.
  const isGroup = assignmentType === CENTRAL_ASSIGNMENT_TYPES.group;
  const groupName = String(value.groupName || '').trim();
  if (isGroup) {
    if (classNumber !== CENTRAL_CONFIG.externalClassNumber) {
      throw new Error('수강 그룹 담당의 반은 0이어야 합니다.');
    }
    if (!groupName) {
      throw new Error('수강 그룹 이름을 입력해 주세요.');
    }
    if (groupName.length > CENTRAL_CONFIG.maxGroupNameLength) {
      throw new Error(
        `수강 그룹 이름은 ${CENTRAL_CONFIG.maxGroupNameLength}자 이내로 입력해 주세요.`
      );
    }
  } else if (!Number.isInteger(classNumber) || classNumber < 1) {
    throw new Error('담당 반을 확인해 주세요.');
  }
  if (!subject || subject.length > APP_CONFIG.maxSubjectLength) {
    throw new Error('담당 과목을 확인해 주세요.');
  }
  return {
    assignmentKey: value.assignmentKey
      ? normalizeCentralKey_(value.assignmentKey, '담당키')
      : '',
    teacherEmail: email,
    schoolYear: schoolYear,
    grade: grade,
    classNumber: classNumber,
    subject: subject,
    assignmentType: assignmentType.slice(0, 30),
    groupName: isGroup ? groupName : '',
    active: value.active == null ? true : Boolean(value.active),
  };
}

function getAdminPhotoStatus(filters) {
  requireAdmin_();
  const criteria = normalizeAdminStudentFilters_({
    ...(filters || {}),
    schoolYear: filters && filters.schoolYear
      ? filters.schoolYear
      : getCurrentSchoolYear_(),
    includeInactive: false,
    limit: CENTRAL_ADMIN_CONFIG.maxPhotoStatusResults,
  });
  const students = readCentralStudents_(
    getRequiredCentralStudentSheet_(),
    false
  ).filter(function (student) {
    return (!criteria.schoolYear || student.schoolYear === criteria.schoolYear)
      && (!criteria.grade || student.grade === criteria.grade)
      && (!criteria.classNumber || student.classNumber === criteria.classNumber);
  });
  const photoRows = readCentralPhotoRows_(getRequiredCentralPhotoSheet_());
  const photoFolder = getCentralPhotoFolder_();
  const catalog = buildCentralPhotoCatalog_(photoFolder);
  const rows = students.slice(0, criteria.limit).map(function (student) {
    const entry = photoRows.get(student.studentKey);
    const candidates = catalog.byPhotoKey.get(centralStudentPhotoKey_(student)) || [];
    let status = 'MISSING';
    if (entry && catalog.byFileId.has(entry.fileId)) status = 'CONNECTED';
    else if (candidates.length > 1) status = 'DUPLICATE';
    else if (candidates.length === 1) status = 'READY_TO_SYNC';
    return {
      student: toPublicCentralStudent_(student),
      status: status,
      candidateCount: candidates.length,
    };
  });
  return {
    rows: rows,
    // 관리자는 사진을 Drive 폴더에 직접 넣어야 하는데 포털에서 그 폴더로 갈
    // 방법이 없었다. requireAdmin_() 을 통과한 이 응답에만 폴더 주소를 담는다.
    // 교사용 사진 응답(getStudentPhotosForMyAssignment)에는 넣지 않는다.
    folderUrl: photoFolder.getUrl(),
    summary: rows.reduce(function (result, row) {
      result.total += 1;
      result[row.status] = (result[row.status] || 0) + 1;
      return result;
    }, { total: 0, CONNECTED: 0, MISSING: 0, DUPLICATE: 0, READY_TO_SYNC: 0 }),
    invalidFiles: catalog.invalidFiles.slice(0, 100),
  };
}

function syncCentralStudentPhotos() {
  requireAdmin_();
  return withCentralWriteLock_(function () {
    const photoSheet = getRequiredCentralPhotoSheet_();
    const schoolYear = getCurrentSchoolYear_();
    const students = readCentralStudents_(
      getRequiredCentralStudentSheet_(),
      false
    ).filter(function (student) {
      return student.schoolYear === schoolYear;
    });
    const existingPhotoRows = Array.from(
      readCentralPhotoRows_(photoSheet).values()
    );
    const catalog = buildCentralPhotoCatalog_(getCentralPhotoFolder_());
    const now = new Date();
    const rows = existingPhotoRows
      .filter(function (entry) {
        return entry.schoolYear && entry.schoolYear !== schoolYear;
      })
      .map(function (entry) {
        return [
          entry.studentKey,
          entry.schoolYear,
          entry.photoKey,
          entry.fileId,
          sanitizeSpreadsheetText_(entry.fileName),
          entry.mimeType,
          entry.lastUpdated,
          entry.synchronizedAt,
        ];
      });
    let connectedCount = 0;
    const duplicates = [];
    const missing = [];
    students.forEach(function (student) {
      const candidates = catalog.byPhotoKey.get(
        centralStudentPhotoKey_(student)
      ) || [];
      if (candidates.length === 0) {
        missing.push(student.studentKey);
        return;
      }
      if (candidates.length > 1) {
        duplicates.push({
          studentKey: student.studentKey,
          candidateCount: candidates.length,
        });
        return;
      }
      const file = candidates[0];
      rows.push([
        student.studentKey,
        student.schoolYear,
        centralStudentPhotoKey_(student),
        file.getId(),
        sanitizeSpreadsheetText_(file.getName()),
        file.getMimeType(),
        file.getLastUpdated(),
        now,
      ]);
      connectedCount += 1;
    });
    clearCentralSheetRows_(photoSheet, CENTRAL_PHOTO_HEADERS.length);
    if (rows.length) {
      photoSheet.getRange(
        2,
        1,
        rows.length,
        CENTRAL_PHOTO_HEADERS.length
      ).setValues(rows);
    }
    clearCentralPhotoRowsCache_(photoSheet.getParent());
    return {
      ok: true,
      connectedCount: connectedCount,
      missingCount: missing.length,
      duplicateCount: duplicates.length,
      invalidFileCount: catalog.invalidFiles.length,
      duplicates: duplicates.slice(0, 100),
      invalidFiles: catalog.invalidFiles.slice(0, 100),
    };
  });
}

function buildCentralPhotoCatalog_(folder) {
  const byPhotoKey = new Map();
  const byFileId = new Map();
  const invalidFiles = [];
  const files = folder.getFiles();
  while (files.hasNext()) {
    const file = files.next();
    if (file.isTrashed()) continue;
    const parsed = parseCentralPhotoFilename_(file.getName());
    if (
      !parsed
        || !CENTRAL_ALLOWED_PHOTO_MIME_TYPES.includes(file.getMimeType())
    ) {
      invalidFiles.push({ fileName: file.getName(), reason: 'INVALID_NAME_OR_TYPE' });
      continue;
    }
    const list = byPhotoKey.get(parsed) || [];
    list.push(file);
    byPhotoKey.set(parsed, list);
    byFileId.set(file.getId(), file);
  }
  return {
    byPhotoKey: byPhotoKey,
    byFileId: byFileId,
    invalidFiles: invalidFiles,
  };
}

function parseCentralPhotoFilename_(fileName) {
  const base = String(fileName || '').replace(/\.[^.]+$/, '').trim();
  const match = base.match(/^([1-3])([1-9])(\d{2})$/);
  return match ? `${match[1]}${match[2]}${match[3]}` : '';
}

function centralStudentPhotoKey_(student) {
  return `${student.grade}${student.classNumber}`
    + String(student.studentNumber).padStart(2, '0');
}
