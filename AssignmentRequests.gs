// © 2026 류기현(부산 동아공고). CC BY-NC-SA 4.0(저작자표시-비영리-동일조건변경허락).
// https://creativecommons.org/licenses/by-nc-sa/4.0/deed.ko
// 문의: https://github.com/blueshadow62/student-activity-webapp/issues

const CENTRAL_ASSIGNMENT_REQUEST_STATUS = Object.freeze({
  pending: 'PENDING',
  approved: 'APPROVED',
  rejected: 'REJECTED',
});

const CENTRAL_ASSIGNMENT_REQUEST_CONFIG = Object.freeze({
  propertyPrefix: 'ASSIGNMENT_REQUESTS_',
  allowedTeacherEmailsProperty: 'ALLOWED_TEACHER_EMAILS',
  maxResults: 500,
  maxRequestsPerUser: 50,
  maxProcessedRetained: 10,
  maxReasonLength: 200,
});

function submitMyAssignmentRequest(payload) {
  const teacherEmail = getRequiredActiveUserEmail_();
  requireAllowedTeacherEmail_(teacherEmail);
  const value = payload || {};
  const requestType = normalizeAssignmentRequestType_(value);
  const classNumbers = requestType.classNumbers;
  const result = withCentralWriteLock_(function () {
    // 승인 전 교사는 중앙 교사담당 시트에 접근 권한이 없을 수 있다. 이미
    // 승인된 반인지 미리 확인하는 절차만 건너뛰고, 실제 중복 여부는 승인
    // 처리 시 다시 확인해 기존 담당키로 안전하게 합쳐진다.
    let assignments = [];
    try {
      assignments = readCentralTeacherAssignmentsCached_(true);
    } catch (error) {
      assignments = [];
    }
    const requests = readStoredAssignmentRequestsForUser_(teacherEmail);
    const normalizedItems = classNumbers.map(function (classNumber) {
      return normalizeTeacherAssignmentPayload_({
        teacherEmail: teacherEmail,
        schoolYear: value.schoolYear,
        grade: value.grade,
        classNumber: classNumber,
        subject: value.subject,
        assignmentType: requestType.assignmentType,
        groupName: requestType.groupName,
        active: true,
      });
    });
    const isGroup = requestType.assignmentType === CENTRAL_ASSIGNMENT_TYPES.group;
    const describe = function (normalized) {
      return isGroup ? requestType.groupName : `${normalized.classNumber}반`;
    };
    const alreadyAssigned = normalizedItems.filter(function (normalized) {
      return assignments.some(function (assignment) {
        return isDuplicateTeacherAssignment_(assignment, normalized, '');
      });
    }).map(describe);
    if (alreadyAssigned.length) {
      throw new Error(
        `이미 승인된 담당이 있습니다: ${alreadyAssigned.join(', ')}`
      );
    }
    const alreadyPending = normalizedItems.filter(function (normalized) {
      return requests.some(function (request) {
        return request.status === CENTRAL_ASSIGNMENT_REQUEST_STATUS.pending
          && assignmentRequestMatches_(request, normalized);
      });
    }).map(describe);
    if (alreadyPending.length) {
      throw new Error(
        `이미 승인 대기 중인 담당이 있습니다: ${alreadyPending.join(', ')}`
      );
    }
    if (
      requests.length + normalizedItems.length
        > CENTRAL_ASSIGNMENT_REQUEST_CONFIG.maxRequestsPerUser
    ) {
      throw new Error('담당 신청 보관 한도를 초과했습니다. 관리자에게 문의해 주세요.');
    }
    const requestedAt = new Date().toISOString();
    const created = normalizedItems.map(function (normalized) {
      return {
        requestKey: Utilities.getUuid(),
        teacherEmail: teacherEmail,
        schoolYear: normalized.schoolYear,
        grade: normalized.grade,
        classNumber: normalized.classNumber,
        subject: normalized.subject,
        assignmentType: requestType.assignmentType,
        groupName: requestType.groupName,
        status: CENTRAL_ASSIGNMENT_REQUEST_STATUS.pending,
        requestedAt: requestedAt,
        processedAt: '',
        processedBy: '',
        reason: '',
        assignmentKey: '',
      };
    });
    writeStoredAssignmentRequestsForUser_(
      teacherEmail,
      requests.concat(created)
    );
    return {
      ok: true,
      count: created.length,
      requests: created.map(function (request) {
        return toPublicAssignmentRequest_(request, false);
      }),
    };
  });
  // 메일 발송 준비 중 어떤 이유로든 실패해도(예: 이 교사 계정이 메일 발송
  // 권한에 아직 동의하지 않은 경우) 이미 끝난 신청 저장 자체는 성공으로
  // 돌려줘야 한다. 그렇지 않으면 신청은 실제로 성공했는데 화면에는 빈 채로
  // 남아 새로고침을 눌러야만 보이는 것처럼 보인다.
  try {
    notifyAdminsOfNewAssignmentRequest_(teacherEmail, result.requests);
  } catch (error) {
    // 관리자 알림 실패는 신청 처리 자체를 막지 않는다.
  }
  return result;
}

