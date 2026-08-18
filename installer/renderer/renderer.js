'use strict';

const elements = {
  openApi: document.getElementById('open-api'),
  login: document.getElementById('login'),
  prepare: document.getElementById('prepare'),
  openEditor: document.getElementById('open-editor'),
  adminComplete: document.getElementById('admin-complete'),
  deploy: document.getElementById('deploy'),
  openWebApp: document.getElementById('open-web-app'),
  shortcut: document.getElementById('shortcut'),
  optimize: document.getElementById('optimize'),
  optimizeStatus: document.getElementById('optimize-status'),
  progress: document.getElementById('progress'),
  error: document.getElementById('error'),
  complete: document.getElementById('complete'),
  webAppUrl: document.getElementById('web-app-url'),
  loginStatus: document.getElementById('login-status'),
  projectStatus: document.getElementById('project-status'),
  adminStatus: document.getElementById('admin-status'),
  deployStatus: document.getElementById('deploy-status'),
};

function setStatus(element, text, className) {
  element.textContent = text;
  element.className = `status ${className || ''}`.trim();
}

function showError(error) {
  elements.error.textContent = error && error.message ? error.message : String(error);
  elements.error.hidden = false;
}

function clearError() {
  elements.error.hidden = true;
  elements.error.textContent = '';
}

function setBusy(button, busy, label) {
  button.disabled = busy;
  if (busy) {
    button.dataset.label = button.textContent;
    button.textContent = label;
  } else if (button.dataset.label) {
    button.textContent = button.dataset.label;
  }
}

function render(state) {
  const loggedInSteps = ['logged-in', 'project-created', 'pushed', 'admin-confirmed', 'deployed'];
  if (loggedInSteps.includes(state.step)) setStatus(elements.loginStatus, '완료', 'done');
  if (state.hasProject) setStatus(elements.projectStatus, state.step === 'project-created' ? '업로드 필요' : '완료', state.step === 'project-created' ? 'working' : 'done');
  if (state.adminConfirmed) {
    elements.adminComplete.checked = true;
    setStatus(elements.adminStatus, '완료', 'done');
  }
  if (state.hasDeployment) {
    setStatus(elements.deployStatus, '완료', 'done');
    elements.complete.hidden = false;
    elements.webAppUrl.value = state.webAppUrl;
    if (state.optimized) {
      setStatus(elements.optimizeStatus, '최적화 완료', 'done');
      elements.optimize.disabled = true;
    }
  }
}

async function invoke(action, value) {
  clearError();
  const state = await window.installer.invoke(action, value);
  if (state && state.step) render(state);
  return state;
}

elements.openApi.addEventListener('click', async () => {
  try {
    await invoke('open-api-settings');
    document.getElementById('api-status').textContent = '페이지 열림';
  } catch (error) { showError(error); }
});

elements.login.addEventListener('click', async () => {
  setBusy(elements.login, true, '승인 기다리는 중…');
  setStatus(elements.loginStatus, '진행 중', 'working');
  try { await invoke('login'); } catch (error) { setStatus(elements.loginStatus, '다시 시도', ''); showError(error); }
  finally { setBusy(elements.login, false); }
});

elements.prepare.addEventListener('click', async () => {
  setBusy(elements.prepare, true, '준비 중…');
  setStatus(elements.projectStatus, '진행 중', 'working');
  try { await invoke('prepare-project'); setStatus(elements.projectStatus, '완료', 'done'); }
  catch (error) { setStatus(elements.projectStatus, '다시 시도', ''); showError(error); }
  finally { setBusy(elements.prepare, false); }
});

elements.openEditor.addEventListener('click', async () => {
  try { await invoke('open-editor'); } catch (error) { showError(error); }
});

elements.adminComplete.addEventListener('change', async () => {
  if (!elements.adminComplete.checked) return;
  try { await invoke('confirm-admin', true); }
  catch (error) { elements.adminComplete.checked = false; showError(error); }
});

elements.deploy.addEventListener('click', async () => {
  setBusy(elements.deploy, true, '배포 중…');
  setStatus(elements.deployStatus, '진행 중', 'working');
  try { await invoke('deploy'); } catch (error) { setStatus(elements.deployStatus, '다시 시도', ''); showError(error); }
  finally { setBusy(elements.deploy, false); }
});

elements.openWebApp.addEventListener('click', async () => {
  try { await invoke('open-web-app'); } catch (error) { showError(error); }
});

elements.shortcut.addEventListener('click', async () => {
  try {
    const result = await invoke('create-shortcut');
    elements.progress.textContent = `바탕화면 바로가기를 만들고 웹앱 주소를 복사했습니다: ${result.shortcutPath}`;
  } catch (error) { showError(error); }
});

elements.optimize.addEventListener('click', async () => {
  setBusy(elements.optimize, true, '최적화 중…');
  try {
    await invoke('optimize');
    setStatus(elements.optimizeStatus, '최적화 완료', 'done');
  } catch (error) { showError(error); }
  finally { setBusy(elements.optimize, false); }
});

window.installer.onProgress((message) => { elements.progress.textContent = message; });
invoke('get-state').catch(showError);
