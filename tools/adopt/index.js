#!/usr/bin/env node
/**
 * `adoptSection` 마이그레이터 CLI — M1 오프라인 도구 (계획 §10.1).
 *
 * 이 파일이 **이 도구에서 파일 시스템을 만지는 유일한 곳**이다. 코어(`core.js`)와
 * 매핑·id·splice 모듈은 `fs`를 import하지 않는다. 계획 §10.1의 감시 지표
 * ("`tools/adopt`가 `writeSpliced` 외의 파일 쓰기 API를 호출하는지 CI grep")가
 * 겨냥하는 표면을 한 파일로 좁혀 두기 위해서다.
 *
 * 사용:
 *   node tools/adopt/index.js <file> [옵션]
 *
 *   --section=N   N번째 섹션만 주석한다 (1-based)
 *   --out=PATH    결과를 새 파일로 쓴다
 *   --write       원본을 덮어쓴다 (이 플래그가 있을 때만)
 *   --json        기계 판독용 리포트를 stdout으로 낸다
 *   --report=PATH 리포트를 파일로 쓴다
 *   --info        info 등급 항목(잔여 클래스 등)도 보고에 포함한다
 *   --context=N   diff 컨텍스트 행 수 (기본 2)
 *
 * 기본 동작은 **dry-run**이다 — `--out`도 `--write`도 없으면 파일을 만들지 않는다.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { adoptDocument } from './core.js';
import { applyEdits } from './splice.js';
import { unifiedDiff, renderFindings, renderAnnotations } from './report.js';

const USAGE = `사용: node tools/adopt/index.js <file> [--section=N] [--out=PATH | --write]
                                  [--json] [--report=PATH] [--info] [--context=N]

기본은 dry-run이다. --out 없이 --write 없이는 어떤 파일도 만들지 않는다.
원본 덮어쓰기는 --write가 있을 때만 일어난다.`;

export function parseArgs(argv) {
  const opts = { info: false, json: false, context: 2 };
  const positional = [];
  for (const arg of argv) {
    if (!arg.startsWith('--')) { positional.push(arg); continue; }
    const [key, value] = arg.slice(2).split(/=(.*)/s);
    switch (key) {
      case 'section': opts.section = Number(value); break;
      case 'out': opts.out = value; break;
      case 'write': opts.write = true; break;
      case 'json': opts.json = true; break;
      case 'report': opts.report = value; break;
      case 'info': opts.info = true; break;
      case 'dry-run': opts.dryRun = true; break;
      case 'context': opts.context = Number(value); break;
      case 'help': opts.help = true; break;
      default: throw new Error(`알 수 없는 옵션: --${key}`);
    }
  }
  opts.file = positional[0];
  if (opts.section !== undefined && (!Number.isInteger(opts.section) || opts.section < 1)) {
    throw new Error('--section은 1 이상의 정수여야 합니다 (1-based).');
  }
  if (opts.write && opts.out) {
    throw new Error('--write와 --out은 함께 쓸 수 없습니다. 덮어쓸지 새 파일로 낼지 하나만 고르세요.');
  }
  if (opts.write && opts.dryRun) {
    throw new Error('--write와 --dry-run은 함께 쓸 수 없습니다.');
  }
  return opts;
}

export function run(opts) {
  const file = resolve(opts.file);
  if (!existsSync(file)) throw new Error(`파일이 없습니다: ${opts.file}`);
  const source = readFileSync(file, 'utf8');

  const result = adoptDocument(source, { section: opts.section });
  const output = applyEdits(source, result.edits);
  const diff = unifiedDiff(source, output, {
    context: opts.context,
    pathA: `${opts.file} (원본)`,
    pathB: `${opts.file} (adopt)`,
  });

  const needHuman = result.findings.filter((f) => f.needsHuman);
  const report = {
    file: opts.file,
    sectionCount: result.sectionCount,
    adoptedSections: result.adoptedSections,
    annotations: result.annotations,
    issuedIds: result.issuedIds,
    findings: result.findings,
    summary: {
      annotated: result.annotations.length,
      issuedIds: result.issuedIds.length,
      edits: result.edits.length,
      needsHuman: needHuman.length,
      bytesBefore: Buffer.byteLength(source),
      bytesAfter: Buffer.byteLength(output),
    },
  };

  let written = null;
  if (opts.write) { writeFileSync(file, output); written = file; }
  else if (opts.out) { writeFileSync(resolve(opts.out), output); written = resolve(opts.out); }

  if (opts.report) writeFileSync(resolve(opts.report), `${JSON.stringify(report, null, 2)}\n`);

  return { source, output, diff, report, written, findings: result.findings };
}

function main(argv) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`${err.message}\n\n${USAGE}\n`);
    return 2;
  }
  if (opts.help || !opts.file) {
    process.stdout.write(`${USAGE}\n`);
    return opts.help ? 0 : 2;
  }

  let out;
  try {
    out = run(opts);
  } catch (err) {
    process.stderr.write(`실패: ${err.message}\n`);
    return 1;
  }

  if (opts.json) {
    process.stdout.write(`${JSON.stringify(out.report, null, 2)}\n`);
  } else {
    const { summary } = out.report;
    process.stdout.write(`# adopt — ${basename(opts.file)}\n`);
    process.stdout.write(
      `섹션 ${out.report.sectionCount}개 중 ${out.report.adoptedSections.length}개 대상 · `
      + `편집 ${summary.edits}건 · id 발급 ${summary.issuedIds}개 · `
      + `사람 판단 ${summary.needsHuman}건\n\n`,
    );
    process.stdout.write(`${renderAnnotations(out.report.annotations)}\n`);
    process.stdout.write(`${renderFindings(out.findings, { file: opts.file, showInfo: opts.info })}\n`);
    process.stdout.write(out.diff || '(변경 없음)\n');
    if (out.written) process.stdout.write(`\n쓰기: ${out.written}\n`);
    else process.stdout.write('\ndry-run — 파일을 쓰지 않았습니다. 적용하려면 --out=PATH, 원본 덮어쓰기는 --write.\n');
  }

  // 사람 판단이 남아 있으면 종료 코드 3 — 하네스가 "자동 부여만으로는 안 끝났다"를 읽는다
  return out.report.summary.needsHuman > 0 ? 3 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = main(process.argv.slice(2));
}

export { main, USAGE };
