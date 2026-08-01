// node --test server/history.test.js
//
// 계획 §11 M2 수용 기준 2·3·7·8·18:
//   2  — 같은 commitId 2회 → {applied:false} + 같은 resultHash, 파일 두 번 안 변함
//   3  — commitId 리플레이가 undo 이후 도착 → superseded:true
//   7  — 편집 100회 후 undo 100회 → 원본 바이트 동일
//   8  — redo 링이 비어 있지 않은 상태에서 새 편집 → redo 링 비워짐
//   18 — reserveSections(3) 병렬 채움 → data-node-id 충돌 0

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { hashOf } from '../tools/harness/splice.js';

const REPO = process.cwd();
const DECK = '2026-08-01-history';

const HTML = `<!DOCTYPE html>
<html data-deck-grammar="v1" lang="ko">
<head><meta charset="utf-8"></head>
<body>
<section data-slide data-variant="default" data-slide-kind="content" data-node-id="n1" class="slide">
  <div data-box="region" data-region="body" data-node-id="n2" class="slide-body">
    <p data-el="text" data-node-id="n3">본문</p>
  </div>
</section>
</body>
</html>
`;

let sandbox;

before(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'deck-history-'));
  process.chdir(sandbox);
});

after(() => {
  process.chdir(REPO);
  rmSync(sandbox, { recursive: true, force: true });
});

beforeEach(async () => {
  rmSync(join(sandbox, '_workspace', DECK), { recursive: true, force: true });
  mkdirSync(join(sandbox, '_workspace', DECK), { recursive: true });
  writeFileSync(join(sandbox, '_workspace', DECK, 'index.html'), HTML, 'utf8');
  const { _reset } = await import('./idempotency.js');
  _reset(DECK);
});

const file = () => join(sandbox, '_workspace', DECK, 'index.html');
const onDisk = () => readFileSync(file(), 'utf8');

const api = async () => ({ ...(await import('./commit.js')), ...(await import('./history.js')) });

function edit(applyCommit, text, commitId = `c${Math.random()}`) {
  return applyCommit(DECK, {
    commitId,
    label: `본문을 ${text} 로`,
    pre: { docHash: hashOf(onDisk()) },
    commands: [{ op: 'setContent', target: 'n3', args: { html: text } }],
  });
}

/* --------------------------------------------------------------- 기준 2 */

test('기준 2 — 같은 commitId 2회 → 두 번째는 applied:false, 파일 불변', async () => {
  const { applyCommit } = await api();
  const first = edit(applyCommit, '한번', 'dup-1');
  assert.equal(first.applied, true);
  const afterFirst = onDisk();

  const second = applyCommit(DECK, {
    commitId: 'dup-1',
    pre: { docHash: hashOf(HTML) },   // 재시도이므로 클라이언트는 여전히 옛 해시를 들고 있다
    commands: [{ op: 'setContent', target: 'n3', args: { html: '한번' } }],
  });

  assert.equal(second.applied, false, '두 번째는 쓰지 않는다');
  assert.equal(second.resultHash, first.resultHash, '같은 resultHash 를 돌려준다');
  assert.equal(onDisk(), afterFirst, '파일이 두 번 변하면 안 된다');
});

test('기준 2 — 멱등 조회가 낙관적 락보다 먼저다 (가짜 충돌 방지)', async () => {
  const { applyCommit } = await api();
  edit(applyCommit, '한번', 'order-1');
  // 옛 해시를 들고 재시도해도 409 가 아니라 멱등 응답이어야 한다.
  const retry = applyCommit(DECK, {
    commitId: 'order-1',
    pre: { docHash: hashOf(HTML) },
    commands: [{ op: 'setContent', target: 'n3', args: { html: '한번' } }],
  });
  assert.equal(retry.applied, false);
});

/* --------------------------------------------------------------- 기준 3 */

test('기준 3 — undo 이후 도착한 리플레이는 superseded:true 다 (Architect A1)', async () => {
  const { applyCommit, applyUndo } = await api();

  const c1 = edit(applyCommit, '적용됨', 'late-1');   // 1. 적용. 응답이 유실됐다고 하자
  applyUndo(DECK);                                    // 2. 사용자가 undo

  const replay = applyCommit(DECK, {                  // 3. 지연됐던 재시도 도착
    commitId: 'late-1',
    pre: { docHash: hashOf(HTML) },
    commands: [{ op: 'setContent', target: 'n3', args: { html: '적용됨' } }],
  });

  assert.equal(replay.applied, false);
  assert.equal(replay.resultHash, c1.resultHash);
  assert.equal(replay.currentHash, hashOf(onDisk()));
  assert.notEqual(replay.resultHash, replay.currentHash);
  assert.equal(replay.superseded, true, '가짜 성공이 되면 미러와 디스크가 조용히 갈라진다');
});

/* --------------------------------------------------------------- 기준 7 */

test('기준 7 — 편집 100회 후 undo 100회 → 원본 바이트 동일', async () => {
  const { applyCommit, applyUndo, depth } = await api();

  for (let i = 0; i < 100; i++) edit(applyCommit, `본문 ${i}`, `e${i}`);
  assert.equal(depth(DECK, 'edit'), 100);
  assert.notEqual(onDisk(), HTML);

  for (let i = 0; i < 100; i++) applyUndo(DECK);

  assert.equal(onDisk(), HTML, '100회 되돌리면 원본 바이트여야 한다');
  assert.equal(depth(DECK, 'edit'), 0);
  assert.equal(depth(DECK, 'redo'), 100, 'undo 스냅샷은 edit 링을 소모하지 않는다 (A2)');
});

