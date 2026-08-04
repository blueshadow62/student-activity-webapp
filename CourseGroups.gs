// © 2026 류기현(부산 동아공고). CC BY-NC-SA 4.0(저작자표시-비영리-동일조건변경허락).
// https://creativecommons.org/licenses/by-nc-sa/4.0/deed.ko
// 문의: https://github.com/blueshadow62/student-activity-webapp/issues

// 담당 소유는 requireMyAssignment_ 가 이미 막는다. 여기서는 담당유형만 더
// 확인해, 학급 단위 담당으로 편성 기능을 부르는 것을 거부한다.
function requireMyGroupAssignment_(assignmentKey) {
  const assignment = requireMyAssignment_(assignmentKey);
  if (!centralAssignmentIsGroup_(assignment)) {
    throw createCentralError_(
      'ASSIGNMENT_NOT_GROUP',
      '수강 그룹 담당에서만 학생을 편성할 수 있습니다.'
    );
  }
  return assignment;
}

// 편성 후보는 담당 학년도·학년의 활성 학생 전체다. 타교생(반 0)도 포함한다.
// 한 학년이 200명을 넘을 수 있어 기존 학생 조회 상한(50)을 쓸 수 없다.
// 대신 증명사진을 싣지 않아 응답이 가볍다. 사진은 기록 화면에서만 쓴다.
function getMyGroupRoster(assignmentKey) {
  const assignment = requireMyGroupAssignment_(assignmentKey);
  const memberKeys = Array.from(
    readCentralGroupMembersCached_().get(assignment.assignmentKey) || new Set()
  );
  const candidates = centralGroupCandidateStudents_(assignment)
    .sort(compareCentralStudents_)
    .slice(0, CENTRAL_CONFIG.maxGroupCandidates)
    .map(toPublicCentralStudent_);
  return {
    assignment: toPublicCentralAssignment_(assignment),
    candidates: candidates,
    memberKeys: memberKeys,
    maxMembers: CENTRAL_CONFIG.maxGroupMembers,
  };
}

function centralGroupCandidateStudents_(assignment) {
  return readCentralStudentsCached_().filter(function (student) {
    return student.active
      && Number(student.schoolYear) === Number(assignment.schoolYear)
      && Number(student.grade) === Number(assignment.grade);
  });
}

// 명단을 통째로 교체한다. 화면에서 여러 번 옮긴 뒤 한 번만 저장하므로 부분
// 갱신보다 단순하고, 중간 상태가 시트에 남지 않는다.
function saveMyGroupRoster(assignmentKey, studentKeys) {
  const assignment = requireMyGroupAssignment_(assignmentKey);
  const keys = Array.from(new Set(
    (Array.isArray(studentKeys) ? studentKeys : [])
      .map(function (key) { return String(key || '').trim(); })
      .filter(Boolean)
  ));
  if (keys.length > CENTRAL_CONFIG.maxGroupMembers) {
    throw new Error(
      `한 그룹에는 ${CENTRAL_CONFIG.maxGroupMembers}명까지 넣을 수 있습니다.`
    );
  }
  // 클라이언트가 보낸 학생키를 그대로 믿지 않는다. 담당 학년 밖 학생이 들어가면
  // 그 학생에 대한 기록 권한이 생기므로 서버에서 다시 확인한다.
  const allowed = new Set(
    centralGroupCandidateStudents_(assignment).map(function (student) {
      return student.studentKey;
    })
  );
  keys.forEach(function (key) {
    if (!allowed.has(key)) {
      throw createCentralError_(
        'STUDENT_FORBIDDEN',
        '담당 학년의 학생만 그룹에 넣을 수 있습니다.'
      );
    }
  });
  return withCentralWriteLock_(function () {
    replaceCentralGroupMembers_(assignment.assignmentKey, keys);
    return { ok: true, count: keys.length };
  });
}