// 승인 전 교사가 잘못 신청한 항목을 스스로 정리할 수 있어야 한다. 승인·거부가
// 끝난 신청은 이미 처리된 기록이라 취소 대상에서 뺀다.
function cancelMyAssignmentRequest(requestKey) {
  const key = String(requestKey || '').trim();
  if (!key) {
    throw new Error('취소할 신청을 확인해 주세요.');
  }
  return cancelAssignmentRequestsBatch([key]);
}

// 여러 반을 한 번에 신청한 교사가 하나씩 취소하지 않아도 되게 한다.
function cancelAssignmentRequestsBatch(requestKeys) {
  const teacherEmail = getRequiredActiveUserEmail_();
  const keys = Array.from(new Set(
    (Array.isArray(requestKeys) ? requestKeys : [])
      .map(function (key) { return String(key || '').trim(); })
      .filter(Boolean)
  ));
  if (!keys.length) {
    throw new Error('취소할 신청을 하나 이상 선택해 주세요.');
  }
  return withCentralWriteLock_(function () {
    const requests = readStoredAssignmentRequestsForUser_(teacherEmail);
    const targetKeys = new Set();
    keys.forEach(function (key) {
      const target = requests.find(function (request) {
        return request.requestKey === key;
      });
      if (!target) {
        throw new Error('신청 내역을 찾을 수 없습니다.');
      }
      if (target.status !== CENTRAL_ASSIGNMENT_REQUEST_STATUS.pending) {
        throw new Error('승인 대기 중인 신청만 취소할 수 있습니다.');
      }
      targetKeys.add(key);
    });
    writeStoredAssignmentRequestsForUser_(
      teacherEmail,
      requests.filter(function (request) {
        return !targetKeys.has(request.requestKey);
      })
    );
    return { ok: true, count: targetKeys.size };
  });
}

// 메일 발송 실패가 신청 처리 자체를 막지 않도록 쓰기 잠금 밖에서 보내고,
// notifyTeacherByEmail_ 이 개별 실패를 조용히 흡수한다.
function notifyAdminsOfNewAssignmentRequest_(teacherEmail, createdRequests) {
  if (!createdRequests.length) return;
  const adminEmails = getCentralConfiguration_().adminEmails;
  if (!adminEmails.length) return;
  const lines = createdRequests.map(function (request) {
    return `- ${assignmentRequestLabel_(request)}`;
  });
  const body = `${teacherEmail} 님이 아래 담당 수업 승인을 신청했습니다.\n\n${lines.join('\n')}\n\n관리자 포털의 교사 담당 탭에서 승인·거부할 수 있습니다.`;
  adminEmails.forEach(function (email) {
    notifyTeacherByEmail_(email, '[학생 활동 기록 웹앱] 담당 수업 승인 신청 안내', body);
  });
}

function getMyAssignmentRequests() {
  const teacherEmail = getRequiredActiveUserEmail_();
  return readStoredAssignmentRequestsForUser_(teacherEmail)
    .slice(0, CENTRAL_ASSIGNMENT_REQUEST_CONFIG.maxResults)
    .map(function (request) {
      return toPublicAssignmentRequest_(request, false);
    });
}

