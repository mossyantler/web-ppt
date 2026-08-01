// node --test server/structure-commands.test.js
//
// M2-3 의 핵심 위험은 하나다 — **쓰기 단위가 슬라이드 전체**이므로 섹션 안의 주석·
// CDATA·<pre> 공백이 splice 구간 **안**에 들어온다. P2 의 보호를 받지 못하고
// 규약 G1(어휘 밖 노드의 불투명 보존)이 유일한 방어선이다 (계획 3판 F-5ⓐ).
//
// 그래서 이 파일의 첫 블록이 G1 이고, 나머지가 명령별 동작이다.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { hashOf } from '../tools/harness/splice.js';

const REPO = process.cwd();
const DECK = '2026-08-01-struct';

const HTML = `<!DOCTYPE html>
<html data-deck-grammar="v1" lang="ko">
<head><meta charset="utf-8"></head>
<body>
<section data-slide data-variant="default" data-slide-kind="content" data-node-id="n1" class="slide">
  <!-- @dsCard group="Slides" name="구조 명령 테스트" -->
  <div data-box="region" data-region="body" data-node-id="n2" class="slide-body">
    <div data-box="stack" data-node-id="n3" class="stack">
      <p data-el="text" data-node-id="n4">첫째</p>
      <!-- 형제 사이의 주석. 이동·묶기에서 살아남아야 한다 -->
      <p data-el="text" data-node-id="n5">둘째</p>
      <p data-el="text" data-node-id="n6">셋째</p>
    </div>
    <div data-box="card" data-node-id="n7" class="card">
      <div data-el="heading" data-node-id="n8" class="card-head">제목</div>
    </div>
  </div>
</section>
</body>
</html>
`;

let sandbox;

before(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'deck-struct-'));
  mkdirSync(join(sandbox, '_workspace', DECK), { recursive: true });
  writeFileSync(join(sandbox, '_workspace', DECK, 'index.html'), HTML, 'utf8');
  process.chdir(sandbox);
});

after(() => {
  process.chdir(REPO);
  rmSync(sandbox, { recursive: true, force: true });
});

const file = () => join(sandbox, '_workspace', DECK, 'index.html');
const onDisk = () => readFileSync(file(), 'utf8');
const reset = () => writeFileSync(file(), HTML, 'utf8');

const api = async () => ({ ...(await import('./commit.js')), ...(await import('./doc.js')) });

function run(applyCommit, commands) {
  const raw = onDisk();
  return applyCommit(DECK, { commitId: `c${Math.random()}`, pre: { docHash: hashOf(raw) }, commands });
}

const comments = (s) => [...s.matchAll(/<!--[\s\S]*?-->/g)].map((m) => m[0]);

/* ------------------------------------------------------- 규약 G1 (최우선) */

test('G1 — 슬라이드 재직렬화 뒤에도 섹션 안 주석이 개수·순서·바이트 그대로다', async () => {
  reset();
  const { applyCommit } = await api();
  const before = comments(HTML);
  assert.equal(before.length, 2, '픽스처 전제');

  run(applyCommit, [{ op: 'moveElement', target: 'n6', args: { newParentId: 'n3', index: 0 } }]);

  assert.deepEqual(comments(onDisk()), before, '주석이 사라지거나 바뀌었다');
});

test('G1 — 섹션 밖 바이트는 P2 로 무조건 보존된다', async () => {
  reset();
  const { applyCommit } = await api();
  run(applyCommit, [{ op: 'removeElement', target: 'n6' }]);
  const after = onDisk();
  const head = HTML.slice(0, HTML.indexOf('<section'));
  assert.equal(after.slice(0, head.length), head);
  assert.ok(after.endsWith('</body>\n</html>\n'));
});

test('G1 — 손대지 않은 형제 슬라이드는 바이트 동일하다', async () => {
  const two = HTML.replace('</body>', `<section data-slide data-variant="default" data-slide-kind="content" data-node-id="m1" class="slide">
  <!-- 두 번째 슬라이드의 주석 -->
  <div data-box="region" data-region="body" data-node-id="m2" class="slide-body">
    <p data-el="text" data-node-id="m3">건드리지 않는다</p>
  </div>
</section>
</body>`);
  writeFileSync(file(), two, 'utf8');

  const { applyCommit } = await api();
  run(applyCommit, [{ op: 'removeElement', target: 'n6' }]);

  const after = onDisk();
  const second = two.slice(two.indexOf('<section data-slide data-variant="default" data-slide-kind="content" data-node-id="m1"'));
  assert.ok(after.endsWith(second), '두 번째 슬라이드가 바이트 동일해야 한다');
});

/* -------------------------------------------------------------- 개별 명령 */