// 공동교육과정 타교생은 중앙 명단에 없다. 교사가 직접 넣되 범위를 좁게 잠근다.
// 반은 0 고정이라 실제 학급 명단이 오염되지 않고, 학적상태는 공동 고정이며,
// 학년도·학년은 담당 값만 쓴다. 관리자 전용 addCentralStudent 는 그대로 둔다.
function addExternalStudentToMyGroup(assignmentKey, payload) {
  const assignment = requireMyGroupAssignment_(assignmentKey);
  const value = payload || {};
  const name = String(value.name || '').trim();
  if (!name) throw new Error('타교생 이름을 입력해 주세요.');
  return withCentralWriteLock_(function () {
    const sheet = getRequiredCentralStudentSheet_();
    const taken = new Set(
      readCentralStudents_(sheet, true)
        .filter(function (student) {
          return Number(student.schoolYear) === Number(assignment.schoolYear)
            && Number(student.grade) === Number(assignment.grade)
            && Number(student.classNumber) === CENTRAL_CONFIG.externalClassNumber;
        })
        .map(function (student) { return Number(student.studentNumber); })
    );
    const requested = Number(value.studentNumber);
    let studentNumber;
    if (Number.isInteger(requested) && requested > 0) {
      if (taken.has(requested)) {
        throw createCentralError_(
          'EXTERNAL_STUDENT_NUMBER_TAKEN',
          `${assignment.grade}학년 공동교육과정 ${requested}번은 이미 사용 중입니다.`
        );
      }
      studentNumber = requested;
    } else {
      studentNumber = nextExternalStudentNumber_(taken);
    }
    const student = appendCentralStudentRow_(
      sheet,
      normalizeCentralStudentPayload_({
        schoolYear: assignment.schoolYear,
        grade: assignment.grade,
        classNumber: CENTRAL_CONFIG.externalClassNumber,
        studentNumber: studentNumber,
        name: name,
        status: '공동',
      }, null)
    );
    appendCentralGroupMember_(assignment.assignmentKey, student.studentKey);
    return { ok: true, student: toPublicCentralStudent_(student) };
  });
}

// 99번부터 거꾸로 내려가며 비어 있는 첫 번호를 고른다. 실제 학생 번호는 앞에서
// 부터 채워지므로 뒤에서부터 잡으면 부딪힐 일이 거의 없다.
function nextExternalStudentNumber_(taken) {
  for (
    let number = CENTRAL_CONFIG.externalStudentNumberStart;
    number > 0;
    number -= 1
  ) {
    if (!taken.has(number)) return number;
  }
  throw createCentralError_(
    'EXTERNAL_STUDENT_NUMBER_TAKEN',
    '이 학년에 더 넣을 수 있는 공동교육과정 번호가 없습니다.'
  );
}

function appendCentralGroupMember_(assignmentKey, studentKey) {
  const members = readCentralGroupMembersCached_().get(assignmentKey) || new Set();
  if (members.has(studentKey)) return;
  if (members.size + 1 > CENTRAL_CONFIG.maxGroupMembers) {
    throw new Error(
      `한 그룹에는 ${CENTRAL_CONFIG.maxGroupMembers}명까지 넣을 수 있습니다.`
    );
  }
  const sheet = getRequiredCentralGroupMemberSheet_();
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, CENTRAL_GROUP_MEMBER_HEADERS.length)
    .setValues([[assignmentKey, studentKey, new Date()]]);
  clearCentralGroupCache_(sheet.getParent());
}

function replaceCentralGroupMembers_(assignmentKey, studentKeys) {
  const sheet = getRequiredCentralGroupMemberSheet_();
  const rowCount = sheet.getLastRow() - 1;
  const kept = [];
  if (rowCount > 0) {
    sheet.getRange(2, 1, rowCount, CENTRAL_GROUP_MEMBER_HEADERS.length)
      .getValues()
      .forEach(function (row) {
        if (String(row[0] || '').trim() !== assignmentKey) kept.push(row);
      });
  }
  const now = new Date();
  const rows = kept.concat(studentKeys.map(function (studentKey) {
    return [assignmentKey, studentKey, now];
  }));
  clearCentralSheetRows_(sheet, CENTRAL_GROUP_MEMBER_HEADERS.length);
  if (rows.length) {
    sheet.getRange(2, 1, rows.length, CENTRAL_GROUP_MEMBER_HEADERS.length)
      .setValues(rows);
  }
  clearCentralGroupCache_(sheet.getParent());
}
