'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_STATE = Object.freeze({
  version: 1,
  step: 'welcome',
  workDir: null,
  scriptId: null,
  deploymentId: null,
  adminConfirmed: false,
});

class StateStore {
  constructor(statePath) {
    this.statePath = statePath;
  }

  load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
      return Object.assign({}, DEFAULT_STATE, parsed);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw new Error('이전 설치 상태를 읽지 못했습니다. 상태 파일을 확인해 주세요.');
      }
      return Object.assign({}, DEFAULT_STATE);
    }
  }

  save(nextState) {
    const directory = path.dirname(this.statePath);
    fs.mkdirSync(directory, { recursive: true });
    const temporaryPath = `${this.statePath}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(nextState, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    fs.renameSync(temporaryPath, this.statePath);
    return nextState;
  }

  update(changes) {
    return this.save(Object.assign({}, this.load(), changes));
  }
}

module.exports = { DEFAULT_STATE, StateStore };