function getAdminAssignmentRequests(filters) {
  requireAdmin_();
  const value = filters || {};
  const status = String(value.status || '').trim().toUpperCase();
  const query = String(value.query || '').trim().toLowerCase();
  return readAllStoredAssignmentRequests_().filter(function (request) {
    return (!status || request.status === status)
      && (!query
        || request.teacherEmail.includes(query)
        || request.subject.toLocaleLowerCase('ko').includes(query));
  }).slice(0, CENTRAL_ASSIGNMENT_REQUEST_CONFIG.maxResults)
    .map(function (request) {
      return toPublicAssignmentRequest_(request, true);
    });
}

function reviewAssignmentRequest(requestKey, decision, reason) {
  const processed = reviewAssignmentRequests_([requestKey], decision, reason);
  return {
    ok: true,
    request: toPublicAssignmentRequest_(processed[0], true),
  };
}

function approveAssignmentRequestsBatch(requestKeys) {
  const processed = reviewAssignmentRequests_(
    requestKeys,
    CENTRAL_ASSIGNMENT_REQUEST_STATUS.approved,
    ''
  );
  return { ok: true, count: processed.length };
}

function reviewAssignmentRequests_(requestKeys, decision, reason) {
  requireAdmin_();
  const keys = normalizeAssignmentRequestKeys_(requestKeys);
  if (!keys.length) {
    throw new Error('처리할 담당 신청을 하나 이상 선택해 주세요.');
  }
  const normalizedDecision = normalizeAssignmentRequestDecision_(decision);
  const normalizedReason = normalizeAssignmentRequestReason_(
    reason,
    normalizedDecision === CENTRAL_ASSIGNMENT_REQUEST_STATUS.rejected
  );
  const reviewerEmail = getRequiredActiveUserEmail_();
  const processed = withCentralWriteLock_(function () {
    const requestsByKey = new Map(readAllStoredAssignmentRequests_().map(
      function (request) { return [request.requestKey, request]; }
    ));
    const selected = keys.map(function (key) {
      const request = requestsByKey.get(key);
      if (!request) throw new Error('처리할 담당 신청을 찾을 수 없습니다.');
      if (request.status !== CENTRAL_ASSIGNMENT_REQUEST_STATUS.pending) {
        throw new Error('이미 처리된 담당 신청이 포함되어 있습니다. 새로고침 후 다시 시도해 주세요.');
      }
      return request;
    });

    const approved = normalizedDecision
      === CENTRAL_ASSIGNMENT_REQUEST_STATUS.approved;
    if (approved) {
      const uniqueTeacherEmails = Array.from(new Set(
        selected.map(function (request) { return request.teacherEmail; })
      ));
      // 중앙 자료 공유가 성공해야만 아래에서 담당·신청 상태를 승인으로 기록한다.
      grantCentralAccessToTeachers_(uniqueTeacherEmails);
    }
    const assignmentSheet = approved ? getRequiredCentralAssignmentSheet_() : null;
    const assignments = approved
      ? readCentralTeacherAssignments_(assignmentSheet, true) : [];
    const now = new Date();
    const assignmentRows = [];
    const approvedGroups = [];
    const processed = selected.map(function (request) {
      let assignmentKey = '';
      if (approved) {
        const normalized = normalizeTeacherAssignmentPayload_({
          teacherEmail: request.teacherEmail,
          schoolYear: request.schoolYear,
          grade: request.grade,
          classNumber: request.classNumber,
          subject: request.subject,
          assignmentType: request.assignmentType
            || CENTRAL_ASSIGNMENT_TYPES.subject,
          groupName: request.groupName || '',
          active: true,
        });
        const existing = assignments.find(function (assignment) {
          return isDuplicateTeacherAssignment_(assignment, normalized, '');
        });
        assignmentKey = existing ? existing.assignmentKey : Utilities.getUuid();
        if (!existing) {
          assignments.push({
            ...normalized,
            assignmentKey: assignmentKey,
            active: true,
          });
          assignmentRows.push(buildTeacherAssignmentRow_(
            normalized, assignmentKey, now, now
          ));
          if (centralAssignmentIsGroup_(normalized)) {
            approvedGroups.push({
              assignmentKey: assignmentKey,
              groupName: normalized.groupName,
            });
          }
        }
      }
      return {
        ...request,
        status: normalizedDecision,
        processedAt: now.toISOString(),
        processedBy: reviewerEmail,
        reason: normalizedReason,
        assignmentKey: assignmentKey,
      };
    });

    if (assignmentRows.length) {
      assignmentSheet.getRange(
        assignmentSheet.getLastRow() + 1,
        1,
        assignmentRows.length,
        CENTRAL_TEACHER_ASSIGNMENT_HEADERS.length
      ).setValues(assignmentRows);
      clearCentralTeacherAssignmentCache_(assignmentSheet.getParent());
    }
    // 담당 행을 쓴 뒤에 그룹 이름을 남긴다. 담당 행이 없으면 가리킬 대상이 없다.
    approvedGroups.forEach(function (group) {
      upsertCentralGroupName_(group.assignmentKey, group.groupName);
    });
    const auditSheet = getRequiredCentralAssignmentRequestSheet_();
    auditSheet.getRange(
      auditSheet.getLastRow() + 1,
      1,
      processed.length,
      CENTRAL_ASSIGNMENT_REQUEST_HEADERS.length
    ).setValues(processed.map(buildCentralAssignmentRequestRow_));

    const requestsByTeacher = new Map();
    processed.forEach(function (request) {
      if (!requestsByTeacher.has(request.teacherEmail)) {
        requestsByTeacher.set(
          request.teacherEmail,
          readStoredAssignmentRequestsForUser_(request.teacherEmail)
        );
      }
      const requests = requestsByTeacher.get(request.teacherEmail);
      const index = requests.findIndex(function (candidate) {
        return candidate.requestKey === request.requestKey;
      });
      if (index >= 0) requests[index] = request;
    });
    requestsByTeacher.forEach(function (requests, teacherEmail) {
      writeStoredAssignmentRequestsForUser_(teacherEmail, requests);
    });
    return processed;
  });
  notifyTeachersOfAssignmentReview_(processed, normalizedDecision, normalizedReason);
  return processed;
}

