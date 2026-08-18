'use strict';

// Deterministically merges the official 2015 high-school curriculum into the
// already generated 2022 bundle.  Source documents are deliberately not kept
// in this repository; kordoc is the only document reader used here.
const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const CODE = /^\[([^\]]+)\]\s*(.+)$/;
// 2015 uses both numeric (10국…), compact specialist (윤사…) and spaced
// specialist (전일 01-01) identifiers.  Keep this strict enough to reject
// bracketed table labels while accepting every official identifier form.
const HIGH_CODE = /^(?:(?:\d{1,2}|[가-힣A-Za-z]{2,})[가-힣A-Za-z0-9ⅠⅡⅢ()]*-\d{2}(?:-\d{2})?|(?:[가-힣A-Za-z]{2,}|\d+[가-힣A-Za-z]+)\s+\d{2}-\d{2}(?:-\d{2})?)$/;
const EXPECTED_BOOK4_RECORDS = 1783;
const EXPECTED_BOOK4_SUBJECTS = 87;
const EXPECTED_SPECIALIST_RECORDS = 56319;

function normalize(value) {
  return String(value || '').replace(/\r/g, '').replace(/^#{1,6}\s+/, '').replace(/\u00a0/g, ' ').replace(/[\t ]+/g, ' ').trim();
}

function keyFor(prefix, parts) {
  return `${prefix}_${crypto.createHash('sha256').update(parts.map(normalize).join('\0'), 'utf8').digest('hex').slice(0, 20)}`;
}

function subjectKey(record) {
  return keyFor('subject', [record.curriculumRevision, record.schoolLevel, record.track, record.subject]);
}

function standardKey(record) {
  return keyFor('standard', [record.curriculumRevision, record.subjectKey, record.domain, record.code || '', record.text]);
}

function convert(source, output) {
  const quote = (value) => `"${String(value).replace(/"/g, '\\"')}"`;
  childProcess.execSync(`npx --yes --package kordoc --package pdfjs-dist kordoc ${quote(source)} -o ${quote(output)}`, { stdio: 'inherit' });
  return fs.readFileSync(output, 'utf8');
}

function isEndOfStandards(line) {
  return /^(?:다\.\s*(?:교수.?학습|평가)|3\.\s*(?:교수.?학습|평가)|##\s*3\.)/.test(line)
    || /성취기준\s*(?:해설|적용|평가)/.test(line);
}

// 별책4 is a combined volume.  Its top-level course headings and official
// bracketed codes are reliable, unlike explanatory re-citations (bullets).
function parseBook4(markdown) {
  const records = [];
  let subject = '';
  let domain = '';
  for (const raw of markdown.split('\n')) {
    const heading = raw.match(/^#\s+(.+)$/);
    const line = normalize(raw);
    if (!line) continue;
    if (heading) {
      const candidate = normalize(heading[1]).replace(/^\d+\.\s*/, '').replace(/\s*교육과정$/, '').replace(/과$/, '');
      // Combined-volume division headings must not replace the most recent
      // actual course name.  Course titles are short and never '…과'.
      if (candidate && candidate.length < 40 && !/(?:총론|교과|계열|교육과정|Contents|차례)$/.test(candidate)) subject = candidate;
      domain = '';
      continue;
    }
    // Official standards start a paragraph with the code.  Explanations only
    // re-cite them as bullets, so a section-state heuristic is less reliable.
    if (/^[-*•∙]/.test(line)) continue;
    const match = line.match(CODE);
    if (!match || !HIGH_CODE.test(normalize(match[1])) || !subject) continue;
    const code = normalize(match[1]);
    // 별책4에서 실제 성취기준이 추출되는 87개 과목은 모두 보통교과다.
    // 고전과 윤리·윤리와 사상의 일부 원문 코드는 학년 접두어가 없으므로
    // 코드 모양으로 전문교과Ⅰ을 판정하면 잘못 분류된다.
    records.push({ curriculumRevision: '2015', schoolLevel: 'high', track: '보통교과', subject, domain, code: `[${code}]`, text: normalize(match[2]), source: '별책4 (2015-74호)' });
  }
  return records;
}

function specialistTrack(file) {
  return normalize(path.basename(file).replace(/^별책\d+_/, '').replace(/ 전문 교과 교육과정.*$/, '')).replace(/미용관광레저/, '미용·관광·레저');
}

// 전문교과Ⅱ uses bullets instead of official codes.  The state is deliberately
// limited to '나. 영역별 성취기준' through the next numbered section.
function parseSpecialist(markdown, file) {
  const records = [];
  let subject = '';
  let domain = '';
  let active = false;
  const track = specialistTrack(file);
  for (const raw of markdown.split('\n')) {
    const heading = raw.match(/^#\s+(?:\d+\.\s*)?(.+)$/);
    const line = normalize(raw);
    if (!line) continue;
    if (heading) {
      const candidate = normalize(heading[1]);
      if (!/^(?:Contents|경영.?금융 전문 교과 교육과정)$/.test(candidate) && candidate.length < 60) { subject = candidate; domain = ''; active = false; }
      continue;
    }
    if (/^나\.\s*영역별 성취기준$/.test(line)) { active = true; continue; }
    if (active && /^(?:다\.\s*교수.?학습|3\.\s*(?:교수.?학습|평가)|##\s*3\.)/.test(line)) { active = false; continue; }
    if (!active || !subject) continue;
    if (/^(?:\d+\)|[가-힣]\))\s+/.test(line)) { domain = line.replace(/^(?:\d+\)|[가-힣]\))\s+/, ''); continue; }
    const bullet = line.match(/^[∙•]\s*(.+)$/);
    if (!bullet) continue;
    const text = normalize(bullet[1]);
    if (text.length < 4 || /(?:교수.?학습|평가|유의 사항|성취기준 해설)/.test(text)) continue;
    records.push({ curriculumRevision: '2015', schoolLevel: 'high', track, subject, domain, code: '', text, source: `${path.basename(file)} (2018-150호)` });
  }
  return records;
}

function loadExisting(file) {
  const source = fs.readFileSync(file, 'utf8');
  const context = {}; vm.createContext(context);
  vm.runInContext(`${source}\nthis.subjects=JSON.parse(STANDARDS_SUBJECTS);this.data=Object.fromEntries(Object.entries(STANDARDS_DATA).map(([k,v])=>[k,JSON.parse(v)]));`, context, { filename: file });
  // 최초 실행 전 번들에는 교육과정 필드가 없으므로 2022로 간주한다. 이미
  // 병합된 번들을 다시 입력받은 경우에는 2015 행을 제외해야 재실행할 때마다
  // 데이터가 불어나거나 2015 행이 2022로 바뀌지 않는다.
  return Object.entries(context.data).flatMap(([schoolLevel, rows]) => rows
    .map((row) => ({ ...row, schoolLevel, curriculumRevision: String(row.curriculumRevision || '2022') }))
    .filter((row) => row.curriculumRevision === '2022'));
}

function verifyBook5Reference(book4Records, book5Records) {
  // 별책5는 초·중·고 국어과를 함께 담고 있다. 별책4와 대조할 대상은
  // 10~12로 시작하는 고교 과목(국어·화법과 작문·문학 등) 전체다.
  const expected = book5Records.filter((record) => /^\[(?:10|11|12)/.test(record.code));
  if (expected.length !== 136) {
    throw new Error(`별책5 국어 고교 성취기준은 136개여야 합니다: ${expected.length}`);
  }
  const book4ByCode = new Map(book4Records.map((record) => [record.code, record.text]));
  const mismatch = expected.find((record) => book4ByCode.get(record.code) !== record.text);
  if (mismatch) throw new Error(`별책4·별책5 국어 불일치: ${mismatch.code}`);
  return expected.length;
}

function enrich(records) {
  return records.map((record) => {
    const item = { ...record, curriculumRevision: String(record.curriculumRevision) };
    item.subjectKey = subjectKey(item); item.standardKey = standardKey(item);
    return item;
  });
}

function render(records) {
  const subjects = [...new Map(records.map((record) => {
    const value = { name: record.subject, abbreviation: record.code ? record.code.slice(1, -1).replace(/^\d{1,2}/, '').replace(/-\d{2}(?:-\d{2})?$/, '') : '', schoolLevel: record.schoolLevel, track: record.track, category: record.track === '보통교과' ? '보통교과' : '전문교과', curriculumRevision: record.curriculumRevision, subjectKey: record.subjectKey };
    return [value.subjectKey, value];
  })).values()].sort((a, b) => a.subjectKey.localeCompare(b.subjectKey));
  const data = Object.fromEntries(['elementary', 'middle', 'high'].map((level) => [level, records.filter((r) => r.schoolLevel === level).sort((a, b) => a.standardKey.localeCompare(b.standardKey)).map(({ schoolLevel, ...r }) => r)]));
  const json = (value) => JSON.stringify(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `// Generated by scripts/build-standards-2015.js. Do not edit by hand.\nconst STANDARDS_SUBJECTS = '${json(subjects)}';\nconst STANDARDS_DATA = Object.freeze({\n  elementary: '${json(data.elementary)}',\n  middle: '${json(data.middle)}',\n  high: '${json(data.high)}',\n});\n`;
}

function build({ sourceDir, existing, output, referenceBook5 }) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'standards-2015-'));
  try {
    const book4 = path.join(sourceDir, '별책4_고등학교 교육과정(제2015-74호).hwp');
    if (!fs.existsSync(book4)) throw new Error(`Missing ${book4}`);
    const book4Records = parseBook4(convert(book4, path.join(temp, 'book4.md')));
    const book4SubjectCount = new Set(book4Records.map((record) => record.subject)).size;
    const specialistFiles = fs.readdirSync(sourceDir).filter((name) => /^별책(?:2[5-9]|3\d|4[01])_.*\.hwp$/i.test(name)).sort((a, b) => a.localeCompare(b, 'ko'));
    if (specialistFiles.length !== 17) throw new Error(`Expected appendices 25-41, found ${specialistFiles.length}`);
    const specialistRecords = specialistFiles.flatMap((name) => parseSpecialist(convert(path.join(sourceDir, name), path.join(temp, `${name}.md`)), path.join(sourceDir, name)));
    if (book4Records.length !== EXPECTED_BOOK4_RECORDS || book4SubjectCount !== EXPECTED_BOOK4_SUBJECTS) {
      throw new Error(`별책4 예상 통계 불일치: standards=${book4Records.length}, subjects=${book4SubjectCount}`);
    }
    if (specialistRecords.length !== EXPECTED_SPECIALIST_RECORDS) {
      throw new Error(`별책25~41 예상 통계 불일치: ${specialistRecords.length}`);
    }
    let book5Matched = 0;
    if (referenceBook5) {
      if (!fs.existsSync(referenceBook5)) throw new Error(`Missing ${referenceBook5}`);
      book5Matched = verifyBook5Reference(
        book4Records,
        parseBook4(convert(referenceBook5, path.join(temp, 'book5.md')))
      );
    }
    const enriched = enrich([...loadExisting(existing), ...book4Records, ...specialistRecords]);
    // Some 전문교과Ⅱ volumes repeat a common course verbatim.  It is one
    // standard in the runtime catalog, not a collision; keep first source in
    // deterministic appendix order.
    const all = [...new Map(enriched.map((row) => [row.standardKey, row])).values()];
    fs.writeFileSync(output, render(all), 'utf8');
    const countBy = (rows, field) => Object.fromEntries([...new Map(rows.map((row) => [row[field], 0])).keys()].sort((a, b) => String(a).localeCompare(String(b), 'ko')).map((key) => [key, rows.filter((row) => row[field] === key).length]));
    console.log(JSON.stringify({ output, book4: book4Records.length, book4ByTrack: countBy(book4Records, 'track'), book4Subjects: countBy(book4Records, 'subject'), book5Matched, specialist: specialistRecords.length, specialistBySource: countBy(specialistRecords, 'source'), duplicatesRemoved: enriched.length - all.length, total: all.length, 2015: all.filter((row) => row.curriculumRevision === '2015').length, 2022: all.filter((row) => row.curriculumRevision === '2022').length }, null, 2));
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}

if (require.main === module) {
  const root = process.argv[2] || 'D:\\2015 개정 교육과정';
  build({ sourceDir: root, existing: path.resolve(__dirname, '..', 'StandardsData.gs'), output: path.resolve(__dirname, '..', 'StandardsData.gs'), referenceBook5: process.argv[3] || '' });
}
module.exports = { parseBook4, parseSpecialist, loadExisting, verifyBook5Reference, enrich, subjectKey, standardKey, build };
