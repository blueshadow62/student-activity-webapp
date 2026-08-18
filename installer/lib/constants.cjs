'use strict';

const PAYLOAD_FILES = Object.freeze([
  'AdminPortal.gs',
  'AssignmentRequests.gs',
  'CentralData.gs',
  'Code.gs',
  'CourseGroups.gs',
  'InstallationSetup.gs',
  'PersonalRouting.gs',
  'PersonalStorage.gs',
  'SchoolSetup.gs',
  'StandardsData.gs',
  'Index.html',
  'appsscript.json',
]);

const URLS = Object.freeze({
  apiSettings: 'https://script.google.com/home/usersettings',
  scriptEditor(scriptId) {
    return `https://script.google.com/home/projects/${scriptId}/edit`;
  },
  webApp(deploymentId) {
    return `https://script.google.com/macros/s/${deploymentId}/exec`;
  },
});

const DEPLOYMENT_DESCRIPTION = '학생 활동 기록 최초 배포';
const PROJECT_TITLE = '학생 활동 기록';

module.exports = {
  DEPLOYMENT_DESCRIPTION,
  PAYLOAD_FILES,
  PROJECT_TITLE,
  URLS,
};
