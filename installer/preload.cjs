'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const allowedActions = Object.freeze([
  'get-state',
  'open-api-settings',
  'login',
  'prepare-project',
  'open-editor',
  'confirm-admin',
  'deploy',
  'open-web-app',
  'create-shortcut',
]);

contextBridge.exposeInMainWorld('installer', {
  invoke(action, value) {
    if (!allowedActions.includes(action)) {
      return Promise.reject(new Error('허용되지 않은 요청입니다.'));
    }
    return ipcRenderer.invoke(`installer:${action}`, value);
  },
  onProgress(callback) {
    const listener = (_event, message) => callback(message);
    ipcRenderer.on('installer:progress', listener);
    return function unsubscribe() {
      ipcRenderer.removeListener('installer:progress', listener);
    };
  },
});