// 잠금 밖에서 보내 메일 발송 지연이 쓰기 잠금을 오래 붙잡지 않게 한다.
function notifyTeachersOfAssignmentReview_(processed, decision, reason) {
  const approved = decision === CENTRAL_ASSIGNMENT_REQUEST_STATUS.approved;
  const labelsByTeacher = new Map();
  processed.forEach(function (request) {
    const labels = labelsByTeacher.get(request.teacherEmail) || [];
    labels.push(
      assignmentRequestLabel_(request)
    );
    labelsByTeacher.set(request.teacherEmail, labels);
  });
  labelsByTeacher.forEach(function (labels, teacherEmail) {
    const subject = approved
      ? '[학생 활동 기록 웹앱] 담당 수업 승인 안내'
      : '[학생 활동 기록 웹앱] 담당 수업 거부 안내';
    const lines = [
      approved
        ? '아래 담당 수업 신청이 승인되었습니다.'
        : '아래 담당 수업 신청이 거부되었습니다.',
      '',
      ...labels.map(function (label) { return `- ${label}`; }),
    ];
    if (!approved && reason) {
      lines.push('', `거부 사유: ${reason}`);
    }
    notifyTeacherByEmail_(teacherEmail, subject, lines.join('\n'));
  });
}

// 학급 단위는 여러 반을 한 번에 신청하지만, 수강 그룹은 이름 하나로 한 건만
// 신청한다. 그룹 담당의 반은 실제로 없는 0으로 고정해 학급 단위 담당과 절대
// 겹치지 않게 한다.
function normalizeAssignmentRequestType_(value) {
  const requested = String(value && value.assignmentType || '').trim();
  if (requested !== CENTRAL_ASSIGNMENT_TYPES.group) {
    return {
      assignmentType: CENTRAL_ASSIGNMENT_TYPES.subject,
      groupName: '',
      classNumbers: normalizeCentralClassNumberList_(value && value.classNumbers),
    };
  }
  const groupName = String(value && value.groupName || '').trim();
  if (!groupName) {
    throw new Error('수강 그룹 이름을 입력해 주세요.');
  }
  if (groupName.length > CENTRAL_CONFIG.maxGroupNameLength) {
    throw new Error(
      `수강 그룹 이름은 ${CENTRAL_CONFIG.maxGroupNameLength}자 이내로 입력해 주세요.`
    );
  }
  return {
    assignmentType: CENTRAL_ASSIGNMENT_TYPES.group,
    groupName: groupName,
    classNumbers: [CENTRAL_CONFIG.externalClassNumber],
  };
}

