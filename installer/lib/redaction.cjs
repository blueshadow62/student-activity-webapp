'use strict';

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const DEPLOYMENT_ID_PATTERN = /AKfy[A-Za-z0-9_-]{16,}/g;
const SCRIPT_ID_PATTERN = /\b[A-Za-z0-9_-]{40,}\b/g;
const TOKEN_PATTERN = /("?(?:access_token|refresh_token|id_token|client_secret)"?\s*[:=]\s*"?)[^"\s,}]+/gi;

function redactSensitive(value) {
  return String(value || '')
    .replace(TOKEN_PATTERN, '$1[숨김]')
    .replace(EMAIL_PATTERN, '[이메일 숨김]')
    .replace(DEPLOYMENT_ID_PATTERN, '[배포 ID 숨김]')
    .replace(SCRIPT_ID_PATTERN, '[스크립트 ID 숨김]');
}

module.exports = { redactSensitive };
