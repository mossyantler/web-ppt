// node --test server/section-edit.test.js
//
// `removeSection` · `duplicateSection` — 레일 조작 버튼이 요구한 둘.
//
// 여기서 재는 것은 **덜어내고 베끼는 일이 나머지를 건드리지 않는가** 다. 둘 다 트리를
// 재직렬화하지 않고 바이트 구간만 다루므로, 남는 장은 바이트가 그대로여야 한다.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { hashOf } from '../tools/harness/splice.js';

const REPO = process.cwd();
const DECK = '2026-08-03-sections';

const slide = (id, label) => `<section data-slide data-variant="default" data-slide-kind="content" data-node-id="${id}" class="slide">
  <div data-box="region" data-region="body" data-node-id="${id}b" class="slide-body">
    <p data-el="text" data-node-id="${id}t">${label}</p>
  </div>
  <div data-box="region" data-region="foot" data-node-id="${id}f" class="slide-foot"><span class="page">0? / 03</span></div>
</section>`;

const HTML = `<!DOCTYPE html>
<html data-deck-grammar="v1" lang="ko">
<head><meta charset="utf-8"></head>
<body>
${slide('n1', '첫째')}
<!-- 장 사이의 주석. 지우거나 복제해도 제자리여야 한다 -->
${slide('n2', '둘째')}
${slide('n3', '셋째')}
</body>
</html>
`;

let sandbox;

before(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'deck-sections-'));
  mkdirSync(join(sandbox, '_workspace', DECK), { recursive: true });
  process.chdir(sandbox);
});

after(() => {
  process.chdir(REPO);
  rmSync(sandbox, { recursive: true, force: true });
});

const file = () => join(sandbox, '_workspace', DECK, 'index.html');
const onDisk = () => readFileSync(file(), 'utf8');
beforeEach(() => writeFileSync(file(), HTML, 'utf8'));

const api = async () => import('./commit.js');
const run = (applyCommit, commands) => applyCommit(DECK, {
  commitId: `c${Math.random()}`,
  pre: { docHash: hashOf(onDisk()) },
  commands,
});

const sectionIds = (html) => [...html.matchAll(/<section[^>]*data-node-id="([^"]+)"/g)].map((m) => m[1]);

/* ------------------------------------------------------------ removeSection */

test('가운데 장을 지우면 그 장만 사라지고 나머지는 바이트가 그대로다', async () => {
  const { applyCommit } = await api();
  const r = run(applyCommit, [{ op: 'removeSection', target: 'n2' }]);

  assert.equal(r.applied, true);
  const after = onDisk();
  assert.deepEqual(sectionIds(after), ['n1', 'n3']);
  assert.ok(!after.includes('둘째'));

  // 페이지 번호는 **바뀌는 것이 맞다** — 장 수가 줄면 `renumberPages` 가 자동으로 붙는다
  // (아래 테스트가 그것을 잰다). 그 한 자리를 빼면 남은 장은 바이트가 그대로여야 한다.
  const exceptPages = (html) => html.replace(/class="page">[^<]*</g, 'class="page">?<');
  assert.ok(exceptPages(after).includes(exceptPages(slide('n1', '첫째'))), '남은 장이 바뀌었다');
  assert.ok(exceptPages(after).includes(exceptPages(slide('n3', '셋째'))), '남은 장이 바뀌었다');
});

test('빈 줄이 자라지 않는다 — 앞 공백을 함께 가져간다', async () => {
  const { applyCommit } = await api();
  run(applyCommit, [{ op: 'removeSection', target: 'n2' }]);
  assert.ok(!/\n\n\n/.test(onDisk()), '지운 자리에 빈 줄이 남았다');
});

test('첫 장도 지울 수 있다', async () => {
  const { applyCommit } = await api();
  run(applyCommit, [{ op: 'removeSection', target: 'n1' }]);
  assert.deepEqual(sectionIds(onDisk()), ['n2', 'n3']);
});