test('removeElement — 요소와 그 앞 들여쓰기가 함께 사라진다', async () => {
  reset();
  const { applyCommit } = await api();
  const r = run(applyCommit, [{ op: 'removeElement', target: 'n5' }]);
  assert.equal(r.applied, true);

  const after = onDisk();
  assert.doesNotMatch(after, /data-node-id="n5"/);
  assert.doesNotMatch(after, /\n\s*\n\s*<p data-el="text" data-node-id="n6">/, '빈 줄이 남았다');
  assert.match(after, /data-node-id="n4"/);
  assert.match(after, /data-node-id="n6"/);
});

test('removeElement — region 과 섹션은 거부된다 (투명 컨테이너)', async () => {
  reset();
  const { applyCommit } = await api();
  assert.throws(() => run(applyCommit, [{ op: 'removeElement', target: 'n2' }]),
    (e) => e.status === 422 && e.code === 'commit.transparent-container');
  assert.throws(() => run(applyCommit, [{ op: 'removeElement', target: 'n1' }]),
    (e) => e.status === 422 && e.code === 'commit.wrong-command');
  assert.equal(onDisk(), HTML);
});

test('moveElement — 순서가 바뀌고 들여쓰기가 유지된다', async () => {
  reset();
  const { applyCommit } = await api();
  run(applyCommit, [{ op: 'moveElement', target: 'n6', args: { newParentId: 'n3', index: 0 } }]);

  const after = onDisk();
  const order = [...after.matchAll(/data-node-id="(n[456])"/g)].map((m) => m[1]);
  assert.deepEqual(order, ['n6', 'n4', 'n5']);
  assert.match(after, /\n      <p data-el="text" data-node-id="n6">셋째<\/p>/, '들여쓰기가 형제와 같아야 한다');
});

test('moveElement — 다른 부모로 옮길 수 있고, 자손 안으로는 거부된다', async () => {
  reset();
  const { applyCommit } = await api();
  run(applyCommit, [{ op: 'moveElement', target: 'n4', args: { newParentId: 'n7', index: 1 } }]);
  assert.match(onDisk(), /data-node-id="n8"[\s\S]*data-node-id="n4"/);

  reset();
  assert.throws(() => run(applyCommit, [{ op: 'moveElement', target: 'n3', args: { newParentId: 'n3', index: 0 } }]),
    (e) => e.status === 422 && e.code === 'commit.cyclic-move');
});

test('insertElement — 어휘 안의 종류만 만들고, 새 id 를 응답에 싣는다', async () => {
  reset();
  const { applyCommit } = await api();
  const r = run(applyCommit, [{ op: 'insertElement', args: { parentId: 'n3', index: 1, type: 'text' } }]);

  const issued = Object.values(r.nodeIds);
  assert.equal(issued.length, 1, 'CommitResult.nodeIds 가 발급된 id 를 담아야 한다 (재조정 정책)');
  const after = onDisk();
  assert.match(after, new RegExp(`data-el="text" data-node-id="${issued[0]}"`));
  const order = [...after.matchAll(/data-node-id="(n[a-z0-9]+)"/g)].map((m) => m[1]);
  assert.equal(order[order.indexOf('n4') + 1], issued[0], 'index 1 = 첫 형제 뒤');
});

test('insertElement — 어휘 밖 종류와 미선언 variant 는 422', async () => {
  reset();
  const { applyCommit } = await api();
  assert.throws(() => run(applyCommit, [{ op: 'insertElement', args: { parentId: 'n3', index: 0, type: 'flowStep' } }]),
    (e) => e.status === 422 && e.code === 'commit.unknown-type');
  assert.throws(() => run(applyCommit, [{ op: 'insertElement', args: { parentId: 'n3', index: 0, type: 'text', variant: 'nope' } }]),
    (e) => e.status === 422 && e.code === 'commit.undeclared-variant');
  assert.throws(() => run(applyCommit, [{ op: 'insertElement', args: { parentId: 'n4', index: 0, type: 'text' } }]),
    (e) => e.status === 422 && e.code === 'commit.not-a-container', '리프 안에는 넣을 수 없다');
  assert.equal(onDisk(), HTML);
});

