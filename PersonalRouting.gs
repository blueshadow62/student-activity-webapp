// © 2026 류기현(부산 동아공고). CC BY-NC-SA 4.0(저작자표시-비영리-동일조건변경허락).
// https://creativecommons.org/licenses/by-nc-sa/4.0/deed.ko  문의: ryu1912@naver.com

const PERSONAL_ROUTING_CONFIG = Object.freeze({
  lockTimeoutMs: 30000,
});

function requirePersonalStorageContext_() {
  const userEmail = requireCurrentUserEmail_();
  const context = getOrCreatePersonalAppContext_(userEmail);
  if (
    !context
      || context.state !== 'READY'
      || !context.database
      || !context.database.spreadsheet
  ) {
    throw createPersonalStorageError_(
      context && context.state ? context.state : 'STORAGE_NOT_READY',
      personalRoutingStateMessage_(context && context.state)
    );
  }
  return {
    userEmail: userEmail,
    schoolYear: context.schoolYear,
    spreadsheet: context.database.spreadsheet,
  };
}

function getPersonalDatabaseForCurrentUser_() {
  const context = requirePersonalStorageContext_();
  ensurePersonalApplicationSchema_(context.spreadsheet);
  return context.spreadsheet;
}

function withPersonalDatabaseLock_(callback) {
  const lock = LockService.getUserLock();
  lock.waitLock(PERSONAL_ROUTING_CONFIG.lockTimeoutMs);
  try {
    requireCurrentUserEmail_();
    return callback();
  } finally {
    lock.releaseLock();
  }
}

function getAppSpreadsheet_() {
  return getPersonalDatabaseForCurrentUser_();
}

function ensurePersonalApplicationSchema_(spreadsheet, forceValidation) {
  const requiredNames = personalRoutingSheetNames_();
  const hasAllSheets = requiredNames.every(function (sheetName) {
    return Boolean(spreadsheet.getSheetByName(sheetName));
  });
  if (hasAllSheets && !forceValidation) {
    return spreadsheet;
  }

  ensureSettingsSheet_(spreadsheet);
  ensureRecordSheet_(spreadsheet);
  ensureArchivedRecordSheet_(spreadsheet);
  ensureDeletedRecordSheet_(spreadsheet);
  updatePersonalApplicationMetadata_(spreadsheet);
  clearAppCaches_(spreadsheet);
  return spreadsheet;
}

function updatePersonalApplicationMetadata_(spreadsheet) {
  const settingsSheet = spreadsheet.getSheetByName(APP_CONFIG.settingsSheetName);
  if (!settingsSheet) return;
  const rowCount = Math.max(settingsSheet.getLastRow() - 1, 0);
  if (rowCount <= 0) return;
  const metadata = settingsSheet
    .getRange(
      2,
      PERSONAL_STORAGE_CONFIG.metadataStartColumn,
      rowCount,
      PERSONAL_METADATA_HEADERS.length
    )
    .getValues();
  const now = new Date();
  metadata.forEach(function (row, index) {
    const key = String(row[0] || '').trim();
    if (key === 'appVersion') {
      settingsSheet
        .getRange(
          index + 2,
          PERSONAL_STORAGE_CONFIG.metadataStartColumn + 1
        )
        .setValue(APP_CONFIG.version);
      settingsSheet
        .getRange(
          index + 2,
          PERSONAL_STORAGE_CONFIG.metadataStartColumn + 2
        )
        .setValue(now);
    }
    if (key === 'updatedAt') {
      settingsSheet
        .getRange(
          index + 2,
          PERSONAL_STORAGE_CONFIG.metadataStartColumn + 1
        )
        .setValue(now);
      settingsSheet
        .getRange(
          index + 2,
          PERSONAL_STORAGE_CONFIG.metadataStartColumn + 2
        )
        .setValue(now);
    }
  });
}

function personalRoutingSheetNames_() {
  return [
    APP_CONFIG.settingsSheetName,
    APP_CONFIG.recordSheetName,
    APP_CONFIG.archivedRecordSheetName,
    APP_CONFIG.deletedRecordSheetName,
  ];
}

function personalRoutingStateMessage_(state) {
  const normalized = String(state || 'STORAGE_NOT_READY');
  const messages = {
    LOGIN_REQUIRED: '로그인 계정을 확인할 수 없어 개인 데이터에 접근하지 않았습니다.',
    TRASHED_DATABASE: '개인 데이터베이스가 휴지통에 있습니다. 저장소 복구 화면에서 처리해 주세요.',
    DATABASE_DELETED: '연결된 개인 데이터베이스가 삭제되었습니다. 저장소 복구 화면에서 처리해 주세요.',
    DATABASE_ACCESS_DENIED: '개인 데이터베이스 접근 권한을 확인할 수 없습니다.',
    PROPERTY_CORRUPT: '개인 저장소 연결정보가 손상되었습니다.',
    UNSUPPORTED_STORAGE_SCHEMA: '지원하지 않는 개인 저장소 스키마입니다.',
    STORAGE_NOT_READY: '개인 저장소를 준비하지 못했습니다.',
  };
  return messages[normalized] || '개인 저장소 상태를 확인한 뒤 다시 시도해 주세요.';
}
