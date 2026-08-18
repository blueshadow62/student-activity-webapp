'use strict';

// Builds the runtime-only Apps Script data from the official curriculum files.
// It deliberately keeps conversion artefacts outside the repository.
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const STANDARD_CODE = /\[([^\]]+)\]\s*([^\[]*?)(?=\s*\[[^\]]+\]|$)/g;
const NORMAL_CODE = /^\d{1,2}[가-힣A-Za-z][가-힣A-Za-z0-9()]*-\d{2}(?:-\d{2})?$/;
const SPECIAL_CODE = /^(?:[가-힣A-Za-z]{2,}|\d+[가-힣A-Za-z]+)\s+\d{2}-\d{2}(?:-\d{2})?$/;
const CODE_LIKE = /\[[^\]]*(?:\d{2}-\d{2})[^\]]*\]/;

function parseArgs(argv) {
  const options = { input: [], output: path.resolve(__dirname, '..', 'StandardsData.gs') };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--input' || value === '-i') options.input.push(argv[++index]);
    else if (value === '--output' || value === '-o') options.output = argv[++index];
    else if (value === '--help' || value === '-h') {
      console.log('Usage: node scripts/build-standards.js --input <curriculum-dir> [--output <StandardsData.gs>]');
      process.exit(0);
    } else throw new Error(`Unknown argument: ${value}`);
  }
  if (!options.input.length) throw new Error('--input is required.');
  return options;
}

function normalize(text) {
  return text.replace(/\r/g, '').replace(/^#{1,6}\s+/, '').replace(/[\t ]+/g, ' ').trim();
}

function schoolLevelForCode(code) {
  if (SPECIAL_CODE.test(code)) return 'high';
  if (/^(?:2|4|6)/.test(code)) return 'elementary';
  if (/^9/.test(code)) return 'middle';
  return 'high';
}

function trackFor(fileName) {
  if (!/별책\s*(?:2[3-9]|3\d)\D/.test(fileName)) return '보통교과';
  const match = fileName.match(/\]\s*([^\]]+?)\s*(?:선택 )?(?:과목|교과) 교육과정/);
  if (!match || /초등학교|중학교|고등학교/.test(match[1])) return '보통교과';
  return normalize(match[1]).replace(/\s*전문$/, '');
}

function isStandardCode(code) {
  return NORMAL_CODE.test(code) || SPECIAL_CODE.test(code);
}

function abbreviationFor(code) {
  if (SPECIAL_CODE.test(code)) return code.split(/\s+/)[0];
  return code.replace(/^\d{1,2}/, '').replace(/-\d{2}(?:-\d{2})?$/, '');
}

function cleanSubject(value) {
  return normalize(value)
    .replace(/^\(?\d+\)?[.)]\s*/, '')
    .replace(/\s*(?:과)? 교육과정$/, '')
    .replace(/과$/, '')
    .trim();
}

function subjectFromTopLevelHeading(line) {
  const value = cleanSubject(line).replace(/^[-–—]\s*|\s*[-–—]$/g, '').trim();
  if (
    !value
      || value.length > 70
      || /^(?:차\s*례|공통 교육과정|선택 중심 교육과정|공통 과목|일반 선택 과목|진로 선택 과목|융합 선택 과목)$/
        .test(value)
      || /성취기준|내용 체계|교수.?학습|평가|총론|편성|운영|교육 환경 조성|설계의 개요/
        .test(value)
  ) return null;
  return value.length > 1 ? value : null;
}

function domainFromHeading(line) {
  const value = normalize(line).replace(/^\(?[가-힣]\)?[.)]\s*/, '').replace(/^\(?\d+\)?[.)]\s*/, '');
  if (!value || value.length > 60 || /성취기준|내용 체계|해설|고려 사항|학년/.test(value)) return null;
  return value;
}

function subjectForCode(subject, code) {
  const candidates = String(subject || '').split(/\s*,\s*/).filter(Boolean);
  if (candidates.length < 2) return subject;
  const abbreviation = abbreviationFor(code);
  const numberSuffix = abbreviation.match(/(\d+)$/)?.[1] || '';
  const byNumber = numberSuffix
    ? candidates.find((candidate) => candidate.endsWith(numberSuffix))
    : null;
  if (byNumber) return byNumber;
  const byInitial = candidates.filter((candidate) => candidate[0] === abbreviation[0]);
  return byInitial.length === 1 ? byInitial[0] : subject;
}

