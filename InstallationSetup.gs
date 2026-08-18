// © 2026 류기현(부산 동아공고). CC BY-NC-SA 4.0(저작자표시-비영리-동일조건변경허락).
// https://creativecommons.org/licenses/by-nc-sa/4.0/deed.ko
// 문의: https://github.com/blueshadow62/student-activity-webapp/issues

const INSTALLATION_CONFIG = Object.freeze({
  stateProperty: 'INSTALLATION_STATE',
  versionProperty: 'INSTALLATION_VERSION',
  schoolNameProperty: 'SCHOOL_NAME',
  schoolLevelProperty: 'SCHOOL_LEVEL',
  version: '2',
  maxSchoolNameLength: 100,
  states: Object.freeze({
    adminRegistrationRequired: 'ADMIN_REGISTRATION_REQUIRED',
    setupRequired: 'SETUP_REQUIRED',
    ready: 'READY',
  }),
});

function registerInitialSchoolAdministrator() {
  const email = requireScriptProjectEditor_();
  return withCentralWriteLock_(function () {
    const current = getSchoolInstallationState_();
    if (current.adminConfigured) {
      return {
        ok: true,
        alreadyRegistered: true,
        installation: current,
      };
    }
    if (!isValidCentralEmail_(email)) {
      throw createCentralError_(
        'INSTALLATION_EMAIL_REQUIRED',
        '최초 관리자로 등록할 Google 계정 이메일을 확인할 수 없습니다.'
      );
    }
    const values = {};
    values[CENTRAL_CONFIG.adminEmailsProperty] = email;
    values[INSTALLATION_CONFIG.stateProperty] =
      INSTALLATION_CONFIG.states.setupRequired;
    values[INSTALLATION_CONFIG.versionProperty] =
      INSTALLATION_CONFIG.version;
    PropertiesService.getScriptProperties().setProperties(values, false);
    return {
      ok: true,
      alreadyRegistered: false,
      installation: getSchoolInstallationState_(),
    };
  });
}

// 편집기 실행과 웹앱 호출을 구분하는 Apps Script API는 없다.
// ScriptApp.getService().isEnabled()는 "웹앱이 배포되어 있는가"이지 "지금
// 웹앱으로 실행 중인가"가 아니어서, 한 번 배포하면 편집기 실행까지 막아 버린다.
// 그래서 실행 위치가 아니라 호출자로 판정한다. 스크립트 프로젝트에 편집 권한이
// 있는 계정만 최초 관리자가 될 수 있고, 교사에게는 /exec URL만 주므로
// google.script.run으로 직접 호출해도 통과하지 못한다.
function requireScriptProjectEditor_() {
  const email = getRequiredActiveUserEmail_();
  let editors;
  try {
    const file = DriveApp.getFileById(ScriptApp.getScriptId());
    editors = [file.getOwner()].concat(file.getEditors());
  } catch (error) {
    throw createCentralError_(
      'INSTALLATION_EDITOR_REQUIRED',
      '최초 관리자는 Apps Script 프로젝트에 편집 권한이 있는 계정으로 등록해야 합니다.'
    );
  }
  const allowed = editors.filter(Boolean).map(function (user) {
    return normalizeCentralEmail_(user.getEmail());
  });
  if (!allowed.includes(email)) {
    throw createCentralError_(
      'INSTALLATION_EDITOR_REQUIRED',
      '최초 관리자는 Apps Script 프로젝트에 편집 권한이 있는 계정으로 등록해야 합니다.'
    );
  }
  return email;
}

function provisionSchoolCentralResources(payload) {
  requireAdmin_();
  const requestedSchoolName = normalizeInstallationSchoolName_(
    payload && payload.schoolName
  );
  const schoolLevel = normalizeSchoolLevel_(
    payload && payload.schoolLevel,
    true
  );
  const resources = withCentralWriteLock_(function () {
    const properties = PropertiesService.getScriptProperties();
    const existingSchoolName = String(
      properties.getProperty(INSTALLATION_CONFIG.schoolNameProperty) || ''
    ).trim();
    const schoolName = existingSchoolName
      ? normalizeInstallationSchoolName_(existingSchoolName)
      : requestedSchoolName;
    const configuration = getCentralConfiguration_();
    const databaseCreated = ensureInstallationDatabase_(
      properties,
      configuration,
      schoolName
    );
    const photoFolderCreated = ensureInstallationPhotoFolder_(
      properties,
      configuration,
      schoolName
    );
    const values = {};
    values[INSTALLATION_CONFIG.schoolNameProperty] = schoolName;
    values[INSTALLATION_CONFIG.schoolLevelProperty] = schoolLevel;
    values[INSTALLATION_CONFIG.versionProperty] =
      INSTALLATION_CONFIG.version;
    values[CENTRAL_CONFIG.schemaVersionProperty] =
      CENTRAL_CONFIG.schemaVersion;
    properties.setProperties(values, false);
    setConfiguredSchoolLevelMemo_(schoolLevel);
    return {
      databaseCreated: databaseCreated,
      photoFolderCreated: photoFolderCreated,
    };
  });

  const dashboard = initializeCentralDataSchema();
  withCentralWriteLock_(function () {
    const state = getSchoolInstallationState_();
    if (!state.resourcesConfigured) {
      throw createCentralError_(
        'INSTALLATION_RESOURCES_REQUIRED',
        '중앙 데이터베이스와 사진 폴더 연결을 확인해 주세요.'
      );
    }
    PropertiesService.getScriptProperties().setProperty(
      INSTALLATION_CONFIG.stateProperty,
      INSTALLATION_CONFIG.states.ready
    );
  });
  return {
    ok: true,
    databaseCreated: resources.databaseCreated,
    photoFolderCreated: resources.photoFolderCreated,
    installation: getSchoolInstallationState_(),
    dashboard: dashboard,
  };
}

