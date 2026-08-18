'use strict';

const { app, BrowserWindow, clipboard, ipcMain, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { ClaspService } = require('./lib/clasp-service.cjs');
const {
  assertSafeWorkDirectory,
  copyPayload,
  listUnexpectedPayloadFiles,
} = require('./lib/payload.cjs');
const { isValidDeploymentId, isValidScriptId } = require('./lib/output-parser.cjs');
const { StateStore } = require('./lib/state-store.cjs');
const { PAYLOAD_FILES, URLS } = require('./lib/constants.cjs');
const { redactSensitive } = require('./lib/redaction.cjs');

let mainWindow;
let stateStore;
let claspService;
let operationInProgress = false;

function getPayloadDirectory() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'payload')
    : path.resolve(__dirname, '..');
}

function resolveClaspCli() {
  return require.resolve('@google/clasp');
}

function sendProgress(message) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('installer:progress', message);
  }
}

async function runExclusive(operation) {
  if (operationInProgress) throw new Error('다른 설치 작업이 진행 중입니다. 잠시 기다려 주세요.');
  operationInProgress = true;
  try {
    return await operation();
  } catch (error) {
    throw new Error(redactSensitive(error && error.message ? error.message : error));
  } finally {
    operationInProgress = false;
  }
}

function getInstallationsRoot() {
  const installationsRoot = path.join(app.getPath('userData'), 'installations');
  fs.mkdirSync(installationsRoot, { recursive: true, mode: 0o700 });
  return installationsRoot;
}

function requireSafeWorkDirectory(workDir) {
  return assertSafeWorkDirectory(getInstallationsRoot(), workDir);
}

function makeWorkDirectory() {
  const suffix = crypto.randomBytes(6).toString('hex');
  const workDir = path.join(getInstallationsRoot(), suffix);
  fs.mkdirSync(workDir, { recursive: true, mode: 0o700 });
  return requireSafeWorkDirectory(workDir);
}

