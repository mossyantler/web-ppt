// node --test server/master-props.test.js
//
// 문법 §2.3.1(배경 `data-bg`)과 §3.5 L5.1(`image` 의 `src`·`alt`) — 새 리포트 만들기의 1번.
//
// 이 둘은 "마스터" 를 문서에 닿게 하는 통로다. 배경은 장마다(결정 4), 로고는 선택 사항이며
// 넣으면 흐름에 끼어든다(결정 5).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { hashOf } from '../tools/harness/splice.js';

const REPO = process.cwd();
const DECK = '2026-08-03-master';

const HTML = `<!DOCTYPE html>
<html data-deck-grammar="v1" lang="ko">
<head><meta charset="utf-8"></head>
<body>
<section data-slide data-variant="title" data-slide-kind="title" data-node-id="n1" class="slide slide--title">
  <div data-box="region" data-region="head" data-node-id="n2" class="slide-head">
    <div data-el="meta" data-variant="lab" data-node-id="n3" class="lab">Flow Physics Lab</div>
  </div>
</section>
</body>
</html>
`;

let sandbox;

before(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'deck-master-'));
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

const api = async () => import('./commit.js');
const run = (applyCommit, commands) => applyCommit(DECK, {
  commitId: `c${Math.random()}`,
  pre: { docHash: hashOf(onDisk()) },
  commands,
});

/* ------------------------------------------------------- 배경 (§2.3.1) */

test('배경은 섹션 속성 하나로 바뀐다 — 조판은 건드리지 않는다', async () => {
  reset();
  const { applyCommit } = await api();
  const r = run(applyCommit, [{ op: 'setSectionProps', target: 'n1', args: { patch: { 'data-bg': 'dark' } } }]);

  assert.equal(r.applied, true);
  // `data-variant`(조판)는 그대로다. 배경과 조판이 직교하다는 것이 이 조항의 근거다.
  assert.match(onDisk(), /data-variant="title"[^>]*data-bg="dark"|data-bg="dark"/);
  assert.match(onDisk(), /class="slide slide--title"/);
});

test('배경 열거 밖의 값은 게이트가 잡는다', async () => {
  reset();
  const { applyCommit } = await api();
  run(applyCommit, [{ op: 'setSectionProps', target: 'n1', args: { patch: { 'data-bg': '보라색' } } }]);

  const { buildDeck } = await import('./doc.js');
  const { sectionGate } = await import('../tools/harness/gate.js');
  const { loadMapping } = await import('../tools/harness/mapping.js');

  const raw = onDisk();
  const deck = buildDeck(DECK, file(), raw);
  const gate = sectionGate(deck.sections[0].root, raw, loadMapping(), 'AFTER');

  assert.equal(gate.pass, false, '열거 밖 값이 통과하면 오타가 조용히 기본 배경으로 렌더된다');
  assert.ok(gate.findings.some((f) => f.code === 'grammar.unknown-variant'));
});

test('배경 속성이 아예 없는 문서는 그대로 통과한다 — 기존 덱을 건드리지 않는다', async () => {
  reset();
  const { buildDeck } = await import('./doc.js');
  const { sectionGate } = await import('../tools/harness/gate.js');
  const { loadMapping } = await import('../tools/harness/mapping.js');

  const raw = onDisk();
  const deck = buildDeck(DECK, file(), raw);
  const gate = sectionGate(deck.sections[0].root, raw, loadMapping(), 'BEFORE');
  assert.equal(gate.pass, true, gate.findings.map((f) => `${f.code} ${f.subject}`).join('\n'));
});

/* --------------------------------------------------- 로고 (§3.5 L5.1) */

test('로고를 머리 맨 앞에 넣고 그림 경로를 정한다', async () => {
  reset();
  const { applyCommit } = await api();

  const inserted = run(applyCommit, [{
    op: 'insertElement',
    args: { parentId: 'n2', index: 0, type: 'image', variant: 'logo', slot: 'logo' },
  }]);
  const id = inserted.nodeIds.logo;
  assert.ok(id, '삽입된 노드의 id 가 응답에 있어야 화면이 그것을 이어서 고칠 수 있다');

  run(applyCommit, [{
    op: 'setProps',
    target: id,
    args: { patch: { src: 'logo.png', alt: '연구실 로고' } },
  }]);

  const after = onDisk();
  // 머리의 **맨 앞**에 들어가고 랩실명이 뒤로 밀린다 (결정 5 — 자리를 비워 두지 않는다).
  assert.match(after, /class="slide-head">\s*<img[^>]*class="brand-logo"[^>]*>\s*<div data-el="meta"/);
  assert.match(after, /src="logo\.png"/);
  assert.match(after, /alt="연구실 로고"/);
});

test('덱 밖을 가리키는 그림 경로는 422 다', async () => {
  reset();
  const { applyCommit } = await api();
  const id = run(applyCommit, [{
    op: 'insertElement',
    args: { parentId: 'n2', index: 0, type: 'image', variant: 'logo', slot: 'logo' },
  }]).nodeIds.logo;

  for (const src of ['https://example.com/logo.png', '/etc/passwd', '../다른덱/logo.png', 'data:image/png;base64,AAAA']) {
    assert.throws(
      () => run(applyCommit, [{ op: 'setProps', target: id, args: { patch: { src } } }]),
      (err) => err.status === 422 && err.code === 'commit.outside-deck',
      `막지 못했다: ${src}`,
    );
  }
});

test('`src` 는 image 에만 열린다 — 다른 리프에서는 여전히 거부다', async () => {
  reset();
  const { applyCommit } = await api();
  assert.throws(
    () => run(applyCommit, [{ op: 'setProps', target: 'n3', args: { patch: { src: 'logo.png' } } }]),
    (err) => err.status === 422 && err.code === 'commit.forbidden-prop',
  );
});

test('섹션에는 `src` 를 열지 않는다', async () => {
  reset();
  const { applyCommit } = await api();
  assert.throws(
    () => run(applyCommit, [{ op: 'setSectionProps', target: 'n1', args: { patch: { src: 'logo.png' } } }]),
    (err) => err.status === 422 && err.code === 'commit.forbidden-prop',
  );
});

test('`style` 은 여전히 닫혀 있다 — 토큰 우회를 열지 않는다', async () => {
  reset();
  const { applyCommit } = await api();
  const id = run(applyCommit, [{
    op: 'insertElement',
    args: { parentId: 'n2', index: 0, type: 'image', variant: 'logo', slot: 'logo' },
  }]).nodeIds.logo;

  assert.throws(
    () => run(applyCommit, [{ op: 'setProps', target: id, args: { patch: { style: 'height:200px' } } }]),
    (err) => err.status === 422 && err.code === 'commit.forbidden-prop',
  );
});