function parseMarkdown(markdown, source) {
  const track = trackFor(source.name);
  const lines = markdown.split('\n');
  const records = [];
  const unparsed = [];
  const diagnostics = { rawCodes: 0, unsupportedCode: 0, outsideStandards: 0, emptyText: 0, missingSubject: 0, accepted: 0 };
  let subject = null;
  let domain = '';
  let inStandards = false;
  let inPrimaryStandards = false;

  for (const rawLine of lines) {
    const markdownHeading = rawLine.match(/^(#{1,6})\s+(.+)$/);
    const isBullet = /^\s*(?:[-*•]|\d+[.)])\s+\[/.test(rawLine);
    const codeStartsParagraph = /^\s*(?:(?:<[^>]+>|\|)\s*)*\[/.test(rawLine);
    const line = normalize(rawLine.replace(/^\s*>\s*/, ''));
    if (!line || /^!\[image\]|^<\/?table/.test(line)) continue;
    if (markdownHeading && markdownHeading[1].length === 1) {
      const candidate = subjectFromTopLevelHeading(markdownHeading[2]);
      if (candidate) {
        subject = candidate;
        domain = '';
        inStandards = false;
        inPrimaryStandards = false;
      }
    }
    if (/^2\.\s*내용 체계 및 성취기준$/.test(line)) {
      inStandards = true;
      inPrimaryStandards = false;
    }
    if (/^나\.\s*성취기준$/.test(line)) {
      inStandards = true;
      inPrimaryStandards = true;
    }
    // HWP/HWPX exports vary the numbering ("(가)", "가.", "1.") but retain
    // these section labels.  Do not treat explanatory re-citations as standards.
    if (/성취기준.*(?:해설|적용 시 고려 사항)/.test(line)) {
      inPrimaryStandards = false;
    }
    if (/^3\.\s*교수.?학습|^(?:[가-하]|\d+)[.)]\s*(?:교수.?학습|평가)/.test(line)) {
      inStandards = false;
      inPrimaryStandards = false;
    }
    if (inStandards && /^(?:\(\d+\)|\d+\))\s*\S+/.test(line)) {
      inPrimaryStandards = true;
    }
    const headingDomain = inStandards && !CODE_LIKE.test(line)
      && /^(?:\(\d+\)|\d+\))\s*\S+/.test(line)
      ? domainFromHeading(line)
      : null;
    if (headingDomain && !CODE_LIKE.test(line)) domain = headingDomain;

    let match;
    STANDARD_CODE.lastIndex = 0;
    while ((match = STANDARD_CODE.exec(line))) {
      const code = normalize(match[1]);
      diagnostics.rawCodes += 1;
      const text = normalize(match[2]
        .replace(/<br\s*\/?\s*>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s*\[[^\]]+\].*$/, ''));
      if (!isStandardCode(code)) {
        diagnostics.unsupportedCode += 1;
        if (inStandards && line.startsWith(match[0]) && /^\d{1,2}[가-힣A-Za-z][가-힣A-Za-z0-9()]*-\d{2}/.test(code)) {
          unparsed.push(`${source.name}: ${match[0]}`);
        }
        continue;
      }
      // 해설은 글머리표 뒤에 코드를 재인용한다. 공식 성취기준 행과 표 셀은
      // 글머리표가 아니며, 영역 전환 뒤에는 별도 '나. 성취기준' 표제가 없다.
      if (
        !inStandards
          || isBullet
          || (
            !inPrimaryStandards
              && !codeStartsParagraph
              && !/<t[dh][^>]*>/i.test(line)
          )
      ) {
        diagnostics.outsideStandards += 1;
        continue;
      }
      if (!text) { diagnostics.emptyText += 1; continue; }
      if (!subject) { diagnostics.missingSubject += 1; continue; }
      records.push({
        code: `[${code}]`,
        subject: subjectForCode(subject, code),
        domain,
        text,
        schoolLevel: schoolLevelForCode(code),
        track,
      });
      diagnostics.accepted += 1;
    }
  }
  return { records, unparsed, diagnostics };
}

