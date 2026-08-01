// node --test server/attr-commands.test.js
//
// M2-2 의 수용 기준은 하나로 요약된다 — **속성 명령은 여는 태그만 바꾼다.**
// 내부 HTML 바이트 동일이 그 직접 측정이고, 나머지 테스트는 각 명령이 무엇을
// 거부하는지(= 문법의 집행 지점)를 고정한다.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { hashOf } from '../tools/harness/splice.js';

const REPO = process.cwd();
const DECK = '2026-08-01-attrs';

const HTML = `<!DOCTYPE html>
<html data-deck-grammar="v1" lang="ko">
<head><meta charset="utf-8"></head>
<body>
<section data-slide data-variant="default" data-slide-kind="content" data-node-id="n1" class="slide">
  <div data-box="region" data-region="body" data-node-id="n2" class="slide-body">
    <div data-box="card" data-node-id="n3" class="card">
      <p data-el="text" data-node-id="n4">본문 <b>강조</b> 그리고 <span class="mono">Cc</span></p>
      <span data-el="equation" data-node-id="n5" data-tex="a=b" data-display="false"></span>
      <div data-el="progress" data-node-id="n6" data-label="작업" data-value="72" style="--pct:72" class="prog-row"><span class="task">작업</span><div class="prog-track"><div class="prog-fill"></div></div><span class="pct">72%</span></div>
    </div>
    <div data-box="canvas" data-node-id="n7" class="free-layer">
      <div data-el="text" data-node-id="n8" style="left:10px;top:20px">자유 배치</div>
    </div>
  </div>
</section>
</body>
</html>
`;

let sandbox;

before(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'deck-attrs-'));
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

/** 노드의 내부 HTML (여는 태그 밖 ~ 닫는 태그 안). */
async function innerOf(nodeId, source) {
  const { buildDeck } = await api();
  const deck = buildDeck(DECK, file(), source);
  const { node } = { node: deck.index.get(nodeId).node };
  const span = node.innerSpan();
  return span ? source.slice(span[0], span[1]) : null;
}

/* ----------------------------------------------------- 핵심 — 여는 태그만 바뀐다 */

test('setProps 후 대상의 내부 HTML 이 바이트 동일하다 (여는 태그만 변경)', async () => {
  reset();
  const { applyCommit } = await api();
  const beforeInner = await innerOf('n4', HTML);

  const r = run(applyCommit, [{ op: 'setProps', target: 'n4', args: { patch: { class: 'lead' } } }]);
  assert.equal(r.applied, true);

  const after = onDisk();
  assert.equal(await innerOf('n4', after), beforeInner, '내부 HTML 이 바뀌었다');
  assert.match(after, /<p data-el="text" data-node-id="n4" class="lead">/);
});

test('손대지 않은 속성의 바이트가 보존된다 — 여는 태그를 다시 쓰지 않는다', async () => {
  reset();
  const { applyCommit } = await api();
  run(applyCommit, [{ op: 'setProps', target: 'n3', args: { patch: { class: 'card subtle' } } }]);
  // data-box 와 data-node-id 는 원문 그대로, class 만 갈렸다.
  assert.match(onDisk(), /<div data-box="card" data-node-id="n3" class="card subtle">/);
});

test('문서 전체에서 바뀐 바이트는 그 속성뿐이다', async () => {
  reset();
  const { applyCommit } = await api();
  run(applyCommit, [{ op: 'setTex', target: 'n5', args: { tex: 'x^2' } }]);
  assert.equal(onDisk(), HTML.replace('data-tex="a=b"', 'data-tex="x^2"'));
});

/* ------------------------------------------------------------------ setProps */

test('setProps 는 속성을 추가·제거할 수 있다', async () => {
  reset();
  const { applyCommit } = await api();
  run(applyCommit, [{ op: 'setProps', target: 'n4', args: { patch: { 'data-note': '메모' } } }]);
  assert.match(onDisk(), /data-node-id="n4" data-note="메모"/);

  run(applyCommit, [{ op: 'setProps', target: 'n4', args: { patch: { 'data-note': null } } }]);
  assert.equal(onDisk(), HTML, '추가한 속성을 지우면 원본 바이트로 돌아온다');
});

test('setProps 는 문법의 뼈대 속성을 거부한다 (422, 파일 미변경)', async () => {
  reset();
  const { applyCommit } = await api();
  for (const name of ['data-node-id', 'data-el', 'data-box', 'data-slide']) {
    assert.throws(
      () => run(applyCommit, [{ op: 'setProps', target: 'n4', args: { patch: { [name]: 'x' } } }]),
      (e) => e.status === 422 && e.code === 'commit.forbidden-prop',
      name,
    );
  }
  assert.equal(onDisk(), HTML);
});

test('setProps 는 class·data-* 밖의 속성을 거부한다', async () => {
  reset();
  const { applyCommit } = await api();
  for (const name of ['style', 'onclick', 'src', 'id']) {
    assert.throws(
      () => run(applyCommit, [{ op: 'setProps', target: 'n4', args: { patch: { [name]: 'x' } } }]),
      (e) => e.status === 422,
      name,
    );
  }
});

test('setProps 의 대상이 섹션이면 422 — setSectionProps 로 안내한다', async () => {
  reset();
  const { applyCommit } = await api();
  assert.throws(
    () => run(applyCommit, [{ op: 'setProps', target: 'n1', args: { patch: { class: 'slide' } } }]),
    (e) => e.status === 422 && e.code === 'commit.wrong-command',
  );
});

