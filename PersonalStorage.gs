// © 2026 류기현(부산 동아공고). CC BY-NC-SA 4.0(저작자표시-비영리-동일조건변경허락).
// https://creativecommons.org/licenses/by-nc-sa/4.0/deed.ko
// 문의: https://github.com/blueshadow62/student-activity-webapp/issues

const PERSONAL_STORAGE_CONFIG = Object.freeze({
  appId: 'student-activity-webapp',
  schemaVersion: '1',
  storageMode: 'USER_OWNED_PERSONAL_DRIVE',
  appFolderName: '학생 활동 기록 웹앱 데이터',
  databaseNamePrefix: '학생 활동 기록 데이터_',
  appFolderIdProperty: 'PERSONAL_APP_FOLDER_ID',
  databaseIdPropertyPrefix: 'PERSONAL_DATABASE_FILE_ID_',
  schemaVersionProperty: 'PERSONAL_STORAGE_SCHEMA_VERSION',
  metadataStartColumn: 10,
  lockTimeoutMs: 30000,
  minSchoolYear: 2000,
  maxSchoolYear: 2100,
});

const PERSONAL_STORAGE_ACTIONS = Object.freeze({
  restoreDatabase: 'RESTORE_DATABASE',
  restoreCandidate: 'RESTORE_CANDIDATE',
  createNewDatabase: 'CREATE_NEW_DATABASE',
  reconnectCandidate: 'RECONNECT_CANDIDATE',
  cancel: 'CANCEL',
});

// 학생 명단·사진은 중앙 자료에서만 읽는다. 개인 스프레드시트에는 활동 기록
// 계열 시트만 둔다.
const PERSONAL_DATABASE_SHEETS = Object.freeze({
  settings: '설정',
  records: '활동기록',
  archive: '활동기록보관',
});

// Code.gs 의 RECORD_HEADERS 와 반드시 같아야 한다. 파일 로드 순서에 기대지 않으려고
// 참조 대신 같은 값을 적어 두고, verify-v8.4-runtime.js 가 둘이 같은지 확인한다.
const PERSONAL_RECORD_HEADERS = Object.freeze([
  '기록ID', '기록일시', '학년', '반', '번호', '이름', '학적상태',
  '구분', '역량', '과목', '내용메모', '작성자', '수정일시', '학생ID', '학년도',
  '담당키',
]);

const PERSONAL_COMPETENCY_HEADERS = Object.freeze([
  '구분', '역량', '설명', '사용', '정렬',
]);

const PERSONAL_SUBJECT_HEADERS = Object.freeze(['학년', '기본과목']);

const PERSONAL_METADATA_HEADERS = Object.freeze(['항목', '값', '수정일시']);

const PERSONAL_METADATA_KEYS = Object.freeze([
  'appId',
  'appVersion',
  'schemaVersion',
  'storageMode',
  'schoolYear',
  'createdAt',
  'updatedAt',
]);

function preparePersonalStorageContext_() {
  let userEmail;
  try {
    userEmail = requireCurrentUserEmail_();
  } catch (error) {
    return {
      storage: buildPersonalStorageFailure_(
        'LOGIN_REQUIRED',
        '로그인 계정을 확인할 수 없어 개인 저장소를 준비하지 않았습니다.'
      ),
      context: null,
    };
  }

  return withPersonalStorageLock_(function () {
    try {
      const context = getOrCreatePersonalAppContext_(userEmail);
      return {
        storage: buildPublicPersonalStorageState_(context),
        context: context.state === 'READY' ? context : null,
      };
    } catch (error) {
      return {
        storage: buildPersonalStorageFailure_(
          error && error.personalStorageCode
            ? error.personalStorageCode
            : 'STORAGE_CREATION_FAILED',
          safePersonalStorageErrorMessage_(error)
        ),
        context: null,
      };
    }
  });
}

function resolvePersonalStorageIssue(action, candidateToken) {
  const userEmail = requireCurrentUserEmail_();
  const normalizedAction = String(action || '').trim();
  const allowedActions = Object.keys(PERSONAL_STORAGE_ACTIONS).map(function (key) {
    return PERSONAL_STORAGE_ACTIONS[key];
  });

  if (!allowedActions.includes(normalizedAction)) {
    throw createPersonalStorageError_(
      'INVALID_ACTION',
      '지원하지 않는 개인 저장소 작업입니다.'
    );
  }

  return withPersonalStorageLock_(function () {
    if (normalizedAction === PERSONAL_STORAGE_ACTIONS.cancel) {
      return buildPersonalStorageFailure_(
        'CANCELLED',
        '개인 저장소 복구 작업을 취소했습니다.'
      );
    }

    try {
      const schoolYear = getPersonalCurrentSchoolYear_();
      const properties = PropertiesService.getUserProperties();
      const appFolderResult = getOrCreatePersonalAppFolder_(
        properties,
        userEmail
      );
      if (!appFolderResult.ready) {
        return buildPublicPersonalStorageState_(
          buildPersonalStorageContextState_(
            appFolderResult.state,
            schoolYear,
            appFolderResult
          )
        );
      }

      clearCachedPersonalContext_(schoolYear);
      if (normalizedAction === PERSONAL_STORAGE_ACTIONS.restoreDatabase) {
        restoreStoredPersonalDatabase_(
          properties,
          appFolderResult.folder,
          schoolYear,
          userEmail
        );
      } else if (
        normalizedAction === PERSONAL_STORAGE_ACTIONS.restoreCandidate
      ) {
        reconnectPersonalDatabaseCandidate_(
          properties,
          appFolderResult.folder,
          schoolYear,
          userEmail,
          candidateToken,
          true
        );
      } else if (
        normalizedAction === PERSONAL_STORAGE_ACTIONS.reconnectCandidate
      ) {
        reconnectPersonalDatabaseCandidate_(
          properties,
          appFolderResult.folder,
          schoolYear,
          userEmail,
          candidateToken,
          false
        );
      } else if (
        normalizedAction === PERSONAL_STORAGE_ACTIONS.createNewDatabase
      ) {
        clearUnavailablePersonalDatabaseLink_(
          properties,
          appFolderResult.folder,
          schoolYear,
          userEmail,
          candidateToken
        );
        // 자동 생성을 없앤 뒤로는 정리만 해서는 파일이 생기지 않는다.
        // 버튼을 누른 이 시점에 실제로 새 개인 데이터베이스를 만든다.
        createPersonalDatabase_(
          properties,
          appFolderResult.folder,
          schoolYear,
          userEmail
        );
      }

      return buildPublicPersonalStorageState_(
        getOrCreatePersonalAppContext_(userEmail)
      );
    } catch (error) {
      return buildPersonalStorageFailure_(
        error && error.personalStorageCode
          ? error.personalStorageCode
          : 'STORAGE_CREATION_FAILED',
        safePersonalStorageErrorMessage_(error)
      );
    }
  });
}

