'use strict';

const fs = require('fs');
const path = require('path');

const gsFiles = fs.readdirSync(__dirname)
  .filter((name) => name.endsWith('.gs'))
  .sort();
const sources = Object.fromEntries(gsFiles.map((fileName) => [
  fileName,
  fs.readFileSync(path.join(__dirname, fileName), 'utf8'),
]));
const serverCode = gsFiles.map((fileName) => sources[fileName]).join('\n');
const html = fs.readFileSync(path.join(__dirname, 'Index.html'), 'utf8');
const manifestText = fs.readFileSync(
  path.join(__dirname, 'appsscript.json'),
  'utf8',
);
const clientScripts = [...html.matchAll(
  /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi,
)].map((match) => match[1]);
const clientScript = clientScripts.join('\n');

// 체크포인트 2.5는 개인 학생 원본·개인 사진 업로드 정책을 중앙 읽기
// 정책으로 바꿨다. 그 이전 아키텍처를 검증하던 대형 회귀 스위트는
// 더 이상 현재 코드와 맞지 않아 제거했다. 체크포인트별 상세 회귀는
// verify-v8.4-cpX.js가 담당하고, 이 파일은 전체 소스의 구문·매니페스트·
// 개인 기록 라우팅 정책 불변식만 가볍게 확인한다.
new Function(serverCode);
clientScripts.forEach((script) => new Function(script));

const manifest = JSON.parse(manifestText);
if (manifest.webapp.executeAs !== 'USER_ACCESSING') {
  throw new Error('USER_ACCESSING 실행이 필요합니다.');
}
if (!sources['Code.gs'].includes('getPersonalRecordContext_')) {
  throw new Error('개인 기록 라우팅 함수가 없습니다.');
}
if (!sources['Code.gs'].includes('requireMyAssignment_')) {
  throw new Error('기록 저장 전 담당 수업 재검증이 없습니다.');
}
if (!sources['Code.gs'].includes('getAppSpreadsheet_()')) {
  throw new Error('현재 사용자 개인 DB 라우팅이 없습니다.');
}
if (
  clientScript.includes('uploadStudentPhoto')
    || clientScript.includes('previewStudentRosterCsv')
    || clientScript.includes('initializeSchoolDatabase')
) {
  throw new Error('개인 CSV·사진 업로드 초기화 흐름이 남아 있습니다.');
}

console.log(
  'v8.4 checkpoint 2 policy-updated regression checks OK '
    + '(personal records retained; roster/photos moved to central read)'
);