// 승인으로 담당 행이 새로 생겼을 때 그룹 이름을 기록한다. 담당키가 이미 있으면
// 이름만 갱신하고 생성일시는 보존한다.
function upsertCentralGroupName_(assignmentKey, groupName) {
  const sheet = getRequiredCentralGroupSheet_();
  const rowCount = sheet.getLastRow() - 1;
  const keys = rowCount > 0
    ? sheet.getRange(2, 1, rowCount, 1).getDisplayValues()
    : [];
  const index = keys.findIndex(function (row) {
    return String(row[0] || '').trim() === assignmentKey;
  });
  const now = new Date();
  if (index >= 0) {
    sheet.getRange(index + 2, 2, 1, 3).setValues([[
      sanitizeSpreadsheetText_(groupName),
      sheet.getRange(index + 2, 3).getValue() || now,
      now,
    ]]);
  } else {
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, CENTRAL_GROUP_HEADERS.length)
      .setValues([[
        assignmentKey,
        sanitizeSpreadsheetText_(groupName),
        now,
        now,
      ]]);
  }
  clearCentralGroupCache_(sheet.getParent());
}

function normalizeAssignmentRequestKeys_(requestKeys) {
  const keys = Array.from(new Set(
    (Array.isArray(requestKeys) ? requestKeys : [])
      .map(function (key) { return String(key || '').trim(); })
      .filter(Boolean)
  ));
  if (keys.length > CENTRAL_ASSIGNMENT_REQUEST_CONFIG.maxResults) {
    throw new Error('한 번에 처리할 담당 신청 수가 너무 많습니다.');
  }
  return keys;
}

function readStoredAssignmentRequestsForUser_(teacherEmail) {
  const normalizedEmail = normalizeCentralEmail_(teacherEmail);
  if (!isValidCentralEmail_(normalizedEmail)) return [];
  const raw = PropertiesService.getScriptProperties().getProperty(
    assignmentRequestPropertyKey_(normalizedEmail)
  );
  if (!raw) return [];
  try {
    const requests = JSON.parse(raw);
    if (!Array.isArray(requests)) return [];
    return requests.filter(isValidStoredAssignmentRequest_)
      .sort(compareStoredAssignmentRequests_);
  } catch (error) {
    throw createCentralError_(
      'ASSIGNMENT_REQUEST_STORAGE_INVALID',
      '담당 신청 저장 상태를 확인해 주세요.'
    );
  }
}

function readAllStoredAssignmentRequests_() {
  const properties = PropertiesService.getScriptProperties().getProperties();
  return Object.keys(properties).filter(function (key) {
    return key.startsWith(CENTRAL_ASSIGNMENT_REQUEST_CONFIG.propertyPrefix);
  }).flatMap(function (key) {
    try {
      const requests = JSON.parse(properties[key]);
      return Array.isArray(requests)
        ? requests.filter(isValidStoredAssignmentRequest_)
        : [];
    } catch (error) {
      return [];
    }
  }).sort(compareStoredAssignmentRequests_);
}

// 웹앱은 로그인한 Google 계정이면 누구나 열 수 있고, 담당 신청은 승인 전
// 교사도 해야 하므로 승인 여부로 막을 수 없다. 그래서 관리자가 원할 때만
// 켜는 관문을 둔다. `ALLOWED_TEACHER_EMAILS` 가 비어 있으면 지금처럼 누구나
// 신청할 수 있고, 값이 있으면 그 목록에 맞는 계정만 신청할 수 있다. 목록은
// 이메일 전체(kim@x.hs.kr)와 도메인(@x.hs.kr)을 함께 받는다. 기본을 꺼짐으로
// 두는 이유는, 설치 직후 아무도 신청하지 못하면 최초 관리자가 막히기 때문이다.
function requireAllowedTeacherEmail_(email) {
  const allowed = parseCentralEmailList_(
    PropertiesService.getScriptProperties().getProperty(
      CENTRAL_ASSIGNMENT_REQUEST_CONFIG.allowedTeacherEmailsProperty
    )
  );
  if (!allowed.length) return;
  const normalized = normalizeCentralEmail_(email);
  const domain = normalized.slice(normalized.indexOf('@'));
  if (allowed.includes(normalized) || allowed.includes(domain)) return;
  throw createCentralError_(
    'TEACHER_NOT_ALLOWED',
    '담당 신청이 허용되지 않은 계정입니다. 관리자에게 문의해 주세요.'
  );
}