// 앱 폴더 밖으로 옮겼거나 이름을 바꾼 개인 데이터베이스는 이름 기반 후보
// 탐색으로 찾을 수 없다. 사용자가 링크를 직접 넣어 다시 연결한다.
// 본인 소유이면서 이 앱이 만든 해당 학년도 파일만 받아들인다. 확인을 빼면
// 다른 교사의 개인 활동 기록을 가리키게 만들 수 있다.
function connectPersonalDatabaseByLink(reference) {
  const userEmail = requireCurrentUserEmail_();
  const fileId = extractPersonalDatabaseId_(reference);
  return withPersonalStorageLock_(function () {
    const schoolYear = getPersonalCurrentSchoolYear_();
    let file;
    try {
      file = DriveApp.getFileById(fileId);
    } catch (error) {
      throw createPersonalStorageError_(
        'LINK_NOT_ACCESSIBLE',
        '입력한 링크의 파일을 열 수 없습니다. 지금 로그인한 계정으로 열리는 파일인지 확인해 주세요.'
      );
    }
    if (!isPersonalDriveItemOwnedBy_(file, userEmail)) {
      throw createPersonalStorageError_(
        'LINK_NOT_OWNED',
        '지금 로그인한 계정이 소유한 파일만 개인 저장소로 연결할 수 있습니다.'
      );
    }
    if (file.isTrashed()) {
      throw createPersonalStorageError_(
        'LINK_TRASHED',
        '휴지통에 있는 파일입니다. Drive에서 먼저 복원한 뒤 다시 연결해 주세요.'
      );
    }
    const metadata = validatePersonalDatabaseMetadata_(
      SpreadsheetApp.openById(fileId),
      schoolYear
    );
    if (!metadata.valid) {
      throw createPersonalStorageError_(
        metadata.unsupportedSchema
          ? 'UNSUPPORTED_DATABASE_SCHEMA'
          : 'LINK_NOT_PERSONAL_DATABASE',
        `${schoolYear}학년도 개인 활동 기록 파일이 아닙니다. 이 앱이 만든 파일인지 확인해 주세요.`
      );
    }
    clearCachedPersonalContext_(schoolYear);
    PropertiesService.getUserProperties().setProperty(
      personalDatabasePropertyKey_(schoolYear),
      fileId
    );
    return buildPublicPersonalStorageState_(
      getOrCreatePersonalAppContext_(userEmail)
    );
  });
}

