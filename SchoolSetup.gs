// © 2026 류기현(부산 동아공고). CC BY-NC-SA 4.0(저작자표시-비영리-동일조건변경허락).
// https://creativecommons.org/licenses/by-nc-sa/4.0/deed.ko
// 문의: https://github.com/blueshadow62/student-activity-webapp/issues

const SCHOOL_SETUP_CONFIG = Object.freeze({
  maxCsvLength: 2 * 1024 * 1024,
  maxRosterRows: 2000,
  initialStatuses: Object.freeze(['재학', '위탁']),
});

const ROSTER_CSV_HEADERS = CENTRAL_ROSTER_CSV_HEADERS;

function sanitizeCsvCell_(value) {
  let text = String(value == null ? '' : value);
  if (/^[=+\-@]/.test(text)) {
    text = `'${text}`;
  }
  return `"${text.replace(/"/g, '""')}"`;
}

function parseAndValidateRosterCsv_(csvText) {
  const text = String(csvText || '');
  if (!text.trim()) {
    throw new Error('등록할 CSV 파일을 선택해 주세요.');
  }
  if (text.length > SCHOOL_SETUP_CONFIG.maxCsvLength) {
    throw new Error('CSV 파일이 너무 큽니다. 2MB 이하 파일을 사용해 주세요.');
  }
  if (text.includes('\uFFFD')) {
    throw new Error('CSV 문자 인코딩을 확인할 수 없습니다. CSV UTF-8 형식으로 다시 저장해 주세요.');
  }
  const rows = Utilities.parseCsv(text.replace(/^\uFEFF/, ''))
    .filter(function (row) { return row.some(function (value) { return String(value).trim(); }); });
  if (rows.length < 2) {
    throw new Error('CSV에 머리글과 학생 데이터가 필요합니다.');
  }
  const headers = rows[0].map(function (value) { return String(value).trim(); });
  if (headers.length !== ROSTER_CSV_HEADERS.length
      || !ROSTER_CSV_HEADERS.every(function (header, index) { return headers[index] === header; })) {
    throw new Error(`CSV 머리글은 다음 순서여야 합니다: ${ROSTER_CSV_HEADERS.join(', ')}`);
  }
  const dataRows = rows.slice(1);
  if (dataRows.length > SCHOOL_SETUP_CONFIG.maxRosterRows) {
    throw new Error(`학생은 최대 ${SCHOOL_SETUP_CONFIG.maxRosterRows}명까지 한 번에 등록할 수 있습니다.`);
  }

  const duplicates = new Set();
  return dataRows.map(function (row, index) {
    const rowNumber = index + 2;
    if (row.length !== ROSTER_CSV_HEADERS.length) {
      throw new Error(`${rowNumber}행의 열 개수가 올바르지 않습니다.`);
    }
    const grade = Number(String(row[0]).trim());
    const classNumber = Number(String(row[1]).trim());
    const studentNumber = Number(String(row[2]).trim());
    const name = String(row[3]).trim();
    const status = String(row[4]).trim();
    if (!APP_CONFIG.allowedGrades.includes(grade)) {
      throw new Error(`${rowNumber}행 학년은 1·2·3 중에서 입력해 주세요.`);
    }
    if (!Number.isInteger(classNumber) || classNumber <= 0) {
      throw new Error(`${rowNumber}행 반은 1 이상의 정수로 입력해 주세요.`);
    }
    if (!Number.isInteger(studentNumber)
        || studentNumber <= 0
        || studentNumber > APP_CONFIG.maxStudentNumber) {
      throw new Error(`${rowNumber}행 번호는 1~${APP_CONFIG.maxStudentNumber} 사이의 정수로 입력해 주세요.`);
    }
    if (!name || name.length > APP_CONFIG.maxStudentNameLength) {
      throw new Error(`${rowNumber}행 이름은 1~${APP_CONFIG.maxStudentNameLength}자로 입력해 주세요.`);
    }
    if (/^[=+\-@]/.test(name)) {
      throw new Error(`${rowNumber}행 이름에 수식이 포함되어 있습니다. 값만 붙여넣기 후 다시 저장해 주세요.`);
    }
    if (!SCHOOL_SETUP_CONFIG.initialStatuses.includes(status)) {
      throw new Error(`${rowNumber}행 학적상태는 재학 또는 위탁만 입력해 주세요.`);
    }
    const duplicateKey = [grade, classNumber, studentNumber].join('-');
    if (duplicates.has(duplicateKey)) {
      throw new Error(`${rowNumber}행의 학년·반·번호가 앞 행과 중복됩니다.`);
    }
    duplicates.add(duplicateKey);
    return {
      grade: grade,
      classNumber: classNumber,
      studentNumber: studentNumber,
      name: name,
      status: status,
    };
  });
}
