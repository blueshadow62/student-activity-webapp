'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { redactSensitive } = require('./redaction.cjs');
const {
  findDeployment,
  isValidDeploymentId,
  isValidScriptId,
  parseJsonOutput,
} = require('./output-parser.cjs');
const {
  DEPLOYMENT_DESCRIPTION,
  PROJECT_TITLE,
} = require('./constants.cjs');

function buildClaspCommandArgs(cliPath, authFilePath, args) {
  return [cliPath, '-A', authFilePath].concat(args);
}

class ClaspService {
  constructor(options) {
    this.executablePath = options.executablePath;
    this.cliPath = options.cliPath;
    this.authFilePath = options.authFilePath;
    this.onProgress = options.onProgress || function () {};
  }

  run(args, workingDirectory) {
    const commandArgs = buildClaspCommandArgs(
      this.cliPath,
      this.authFilePath,
      args
    );
    const environment = Object.assign({}, process.env, {
      ELECTRON_RUN_AS_NODE: '1',
    });
    fs.mkdirSync(path.dirname(this.authFilePath), {
      recursive: true,
      mode: 0o700,
    });

    return new Promise((resolve, reject) => {
      const child = spawn(this.executablePath, commandArgs, {
        cwd: workingDirectory,
        env: environment,
        shell: false,
        windowsHide: true,
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
      child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
      child.on('error', (error) => reject(new Error(`설치 명령을 시작하지 못했습니다: ${error.message}`)));
      child.on('close', (exitCode) => {
        if (exitCode === 0) {
          resolve({ stdout, stderr });
          return;
        }
        const details = redactSensitive(stderr || stdout).trim();
        reject(new Error(details || `clasp 명령이 종료 코드 ${exitCode}로 실패했습니다.`));
      });
    });
  }

  async login(workingDirectory) {
    this.onProgress('기본 브라우저에서 Google 로그인을 승인해 주세요.');
    await this.run(['login'], workingDirectory);
    await this.run(['--json', 'show-authorized-user'], workingDirectory);
  }

  async createProject(projectDir) {
    this.onProgress('학교 전용 Apps Script 프로젝트를 만들고 있습니다.');
    const result = await this.run([
      '--json',
      'create-script',
      '--type',
      'standalone',
      '--title',
      PROJECT_TITLE,
    ], projectDir);
    const projectFile = path.join(projectDir, '.clasp.json');
    if (!fs.existsSync(projectFile)) {
      throw new Error('프로젝트가 만들어졌지만 연결 정보를 찾지 못했습니다.');
    }
    const project = JSON.parse(fs.readFileSync(projectFile, 'utf8'));
    if (!isValidScriptId(project.scriptId)) {
      try {
        const output = parseJsonOutput(result.stdout);
        project.scriptId = output.scriptId;
      } catch (_) {
        // 아래 공통 검증에서 안전하게 실패한다.
      }
    }
    if (!isValidScriptId(project.scriptId)) {
      throw new Error('생성된 Apps Script 프로젝트 ID가 올바르지 않습니다.');
    }
    return project.scriptId;
  }

  async push(projectDir) {
    this.onProgress('앱 코드를 업로드하고 있습니다. 큰 데이터 파일 때문에 몇 분 걸릴 수 있습니다.');
    await this.run(['--json', 'push', '--force'], projectDir);
  }

  async findExistingDeployment(projectDir) {
    const result = await this.run(['--json', 'list-deployments'], projectDir);
    const deployments = parseJsonOutput(result.stdout);
    return findDeployment(deployments, DEPLOYMENT_DESCRIPTION);
  }

  async deploy(projectDir) {
    this.onProgress('웹앱 배포를 만들고 있습니다.');
    const existing = await this.findExistingDeployment(projectDir);
    if (existing && isValidDeploymentId(existing.deploymentId)) {
      return existing.deploymentId;
    }

    const result = await this.run([
      '--json',
      'create-deployment',
      '-d',
      DEPLOYMENT_DESCRIPTION,
    ], projectDir);
    const deployment = parseJsonOutput(result.stdout);
    if (!isValidDeploymentId(deployment.deploymentId)) {
      throw new Error('배포는 완료되었지만 배포 ID를 확인하지 못했습니다. 다시 시도해 주세요.');
    }
    return deployment.deploymentId;
  }
}

module.exports = { buildClaspCommandArgs, ClaspService };