function extractPersonalDatabaseId_(value) {
  const reference = String(value || '').trim();
  const direct = isValidPersonalDriveId_(reference) ? reference : '';
  const match = direct
    ? null
    : reference.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]{10,})(?:[/?#]|$)/);
  const id = direct || (match && match[1]) || '';
  if (!isValidPersonalDriveId_(id)) {
    throw createPersonalStorageError_(
      'LINK_INVALID',
      'Google 스프레드시트 링크 또는 파일 ID를 확인해 주세요.'
    );
  }
  return id;
}

function getCurrentUserEmail_() {
  return normalizeCurrentUserEmail_(
    Session.getActiveUser().getEmail()
  );
}

function requireCurrentUserEmail_() {
  const email = getCurrentUserEmail_();
  if (!email) {
    throw createPersonalStorageError_(
      'LOGIN_REQUIRED',
      '현재 접속한 Google 계정의 이메일을 확인할 수 없습니다.'
    );
  }
  return email;
}

function normalizeCurrentUserEmail_(value) {
  return String(value || '').trim().toLowerCase();
}

function getOrCreatePersonalAppContext_(userEmail) {
  const properties = PropertiesService.getUserProperties();
  const schoolYear = getPersonalCurrentSchoolYear_();
  const storedSchemaVersion = String(
    properties.getProperty(PERSONAL_STORAGE_CONFIG.schemaVersionProperty)
      || ''
  ).trim();

  if (
    storedSchemaVersion
      && storedSchemaVersion !== PERSONAL_STORAGE_CONFIG.schemaVersion
  ) {
    return buildPersonalStorageContextState_(
      'UNSUPPORTED_STORAGE_SCHEMA',
      schoolYear,
      null,
      null,
      [],
      []
    );
  }

  const cached = readCachedPersonalContext_(schoolYear);
  if (cached) return cached;

  const appFolderResult = getOrCreatePersonalAppFolder_(
    properties,
    userEmail
  );
  if (!appFolderResult.ready) {
    clearCachedPersonalContext_(schoolYear);
    return buildPersonalStorageContextState_(
      appFolderResult.state,
      schoolYear,
      appFolderResult
    );
  }

  const databaseResult = getOrCreatePersonalDatabase_(
    properties,
    appFolderResult.folder,
    schoolYear,
    userEmail
  );
  if (!databaseResult.ready) {
    clearCachedPersonalContext_(schoolYear);
    return buildPersonalStorageContextState_(
      databaseResult.state,
      schoolYear,
      appFolderResult,
      databaseResult,
      databaseResult.recoveryCandidates,
      databaseResult.actions
    );
  }

  properties.setProperty(
    PERSONAL_STORAGE_CONFIG.schemaVersionProperty,
    PERSONAL_STORAGE_CONFIG.schemaVersion
  );

  writeCachedPersonalContext_(
    schoolYear,
    appFolderResult.resource.getId(),
    databaseResult.spreadsheet.getId()
  );

  return buildPersonalStorageContextState_(
    'READY',
    schoolYear,
    appFolderResult,
    databaseResult
  );
}

// 소유권·휴지통·상위 폴더 소속 확인은 Drive API 호출이 여러 번 드는 검사라
// 짧은 기간(수 분) 동안은 재확인하지 않고 ID로 바로 자원을 연다.
// ponytail: 캐시 유효 시간 안에는 실제로 파일이 휴지통에 들어가도 즉시
// 반영되지 않는다. 캐시가 만료되거나 자원 변경 작업(복구·재연결·새로 만들기)
// 후에는 다시 원본 검증 경로를 탄다.
const PERSONAL_CONTEXT_CACHE_SECONDS = 180;

function personalContextCacheKey_(schoolYear) {
  return `personal-context:${PERSONAL_STORAGE_CONFIG.schemaVersion}:${schoolYear}`;
}

function readCachedPersonalContext_(schoolYear) {
  const cache = CacheService.getUserCache();
  if (!cache) return null;
  const raw = cache.get(personalContextCacheKey_(schoolYear));
  if (!raw) return null;
  try {
    const ids = JSON.parse(raw);
    if (
      !isValidPersonalDriveId_(ids.appFolderId)
        || !isValidPersonalDriveId_(ids.databaseId)
    ) {
      return null;
    }
    const folder = DriveApp.getFolderById(ids.appFolderId);
    const spreadsheet = SpreadsheetApp.openById(ids.databaseId);
    return buildPersonalStorageContextState_(
      'READY',
      schoolYear,
      buildReadyPersonalResource_(
        folder, 'REUSED', PERSONAL_STORAGE_CONFIG.appFolderName
      ),
      buildReadyPersonalResource_(
        spreadsheet,
        'REUSED',
        personalDatabaseName_(schoolYear),
        DriveApp.getFileById(ids.databaseId)
      )
    );
  } catch (error) {
    return null;
  }
}

function writeCachedPersonalContext_(
  schoolYear,
  appFolderId,
  databaseId
) {
  const cache = CacheService.getUserCache();
  if (!cache) return;
  try {
    cache.put(
      personalContextCacheKey_(schoolYear),
      JSON.stringify({
        appFolderId: appFolderId,
        databaseId: databaseId,
      }),
      PERSONAL_CONTEXT_CACHE_SECONDS
    );
  } catch (error) {
    // 캐시 실패 시에도 이번 요청은 이미 원본 검증을 마쳤으므로 계속 진행한다.
  }
}

function clearCachedPersonalContext_(schoolYear) {
  try {
    const cache = CacheService.getUserCache();
    if (cache) cache.remove(personalContextCacheKey_(schoolYear));
  } catch (error) {
    // 캐시 제거 실패는 다음 만료 시점에 자연히 복구된다.
  }
}

function getOrCreatePersonalAppFolder_(properties, userEmail) {
  const storedFolderId = String(
    properties.getProperty(PERSONAL_STORAGE_CONFIG.appFolderIdProperty)
      || ''
  ).trim();

  if (storedFolderId) {
    if (!isValidPersonalDriveId_(storedFolderId)) {
      return buildPersonalResourceIssue_('PROPERTY_CORRUPT', 'UNAVAILABLE');
    }

    try {
      const storedFolder = DriveApp.getFolderById(storedFolderId);
      if (!isPersonalDriveItemOwnedBy_(storedFolder, userEmail)) {
        return buildPersonalResourceIssue_('ACCESS_DENIED', 'UNAVAILABLE');
      }
      if (storedFolder.isTrashed()) {
        return buildPersonalResourceIssue_(
          'TRASHED_APP_FOLDER',
          'TRASHED'
        );
      }
      return buildReadyPersonalResource_(
        storedFolder,
        'REUSED',
        PERSONAL_STORAGE_CONFIG.appFolderName
      );
    } catch (error) {
      return buildPersonalResourceIssue_(
        classifyPersonalDriveError_(error, 'APP_FOLDER'),
        'UNAVAILABLE'
      );
    }
  }

  const rootFolder = DriveApp.getRootFolder();
  const candidates = collectOwnedPersonalFolders_(
    rootFolder.getFoldersByName(PERSONAL_STORAGE_CONFIG.appFolderName),
    userEmail
  );
  if (candidates.length > 1) {
    return buildPersonalResourceIssue_(
      'MULTIPLE_APP_FOLDERS',
      'AMBIGUOUS'
    );
  }
  if (candidates.length === 1) {
    properties.setProperty(
      PERSONAL_STORAGE_CONFIG.appFolderIdProperty,
      candidates[0].getId()
    );
    return buildReadyPersonalResource_(
      candidates[0],
      'RECONNECTED',
      PERSONAL_STORAGE_CONFIG.appFolderName
    );
  }

  const folder = rootFolder.createFolder(
    PERSONAL_STORAGE_CONFIG.appFolderName
  );
  if (!isPersonalDriveItemOwnedBy_(folder, userEmail)) {
    throw createPersonalStorageError_(
      'OWNER_MISMATCH',
      '현재 계정 소유의 개인 앱 폴더인지 확인하지 못했습니다.'
    );
  }
  properties.setProperty(
    PERSONAL_STORAGE_CONFIG.appFolderIdProperty,
    folder.getId()
  );
  return buildReadyPersonalResource_(
    folder,
    'CREATED',
    PERSONAL_STORAGE_CONFIG.appFolderName
  );
}

function getOrCreatePersonalDatabase_(
  properties,
  appFolder,
  schoolYear,
  userEmail
) {
  const linkedDatabase = getPersonalDatabase_(
    properties,
    appFolder,
    schoolYear,
    userEmail
  );
  if (linkedDatabase) {
    return linkedDatabase;
  }

  // 처음 접속한 사용자에게 자동으로 만들어 주지 않는다. 어떤 계정이든
  // '새 개인 저장소 만들기' 버튼을 직접 눌러야 생성된다.
  return recoverPersonalDatabaseLink_(
    properties,
    appFolder,
    schoolYear,
    userEmail,
    ''
  );
}

function getPersonalDatabase_(
  properties,
  appFolder,
  schoolYear,
  userEmail
) {
  const propertyKey = personalDatabasePropertyKey_(schoolYear);
  const storedFileId = String(
    properties.getProperty(propertyKey) || ''
  ).trim();
  if (!storedFileId) {
    return null;
  }
  if (!isValidPersonalDriveId_(storedFileId)) {
    return buildPersonalDatabaseIssue_(
      'PROPERTY_CORRUPT',
      'UNAVAILABLE',
      [PERSONAL_STORAGE_ACTIONS.createNewDatabase]
    );
  }

  try {
    const file = DriveApp.getFileById(storedFileId);
    if (!isPersonalDriveItemOwnedBy_(file, userEmail)) {
      return buildPersonalDatabaseIssue_(
        'ACCESS_DENIED',
        'UNAVAILABLE',
        [PERSONAL_STORAGE_ACTIONS.createNewDatabase]
      );
    }
    if (!personalFileBelongsToFolder_(file, appFolder.getId())) {
      return buildPersonalDatabaseIssue_(
        'PROPERTY_CORRUPT',
        'UNAVAILABLE',
        [PERSONAL_STORAGE_ACTIONS.createNewDatabase]
      );
    }
    if (file.isTrashed()) {
      return buildPersonalDatabaseIssue_(
        'TRASHED_DATABASE',
        'TRASHED',
        [
          PERSONAL_STORAGE_ACTIONS.restoreDatabase,
          PERSONAL_STORAGE_ACTIONS.createNewDatabase,
          PERSONAL_STORAGE_ACTIONS.cancel,
        ]
      );
    }

    const spreadsheet = SpreadsheetApp.openById(storedFileId);
    const metadata = validatePersonalDatabaseMetadata_(
      spreadsheet,
      schoolYear
    );
    if (!metadata.valid) {
      return buildPersonalDatabaseIssue_(
        metadata.unsupportedSchema
          ? 'UNSUPPORTED_DATABASE_SCHEMA'
          : 'PROPERTY_CORRUPT',
        'UNAVAILABLE',
        []
      );
    }

    return buildReadyPersonalResource_(
      spreadsheet,
      'REUSED',
      personalDatabaseName_(schoolYear),
      file
    );
  } catch (error) {
    return buildPersonalDatabaseIssue_(
      classifyPersonalDriveError_(error, 'DATABASE'),
      'UNAVAILABLE',
      [PERSONAL_STORAGE_ACTIONS.createNewDatabase]
    );
  }
}

function createPersonalDatabase_(
  properties,
  appFolder,
  schoolYear,
  userEmail
) {
  const spreadsheet = SpreadsheetApp.create(
    personalDatabaseName_(schoolYear)
  );
  let file = null;

  try {
    initializePersonalDatabase_(spreadsheet, schoolYear);
    file = DriveApp.getFileById(spreadsheet.getId());
    if (!isPersonalDriveItemOwnedBy_(file, userEmail)) {
      throw createPersonalStorageError_(
        'OWNER_MISMATCH',
        '현재 계정 소유의 개인 데이터베이스인지 확인하지 못했습니다.'
      );
    }
    file.moveTo(appFolder);
    if (!personalFileBelongsToFolder_(file, appFolder.getId())) {
      throw createPersonalStorageError_(
        'DATABASE_MOVE_FAILED',
        '개인 데이터베이스를 앱 전용 폴더로 이동하지 못했습니다.'
      );
    }

    properties.setProperty(
      personalDatabasePropertyKey_(schoolYear),
      spreadsheet.getId()
    );

    return buildReadyPersonalResource_(
      spreadsheet,
      'CREATED',
      personalDatabaseName_(schoolYear),
      file
    );
  } catch (error) {
    properties.deleteProperty(personalDatabasePropertyKey_(schoolYear));
    if (file && isPersonalDriveItemOwnedBy_(file, userEmail)) {
      try {
        file.setTrashed(true);
      } catch (cleanupError) {
        // 연결 정보는 저장하지 않았으므로 다음 실행에서 부분 파일을 자동 선택하지 않는다.
      }
    }
    throw error;
  }
}

function recoverPersonalDatabaseLink_(
  properties,
  appFolder,
  schoolYear,
  userEmail,
  candidateToken
) {
  const candidates = findPersonalDatabaseRecoveryCandidates_(
    appFolder,
    schoolYear,
    userEmail
  );
  const normalizedToken = normalizePersonalCandidateToken_(candidateToken);

  if (normalizedToken) {
    const matching = candidates.filter(function (candidate) {
      return candidate.token === normalizedToken;
    });
    if (matching.length !== 1) {
      throw createPersonalStorageError_(
        'INVALID_RECOVERY_CANDIDATE',
        '선택한 복구 후보를 현재 앱 폴더에서 확인할 수 없습니다.'
      );
    }
    if (matching[0].trashed) {
      return buildPersonalDatabaseIssue_(
        'TRASHED_DATABASE',
        'TRASHED',
        [
          PERSONAL_STORAGE_ACTIONS.restoreCandidate,
          PERSONAL_STORAGE_ACTIONS.createNewDatabase,
          PERSONAL_STORAGE_ACTIONS.cancel,
        ],
        [matching[0]]
      );
    }
    properties.setProperty(
      personalDatabasePropertyKey_(schoolYear),
      matching[0].file.getId()
    );
    return buildReadyPersonalResource_(
      matching[0].spreadsheet,
      'RECONNECTED',
      personalDatabaseName_(schoolYear),
      matching[0].file
    );
  }

  if (candidates.length === 0) {
    return buildPersonalDatabaseIssue_(
      'NO_RECOVERY_CANDIDATE',
      'MISSING',
      [PERSONAL_STORAGE_ACTIONS.createNewDatabase]
    );
  }
  if (candidates.length > 1) {
    return buildPersonalDatabaseIssue_(
      'MULTIPLE_RECOVERY_CANDIDATES',
      'AMBIGUOUS',
      [
        PERSONAL_STORAGE_ACTIONS.reconnectCandidate,
        PERSONAL_STORAGE_ACTIONS.cancel,
      ],
      candidates
    );
  }
  if (candidates[0].trashed) {
    return buildPersonalDatabaseIssue_(
      'TRASHED_DATABASE',
      'TRASHED',
      [
        PERSONAL_STORAGE_ACTIONS.restoreCandidate,
        PERSONAL_STORAGE_ACTIONS.createNewDatabase,
        PERSONAL_STORAGE_ACTIONS.cancel,
      ],
      candidates
    );
  }

  properties.setProperty(
    personalDatabasePropertyKey_(schoolYear),
    candidates[0].file.getId()
  );
  return buildReadyPersonalResource_(
    candidates[0].spreadsheet,
    'RECONNECTED',
    personalDatabaseName_(schoolYear),
    candidates[0].file
  );
}

function findPersonalDatabaseRecoveryCandidates_(
  appFolder,
  schoolYear,
  userEmail
) {
  const iterator = appFolder.getFilesByName(
    personalDatabaseName_(schoolYear)
  );
  const candidates = [];

  while (iterator.hasNext()) {
    const file = iterator.next();
    if (!isPersonalDriveItemOwnedBy_(file, userEmail)) {
      continue;
    }
    try {
      const spreadsheet = SpreadsheetApp.openById(file.getId());
      const metadata = validatePersonalDatabaseMetadata_(
        spreadsheet,
        schoolYear
      );
      if (!metadata.valid) {
        continue;
      }
      candidates.push({
        file: file,
        spreadsheet: spreadsheet,
        token: personalDriveIdFingerprint_(file.getId()),
        trashed: Boolean(file.isTrashed()),
        createdAt: formatPersonalStorageDate_(file.getDateCreated()),
      });
    } catch (error) {
      // 열 수 없는 파일은 자동 복구 후보로 사용하지 않는다.
    }
  }

  return candidates;
}

function reconnectPersonalDatabaseCandidate_(
  properties,
  appFolder,
  schoolYear,
  userEmail,
  candidateToken,
  restoreTrashed
) {
  const candidates = findPersonalDatabaseRecoveryCandidates_(
    appFolder,
    schoolYear,
    userEmail
  );
  const normalizedToken = normalizePersonalCandidateToken_(candidateToken);
  const matching = candidates.filter(function (candidate) {
    return candidate.token === normalizedToken;
  });

  if (matching.length !== 1) {
    throw createPersonalStorageError_(
      'INVALID_RECOVERY_CANDIDATE',
      '선택한 복구 후보를 현재 앱 폴더에서 확인할 수 없습니다.'
    );
  }
  if (restoreTrashed && !matching[0].trashed) {
    throw createPersonalStorageError_(
      'INVALID_ACTION',
      '선택한 파일은 휴지통 상태가 아닙니다.'
    );
  }
  if (!restoreTrashed && matching[0].trashed) {
    throw createPersonalStorageError_(
      'INVALID_ACTION',
      '휴지통 파일은 먼저 복구해야 합니다.'
    );
  }

  if (restoreTrashed) {
    matching[0].file.setTrashed(false);
  }
  properties.setProperty(
    personalDatabasePropertyKey_(schoolYear),
    matching[0].file.getId()
  );
}

function restoreStoredPersonalDatabase_(
  properties,
  appFolder,
  schoolYear,
  userEmail
) {
  const propertyKey = personalDatabasePropertyKey_(schoolYear);
  const storedFileId = String(properties.getProperty(propertyKey) || '').trim();
  if (!isValidPersonalDriveId_(storedFileId)) {
    throw createPersonalStorageError_(
      'PROPERTY_CORRUPT',
      '저장된 개인 데이터베이스 연결 정보가 올바르지 않습니다.'
    );
  }

  let file;
  try {
    file = DriveApp.getFileById(storedFileId);
  } catch (error) {
    throw createPersonalStorageError_(
      classifyPersonalDriveError_(error, 'DATABASE'),
      '연결된 개인 데이터베이스를 확인할 수 없습니다.'
    );
  }
  if (
    !isPersonalDriveItemOwnedBy_(file, userEmail)
      || !personalFileBelongsToFolder_(file, appFolder.getId())
  ) {
    throw createPersonalStorageError_(
      'ACCESS_DENIED',
      '현재 계정 소유의 앱 폴더 파일인지 확인하지 못했습니다.'
    );
  }
  if (!file.isTrashed()) {
    throw createPersonalStorageError_(
      'INVALID_ACTION',
      '연결된 개인 데이터베이스는 휴지통 상태가 아닙니다.'
    );
  }

  file.setTrashed(false);
  const spreadsheet = SpreadsheetApp.openById(storedFileId);
  const metadata = validatePersonalDatabaseMetadata_(
    spreadsheet,
    schoolYear
  );
  if (!metadata.valid) {
    file.setTrashed(true);
    throw createPersonalStorageError_(
      'UNSUPPORTED_DATABASE_SCHEMA',
      '복구할 파일의 앱 식별자 또는 스키마를 확인할 수 없습니다.'
    );
  }
}

function clearUnavailablePersonalDatabaseLink_(
  properties,
  appFolder,
  schoolYear,
  userEmail,
  candidateToken
) {
  const propertyKey = personalDatabasePropertyKey_(schoolYear);
  const storedFileId = String(properties.getProperty(propertyKey) || '').trim();

  if (storedFileId) {
    if (isValidPersonalDriveId_(storedFileId)) {
      try {
        const file = DriveApp.getFileById(storedFileId);
        if (!isPersonalDriveItemOwnedBy_(file, userEmail)) {
          throw createPersonalStorageError_(
            'ACCESS_DENIED',
            '현재 계정 소유 파일인지 확인할 수 없습니다.'
          );
        }
        if (
          !file.isTrashed()
            && personalFileBelongsToFolder_(file, appFolder.getId())
        ) {
          throw createPersonalStorageError_(
            'INVALID_ACTION',
            '정상 개인 데이터베이스 연결은 새 파일로 교체할 수 없습니다.'
          );
        }
        if (file.isTrashed()) {
          retirePersonalDatabaseName_(file, schoolYear);
        }
      } catch (error) {
        if (error && error.personalStorageCode === 'INVALID_ACTION') {
          throw error;
        }
        // 삭제·접근 불가·손상 연결은 사용자가 새 파일 생성을 선택하면 해제한다.
      }
    }
    properties.deleteProperty(propertyKey);
    return;
  }

  const token = normalizePersonalCandidateToken_(candidateToken);
  if (!token) {
    // 정리할 저장 링크도, 지정된 복구 후보도 없는 순수 최초 생성
    // 상황이다. 정리할 대상이 없으므로 그대로 새 파일 생성으로 넘어간다.
    return;
  }
  const candidates = findPersonalDatabaseRecoveryCandidates_(
    appFolder,
    schoolYear,
    userEmail
  );
  const matching = candidates.filter(function (candidate) {
    return candidate.token === token && candidate.trashed;
  });
  if (matching.length !== 1) {
    throw createPersonalStorageError_(
      'INVALID_RECOVERY_CANDIDATE',
      '휴지통 복구 후보를 현재 앱 폴더에서 확인할 수 없습니다.'
    );
  }
  retirePersonalDatabaseName_(matching[0].file, schoolYear);
}

function initializePersonalDatabase_(spreadsheet, schoolYear) {
  const settingsSheet = preparePersonalDatabaseFirstSheet_(spreadsheet);
  initializePersonalSettingsSheet_(settingsSheet, schoolYear);

  const recordSheet = getOrInsertPersonalSheet_(
    spreadsheet,
    PERSONAL_DATABASE_SHEETS.records
  );
  initializePersonalHeaderSheet_(
    recordSheet,
    PERSONAL_RECORD_HEADERS,
    '#1a73e8'
  );

  const archiveSheet = getOrInsertPersonalSheet_(
    spreadsheet,
    PERSONAL_DATABASE_SHEETS.archive
  );
  initializePersonalHeaderSheet_(
    archiveSheet,
    PERSONAL_RECORD_HEADERS,
    '#5f6368'
  );

  removeUnusedPersonalDefaultSheets_(spreadsheet);
  SpreadsheetApp.flush();
}

// 새 스프레드시트의 기본 시트를 '설정'으로 재사용해 빈 기본 시트가 남지 않게 한다.
function preparePersonalDatabaseFirstSheet_(spreadsheet) {
  const sheet = spreadsheet.getSheetByName(
    PERSONAL_DATABASE_SHEETS.settings
  );
  if (sheet) {
    return sheet;
  }

  const sheets = spreadsheet.getSheets();
  if (sheets.length === 1 && sheets[0].getLastRow() === 0) {
    sheets[0].setName(PERSONAL_DATABASE_SHEETS.settings);
    return sheets[0];
  }
  return spreadsheet.insertSheet(PERSONAL_DATABASE_SHEETS.settings);
}

function getOrInsertPersonalSheet_(spreadsheet, sheetName) {
  return spreadsheet.getSheetByName(sheetName)
    || spreadsheet.insertSheet(sheetName);
}

function initializePersonalSettingsSheet_(sheet, schoolYear) {
  const now = new Date();
  const metadataValues = {
    appId: PERSONAL_STORAGE_CONFIG.appId,
    appVersion: APP_CONFIG.version,
    schemaVersion: PERSONAL_STORAGE_CONFIG.schemaVersion,
    storageMode: PERSONAL_STORAGE_CONFIG.storageMode,
    schoolYear: schoolYear,
    createdAt: now,
    updatedAt: now,
  };
  const metadataRows = PERSONAL_METADATA_KEYS.map(function (key) {
    return [key, metadataValues[key], now];
  });

  sheet.clear();
  sheet.setFrozenRows(1);
  sheet.setHiddenGridlines(true);
  sheet
    .getRange(1, 1, 1, PERSONAL_COMPETENCY_HEADERS.length)
    .setValues([PERSONAL_COMPETENCY_HEADERS]);
  sheet
    .getRange(2, 4, DEFAULT_COMPETENCIES.length, 1)
    .insertCheckboxes();
  sheet
    .getRange(2, 1, DEFAULT_COMPETENCIES.length, 5)
    .setValues(DEFAULT_COMPETENCIES);
  sheet
    .getRange(1, 7, 1, PERSONAL_SUBJECT_HEADERS.length)
    .setValues([PERSONAL_SUBJECT_HEADERS]);
  sheet
    .getRange(2, 7, DEFAULT_SUBJECTS.length, 2)
    .setValues(DEFAULT_SUBJECTS);
  sheet
    .getRange(
      1,
      PERSONAL_STORAGE_CONFIG.metadataStartColumn,
      1,
      PERSONAL_METADATA_HEADERS.length
    )
    .setValues([PERSONAL_METADATA_HEADERS]);
  sheet
    .getRange(
      2,
      PERSONAL_STORAGE_CONFIG.metadataStartColumn,
      metadataRows.length,
      PERSONAL_METADATA_HEADERS.length
    )
    .setValues(metadataRows);

  stylePersonalHeader_(
    sheet.getRange(1, 1, 1, PERSONAL_COMPETENCY_HEADERS.length),
    '#137333'
  );
  stylePersonalHeader_(
    sheet.getRange(1, 7, 1, PERSONAL_SUBJECT_HEADERS.length),
    '#1a73e8'
  );
  stylePersonalHeader_(
    sheet.getRange(
      1,
      PERSONAL_STORAGE_CONFIG.metadataStartColumn,
      1,
      PERSONAL_METADATA_HEADERS.length
    ),
    '#6f42c1'
  );
  sheet
    .getRange(
      2,
      PERSONAL_STORAGE_CONFIG.metadataStartColumn + 2,
      metadataRows.length,
      1
    )
    .setNumberFormat('yyyy-mm-dd hh:mm:ss');
}

function initializePersonalHeaderSheet_(sheet, headers, color) {
  sheet.clear();
  sheet.setFrozenRows(1);
  sheet.setHiddenGridlines(true);
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  stylePersonalHeader_(sheet.getRange(1, 1, 1, headers.length), color);
}

function stylePersonalHeader_(range, color) {
  range
    .setBackground(color)
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setHorizontalAlignment('center');
}

function removeUnusedPersonalDefaultSheets_(spreadsheet) {
  const expectedNames = Object.keys(PERSONAL_DATABASE_SHEETS).map(
    function (key) {
      return PERSONAL_DATABASE_SHEETS[key];
    }
  );
  spreadsheet.getSheets().forEach(function (sheet) {
    if (
      !expectedNames.includes(sheet.getName())
        && sheet.getLastRow() === 0
        && spreadsheet.getSheets().length > expectedNames.length
    ) {
      spreadsheet.deleteSheet(sheet);
    }
  });
}

function validatePersonalDatabaseMetadata_(spreadsheet, schoolYear) {
  const sheet = spreadsheet.getSheetByName(
    PERSONAL_DATABASE_SHEETS.settings
  );
  if (!sheet) {
    return { valid: false, unsupportedSchema: false };
  }

  const actualHeaders = sheet
    .getRange(
      1,
      PERSONAL_STORAGE_CONFIG.metadataStartColumn,
      1,
      PERSONAL_METADATA_HEADERS.length
    )
    .getDisplayValues()[0]
    .map(function (value) {
      return String(value || '').trim();
    });
  if (
    actualHeaders.join('\u0000')
      !== PERSONAL_METADATA_HEADERS.join('\u0000')
  ) {
    return { valid: false, unsupportedSchema: false };
  }

  const rows = sheet
    .getRange(
      2,
      PERSONAL_STORAGE_CONFIG.metadataStartColumn,
      PERSONAL_METADATA_KEYS.length,
      2
    )
    .getValues();
  const metadata = {};
  rows.forEach(function (row) {
    metadata[String(row[0] || '').trim()] = row[1];
  });

  const schemaVersion = String(metadata.schemaVersion || '').trim();
  if (schemaVersion !== PERSONAL_STORAGE_CONFIG.schemaVersion) {
    return { valid: false, unsupportedSchema: true };
  }
  return {
    valid:
      String(metadata.appId || '').trim()
        === PERSONAL_STORAGE_CONFIG.appId
      && String(metadata.storageMode || '').trim()
        === PERSONAL_STORAGE_CONFIG.storageMode
      && Number(metadata.schoolYear) === Number(schoolYear),
    unsupportedSchema: false,
  };
}

function buildPersonalStorageContextState_(
  state,
  schoolYear,
  appFolder,
  database,
  recoveryCandidates,
  actions
) {
  return {
    state: state,
    schoolYear: schoolYear,
    appFolder: appFolder || null,
    database: database || null,
    recoveryCandidates: recoveryCandidates || [],
    actions: actions || [],
  };
}

function buildPublicPersonalStorageState_(context) {
  return {
    ok: context.state === 'READY',
    state: context.state,
    statusMessage: personalStorageStatusMessage_(context.state),
    appVersion: APP_CONFIG.version,
    schemaVersion: PERSONAL_STORAGE_CONFIG.schemaVersion,
    storageMode: PERSONAL_STORAGE_CONFIG.storageMode,
    schoolYear: context.schoolYear || getPersonalCurrentSchoolYear_(),
    appFolder: publicPersonalResource_(
      context.appFolder,
      PERSONAL_STORAGE_CONFIG.appFolderName
    ),
    database: publicPersonalResource_(
      context.database,
      personalDatabaseName_(
        context.schoolYear || getPersonalCurrentSchoolYear_()
      )
    ),
    recoveryCandidates: (context.recoveryCandidates || []).map(
      function (candidate, index) {
        return {
          token: candidate.token,
          label: `복구 후보 ${index + 1}`,
          createdAt: candidate.createdAt,
          trashed: Boolean(candidate.trashed),
        };
      }
    ),
    actions: (context.actions || []).slice(),
  };
}

function buildPersonalStorageFailure_(state, message) {
  return {
    ok: false,
    state: state,
    statusMessage: String(message || personalStorageStatusMessage_(state)),
    appVersion: APP_CONFIG.version,
    schemaVersion: PERSONAL_STORAGE_CONFIG.schemaVersion,
    storageMode: PERSONAL_STORAGE_CONFIG.storageMode,
    schoolYear: getPersonalCurrentSchoolYear_(),
    appFolder: publicPersonalResource_(
      null,
      PERSONAL_STORAGE_CONFIG.appFolderName
    ),
    database: publicPersonalResource_(
      null,
      personalDatabaseName_(getPersonalCurrentSchoolYear_())
    ),
    recoveryCandidates: [],
    actions: [],
  };
}

function publicPersonalResource_(resource, expectedName) {
  return {
    status: resource && resource.status ? resource.status : 'NOT_READY',
    name: expectedName,
    url: resource && resource.url ? resource.url : null,
  };
}

function buildReadyPersonalResource_(
  resource,
  status,
  expectedName,
  driveFile
) {
  return {
    ready: true,
    state: 'READY',
    status: status,
    name: expectedName,
    resource: resource,
    folder: resource && typeof resource.getFilesByName === 'function'
      ? resource
      : null,
    spreadsheet: resource && typeof resource.getSheets === 'function'
      ? resource
      : null,
    file: driveFile || null,
    url: resource && typeof resource.getUrl === 'function'
      ? resource.getUrl()
      : null,
    recoveryCandidates: [],
    actions: [],
  };
}

function buildPersonalResourceIssue_(state, status) {
  return {
    ready: false,
    state: state,
    status: status,
    recoveryCandidates: [],
    actions: [],
  };
}

function buildPersonalDatabaseIssue_(
  state,
  status,
  actions,
  recoveryCandidates
) {
  return {
    ready: false,
    state: state,
    status: status,
    recoveryCandidates: recoveryCandidates || [],
    actions: actions || [],
  };
}

function collectOwnedPersonalFolders_(iterator, userEmail) {
  const folders = [];
  while (iterator.hasNext()) {
    const folder = iterator.next();
    if (
      !folder.isTrashed()
        && isPersonalDriveItemOwnedBy_(folder, userEmail)
    ) {
      folders.push(folder);
    }
  }
  return folders;
}

function isPersonalDriveItemOwnedBy_(item, userEmail) {
  try {
    const owner = item.getOwner();
    return Boolean(owner)
      && normalizeCurrentUserEmail_(owner.getEmail()) === userEmail;
  } catch (error) {
    return false;
  }
}

function personalFileBelongsToFolder_(file, folderId) {
  try {
    const parents = file.getParents();
    while (parents.hasNext()) {
      if (parents.next().getId() === folderId) {
        return true;
      }
    }
  } catch (error) {
    return false;
  }
  return false;
}

function classifyPersonalDriveError_(error, resourceType) {
  const message = String(error && error.message ? error.message : '')
    .toLowerCase();
  if (/permission|access denied|forbidden|권한|액세스/.test(message)) {
    return `${resourceType}_ACCESS_DENIED`;
  }
  if (/not found|does not exist|no item|찾을 수 없|존재하지/.test(message)) {
    return `${resourceType}_DELETED`;
  }
  return `${resourceType}_UNKNOWN`;
}

function isValidPersonalDriveId_(value) {
  return /^[A-Za-z0-9_-]{10,}$/.test(String(value || '').trim());
}

function normalizePersonalCandidateToken_(value) {
  const token = String(value || '').trim().toLowerCase();
  return /^[a-f0-9]{16}$/.test(token) ? token : '';
}

function personalDriveIdFingerprint_(driveId) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(driveId),
    Utilities.Charset.UTF_8
  );
  return digest
    .slice(0, 8)
    .map(function (value) {
      return (value + 256).toString(16).slice(-2);
    })
    .join('');
}