test('duplicateElement — 서브트리의 data-node-id 가 전부 재발급된다 (§4.1)', async () => {
  reset();
  const { applyCommit } = await api();
  const r = run(applyCommit, [{ op: 'duplicateElement', target: 'n7' }]);

  const after = onDisk();
  const ids = [...after.matchAll(/data-node-id="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, 'id 가 중복되면 인덱스가 깨진다');
  assert.ok(r.nodeIds.n7, '원본 id → 새 id 대응이 응답에 있어야 한다');
  assert.ok(r.nodeIds.n8, '자손 id 도 재발급된다');
  assert.equal(after.match(/class="card-head"/g).length, 2);
});

test('wrapElements — 연속 형제를 묶고 사이의 주석을 보존한다', async () => {
  reset();
  const { applyCommit } = await api();
  const r = run(applyCommit, [{ op: 'wrapElements', target: ['n4', 'n5'], args: { boxType: 'card' } }]);

  const after = onDisk();
  assert.ok(r.nodeIds.wrapper);
  assert.match(after, new RegExp(`<div data-box="card" data-node-id="${r.nodeIds.wrapper}" class="card">`));
  assert.deepEqual(comments(after), comments(HTML), '묶인 구간 안의 주석이 사라졌다');
});

test('wrapElements — 부모가 다르면 422 이고 진단이 고칠 명령을 함께 준다 (§3.5)', async () => {
  reset();
  const { applyCommit } = await api();
  try {
    run(applyCommit, [{ op: 'wrapElements', target: ['n4', 'n8'], args: { boxType: 'card' } }]);
    assert.fail('거부되어야 한다');
  } catch (e) {
    assert.equal(e.status, 422);
    assert.equal(e.code, 'grammar.cross-scope-wrap');
    assert.ok(e.fixes?.[0]?.commands?.length, '거부하되 길을 준다');
  }
  assert.equal(onDisk(), HTML);
});

test('wrapElements — 연속하지 않으면 422', async () => {
  reset();
  const { applyCommit } = await api();
  assert.throws(() => run(applyCommit, [{ op: 'wrapElements', target: ['n4', 'n6'], args: { boxType: 'card' } }]),
    (e) => e.status === 422 && e.code === 'commit.not-contiguous');
});

test('unwrapElement — 내부가 원문 그대로 부모로 올라온다', async () => {
  reset();
  const { applyCommit } = await api();
  run(applyCommit, [{ op: 'unwrapElement', target: 'n3' }]);

  const after = onDisk();
  assert.doesNotMatch(after, /data-node-id="n3"/);
  for (const id of ['n4', 'n5', 'n6']) assert.match(after, new RegExp(`data-node-id="${id}"`));
  assert.deepEqual(comments(after), comments(HTML), '벗긴 컨테이너 안의 주석이 사라졌다');
});

test('unwrapElement — region·canvas 와 리프는 거부된다', async () => {
  reset();
  const { applyCommit } = await api();
  assert.throws(() => run(applyCommit, [{ op: 'unwrapElement', target: 'n2' }]),
    (e) => e.status === 422 && e.code === 'commit.transparent-container');
  assert.throws(() => run(applyCommit, [{ op: 'unwrapElement', target: 'n4' }]),
    (e) => e.status === 422 && e.code === 'commit.not-a-container');
});

/* ------------------------------------------------------------ 결과의 재파싱 */

test('구조 명령 뒤에도 문서가 다시 파싱되고 문법 게이트를 통과한다', async () => {
  reset();
  const { applyCommit, buildDeck } = await api();
  run(applyCommit, [
    { op: 'insertElement', args: { parentId: 'n3', index: 0, type: 'text' } },
    { op: 'moveElement', target: 'n6', args: { newParentId: 'n7', index: 0 } },
  ]);

  const after = onDisk();
  const deck = buildDeck(DECK, file(), after);
  assert.equal(deck.sections.length, 1);

  const { sectionGate } = await import('../tools/harness/gate.js');
  const { loadMapping } = await import('../tools/harness/mapping.js');
  const gate = sectionGate(deck.sections[0].root, after, loadMapping(), 'AFTER');
  assert.ok(gate.pass, `게이트 실패:\n${gate.findings.map((f) => `${f.rule} ${f.code} ${f.subject}`).join('\n')}`);
  assert.ok(gate.roundTripLossless);
});

test('한 커밋의 구조 명령 여러 개가 같은 섹션에 겹치지 않는다', async () => {
  reset();
  const { applyCommit } = await api();
  const r = run(applyCommit, [
    { op: 'removeElement', target: 'n6' },
    { op: 'removeElement', target: 'n5' },
  ]);
  assert.equal(r.applied, true);
  const after = onDisk();
  assert.doesNotMatch(after, /data-node-id="n[56]"/);
  assert.match(after, /data-node-id="n4"/);
});

test('M2-3 이 등록한 명령은 구조 6종이다 — setContent 는 M2-4 다', async () => {
  const { registeredOps } = await import('./commands.js');
  assert.deepEqual(registeredOps(), [
    'duplicateElement', 'insertElement', 'moveElement', 'removeElement',
    'setPosition', 'setProps', 'setSectionProps', 'setTex', 'setValue',
    'unwrapElement', 'wrapElements',
  ]);
});
