// 성취기준 .gs 번들에서 JSON을 추출해 data/ 디렉터리에 나눠 쓴다.
// StandardsData_high.gs가 40MB라 require/eval은 V8 파서가 못 버틴다.
// 그래서 파일을 순수 텍스트로 읽고, 첫 '[' ~ 마지막 ']' 사이만 잘라 JSON.parse한다.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');

// .gs 파일에서 `const NAME = '...json...';` 형태의 JSON 문자열을 추출한다.
// 원본 빌드 스크립트가 JSON을 JS 작은따옴표 문자열로 감쌀 때 내부의 '를 \'로
// 이스케이프했기 때문에(JSON 문법에는 없는 이스케이프), JSON.parse를 바로 쓰면
// "Bad escaped character" 오류가 난다. 그래서 따옴표를 포함한 리터럴 전체를
// `new Function('return ' + literal)()`로 평가해 JS 문자열 이스케이프를 정확히
// 풀어낸 뒤, 그 결과 문자열을 JSON.parse한다. (전체 .gs 파일을 eval하는 게
// 아니라 리터럴 부분만 떼어내 평가하므로 40MB 파일도 안전하다.)
function extractJsonArray(gsFilePath) {
  const text = fs.readFileSync(gsFilePath, 'utf8');
  const quoteStart = text.indexOf("'["); // 여는 따옴표 위치
  const quoteEnd = text.lastIndexOf("]'") + 2; // 닫는 따옴표까지 포함
  if (quoteStart < 0 || quoteEnd < 2 || quoteEnd <= quoteStart) {
    throw new Error(`${path.basename(gsFilePath)}: JSON 문자열 경계를 찾지 못함`);
  }
  const literal = text.slice(quoteStart, quoteEnd); // 예: '[{...}]'
  const jsonText = new Function('return ' + literal)();
  return JSON.parse(jsonText);
}

const TRACKS_2022 = [
  '건축·토목', '경영·금융', '관광·레저', '기계', '농림·축산',
  '문화·예술·디자인·방송', '미용', '보건·복지', '섬유·의류', '수산·해운',
  '식품·조리', '융복합·지식 재산', '재료', '전기·전자', '정보·통신',
  '화학 공업', '환경·안전·소방',
];
const TRACKS_2015 = [
  '건설', '경영·금융', '기계', '농림·수산 해양', '디자인문화콘텐츠',
  '미용·관광·레저', '보건복지', '선박 운항', '섬유·의류', '식품가공',
  '음식조리', '인쇄출판공예', '재료', '전기·전자', '정보·통신',
  '화학 공업', '환경 안전',
];

function safeFileName(name) {
  return name.replace(/[\\/:*?"<>|]/g, '_');
}

function writeStandardsFile(fileName, meta, subjects, standards) {
  const filePath = path.join(DATA_DIR, safeFileName(fileName));
  const payload = { meta, subjects, standards };
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
  const sizeKb = (fs.statSync(filePath).size / 1024).toFixed(1);
  console.log(`  ${fileName}: 과목 ${subjects.length}개, 성취기준 ${standards.length}개 (${sizeKb} KB)`);
}

function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  console.log('STANDARDS_SUBJECTS 로딩 중 (StandardsData.gs)...');
  const subjects = extractJsonArray(path.join(ROOT, 'StandardsData.gs'));
  console.log(`  과목 총 ${subjects.length}개`);

  const bySchool = (level) => subjects.filter((s) => s.schoolLevel === level);
  const highByCategory = (category, rev, track) =>
    subjects.filter(
      (s) =>
        s.schoolLevel === 'high' &&
        s.category === category &&
        s.curriculumRevision === rev &&
        (track === undefined || s.track === track)
    );

  console.log('\n=== 초등학교 ===');
  console.log('STANDARDS_DATA_ELEMENTARY 로딩 중...');
  const elemStandards = extractJsonArray(path.join(ROOT, 'StandardsData_elementary.gs'));
  writeStandardsFile(
    'elementary.json',
    { schoolLevel: 'elementary', category: null, curriculumRevision: null, description: '초등학교 전체 과목 및 성취기준' },
    bySchool('elementary'),
    elemStandards
  );

  console.log('\n=== 중학교 ===');
  console.log('STANDARDS_DATA_MIDDLE 로딩 중...');
  const middleStandards = extractJsonArray(path.join(ROOT, 'StandardsData_middle.gs'));
  writeStandardsFile(
    'middle.json',
    { schoolLevel: 'middle', category: null, curriculumRevision: null, description: '중학교 전체 과목 및 성취기준' },
    bySchool('middle'),
    middleStandards
  );

  console.log('\n=== 고등학교 (StandardsData_high.gs, 40MB — 시간이 걸릴 수 있음) ===');
  const highStandards = extractJsonArray(path.join(ROOT, 'StandardsData_high.gs'));
  console.log(`  성취기준 총 ${highStandards.length}개 로딩 완료`);

  // 보통교과: track === '보통교과'
  for (const rev of ['2022', '2015']) {
    const fileSubjects = highByCategory('보통교과', rev);
    const fileStandards = highStandards.filter(
      (st) => st.track === '보통교과' && st.curriculumRevision === rev
    );
    writeStandardsFile(
      `high-보통교과-${rev}.json`,
      { schoolLevel: 'high', category: '보통교과', curriculumRevision: rev, description: `${rev} 개정 고등학교 보통교과 과목 및 성취기준` },
      fileSubjects,
      fileStandards
    );
  }

  // 전문교과: track별 + 개정연도별
  const trackSets = { 2022: TRACKS_2022, 2015: TRACKS_2015 };
  for (const rev of Object.keys(trackSets)) {
    for (const track of trackSets[rev]) {
      const fileSubjects = highByCategory('전문교과', rev, track);
      const fileStandards = highStandards.filter(
        (st) => st.track === track && st.curriculumRevision === rev
      );
      writeStandardsFile(
        `high-전문교과-${track}-${rev}.json`,
        { schoolLevel: 'high', category: '전문교과', curriculumRevision: rev, track, description: `${rev} 개정 고등학교 전문교과(${track}) 과목 및 성취기준` },
        fileSubjects,
        fileStandards
      );
    }
  }

  console.log('\n완료.');
}

main();