function connectExistingSchoolCentralResources(payload) {
  requireAdmin_();
  const schoolName = normalizeInstallationSchoolName_(
    payload && payload.schoolName
  );
  const schoolLevel = normalizeSchoolLevel_(
    payload && payload.schoolLevel,
    true
  );
  const databaseId = extractInstallationDriveId_(
    payload && payload.databaseReference,
    'spreadsheet'
  );
  const photoFolderId = extractInstallationDriveId_(
    payload && payload.photoFolderReference,
    'folder'
  );

  withCentralWriteLock_(function () {
    validateExistingInstallationResources_(databaseId, photoFolderId);
    const properties = PropertiesService.getScriptProperties();
    const values = {};
    values[CENTRAL_CONFIG.databaseIdProperty] = databaseId;
    values[CENTRAL_CONFIG.photoFolderIdProperty] = photoFolderId;
    values[CENTRAL_CONFIG.schemaVersionProperty] =
      CENTRAL_CONFIG.schemaVersion;
    values[INSTALLATION_CONFIG.schoolNameProperty] = schoolName;
    values[INSTALLATION_CONFIG.schoolLevelProperty] = schoolLevel;
    values[INSTALLATION_CONFIG.stateProperty] =
      INSTALLATION_CONFIG.states.setupRequired;
    values[INSTALLATION_CONFIG.versionProperty] =
      INSTALLATION_CONFIG.version;
    properties.setProperties(values, false);
    setConfiguredSchoolLevelMemo_(schoolLevel);
  });

  const dashboard = initializeCentralDataSchema();
  withCentralWriteLock_(function () {
    PropertiesService.getScriptProperties().setProperty(
      INSTALLATION_CONFIG.stateProperty,
      INSTALLATION_CONFIG.states.ready
    );
  });
  return {
    ok: true,
    resourcesConnected: true,
    installation: getSchoolInstallationState_(),
    dashboard: dashboard,
  };
}

function resetSchoolInstallationConnections(payload) {
  requireAdmin_();
  if (String(payload && payload.confirmation || '').trim() !== '초기화') {
    throw new Error('확인란에 초기화를 정확히 입력해 주세요.');
  }
  return withCentralWriteLock_(function () {
    const properties = PropertiesService.getScriptProperties();
    [
      CENTRAL_CONFIG.databaseIdProperty,
      CENTRAL_CONFIG.legacyDatabaseIdProperty,
      CENTRAL_CONFIG.photoFolderIdProperty,
      CENTRAL_CONFIG.schemaVersionProperty,
      INSTALLATION_CONFIG.schoolNameProperty,
      INSTALLATION_CONFIG.schoolLevelProperty,
    ].forEach(function (key) {
      properties.deleteProperty(key);
    });
    setConfiguredSchoolLevelMemo_('');
    const clearedRequests = clearStoredAssignmentRequests_(properties);
    const values = {};
    values[INSTALLATION_CONFIG.stateProperty] =
      INSTALLATION_CONFIG.states.setupRequired;
    values[INSTALLATION_CONFIG.versionProperty] =
      INSTALLATION_CONFIG.version;
    properties.setProperties(values, false);
    return {
      ok: true,
      administratorsPreserved: true,
      driveFilesPreserved: true,
      clearedAssignmentRequests: clearedRequests,
      installation: getSchoolInstallationState_(),
    };
  });
}

