'use strict';

const assert = require('assert');
const { parseMarkdown } = require('./scripts/build-standards');
const {
  parseBook4,
  parseSpecialist,
  loadExisting,
  subjectKey,
  standardKey,
  verifyBook5Reference,
} = require('./scripts/build-standards-2015');

function parse(markdown, name = '[별책5] 국어과 교육과정.hwp') {
  return parseMarkdown(markdown, { name }).records;
}

const elementary = parse('# 바른 생활\n\n### 2. 내용 체계 및 성취기준\n\n<td>[2바01-01] 첫 기준.<br>[2바01-02] 둘째 기준.</td>');
assert.deepStrictEqual(elementary.map((row) => row.code), ['[2바01-01]', '[2바01-02]']);
assert(elementary.every((row) => row.subject === '바른 생활' && row.schoolLevel === 'elementary'));

const middle = parse('# 국어\n\n나. 성취기준\n\n[9국01-01] 화자의 의도와 관점을 추론한다.');
assert.strictEqual(middle[0].schoolLevel, 'middle');

const high = parse('# 공통국어1\n\n2. 내용 체계 및 성취기준\n\n[10공국1-01-01] 핵심 내용을 이해한다.');
assert.strictEqual(high[0].schoolLevel, 'high');

const specialist = parse('# 전기 일반\n\n나. 성취기준\n\n[전일 01-01] 전기의 원리를 설명한다.', '[별책34] 전기·전자 전문 교과 교육과정.hwp');
assert.strictEqual(specialist[0].track, '전기·전자');
assert.strictEqual(specialist[0].schoolLevel, 'high');

const explanation = parse('# 국어\n\n나. 성취기준\n\n[9국01-01] 기준 문장.\n\n(가) 성취기준 해설\n\n• [9국01-01] 해설 문장.');
assert.strictEqual(explanation.length, 1);

const pipe = parse('# 수학\n\n나. 성취기준\n\n| 기준 | 내용 |\n| --- | --- |\n| [6수01-01] 수를 이해한다. | [6수01-02] 계산한다. |');
assert.deepStrictEqual(pipe.map((row) => row.code), ['[6수01-01]', '[6수01-02]']);

const book4 = parseBook4([
  '# 윤리와 사상',
  '[윤사01-01] 인간에 대한 관점을 비교한다.',
  '- [윤사01-01] 해설에서 다시 인용한다.',
  '# 고전과 윤리',
  '[고윤01-01] 뜻을 세우고 실천한다.',
].join('\n'));
assert.strictEqual(book4.length, 2);
assert(book4.every((row) => row.track === '보통교과'));

const specialist2015 = parseSpecialist([
  '# 기계 제도',
  '나. 영역별 성취기준',
  '1) 도면 이해',
  '• 도면의 기본 원리를 설명할 수 있다.',
  '다. 교수･학습 방법 및 유의 사항',
  '• 이 문장은 성취기준이 아니다.',
].join('\n'), '별책31_기계 전문 교과 교육과정(2018-150호).hwp');
assert.strictEqual(specialist2015.length, 1);
assert.strictEqual(specialist2015[0].code, '');
assert.strictEqual(specialist2015[0].domain, '도면 이해');

const sameName2015 = { curriculumRevision:'2015', schoolLevel:'high', track:'보통교과', subject:'국어' };
const sameName2022 = { ...sameName2015, curriculumRevision:'2022' };
assert.notStrictEqual(subjectKey(sameName2015), subjectKey(sameName2022));
const keyRecord = { ...sameName2015, subjectKey:subjectKey(sameName2015), domain:'읽기', code:'', text:'글을 읽는다.' };
assert.strictEqual(standardKey(keyRecord), standardKey({ ...keyRecord }));

const reference = Array.from({ length:136 }, (_, index) => ({
  subject:'국어', code:`[10국${String(index).padStart(3, '0')}-01]`, text:`기준 ${index}`,
}));
assert.strictEqual(verifyBook5Reference(reference, reference), 136);

const existing2022 = loadExisting(require('path').resolve(__dirname, 'StandardsData.gs'));
assert(existing2022.length > 50000);
assert(existing2022.every((row) => row.curriculumRevision === '2022'));

console.log('achievement parser fixtures OK (11)');