test('기준 7 — redo 100회로 다시 앞으로 갈 수 있다 (두 방향 대칭)', async () => {
  const { applyCommit, applyUndo, applyRedo } = await api();

  for (let i = 0; i < 100; i++) edit(applyCommit, `본문 ${i}`, `r${i}`);
  const tip = onDisk();

  for (let i = 0; i < 100; i++) applyUndo(DECK);
  assert.equal(onDisk(), HTML);

  for (let i = 0; i < 100; i++) applyRedo(DECK);
  assert.equal(onDisk(), tip);
});

test('빈 링에 undo·redo 를 걸면 409 이고 파일은 바뀌지 않는다', async () => {
  const { applyUndo, applyRedo } = await api();
  assert.throws(() => applyUndo(DECK), (e) => e.status === 409 && e.code === 'commit.edit-empty');
  assert.throws(() => applyRedo(DECK), (e) => e.status === 409 && e.code === 'commit.redo-empty');
  assert.equal(onDisk(), HTML);
});

/* --------------------------------------------------------------- 기준 8 */

test('기준 8 — redo 링이 찬 상태에서 새 편집을 하면 redo 링이 비워진다', async () => {
  const { applyCommit, applyUndo, depth } = await api();

  edit(applyCommit, '첫째', 'k1');
  edit(applyCommit, '둘째', 'k2');
  applyUndo(DECK);
  assert.equal(depth(DECK, 'redo'), 1);

  edit(applyCommit, '다른 갈래', 'k3');
  assert.equal(depth(DECK, 'redo'), 0, '이어지지 않는 두 역사가 남으면 안 된다 (§3.4 커서 모델)');
});

/* --------------------------------------------------------------- 링 크기 */

test('링은 RING_SIZE 를 넘지 않고 가장 오래된 것을 버린다', async () => {
  const { applyCommit, depth, RING_SIZE } = await api();
  for (let i = 0; i < RING_SIZE + 5; i++) edit(applyCommit, `본문 ${i}`, `big${i}`);
  assert.equal(depth(DECK, 'edit'), RING_SIZE);
});

/* -------------------------------------------------------------- 기준 18 */

test('기준 18 — reserveSections(3) 이 충돌 없는 id 를 발급한다', async () => {
  const { applyCommit } = await api();
  const r = applyCommit(DECK, {
    commitId: 'res-1',
    pre: { docHash: hashOf(onDisk()) },
    commands: [{ op: 'reserveSections', args: { n: 3, templateId: 'blockers' } }],
  });

  assert.equal(r.applied, true);
  assert.equal(Object.keys(r.nodeIds).length, 3);

  const after = onDisk();
  const ids = [...after.matchAll(/data-node-id="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, `id 충돌: ${ids.length - new Set(ids).size} 건`);
  assert.equal((after.match(/<section data-slide/g) ?? []).length, 4, '원본 1 + 예약 3');
});

test('기준 18 — 병렬 요청에서도 id 충돌이 0 이다 (문서 락)', async () => {
  const { applyCommit } = await api();

  // 같은 프로세스에서 동시에 던진다. 발급과 쓰기 사이에 await 가 없으므로 직렬화된다.
  const results = await Promise.allSettled(
    [0, 1, 2].map((i) => Promise.resolve().then(() => applyCommit(DECK, {
      commitId: `par-${i}`,
      pre: { docHash: hashOf(onDisk()) },
      commands: [{ op: 'reserveSections', args: { n: 3, templateId: 'blockers' } }],
    }))),
  );

  const applied = results.filter((r) => r.status === 'fulfilled' && r.value.applied);
  assert.ok(applied.length >= 1, '적어도 하나는 적용되어야 한다');
  // 나머지는 409(낙관적 락)로 거부된다 — 그것이 정상이다. 조용히 덮어쓰는 것이 사고다.
  for (const r of results) {
    if (r.status === 'rejected') assert.equal(r.reason.status, 409, r.reason.message);
  }

  const ids = [...onDisk().matchAll(/data-node-id="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, 'data-node-id 충돌 0건이어야 한다');
});

test('reserveSections 는 경로가 든 templateId 를 거부한다', async () => {
  const { applyCommit } = await api();
  for (const templateId of ['../../etc/passwd', 'a/b', '..']) {
    assert.throws(() => applyCommit(DECK, {
      commitId: `bad-${templateId}`,
      pre: { docHash: hashOf(onDisk()) },
      commands: [{ op: 'reserveSections', args: { n: 1, templateId } }],
    }), (e) => e.status === 403 || e.status === 404, templateId);
  }
  assert.equal(onDisk(), HTML);
});

/* ------------------------------------------------------------- 스냅샷 위치 */

test('스냅샷은 _workspace/<deck>/.history/{edit,redo}/ 안에 쌓인다', async () => {
  const { applyCommit } = await api();
  edit(applyCommit, '한번', 'loc-1');
  const { readdirSync } = await import('node:fs');
  const dir = join(sandbox, '_workspace', DECK, '.history', 'edit');
  const files = readdirSync(dir);
  assert.equal(files.length, 1);
  assert.match(files[0], /^\d{8}-.*\.html$/, '순번 접두사가 있어야 정렬이 곧 시간순이다');
  assert.equal(readFileSync(join(dir, files[0]), 'utf8'), HTML, '커밋 **직전** 바이트여야 한다');
});