function convert(source, tempDir) {
  const output = path.join(tempDir, `${path.basename(source, path.extname(source))}.md`);
  const args = ['--yes', '--package', 'kordoc', '--package', 'pdfjs-dist', 'kordoc', source, '-o', output];
  const quote = (value) => `"${String(value).replace(/"/g, '\\"')}"`;
  const runKordoc = (input) => {
    const command = process.platform === 'win32'
      ? `npx --yes --package kordoc --package pdfjs-dist kordoc ${quote(input)} -o ${quote(output)}`
      : null;
    if (process.platform === 'win32') childProcess.execSync(command, { stdio: 'inherit' });
    else childProcess.execFileSync('npx', [...args.slice(0, -3), input, '-o', output], { stdio: 'inherit' });
  };
  if (process.platform === 'win32') {
    // .cmd launchers cannot be execFileSync-ed by Node on Windows.
    try { runKordoc(source); } catch (error) {
      if (!/\.hwpx$/i.test(source)) throw error;
      // The official high-school HWPX embeds large preview images.  Preserve every
      // XML part but omit BinData in an OS-temp copy, then still parse with kordoc.
      const slim = path.join(tempDir, `text-only-${path.basename(source)}`);
      const ps = path.join(tempDir, 'strip-hwpx-images.ps1');
      fs.writeFileSync(ps, "param([string]$SourcePath,[string]$OutputPath)\n$ErrorActionPreference='Stop'\nAdd-Type -AssemblyName System.IO.Compression.FileSystem\n$src=[System.IO.Compression.ZipFile]::OpenRead($SourcePath); $dst=[System.IO.Compression.ZipFile]::Open($OutputPath,[System.IO.Compression.ZipArchiveMode]::Create)\ntry { foreach($entry in $src.Entries) { if($entry.FullName -match '(^|/)BinData/' -or $entry.FullName -match '(^|/)Preview/') { continue }; $copy=$dst.CreateEntry($entry.FullName,[System.IO.Compression.CompressionLevel]::Optimal); if($entry.Length -gt 0) { $in=$entry.Open(); $out=$copy.Open(); try { $in.CopyTo($out) } finally { $out.Dispose(); $in.Dispose() } } } } finally { $dst.Dispose(); $src.Dispose() }\n", 'utf8');
      childProcess.execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps, source, slim], { stdio: 'inherit' });
      runKordoc(slim);
    }
  } else childProcess.execFileSync('npx', args, { stdio: 'inherit' });
  return fs.readFileSync(output, 'utf8');
}

