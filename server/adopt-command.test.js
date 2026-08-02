// node --test server/adopt-command.test.js
//
// M3-9 (결정 9) — "잠그기만 하고 방법을 안 주면 나갈 문이 없다".
//
// 이 파일이 재는 것은 이름표 판정이 아니라 **파이프라인 통합**이다. 판정 자체는
// `tools/adopt/adopt.test.js` 가 이미 재고 있고, 여기서 다시 재면 같은 것을 두 번
// 쓰는 셈이다. 여기서 재는 것은 그 판정이 커밋으로 나갈 때 낙관적 락·되돌리기·
// 멱등이 다른 명령과 **똑같이** 걸리는가다 — 마이그레이션에 옆문을 내지 않았다는 것.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { hashOf } from '../tools/harness/splice.js';

const REPO = process.cwd();
const DECK = '2026-08-01-adopt';

// 이름표가 하나도 없는 문서. 실제 W30 리포트가 이 상태였다.
const RAW = `<!DOCTYPE html>
<html lang="ko">
<head><meta charset="utf-8"></head>
<body>
<section class="slide slide--title dark" data-label="표지">
  <h1 class="report-hero">주간 보고</h1>
</section>
<section class="slide" data-label="본문">
  <div class="slide-body">
    <div class="stack"><p>첫째</p></div>
  </div>
</section>
</body>
</html>
`;

let sandbox;

before(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'deck-adopt-'));
  process.chdir(sandbox);
});