test('마지막 한 장은 지우지 못한다 — 장이 없는 덱은 열 수 없다', async () => {
  const { applyCommit } = await api();
  run(applyCommit, [{ op: 'removeSection', target: 'n1' }]);
  run(applyCommit, [{ op: 'removeSection', target: 'n2' }]);

  const before = onDisk();
  assert.throws(
    () => run(applyCommit, [{ op: 'removeSection', target: 'n3' }]),
    (err) => err.status === 422 && err.code === 'commit.last-section',
  );
  assert.equal(onDisk(), before);
});

test('지우면 페이지 번호가 다시 매겨진다', async () => {
  const { applyCommit } = await api();
  run(applyCommit, [{ op: 'removeSection', target: 'n2' }]);

  const pages = [...onDisk().matchAll(/class="page">([^<]*)</g)].map((m) => m[1]);
  assert.deepEqual(pages, ['01 / 02', '02 / 02'], '장 수가 줄면 꼬리의 번호도 따라와야 한다');
});

/* --------------------------------------------------------- duplicateSection */

test('복제본이 바로 뒤에 오고 이름표는 전부 새로 발급된다', async () => {
  const { applyCommit } = await api();
  const r = run(applyCommit, [{ op: 'duplicateSection', target: 'n2' }]);

  const after = onDisk();
  const ids = sectionIds(after);
  assert.equal(ids.length, 4);
  assert.equal(ids[0], 'n1');
  assert.equal(ids[1], 'n2');
  assert.equal(ids[3], 'n3');

  const fresh = ids[2];
  assert.notEqual(fresh, 'n2', '같은 id 가 둘이면 문서 전체가 409 로 거부된다');
  assert.equal(r.nodeIds.n2, fresh, '새 id 를 응답에 실어야 화면이 그것을 고를 수 있다');

  // 안쪽 이름표도 전부 새것이다.
  assert.equal((after.match(/data-node-id="n2b"/g) ?? []).length, 1);
  assert.match(after, /둘째[\s\S]*둘째/);
});

test('복제한 문서가 다시 파싱되고 게이트를 통과한다 — id 충돌이 없다는 뜻이다', async () => {
  const { applyCommit } = await api();
  run(applyCommit, [{ op: 'duplicateSection', target: 'n2' }]);

  const { buildDeck } = await import('./doc.js');
  const { sectionGate } = await import('../tools/harness/gate.js');
  const { loadMapping } = await import('../tools/harness/mapping.js');

  const raw = onDisk();
  const deck = buildDeck(DECK, file(), raw);       // 중복 id 면 여기서 409 로 죽는다
  assert.equal(deck.sections.length, 4);

  for (const section of deck.sections) {
    const gate = sectionGate(section.root, raw, loadMapping(), 'AFTER');
    assert.ok(gate.pass, gate.findings.map((f) => `${f.code} ${f.subject}`).join('\n'));
  }
});

test('복제해도 장 사이의 주석은 제자리다', async () => {
  const { applyCommit } = await api();
  run(applyCommit, [{ op: 'duplicateSection', target: 'n3' }]);
  const after = onDisk();
  assert.equal((after.match(/장 사이의 주석/g) ?? []).length, 1);
  assert.match(after, /<!-- 장 사이의 주석[\s\S]*data-node-id="n2"/);
});

test('없는 장을 지우거나 복제하면 404 다', async () => {
  const { applyCommit } = await api();
  for (const op of ['removeSection', 'duplicateSection']) {
    assert.throws(
      () => run(applyCommit, [{ op, target: '없는장' }]),
      (err) => err.status === 404 && err.code === 'commit.unknown-target',
      op,
    );
  }
});

test('되돌리면 지운 장이 그대로 돌아온다', async () => {
  const { applyCommit, applyUndo } = await api();
  const before = onDisk();
  run(applyCommit, [{ op: 'removeSection', target: 'n2' }]);
  applyUndo(DECK);
  assert.equal(onDisk(), before);
});