function personalDatabasePropertyKey_(schoolYear) {
  return `${PERSONAL_STORAGE_CONFIG.databaseIdPropertyPrefix}${schoolYear}`;
}

// 학교명이 없으면(설치 전 등) 접두어 없이 예전 이름 그대로 쓴다. 이미
// 연결된 파일은 저장된 파일 ID로만 찾으므로 이름 형식이 바뀌어도 영향
// 없고, 새로 만드는 파일에만 학교명이 붙는다.
function personalDatabaseName_(schoolYear) {
  const schoolName = getSchoolInstallationState_().schoolName;
  const prefix = schoolName ? `${schoolName}_` : '';
  return `${prefix}${PERSONAL_STORAGE_CONFIG.databaseNamePrefix}${schoolYear}`;
}

function retirePersonalDatabaseName_(file, schoolYear) {
  const suffix = Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone(),
    'yyyyMMddHHmmss'
  );
  file.setName(
    `${personalDatabaseName_(schoolYear)}_휴지통보관_${suffix}`
  );
}

function getPersonalCurrentSchoolYear_() {
  return personalSchoolYearFromDate_(new Date());
}

function personalSchoolYearFromDate_(value) {
  const date = value instanceof Date && !Number.isNaN(value.getTime())
    ? value
    : new Date();
  const month = Number(
    Utilities.formatDate(date, Session.getScriptTimeZone(), 'M')
  );
  const year = Number(
    Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy')
  );
  return month >= 3 ? year : year - 1;
}