// 처리 끝난 신청의 감사 이력은 중앙 `담당신청` 시트에 따로 남는다. Script
// Properties 는 스토어 전체가 500KB 이고 ADMIN_EMAILS·중앙 파일 ID 같은 설치
// 설정이 같은 스토어를 쓴다. 처리 완료 건까지 무한정 쌓으면 설치 설정 저장까지
// 함께 막히므로, 교사 화면이 승인·거부 결과와 거부 사유를 보여줄 만큼만 최근
// 것으로 남긴다. 대기 중 신청은 취소·승인 대상이라 하나도 버리지 않는다.
function pruneStoredAssignmentRequests_(requests) {
  const pending = requests.filter(function (request) {
    return request.status === CENTRAL_ASSIGNMENT_REQUEST_STATUS.pending;
  });
  const processed = requests.filter(function (request) {
    return request.status !== CENTRAL_ASSIGNMENT_REQUEST_STATUS.pending;
  }).slice(0, CENTRAL_ASSIGNMENT_REQUEST_CONFIG.maxProcessedRetained);
  return pending.concat(processed).sort(compareStoredAssignmentRequests_);
}

function writeStoredAssignmentRequestsForUser_(teacherEmail, requests) {
  // 신청·취소·승인 세 경로가 모두 이 함수를 지나가므로 여기서 한 번만 줄인다.
  const retained = pruneStoredAssignmentRequests_(requests);
  if (retained.length > CENTRAL_ASSIGNMENT_REQUEST_CONFIG.maxRequestsPerUser) {
    throw new Error('담당 신청 보관 한도를 초과했습니다.');
  }
  const json = JSON.stringify(retained);
  if (json.length > 8500) {
    throw new Error('담당 신청 저장 용량을 초과했습니다. 관리자에게 문의해 주세요.');
  }
  PropertiesService.getScriptProperties().setProperty(
    assignmentRequestPropertyKey_(teacherEmail),
    json
  );
}

// 담당 신청은 특정 중앙 교사담당 시트를 전제로 한 기록이다. 중앙 자료 연결을
// 끊으면 '승인' 이력이 가리키던 담당 행이 사라져, 관리자 화면에는 승인 4건인데
// 담당 수업은 0건인 거짓 상태가 남는다. 교사 본인도 승인된 줄 알게 된다.
// 그래서 연결 해제 시 신청 이력도 함께 지운다.
function clearStoredAssignmentRequests_(properties) {
  const store = properties || PropertiesService.getScriptProperties();
  const keys = Object.keys(store.getProperties()).filter(function (key) {
    return key.startsWith(CENTRAL_ASSIGNMENT_REQUEST_CONFIG.propertyPrefix);
  });
  keys.forEach(function (key) {
    store.deleteProperty(key);
  });
  return keys.length;
}

function assignmentRequestPropertyKey_(teacherEmail) {
  return CENTRAL_ASSIGNMENT_REQUEST_CONFIG.propertyPrefix
    + centralHash_(normalizeCentralEmail_(teacherEmail));
}

function isValidStoredAssignmentRequest_(request) {
  if (
    !request
      || !request.requestKey
      || !isValidCentralEmail_(request.teacherEmail)
      || !Number.isInteger(Number(request.schoolYear))
      || !APP_CONFIG.allowedGrades.includes(Number(request.grade))
      || !Number.isInteger(Number(request.classNumber))
      || !String(request.subject || '').trim()
      || !Object.values(CENTRAL_ASSIGNMENT_REQUEST_STATUS)
        .includes(String(request.status || '').trim().toUpperCase())
  ) {
    return false;
  }
  // 그룹 신청은 반이 0이고 이름이 있어야 한다. 학급 단위는 반이 1 이상이어야
  // 한다. 담당유형이 없는 기존 신청은 학급 단위로 본다.
  if (String(request.assignmentType || '').trim() === CENTRAL_ASSIGNMENT_TYPES.group) {
    return Number(request.classNumber) === CENTRAL_CONFIG.externalClassNumber
      && Boolean(String(request.groupName || '').trim());
  }
  return Number(request.classNumber) > 0;
}

function compareStoredAssignmentRequests_(left, right) {
  return assignmentRequestDate_(right.requestedAt).getTime()
    - assignmentRequestDate_(left.requestedAt).getTime();
}