function stableJson(value) {
  // JSON is embedded in a single-quoted Apps Script string literal.
  return JSON.stringify(value)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function validate(records, unparsed) {
  const codes = new Map();
  const errors = [];
  for (const record of records) {
    const key = `${record.schoolLevel}|${record.code}`;
    if (!codes.has(key)) codes.set(key, []);
    codes.get(key).push(record);
    if (!record.subject) errors.push(`missing subject: ${record.code}`);
    if (!record.text) errors.push(`empty text: ${record.code}`);
  }
  if (unparsed.length) errors.push(`unparsed code-like paragraphs (${unparsed.length}): ${unparsed.slice(0, 5).join('; ')}`);
  for (const level of ['elementary', 'middle', 'high']) {
    if (!records.some((record) => record.schoolLevel === level)) errors.push(`no ${level} standards`);
  }
  if (errors.length) throw new Error(`Standards validation failed:\n${errors.join('\n')}`);
  const codeCollisions = [...codes.values()].filter((items) => items.length > 1);
  return {
    globalCodeCollisions: codeCollisions.length,
    subjectCodeTextCollisions: codeCollisions.filter((items) => new Set(items.map((item) => `${item.subject}\0${item.code}`)).size < items.length).length,
  };
}

// Achievement standards live in one file per school level so Apps Script
// doesn't re-parse all ~29MB of every level on every web app request when
// only one level's data is ever read at a time (see CentralData.gs's
// getBundledStandardsRaw_). STANDARDS_SUBJECTS is small and always needed,
// so it stays in StandardsData.gs.
const LEVEL_FILES = { elementary: 'StandardsData_elementary.gs', middle: 'StandardsData_middle.gs', high: 'StandardsData_high.gs' };
const LEVEL_CONSTANTS = { elementary: 'STANDARDS_DATA_ELEMENTARY', middle: 'STANDARDS_DATA_MIDDLE', high: 'STANDARDS_DATA_HIGH' };

function render(subjects) {
  return [
    '// Generated by scripts/build-standards.js. Do not edit by hand.',
    '// Keep the large payload encoded. Runtime code parses only the configured level',
    '// during installation or an explicit standards reload.',
    `const STANDARDS_SUBJECTS = '${stableJson(subjects)}';`,
    '',
  ].join('\n');
}

function renderLevel(level, records) {
  return [
    '// Generated by scripts/build-standards.js. Do not edit by hand.',
    `const ${LEVEL_CONSTANTS[level]} = '${stableJson(records)}';`,
    '',
  ].join('\n');
}

function build(options) {
  const walk = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);
  const candidates = options.input.flatMap(walk)
    .filter((file) => /\.(hwp|hwpx)$/i.test(file) && /(?:별책\s*|\[\D*)(?:[2-9]|[12]\d|3\d)\D/.test(path.basename(file)))
  const appendixNumber = (file) => Number(path.basename(file).match(/(?:별책\s*|\[\D*)(\d+)/)?.[1]);
  const selected = new Map();
  for (const file of candidates) if (!selected.has(appendixNumber(file))) selected.set(appendixNumber(file), file);
  // 별책2~4는 학교급 총론으로 교과별 별책의 성취기준을 재인용한다.
  // 원문이 중복되거나 개정 시점이 섞이지 않도록 각론 별책5~39만 사용한다.
  const requiredAppendices = Array.from({ length: 35 }, (_, index) => index + 5);
  const missing = requiredAppendices.filter((number) => !selected.has(number));
  if (missing.length) throw new Error(`Missing curriculum appendices: ${missing.join(', ')}`);
  const files = requiredAppendices.map((number) => selected.get(number));
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'achievement-standards-'));
  try {
    const parsed = files.map((file) => {
      const result = parseMarkdown(convert(file, tempDir), { name: path.basename(file) });
      console.error(JSON.stringify({ file: path.basename(file), ...result.diagnostics }));
      return result;
    });
    const rawRecords = parsed.flatMap((result) => result.records);
    const records = [...new Map(rawRecords.map((record) =>
      [[record.schoolLevel, record.track, record.subject, record.domain, record.code, record.text].join('\0'), record],
    )).values()].sort((a, b) =>
      [a.schoolLevel, a.track, a.subject, a.code].join('\0').localeCompare([b.schoolLevel, b.track, b.subject, b.code].join('\0'), 'ko'));
    const collisionStats = validate(records, parsed.flatMap((result) => result.unparsed));
    const subjects = [...new Map(records.map((record) => {
      const value = { name: record.subject, abbreviation: abbreviationFor(record.code.slice(1, -1)), schoolLevel: record.schoolLevel, track: record.track, category: record.track === '보통교과' ? '보통교과' : '전문교과' };
      return [[value.schoolLevel, value.track, value.name].join('\0'), value];
    })).values()].sort((a, b) => [a.schoolLevel, a.track, a.name].join('\0').localeCompare([b.schoolLevel, b.track, b.name].join('\0'), 'ko'));
    const byLevel = Object.fromEntries(['elementary', 'middle', 'high'].map((level) => [level, records.filter((record) => record.schoolLevel === level).map(({ schoolLevel, ...record }) => record)]));
    fs.writeFileSync(options.output, render(subjects), 'utf8');
    const outputDir = path.dirname(options.output);
    for (const level of ['elementary', 'middle', 'high']) {
      fs.writeFileSync(path.join(outputDir, LEVEL_FILES[level]), renderLevel(level, byLevel[level]), 'utf8');
    }
    const highTracks = Object.fromEntries([...new Set(records.filter((record) => record.schoolLevel === 'high').map((record) => record.track))]
      .sort((a, b) => a.localeCompare(b, 'ko')).map((track) => [track, {
        subjects: subjects.filter((subject) => subject.schoolLevel === 'high' && subject.track === track).length,
        standards: records.filter((record) => record.schoolLevel === 'high' && record.track === track).length,
      }]));
    console.log(JSON.stringify({
      output: options.output,
      elementary: byLevel.elementary.length,
      middle: byLevel.middle.length,
      high: byLevel.high.length,
      subjects: Object.fromEntries(['elementary', 'middle', 'high'].map((level) => [level, subjects.filter((subject) => subject.schoolLevel === level).length])),
      highTracks,
      exactDuplicatesRemoved: rawRecords.length - records.length,
      ...collisionStats,
      standardsOver240Chars: records.filter((record) => record.text.length > 240).length,
    }, null, 2));
  } finally { fs.rmSync(tempDir, { recursive: true, force: true }); }
}

if (require.main === module) build(parseArgs(process.argv.slice(2)));
module.exports = { parseMarkdown, build, parseArgs, validate };