function withPersonalStorageLock_(operation) {
  const lock = LockService.getUserLock();
  if (!lock.tryLock(PERSONAL_STORAGE_CONFIG.lockTimeoutMs)) {
    throw createPersonalStorageError_(
      'USER_LOCK_TIMEOUT',
      '같은 계정에서 다른 개인 저장소 작업이 진행 중입니다.'
    );
  }
  try {
    return operation();
  } finally {
    lock.releaseLock();
  }
}

function createPersonalStorageError_(code, message) {
  const error = new Error(message);
  error.personalStorageCode = code;
  return error;
}

function safePersonalStorageErrorMessage_(error) {
  if (error && error.personalStorageCode) {
    return String(error.message || '개인 저장소 작업을 완료하지 못했습니다.');
  }
  return '개인 저장소를 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.';
}

function formatPersonalStorageDate_(dateValue) {
  return Utilities.formatDate(
    dateValue,
    Session.getScriptTimeZone(),
    'yyyy-MM-dd HH:mm:ss'
  );
}

function personalStorageStatusMessage_(state) {
  const messages = {
    READY: '개인 폴더, 개인 데이터베이스, 사진 폴더 준비가 완료되었습니다.',
    NO_RECOVERY_CANDIDATE: '아직 개인 저장소가 없습니다. 아래에서 새로 만들어 주세요.',
    LOGIN_REQUIRED: '로그인 계정을 확인할 수 없습니다.',
    TRASHED_DATABASE: '휴지통에 있는 개인 데이터베이스를 발견했습니다.',
    MULTIPLE_RECOVERY_CANDIDATES: '복구 가능한 개인 데이터베이스가 여러 개 있습니다.',
    MULTIPLE_APP_FOLDERS: '내 Drive 루트에 같은 이름의 앱 폴더가 여러 개 있습니다.',
    MULTIPLE_PHOTO_FOLDERS: '앱 폴더 안에 같은 이름의 사진 폴더가 여러 개 있습니다.',
    TRASHED_APP_FOLDER: '개인 앱 폴더가 휴지통에 있습니다.',
    TRASHED_PHOTO_FOLDER: '개인 사진 폴더가 휴지통에 있습니다.',
    PROPERTY_CORRUPT: '저장된 개인 파일 연결 정보가 손상되었습니다.',
    DATABASE_DELETED: '연결된 개인 데이터베이스가 삭제되었습니다.',
    DATABASE_ACCESS_DENIED: '개인 데이터베이스에 접근할 권한이 없습니다.',
    DATABASE_UNKNOWN: '개인 데이터베이스 상태를 확인하지 못했습니다.',
    APP_FOLDER_DELETED: '연결된 개인 앱 폴더가 삭제되었습니다.',
    APP_FOLDER_ACCESS_DENIED: '개인 앱 폴더에 접근할 권한이 없습니다.',
    APP_FOLDER_UNKNOWN: '개인 앱 폴더 상태를 확인하지 못했습니다.',
    PHOTO_FOLDER_DELETED: '연결된 개인 사진 폴더가 삭제되었습니다.',
    PHOTO_FOLDER_ACCESS_DENIED: '개인 사진 폴더에 접근할 권한이 없습니다.',
    PHOTO_FOLDER_UNKNOWN: '개인 사진 폴더 상태를 확인하지 못했습니다.',
    UNSUPPORTED_STORAGE_SCHEMA: '지원하지 않는 개인 저장소 스키마입니다.',
    UNSUPPORTED_DATABASE_SCHEMA: '지원하지 않는 개인 데이터베이스 스키마입니다.',
    CANCELLED: '개인 저장소 복구 작업을 취소했습니다.',
    STORAGE_CREATION_FAILED: '개인 저장소 생성에 실패했습니다.',
  };
  return messages[state] || '개인 저장소 상태를 확인했습니다.';
}