function buildCentralAssignmentRequestRow_(request) {
  return [
    request.requestKey,
    request.teacherEmail,
    Number(request.schoolYear),
    Number(request.grade),
    Number(request.classNumber),
    sanitizeSpreadsheetText_(request.subject),
    request.status,
    assignmentRequestDate_(request.requestedAt),
    request.processedAt ? assignmentRequestDate_(request.processedAt) : '',
    request.processedBy || '',
    sanitizeSpreadsheetText_(request.reason || ''),
    request.assignmentKey || '',
  ];
}

function toPublicAssignmentRequest_(request, includeTeacherEmail) {
  const assignmentType = String(request.assignmentType || '').trim()
    === CENTRAL_ASSIGNMENT_TYPES.group
    ? CENTRAL_ASSIGNMENT_TYPES.group
    : CENTRAL_ASSIGNMENT_TYPES.subject;
  const groupName = String(request.groupName || '');
  const result = {
    requestKey: request.requestKey,
    schoolYear: Number(request.schoolYear),
    grade: Number(request.grade),
    classNumber: Number(request.classNumber),
    subject: String(request.subject || ''),
    assignmentType: assignmentType,
    groupName: groupName,
    // 관리자가 무엇을 승인하는지 한 줄로 알 수 있어야 한다. 그룹 신청은 반이
    // 0이라 반 번호를 보여줘도 의미가 없다.
    target: assignmentType === CENTRAL_ASSIGNMENT_TYPES.group
      ? groupName
      : `${Number(request.classNumber)}반`,
    status: String(request.status || ''),
    statusLabel: assignmentRequestStatusLabel_(request.status),
    requestedAt: formatDateTime_(assignmentRequestDate_(request.requestedAt), ''),
    processedAt: request.processedAt
      ? formatDateTime_(assignmentRequestDate_(request.processedAt), '') : '',
    reason: request.reason || '',
  };
  if (includeTeacherEmail) result.teacherEmail = request.teacherEmail;
  return result;
}

// 알림 메일과 화면이 같은 문구를 쓰게 한 곳에 모은다. 그룹 신청은 반이 0이라
// '0반'이라고 쓰면 받는 사람이 무슨 수업인지 알 수 없다.
function assignmentRequestLabel_(request) {
  const base = `${request.schoolYear}학년도 ${request.grade}학년`;
  return String(request.assignmentType || '').trim() === CENTRAL_ASSIGNMENT_TYPES.group
    ? `${base} ${request.groupName || '이름 없는 그룹'} ${request.subject}`
    : `${base} ${request.classNumber}반 ${request.subject}`;
}

function assignmentRequestMatches_(request, assignment) {
  return request.teacherEmail === assignment.teacherEmail
    && Number(request.schoolYear) === assignment.schoolYear
    && Number(request.grade) === assignment.grade
    && Number(request.classNumber) === assignment.classNumber
    && request.subject === assignment.subject;
}

function normalizeAssignmentRequestDecision_(value) {
  const decision = String(value || '').trim().toUpperCase();
  if (
    decision !== CENTRAL_ASSIGNMENT_REQUEST_STATUS.approved
      && decision !== CENTRAL_ASSIGNMENT_REQUEST_STATUS.rejected
  ) {
    throw new Error('담당 신청 처리 값을 확인해 주세요.');
  }
  return decision;
}

function normalizeAssignmentRequestReason_(value, required) {
  const reason = String(value || '').trim();
  if (required && !reason) throw new Error('거부 사유를 입력해 주세요.');
  if (reason.length > CENTRAL_ASSIGNMENT_REQUEST_CONFIG.maxReasonLength) {
    throw new Error(
      `처리 사유는 ${CENTRAL_ASSIGNMENT_REQUEST_CONFIG.maxReasonLength}자 이내로 입력해 주세요.`
    );
  }
  return reason;
}

function assignmentRequestDate_(value) {
  const date = value instanceof Date ? value : new Date(value || 0);
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

function assignmentRequestStatusLabel_(status) {
  if (status === CENTRAL_ASSIGNMENT_REQUEST_STATUS.approved) return '승인';
  if (status === CENTRAL_ASSIGNMENT_REQUEST_STATUS.rejected) return '거부';
  return '승인 대기';
}
