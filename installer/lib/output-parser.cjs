'use strict';

function parseJsonOutput(output) {
  const text = String(output || '').trim();
  if (!text) {
    throw new Error('명령 결과가 비어 있습니다.');
  }

  try {
    return JSON.parse(text);
  } catch (_) {
    const starts = [];
    for (let index = 0; index < text.length; index += 1) {
      if (text[index] === '{' || text[index] === '[') starts.push(index);
    }
    for (const start of starts) {
      try {
        return JSON.parse(text.slice(start));
      } catch (_) {
        // clasp가 JSON 앞에 안내 문구를 출력하는 버전도 있어 다음 후보를 확인한다.
      }
    }
  }
  throw new Error('clasp 결과를 해석하지 못했습니다.');
}

function findDeployment(deployments, description) {
  if (!Array.isArray(deployments)) return null;
  return deployments.find((item) => item && item.description === description && item.deploymentId) || null;
}

function isValidScriptId(value) {
  return /^[A-Za-z0-9_-]{20,}$/.test(String(value || ''));
}

function isValidDeploymentId(value) {
  return /^AKfy[A-Za-z0-9_-]{16,}$/.test(String(value || ''));
}

module.exports = {
  findDeployment,
  isValidDeploymentId,
  isValidScriptId,
  parseJsonOutput,
};