after(() => {
  process.chdir(REPO);
  rmSync(sandbox, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(join(sandbox, '_workspace', DECK), { recursive: true, force: true });
  mkdirSync(join(sandbox, '_workspace', DECK), { recursive: true });
  writeFileSync(join(sandbox, '_workspace', DECK, 'index.html'), RAW, 'utf8');
});

const file = () => join(sandbox, '_workspace', DECK, 'index.html');
const onDisk = () => readFileSync(file(), 'utf8');

// 멱등 캐시는 (덱, commitId) 로 기억하고 테스트 사이에 지워지지 않는다 — 그게 제 일이다.
// 그래서 키를 돌려 쓰면 두 번째 테스트가 첫 번째의 재생을 받아 `applied:false` 가 된다.
// 멱등을 **일부러** 재는 테스트만 키를 고정한다.
let seq = 0;
const commit = async (command, commitId = `auto-${++seq}`) => {
  const { applyCommit } = await import('./commit.js');
  return applyCommit(DECK, {
    commitId,
    pre: { docHash: hashOf(onDisk()) },
    commands: [command],
  });
};

/* --------------------------------------------------------- 이름표 붙이기 */

test('한 장만 고르면 그 장에만 이름표가 붙는다', async () => {
  const r = await commit({ op: 'adoptSlide', args: { section: 1 } });
  assert.equal(r.applied, true);

  const after = onDisk();
  const sections = after.split('<section');
  assert.match(sections[1], /data-slide/, '고른 장에는 이름표가 붙는다');
  assert.doesNotMatch(sections[2], /data-slide/, '고르지 않은 장은 그대로 둔다');
});

test('장을 고르지 않으면 문서 전체에 붙는다', async () => {
  await commit({ op: 'adoptSlide', args: {} });
  const after = onDisk();
  // `\b` 로 세면 안 된다 — `data-slide-kind` 가 하이픈에서 경계로 걸려 같이 세어진다.
  assert.equal((after.match(/data-slide(?![\w-])/g) ?? []).length, 2);
});

test('첫 장을 고치면 문서 수준 선언도 함께 붙는다', async () => {
  // 이것이 붙어야 덱이 "편집 가능" 으로 바뀐다 — 목록 화면이 그 속성을 본다.
  await commit({ op: 'adoptSlide', args: { section: 1 } });
  assert.match(onDisk(), /<html data-deck-grammar="v1"/);
});

test('자동으로 판단이 안 된 곳을 진단으로 돌려준다', async () => {
  // 결정 9 — "자동으로 판단이 안 되는 곳만 따로 보여준다". 이 응답이 그 화면의 근거다.
  const r = await commit({ op: 'adoptSlide', args: { section: 1 } });
  assert.ok(Array.isArray(r.diagnostics));
  for (const d of r.diagnostics) {
    // 줄 번호가 없으면 사용자가 손으로 고칠 자리를 찾을 방법이 없다.
    assert.ok(Number.isInteger(d.line) && d.line > 0, JSON.stringify(d));
    assert.ok(d.remedy, '무엇을 해야 하는지 없이 위치만 주면 나갈 문이 아니다');
  }
});

/* ------------------------------------------------------------- 통합 계약 */

test('되돌리기가 원본 바이트를 그대로 되살린다', async () => {
  const before = onDisk();
  await commit({ op: 'adoptSlide', args: { section: 1 } });
  assert.notEqual(onDisk(), before);

  const { applyUndo } = await import('./commit.js');
  applyUndo(DECK);
  // 결정 9 의 핵심 요구다. "비슷하게" 가 아니라 **바이트가 같아야** 한다 —
  // 되돌린 문서가 원본과 다르면 사용자는 무엇을 되돌린 것인지 알 수 없다.
  assert.equal(onDisk(), before);
});

test('낙관적 락이 걸린다 — 그 사이 파일이 바뀌었으면 409', async () => {
  const { applyCommit } = await import('./commit.js');
  const { DocError } = await import('./doc.js');

  assert.throws(
    () => applyCommit(DECK, {
      commitId: 'stale',
      pre: { docHash: 'sha256:없는해시' },
      commands: [{ op: 'adoptSlide', args: { section: 1 } }],
    }),
    (err) => err instanceof DocError && err.status === 409,
  );
  assert.equal(onDisk(), RAW, '거부된 커밋은 파일을 건드리지 않는다');
});

test('같은 commitId 로 두 번 보내도 파일은 한 번만 바뀐다', async () => {
  const { applyCommit } = await import('./commit.js');
  const envelope = {
    commitId: 'twice',
    pre: { docHash: hashOf(RAW) },
    commands: [{ op: 'adoptSlide', args: { section: 1 } }],
  };
  const first = applyCommit(DECK, envelope);
  const afterFirst = onDisk();

  // 버튼을 두 번 눌렀을 때 이름표가 두 겹으로 붙지 않는다는 뜻이다.
  const second = applyCommit(DECK, envelope);
  assert.equal(first.applied, true);
  assert.equal(second.applied, false);
  assert.equal(onDisk(), afterFirst);
});

test('두 번째로 같은 장을 고치면 붙일 것이 없다 (멱등)', async () => {
  await commit({ op: 'adoptSlide', args: { section: 1 } }, 'first');
  const afterFirst = onDisk();

  const again = await commit({ op: 'adoptSlide', args: { section: 1 } }, 'second');
  assert.equal(again.applied, false, '붙일 이름표가 없으면 쓰지 않는다');
  assert.equal(onDisk(), afterFirst);
});

test('없는 장을 고르면 400 이고 파일은 그대로다', async () => {
  const { DocError } = await import('./doc.js');
  for (const section of [0, 9, 1.5, 'first']) {
    await assert.rejects(
      async () => commit({ op: 'adoptSlide', args: { section } }, `bad-${section}`),
      (err) => err instanceof DocError && err.status === 400,
      `section=${JSON.stringify(section)}`,
    );
  }
  assert.equal(onDisk(), RAW);
});

test('고친 장은 목차에서 고를 수 있는 장이 된다', async () => {
  // 화면이 잠금을 푸는 근거는 목차의 `annotated` 다. 커밋이 그것을 실제로 바꾸는지
  // 확인하지 않으면, 파일은 고쳐졌는데 화면은 계속 잠긴 채인 상태를 놓친다.
  const { loadDeck } = await import('./doc.js');
  const { outlineOf } = await import('./outline.js');

  assert.deepEqual(outlineOf(loadDeck(DECK)).sections.map((s) => s.annotated), [false, false]);
  await commit({ op: 'adoptSlide', args: { section: 1 } });
  assert.deepEqual(outlineOf(loadDeck(DECK)).sections.map((s) => s.annotated), [true, false]);
});
