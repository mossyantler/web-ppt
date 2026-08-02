// node --test server/outline.test.js
//
// M3-3 목차. 화면이 선택을 만들기 위해 서버에 묻는 것 하나뿐이므로, 여기서 재는 것은
// "무엇이 고를 수 있는 것으로 나오는가" 와 "잠긴 섹션이 이유를 함께 내는가" 둘이다.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = process.cwd();

const deck = (body) => `<!DOCTYPE html>
<html data-deck-grammar="v1" lang="ko">
<head><meta charset="utf-8"></head>
<body>
${body}
</body>
</html>
`;

// 대표 수용 기준의 축소판 — 카드 안의 지표, 그리고 불투명 리프인 진행바.
const OK_SECTION = `<section data-slide data-variant="default" data-slide-kind="content" data-node-id="s1" class="slide" data-screen-label="진행 상황">
  <div data-box="region" data-region="body" data-node-id="s1b" class="slide-body">
    <div data-box="grid" data-variant="cols3" data-cols="3" data-node-id="s1g" class="cols-3">
      <div data-box="card" data-node-id="s1c" class="card"><div data-el="metric" data-node-id="s1m" class="kpi"><span class="num">64<span class="unit">%</span></span></div></div>
    </div>
    <div data-el="progress" data-node-id="s1p" data-label="수치해석" data-value="72" style="--pct:72" class="prog-row"><span class="task">수치해석</span><div class="prog-track"><div class="prog-fill"></div></div><span class="pct">72%</span></div>
    <div data-el="equation" data-node-id="s1e" data-tex="a^2" class="equation"></div>
  </div>
</section>`;

// 어휘 밖 요소가 하나 섞인 섹션 — 잠겨야 하고 이유가 나와야 한다.
const BAD_SECTION = `<section data-slide data-variant="default" data-slide-kind="content" data-node-id="s2" class="slide">
  <div data-box="region" data-region="body" data-node-id="s2b" class="slide-body">
    <blockquote class="quote">외부 편집기가 넣은 것</blockquote>
  </div>
</section>`;

// 이름표가 없는 섹션 — 문법 선언 자체가 없는 옛 덱과 같은 자리에 놓인다.
const RAW_SECTION = '<section class="slide">이름표 없음</section>';

let sandbox;
let server;
let base;

before(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'deck-outline-'));
  const ws = join(sandbox, '_workspace');
  mkdirSync(join(ws, 'd1'), { recursive: true });
  writeFileSync(join(ws, 'd1', 'index.html'),
    deck(`${OK_SECTION}\n${BAD_SECTION}\n${RAW_SECTION}`), 'utf8');

  process.chdir(sandbox);
  const { createDeckServer } = await import('./index.js');
  server = createDeckServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  process.chdir(REPO);
  await new Promise((r) => server.close(r));
  rmSync(sandbox, { recursive: true, force: true });
});

const outline = async (id = 'd1') => (await fetch(`${base}/deck/${id}/outline`)).json();

const byId = (nodes, id) => {
  for (const n of nodes) {
    if (n.nodeId === id) return n;
    const hit = byId(n.children, id);
    if (hit) return hit;
  }
  return null;
};

test('목차가 섹션마다 화면 이름과 이름표 유무를 준다', async () => {
  const body = await outline();
  assert.equal(body.sections.length, 3);
  assert.equal(body.sections[0].label, '진행 상황');
  assert.equal(body.sections[0].annotated, true);
  assert.equal(body.sections[0].blockerCount, 0);
  assert.match(body.docHash, /^[a-f0-9]{8,}$/);
});

test('이름표 없는 요소는 건너뛰고 그 안의 지목 가능한 것을 올린다', async () => {
  const [first] = (await outline()).sections;

  // 카드는 격자의 자식으로, 지표는 카드의 자식으로 나온다 — 중첩이 보존된다.
  const grid = byId(first.children, 's1g');
  assert.equal(grid.kind, 'container');
  assert.equal(grid.children[0].nodeId, 's1c');
  assert.equal(grid.children[0].children[0].nodeId, 's1m');

  // `.prog-track`·`.prog-fill`·`<span class="num">` 은 노드가 아니라 겉모습이다.
  // 목차에 실리면 화면이 고를 수 없는 것을 고를 수 있다고 표시한다.
  const ids = [];
  const collect = (ns) => ns.forEach((n) => { ids.push(n.nodeId); collect(n.children); });
  collect(first.children);
  assert.deepEqual(ids.sort(), ['s1b', 's1c', 's1e', 's1g', 's1m', 's1p']);
});

test('불투명 리프는 전용 명령을 이름으로 달고 나온다', async () => {
  const [first] = (await outline()).sections;
  assert.equal(byId(first.children, 's1p').edit, 'setValue');   // 진행바
  assert.equal(byId(first.children, 's1e').edit, 'setTex');     // 수식
  assert.equal(byId(first.children, 's1m').edit, 'setContent'); // 저작 리프
  assert.equal(byId(first.children, 's1c').edit, null);         // 컨테이너는 내용이 없다
});

test('어휘 밖 요소는 이유와 줄 번호로 보고된다 — 이름표 유무와 별개다', async () => {
  const [, bad] = (await outline()).sections;
  // 섹션 자신은 이름표가 있다. **어디까지 잠글지는 M3-9 의 정책**이고 목차는 재료만 준다.
  assert.equal(bad.annotated, true);
  assert.ok(bad.blockerCount >= 1);

  const hit = bad.blockers.find((b) => b.tag === 'blockquote');
  assert.equal(hit.code, 'grammar.unknown-element');
  assert.deepEqual(hit.classes, ['quote']);
  assert.equal(typeof hit.line, 'number');
});

test('이름표가 아예 없는 섹션은 지목 불가로 나온다', async () => {
  const [, , raw] = (await outline()).sections;
  assert.equal(raw.annotated, false);
  assert.equal(raw.nodeId, null);
  assert.deepEqual(raw.children, []);
});

test('없는 덱은 404 다 — 화면이 빈 목차를 진짜 목차로 오해하지 않는다', async () => {
  const res = await fetch(`${base}/deck/nope/outline`);
  assert.equal(res.status, 404);
});

test('_workspace 밖은 403 이다', async () => {
  const res = await fetch(`${base}/deck/${encodeURIComponent('../../etc')}/outline`);
  assert.equal(res.status, 403);
});