function extractInstallationDriveId_(value, resourceType) {
  const reference = String(value || '').trim();
  const rawId = isValidCentralDriveId_(reference) ? reference : '';
  const pattern = resourceType === 'spreadsheet'
    ? /\/spreadsheets\/d\/([A-Za-z0-9_-]{10,})(?:[/?#]|$)/
    : /\/folders\/([A-Za-z0-9_-]{10,})(?:[/?#]|$)/;
  const match = rawId ? null : reference.match(pattern);
  const id = rawId || (match && match[1]) || '';
  if (!isValidCentralDriveId_(id)) {
    throw createCentralError_(
      'INSTALLATION_RESOURCE_REFERENCE_INVALID',
      resourceType === 'spreadsheet'
        ? '중앙 스프레드시트 URL 또는 파일 ID를 확인해 주세요.'
        : '중앙 사진 폴더 URL 또는 폴더 ID를 확인해 주세요.'
    );
  }
  return id;
}

function validateExistingInstallationResources_(databaseId, photoFolderId) {
  try {
    SpreadsheetApp.openById(databaseId);
  } catch (error) {
    throw createCentralError_(
      'INSTALLATION_DATABASE_ACCESS_DENIED',
      '중앙 스프레드시트를 열 수 없습니다. 파일과 접근 권한을 확인해 주세요.'
    );
  }
  try {
    const folder = DriveApp.getFolderById(photoFolderId);
    if (folder.isTrashed()) throw new Error('TRASHED');
  } catch (error) {
    throw createCentralError_(
      'INSTALLATION_PHOTO_FOLDER_ACCESS_DENIED',
      '중앙 사진 폴더를 열 수 없습니다. 폴더와 접근 권한을 확인해 주세요.'
    );
  }
}

function ensureInstallationDatabase_(properties, configuration, schoolName) {
  if (configuration.databaseId) {
    if (!isValidCentralDriveId_(configuration.databaseId)) {
      throw createCentralError_(
        'INSTALLATION_DATABASE_INVALID',
        '기존 중앙 데이터베이스 설정값이 올바르지 않습니다. 새 파일로 덮어쓰지 않았습니다.'
      );
    }
    getCentralDatabase_(configuration);
    return false;
  }
  const spreadsheet = SpreadsheetApp.create(
    `${schoolName}_학생 활동 기록_중앙 데이터베이스`
  );
  properties.setProperty(
    CENTRAL_CONFIG.databaseIdProperty,
    spreadsheet.getId()
  );
  return true;
}

function ensureInstallationPhotoFolder_(
  properties,
  configuration,
  schoolName
) {
  if (configuration.photoFolderId) {
    if (!isValidCentralDriveId_(configuration.photoFolderId)) {
      throw createCentralError_(
        'INSTALLATION_PHOTO_FOLDER_INVALID',
        '기존 중앙 사진 폴더 설정값이 올바르지 않습니다. 새 폴더로 덮어쓰지 않았습니다.'
      );
    }
    getCentralPhotoFolder_(configuration);
    return false;
  }
  const folder = DriveApp.createFolder(
    `${schoolName}_학생 활동 기록_중앙 사진`
  );
  properties.setProperty(
    CENTRAL_CONFIG.photoFolderIdProperty,
    folder.getId()
  );
  return true;
}

function normalizeInstallationSchoolName_(value) {
  const schoolName = String(value || '').trim();
  if (!schoolName) {
    throw new Error('학교명을 입력해 주세요.');
  }
  if (schoolName.length > INSTALLATION_CONFIG.maxSchoolNameLength) {
    throw new Error(
      `학교명은 ${INSTALLATION_CONFIG.maxSchoolNameLength}자 이하로 입력해 주세요.`
    );
  }
  const sanitized = schoolName
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, ' ')
    .trim();
  if (!sanitized) {
    throw new Error('학교명에 사용할 수 있는 문자를 입력해 주세요.');
  }
  return sanitized;
}

function getSchoolInstallationState_() {
  const properties = PropertiesService.getScriptProperties();
  const configuration = getCentralConfiguration_();
  const adminConfigured = configuration.adminEmails.length > 0;
  const databaseConfigured = isValidCentralDriveId_(
    configuration.databaseId
  );
  const photoFolderConfigured = isValidCentralDriveId_(
    configuration.photoFolderId
  );
  const resourcesConfigured = adminConfigured
    && databaseConfigured
    && photoFolderConfigured;
  const recordedState = String(
    properties.getProperty(INSTALLATION_CONFIG.stateProperty) || ''
  ).trim();
  const ready = resourcesConfigured
    && (
      recordedState === INSTALLATION_CONFIG.states.ready
      || !recordedState
    );
  const state = ready
    ? INSTALLATION_CONFIG.states.ready
    : adminConfigured
      ? INSTALLATION_CONFIG.states.setupRequired
      : INSTALLATION_CONFIG.states.adminRegistrationRequired;
  const schoolLevel = getConfiguredSchoolLevel_();
  return {
    state: state,
    ready: ready,
    adminConfigured: adminConfigured,
    databaseConfigured: databaseConfigured,
    photoFolderConfigured: photoFolderConfigured,
    resourcesConfigured: resourcesConfigured,
    schoolName: String(
      properties.getProperty(INSTALLATION_CONFIG.schoolNameProperty) || ''
    ).trim(),
    schoolLevel: schoolLevel,
    schoolLevelLabel: schoolLevelLabel_(schoolLevel),
    version: String(
      properties.getProperty(INSTALLATION_CONFIG.versionProperty) || ''
    ).trim(),
  };
}