function ensureProjectFile(state) {
  const workDir = requireSafeWorkDirectory(state.workDir);
  const projectFile = path.join(workDir, '.clasp.json');
  if (!fs.existsSync(projectFile) && isValidScriptId(state.scriptId)) {
    fs.writeFileSync(projectFile, `${JSON.stringify({ scriptId: state.scriptId, rootDir: '.' }, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
  }
}

function publicState(state) {
  return {
    step: state.step,
    hasProject: isValidScriptId(state.scriptId),
    adminConfirmed: Boolean(state.adminConfirmed),
    hasDeployment: isValidDeploymentId(state.deploymentId),
    webAppUrl: isValidDeploymentId(state.deploymentId) ? URLS.webApp(state.deploymentId) : null,
  };
}

function registerHandlers() {
  ipcMain.handle('installer:get-state', () => publicState(stateStore.load()));

  ipcMain.handle('installer:open-api-settings', async () => {
    await shell.openExternal(URLS.apiSettings);
    return { ok: true };
  });

  ipcMain.handle('installer:login', () => runExclusive(async () => {
    const state = stateStore.load();
    const workingDirectory = state.workDir
      ? requireSafeWorkDirectory(state.workDir)
      : app.getPath('userData');
    fs.mkdirSync(workingDirectory, { recursive: true });
    await claspService.login(workingDirectory);
    return publicState(stateStore.update({ step: 'logged-in' }));
  }));

  ipcMain.handle('installer:prepare-project', () => runExclusive(async () => {
    let state = stateStore.load();
    if (!state.workDir) {
      state = stateStore.update({ workDir: makeWorkDirectory() });
    }
    const workDir = requireSafeWorkDirectory(state.workDir);

    if (!isValidScriptId(state.scriptId)) {
      try {
        const scriptId = await claspService.createProject(workDir);
        state = stateStore.update({ scriptId, step: 'project-created' });
      } catch (error) {
        const projectFile = path.join(workDir, '.clasp.json');
        if (fs.existsSync(projectFile)) {
          const recovered = JSON.parse(fs.readFileSync(projectFile, 'utf8'));
          if (isValidScriptId(recovered.scriptId)) {
            stateStore.update({ scriptId: recovered.scriptId, step: 'project-created' });
          }
        }
        throw error;
      }
    } else {
      ensureProjectFile(state);
    }

    const payloadDir = getPayloadDirectory();
    const unexpected = app.isPackaged ? listUnexpectedPayloadFiles(payloadDir) : [];
    if (unexpected.length > 0) {
      throw new Error(`허용되지 않은 설치 파일이 포함되었습니다: ${unexpected.join(', ')}`);
    }
    copyPayload(payloadDir, workDir, getInstallationsRoot());
    await claspService.push(workDir);
    return publicState(stateStore.update({ step: 'pushed' }));
  }));

  ipcMain.handle('installer:open-editor', async () => {
    const state = stateStore.load();
    if (!isValidScriptId(state.scriptId)) throw new Error('먼저 프로젝트와 코드를 준비해 주세요.');
    await shell.openExternal(URLS.scriptEditor(state.scriptId));
    return { ok: true };
  });

  ipcMain.handle('installer:confirm-admin', (_event, confirmed) => {
    if (confirmed !== true) throw new Error('관리자 등록 완료 여부를 확인해 주세요.');
    return publicState(stateStore.update({ adminConfirmed: true, step: 'admin-confirmed' }));
  });

  ipcMain.handle('installer:deploy', () => runExclusive(async () => {
    let state = stateStore.load();
    if (!state.adminConfirmed) throw new Error('먼저 편집기에서 최초 관리자 등록을 완료해 주세요.');
    if (!isValidScriptId(state.scriptId) || !state.workDir) throw new Error('설치 프로젝트 정보가 없습니다.');
    const workDir = requireSafeWorkDirectory(state.workDir);
    ensureProjectFile(state);
    let deploymentId = state.deploymentId;
    if (!isValidDeploymentId(deploymentId)) {
      deploymentId = await claspService.deploy(workDir);
      state = stateStore.update({ deploymentId, step: 'deployed' });
    }
    return publicState(state);
  }));

  ipcMain.handle('installer:open-web-app', async () => {
    const state = stateStore.load();
    if (!isValidDeploymentId(state.deploymentId)) throw new Error('먼저 웹앱을 배포해 주세요.');
    const url = URLS.webApp(state.deploymentId);
    await shell.openExternal(url);
    return { ok: true, url };
  });

  ipcMain.handle('installer:create-shortcut', async () => {
    const state = stateStore.load();
    if (!isValidDeploymentId(state.deploymentId)) throw new Error('먼저 웹앱을 배포해 주세요.');
    const shortcutPath = path.join(app.getPath('desktop'), '학생 활동 기록.url');
    const contents = `[InternetShortcut]\r\nURL=${URLS.webApp(state.deploymentId)}\r\n`;
    fs.writeFileSync(shortcutPath, contents, { encoding: 'utf8' });
    clipboard.writeText(URLS.webApp(state.deploymentId));
    return { ok: true, shortcutPath };
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 940,
    height: 760,
    minWidth: 820,
    minHeight: 680,
    show: false,
    backgroundColor: '#f4f7fb',
    title: '학생 활동 기록 설치 도우미',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.removeMenu();
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
}

app.whenReady().then(() => {
  if (process.argv.includes('--smoke-test')) {
    const payloadDir = getPayloadDirectory();
    if (listUnexpectedPayloadFiles(payloadDir).length > 0) app.exit(2);
    for (const fileName of PAYLOAD_FILES) {
      if (!fs.existsSync(path.join(payloadDir, fileName))) app.exit(3);
    }
    resolveClaspCli();
    app.exit(0);
    return;
  }
  const userData = app.getPath('userData');
  stateStore = new StateStore(path.join(userData, 'state.json'));
  claspService = new ClaspService({
    executablePath: process.execPath,
    cliPath: resolveClaspCli(),
    authDir: path.join(userData, 'auth'),
    onProgress: sendProgress,
  });
  registerHandlers();
  createWindow();
});

app.on('window-all-closed', () => app.quit());
