'use strict';

const assert = require('assert');
const { parseMarkdown } = require('./scripts/build-standards');

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

console.log('achievement parser fixtures OK (6)');