test('setSectionProps 는 섹션에만 적용된다', async () => {
  reset();
  const { applyCommit } = await api();
  run(applyCommit, [{ op: 'setSectionProps', target: 'n1', args: { patch: { 'data-label': '표지' } } }]);
  assert.match(onDisk(), /data-node-id="n1" class="slide" data-label="표지"/);

  assert.throws(
    () => run(applyCommit, [{ op: 'setSectionProps', target: 'n4', args: { patch: { 'data-x': '1' } } }]),
    (e) => e.status === 422 && e.code === 'commit.wrong-target',
  );
});

/* -------------------------------------------------------------------- setTex */

test('setTex 는 equation 이 아니면 422', async () => {
  reset();
  const { applyCommit } = await api();
  assert.throws(
    () => run(applyCommit, [{ op: 'setTex', target: 'n4', args: { tex: 'x' } }]),
    (e) => e.status === 422 && e.code === 'commit.wrong-target',
  );
});

test('setTex 는 값의 특수문자를 이스케이프한다', async () => {
  reset();
  const { applyCommit } = await api();
  run(applyCommit, [{ op: 'setTex', target: 'n5', args: { tex: 'a<b & c="d"' } }]);
  assert.match(onDisk(), /data-tex="a&lt;b &amp; c=&quot;d&quot;"/);
  // 그리고 그 값은 다시 읽었을 때 원래 문자열이다.
  const { buildDeck } = await api();
  const deck = buildDeck(DECK, file(), onDisk());
  assert.equal(deck.index.get('n5').node.attrs.find((a) => a.name === 'data-tex').value, 'a<b & c="d"');
});

/* ------------------------------------------------------------------ setValue */

test('setValue 는 data-value 와 --pct 를 함께 갱신한다 (§3.4 동기 불변식)', async () => {
  reset();
  const { applyCommit } = await api();
  run(applyCommit, [{ op: 'setValue', target: 'n6', args: { value: 45 } }]);
  const after = onDisk();
  assert.match(after, /data-value="45"/);
  assert.match(after, /style="--pct:45"/);
  assert.doesNotMatch(after, /data-value="72"/);
  assert.doesNotMatch(after, /--pct:72/);
});

test('setValue 는 스캐폴딩 자식을 건드리지 않는다 (불투명 서브트리)', async () => {
  reset();
  const { applyCommit } = await api();
  const beforeInner = await innerOf('n6', HTML);
  run(applyCommit, [{ op: 'setValue', target: 'n6', args: { value: 45 } }]);
  assert.equal(await innerOf('n6', onDisk()), beforeInner);
});

test('setValue 는 범위 밖 값과 비대상 리프를 거부한다', async () => {
  reset();
  const { applyCommit } = await api();
  assert.throws(
    () => run(applyCommit, [{ op: 'setValue', target: 'n6', args: { value: 140 } }]),
    (e) => e.status === 422 && e.code === 'commit.value-range',
  );
  assert.throws(
    () => run(applyCommit, [{ op: 'setValue', target: 'n5', args: { value: 40 } }]),
    (e) => e.status === 422 && e.code === 'commit.wrong-target',
    'equation 은 데이터 채널을 선언하지 않았다',
  );
  assert.equal(onDisk(), HTML);
});

/* --------------------------------------------------------------- setPosition */

test('setPosition 은 canvas 의 자식에서만 유효하다', async () => {
  reset();
  const { applyCommit } = await api();
  run(applyCommit, [{ op: 'setPosition', target: 'n8', args: { x: 40, y: 50, w: 100 } }]);
  assert.match(onDisk(), /style="left:40px;top:50px;width:100px"/);

  assert.throws(
    () => run(applyCommit, [{ op: 'setPosition', target: 'n4', args: { x: 1 } }]),
    (e) => e.status === 422 && e.code === 'commit.not-in-canvas',
  );
});

test('patchStyle 이 기존 선언 순서를 보존한다', async () => {
  const { patchStyle } = await import('./attrs.js');
  assert.equal(patchStyle('top:2px;left:1px', { left: '9px' }), 'top:2px;left:9px');
  assert.equal(patchStyle('top:2px', { left: '9px' }), 'top:2px;left:9px');
  assert.equal(patchStyle('top:2px;left:1px', { top: null }), 'left:1px');
});

/* ------------------------------------------------------------- 원자성·롤백 */

test('명령 하나가 실패하면 커밋 전체가 롤백된다 (파일 미변경)', async () => {
  reset();
  const { applyCommit } = await api();
  assert.throws(
    () => run(applyCommit, [
      { op: 'setProps', target: 'n4', args: { patch: { class: 'lead' } } },   // 유효
      { op: 'setTex', target: 'n4', args: { tex: 'x' } },                      // 422
    ]),
    (e) => e.status === 422,
  );
  assert.equal(onDisk(), HTML, '앞선 명령의 변경이 새어 나가면 안 된다');
});

test('한 커밋의 여러 속성 명령이 함께 적용된다', async () => {
  reset();
  const { applyCommit } = await api();
  const r = run(applyCommit, [
    { op: 'setTex', target: 'n5', args: { tex: 'x^2' } },
    { op: 'setValue', target: 'n6', args: { value: 30 } },
  ]);
  assert.equal(r.applied, true);
  const after = onDisk();
  assert.match(after, /data-tex="x\^2"/);
  assert.match(after, /data-value="30"/);
  assert.match(after, /--pct:30/);
});

test('M2-2 가 등록한 명령은 속성 명령 다섯이다', async () => {
  const { registeredOps } = await import('./commands.js');
  assert.deepEqual(registeredOps(), ['setPosition', 'setProps', 'setSectionProps', 'setTex', 'setValue']);
});
