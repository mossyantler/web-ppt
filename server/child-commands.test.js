// node --test server/child-commands.test.js
//
// 구조 자식 명령 4종. 이 파일이 지키는 핵심 명제는 하나다 —
// **순서를 바꾸는 일이 내용을 바꾸지 않는다.**
//
// 이 명령들이 없던 시절 목록 재정렬은 `setContent` 로 리프 전체를 갈아야 했고,
// 그 경로가 `normalizeInline` 을 지나면서 허용목록 밖 클래스를 지웠다. 사용자는
// 순서만 만졌는데 서식이 사라졌고 무엇이 사라졌는지 몰랐다 (P4 위반).

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { hashOf } from '../tools/harness/splice.js';

const REPO = process.cwd();
const DECK = '2026-08-01-children';

// `wrf` 는 inlineClasses 에 없다 — 정화기를 지나면 지워진다. 재정렬이 그것을 지나지
// 않는다는 것을 재는 것이 이 픽스처의 목적이다.
const HTML = `<!DOCTYPE html>
<html data-deck-grammar="v1" lang="ko">
<head><meta charset="utf-8"></head>
<body>
<section data-slide data-variant="default" data-slide-kind="content" data-node-id="n1" class="slide">
  <div data-box="region" data-region="body" data-node-id="n2" class="slide-body">
    <ul data-el="list" data-node-id="n3" class="list">
      <li>PTM 구현 <span class="mono">v2.1</span><span class="wrf">주1</span></li>
      <!-- 항목 사이 주석. 재정렬에서 자리를 지켜야 한다 -->
      <li>WRF 비교</li>
      <li>논문 초안</li>
    </ul>
    <table data-el="table" data-node-id="n4" class="tbl">
      <thead><tr><th>구분</th><th>값</th></tr></thead>
      <tbody>
        <tr><td>압축지수</td><td class="num">0.42</td></tr>
        <tr><td>투수계수</td><td class="num">2.1e-8</td></tr>
      </tbody>
    </table>
    <div data-el="figure" data-node-id="n5" class="figure"><div class="ic">▦</div><div class="cap">개념도</div></div>
    <p data-el="text" data-node-id="n6">구조 자식이 없는 리프</p>
  </div>
</section>
</body>
</html>
`;

let sandbox;

before(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'deck-children-'));
  process.chdir(sandbox);
});

after(() => {
  process.chdir(REPO);
  rmSync(sandbox, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(join(sandbox, '_workspace', DECK), { recursive: true, force: true });
  mkdirSync(join(sandbox, '_workspace', DECK), { recursive: true });
  writeFileSync(join(sandbox, '_workspace', DECK, 'index.html'), HTML, 'utf8');
});

const file = () => join(sandbox, '_workspace', DECK, 'index.html');
const onDisk = () => readFileSync(file(), 'utf8');
const api = async () => ({ ...(await import('./commit.js')), ...(await import('./doc.js')) });

function run(applyCommit, commands) {
  return applyCommit(DECK, { commitId: `c${Math.random()}`, pre: { docHash: hashOf(onDisk()) }, commands });
}

const items = (s) => [...s.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1]);
const rows = (s) => [...s.matchAll(/<tr><td>([\s\S]*?)<\/td>/g)].map((m) => m[1]);

/* ------------------------------------------------ 핵심 — 순서만 바뀐다 */

test('reorderChildren 은 내용을 건드리지 않는다 — 정화기를 지나지 않는다', async () => {
  const { applyCommit } = await api();
  const before = items(HTML);

  run(applyCommit, [{ op: 'reorderChildren', target: 'n3', args: { order: [2, 0, 1] } }]);

  const after = items(onDisk());
  assert.deepEqual(after, [before[2], before[0], before[1]], '순서가 틀렸다');
  // 이것이 이 명령이 존재하는 이유다. setContent 경로에서는 `class="wrf"` 가 사라졌다.
  assert.match(after[1], /<span class="wrf">주1<\/span>/, '허용목록 밖 클래스가 지워졌다 — 정화기를 지났다는 뜻');
  assert.deepEqual([...after].sort(), [...before].sort(), '내용 집합이 바뀌었다');
});

test('reorderChildren 은 항목 사이 주석의 자리를 지킨다 (규약 G1)', async () => {
  const { applyCommit } = await api();
  run(applyCommit, [{ op: 'reorderChildren', target: 'n3', args: { order: [2, 1, 0] } }]);
  const after = onDisk();
  assert.equal((after.match(/<!-- 항목 사이 주석[^>]*-->/g) ?? []).length, 1);
  // 주석은 두 번째 슬롯 앞에 그대로 있다 — 자리는 고정되고 내용만 바뀐다.
  assert.match(after, /<!-- 항목 사이 주석[\s\S]*?-->\s*<li>WRF 비교<\/li>/);
});

test('reorderChildren 은 들여쓰기를 보존한다', async () => {
  const { applyCommit } = await api();
  run(applyCommit, [{ op: 'reorderChildren', target: 'n3', args: { order: [1, 0, 2] } }]);
  assert.match(onDisk(), /\n {6}<li>WRF 비교<\/li>/);
});

/* ------------------------------------------------------ parentPath (깊이 2) */

test('parentPath 로 tbody 의 행을 재배열한다 (§3.6 조항 6 깊이 2)', async () => {
  const { applyCommit } = await api();
  const before = rows(HTML);

  // table 의 구조 자식은 [thead, tbody] — tbody 는 1번이다.
  run(applyCommit, [{ op: 'reorderChildren', target: 'n4', args: { parentPath: [1], order: [1, 0] } }]);

  const after = rows(onDisk());
  assert.deepEqual(after.slice(-2), [before.at(-1), before.at(-2)]);
  assert.match(onDisk(), /class="num">2\.1e-8<\/td><\/tr>[\s\S]*?class="num">0\.42<\/td>/);
});

test('parentPath 가 범위를 벗어나면 422', async () => {
  const { applyCommit } = await api();
  assert.throws(() => run(applyCommit, [{ op: 'reorderChildren', target: 'n4', args: { parentPath: [9], order: [0] } }]),
    (e) => e.status === 422 && e.code === 'commit.index-out-of-range');
});

/* --------------------------------------------------------------- removeChild */

test('removeChild 는 항목과 그 앞 공백을 함께 뺀다', async () => {
  const { applyCommit } = await api();
  run(applyCommit, [{ op: 'removeChild', target: 'n3', args: { index: 1 } }]);

  const after = onDisk();
  assert.deepEqual(items(after), ['PTM 구현 <span class="mono">v2.1</span><span class="wrf">주1</span>', '논문 초안']);
  assert.doesNotMatch(after, /\n\s*\n\s*<li>/, '빈 줄이 남았다');
});

test('removeChild 도 남는 항목의 내용을 건드리지 않는다', async () => {
  const { applyCommit } = await api();
  run(applyCommit, [{ op: 'removeChild', target: 'n3', args: { index: 2 } }]);
  assert.match(onDisk(), /<span class="wrf">주1<\/span>/);
});

/* --------------------------------------------------------------- insertChild */

test('insertChild 는 선언된 태그만 만들고 형제 들여쓰기를 받는다', async () => {
  const { applyCommit } = await api();
  const r = run(applyCommit, [{ op: 'insertChild', target: 'n3', args: { index: 1, tag: 'li', html: '새 항목' } }]);
  assert.equal(r.applied, true);

  const after = onDisk();
  assert.deepEqual(items(after).length, 4);
  assert.equal(items(after)[1], '새 항목');
  assert.match(after, /\n {6}<li>새 항목<\/li>/);
});

test('insertChild 는 끝에 붙일 수 있다 (index === 자식 수)', async () => {
  const { applyCommit } = await api();
  run(applyCommit, [{ op: 'insertChild', target: 'n3', args: { index: 3, tag: 'li', html: '마지막' } }]);
  assert.equal(items(onDisk()).at(-1), '마지막');
});

test('insertChild 는 leafStructure 에 없는 태그를 거부한다', async () => {
  const { applyCommit } = await api();
  for (const tag of ['div', 'p', 'script', 'td']) {
    assert.throws(() => run(applyCommit, [{ op: 'insertChild', target: 'n3', args: { index: 0, tag, html: 'x' } }]),
      (e) => e.status === 422 && e.code === 'commit.undeclared-child', tag);
  }
  assert.equal(onDisk(), HTML);
});

test('insertChild 는 클래스가 선언된 구조 자식을 만든다 (figure 의 div.ic)', async () => {
  const { applyCommit } = await api();
  run(applyCommit, [{ op: 'insertChild', target: 'n5', args: { index: 2, tag: 'div', className: 'cap', html: '두 번째 캡션' } }]);
  assert.match(onDisk(), /<div class="cap">두 번째 캡션<\/div><\/div>/);

  // 선언에 없는 클래스는 거부된다 — 닫힌 목록이라는 뜻이다.
  assert.throws(() => run(applyCommit, [{ op: 'insertChild', target: 'n5', args: { index: 0, tag: 'div', className: 'nope', html: 'x' } }]),
    (e) => e.status === 422 && e.code === 'commit.undeclared-child');
});

test('insertChild 의 내용은 정화기를 지난다 — 새로 받는 것이므로', async () => {
  const { applyCommit } = await api();
  run(applyCommit, [{ op: 'insertChild', target: 'n3', args: { index: 0, tag: 'li', html: '<div style="x">붙여넣기</div>' } }]);
  assert.equal(items(onDisk())[0], '붙여넣기');

  assert.throws(() => run(applyCommit, [{ op: 'insertChild', target: 'n3', args: { index: 0, tag: 'li', html: '<script>x</script>' } }]),
    (e) => e.status === 422 && e.code === 'commit.rejected-content');
});

/* ----------------------------------------------------------- setChildContent */

test('setChildContent 는 그 항목의 내부만 바꾼다 — 형제는 바이트 동일', async () => {
  const { applyCommit } = await api();
  const r = run(applyCommit, [{ op: 'setChildContent', target: 'n3', args: { index: 1, html: 'WRF 비교 완료' } }]);

  assert.equal(onDisk(), HTML.replace('<li>WRF 비교</li>', '<li>WRF 비교 완료</li>'),
    '문서 전체에서 바뀐 바이트는 그 항목의 내부뿐이어야 한다');
  assert.equal(r.spliceRanges.length, 1);
});

test('setChildContent 는 구조 자식을 또 가진 노드를 거부하고 길을 안내한다', async () => {
  const { applyCommit } = await api();
  // table 의 0번 자식은 thead 이고 그 안에 tr 이 있다.
  assert.throws(() => run(applyCommit, [{ op: 'setChildContent', target: 'n4', args: { index: 0, html: 'x' } }]),
    (e) => e.status === 422 && e.code === 'commit.nested-child');
});

test('setChildContent 로 표의 셀 하나를 고친다 (parentPath 두 단계)', async () => {
  const { applyCommit } = await api();
  // tbody(1) → 첫 행(0) → 두 번째 셀(1)
  run(applyCommit, [{ op: 'setChildContent', target: 'n4', args: { parentPath: [1, 0], index: 1, html: '0.44' } }]);
  assert.equal(onDisk(), HTML.replace('>0.42<', '>0.44<'));
});

/* ------------------------------------------------------------------ 거부 */

test('구조 자식이 없는 리프·컨테이너·섹션은 전부 422', async () => {
  const { applyCommit } = await api();
  for (const target of ['n6', 'n2', 'n1']) {
    assert.throws(() => run(applyCommit, [{ op: 'reorderChildren', target, args: { order: [] } }]),
      (e) => e.status === 422 && e.code === 'commit.no-leaf-structure', target);
  }
});

test('order 가 순열이 아니면 422 이고 파일은 바뀌지 않는다', async () => {
  const { applyCommit } = await api();
  for (const order of [[0, 0, 1], [0, 1, 5], [0, 1]]) {
    assert.throws(() => run(applyCommit, [{ op: 'reorderChildren', target: 'n3', args: { order } }]),
      (e) => e.status === 422 || e.status === 400, JSON.stringify(order));
  }
  assert.equal(onDisk(), HTML);
});

/* --------------------------------------------------------- 재파싱·게이트 */

/* ------------------------------------------------ 열(column) — 행 여럿을 한 커밋에 */

// 열은 행 하나에 사는 것이 아니라 **모든 행에 걸쳐 있다.** 그래서 열 하나를 넣으려면
// `<tr>` 마다 `insertChild` 를 하나씩 내야 하고, 그것이 **한 커밋**이어야 한다 — 나누면
// 표가 잠깐 들쭉날쭉한 상태로 저장되고 되돌리기가 행 수만큼 걸린다.
//
// 한 커밋 안의 명령들은 전부 같은 스냅샷을 보므로 뒤 명령이 앞 명령의 결과를 못 본다
// (`commit.js` 의 주). 여기서는 그것이 문제가 아니다 — 각 `<tr>` 의 내부 구간은 서로
// 겹치지 않으므로 편집이 서로를 밀지 않는다. **그 사실을 재는 것이 이 테스트다.**

test('열 넣기 — 행마다 insertChild 를 내고 한 커밋으로 묶는다', async () => {
  const { applyCommit } = await api();
  const out = await run(applyCommit, [
    { op: 'insertChild', target: 'n4', args: { parentPath: [0, 0], index: 2, tag: 'th', html: '단위' } },
    { op: 'insertChild', target: 'n4', args: { parentPath: [1, 0], index: 2, tag: 'td', html: '—' } },
    { op: 'insertChild', target: 'n4', args: { parentPath: [1, 1], index: 2, tag: 'td', html: 'm/s' } },
  ]);
  assert.equal(out.applied, true);

  const html = onDisk();
  assert.match(html, /<th>구분<\/th><th>값<\/th><th>단위<\/th>/);
  assert.match(html, /<td>압축지수<\/td><td class="num">0\.42<\/td><td>—<\/td>/);
  assert.match(html, /<td>투수계수<\/td><td class="num">2\.1e-8<\/td><td>m\/s<\/td>/);
  // 표 밖은 그대로다.
  assert.match(html, /<li>PTM 구현 <span class="mono">v2\.1<\/span><span class="wrf">주1<\/span><\/li>/);
});

test('빈 요소는 닫는 태그 없이 만든다 — 파일이 유효한 HTML 로 남는다', async () => {
  const { applyCommit } = await api();
  // `<col>` 은 표에만 있으므로 표 픽스처에 colgroup 을 먼저 만들 수 없다. 대신 거부 경로와
  // 생성 형태를 figure 의 선언으로 재는 대신, table 의 선언에 있는 col 을 직접 쓴다.
  run(applyCommit, [{ op: 'insertChild', target: 'n4', args: { index: 0, tag: 'colgroup' } }]);
  run(applyCommit, [{ op: 'insertChild', target: 'n4', args: { parentPath: [0], index: 0, tag: 'col' } }]);

  const html = onDisk();
  assert.match(html, /<colgroup><col><\/colgroup>/, '<col></col> 처럼 닫는 태그를 냈다');
  assert.doesNotMatch(html, /<\/col>/);

  // 내용을 주면 거부한다 — 담을 자리가 없기 때문이다.
  assert.throws(() => run(applyCommit, [{ op: 'insertChild', target: 'n4', args: { parentPath: [0], index: 0, tag: 'col', html: 'x' } }]),
    (e) => e.status === 422 && e.code === 'commit.void-child-content');
});

test('열 지분 — <col> 에는 width 만, 그 밖의 style 은 전부 거부한다 (§5 규칙 5 예외)', async () => {
  const { applyCommit } = await api();
  run(applyCommit, [{ op: 'insertChild', target: 'n4', args: { index: 0, tag: 'colgroup' } }]);
  run(applyCommit, [{ op: 'insertChild', target: 'n4', args: { parentPath: [0], index: 0, tag: 'col', style: 'width:25%' } }]);
  // 원문 코퍼스가 `style="width:34%"` 처럼 공백 없이 쓴다. 그 손버릇에 맞춘다.
  assert.match(onDisk(), /<col style="width:25%">/);

  // 지분 밖의 기하는 규칙 5 가 canvas 의 자식으로 제한한다. 명령으로 우회되면 안 된다.
  for (const bad of ['left:10px', 'width:120px', 'width:25%; height:3px', 'color:red']) {
    assert.throws(() => run(applyCommit, [{ op: 'insertChild', target: 'n4', args: { parentPath: [0], index: 0, tag: 'col', style: bad } }]),
      (e) => e.status === 422 && e.code === 'commit.illegal-style', bad);
  }
  // 표·행·칸에는 애초에 style 을 줄 수 없다 — 조판은 클래스가 정한다.
  assert.throws(() => run(applyCommit, [{ op: 'insertChild', target: 'n4', args: { parentPath: [2], index: 0, tag: 'tr', style: 'width:10%' } }]),
    (e) => e.status === 422 && e.code === 'commit.illegal-style');
});

test('열 지우기 — 되돌리기 한 번에 열 전체가 돌아온다', async () => {
  const { applyCommit, applyUndo } = await api();
  const before = onDisk();

  const out = await run(applyCommit, [
    { op: 'removeChild', target: 'n4', args: { parentPath: [0, 0], index: 1 } },
    { op: 'removeChild', target: 'n4', args: { parentPath: [1, 0], index: 1 } },
    { op: 'removeChild', target: 'n4', args: { parentPath: [1, 1], index: 1 } },
  ]);
  assert.equal(out.applied, true);

  const html = onDisk();
  assert.doesNotMatch(html, /class="num"/, '둘째 열이 남았다');
  assert.match(html, /<th>구분<\/th><\/tr>/);

  applyUndo(DECK);
  assert.equal(onDisk(), before, '되돌리기 한 번으로 원래 표가 돌아오지 않았다');
});

test('네 명령을 이어 적용해도 게이트를 통과한다', async () => {
  const { applyCommit, buildDeck } = await api();
  for (const [i, c] of [
    { op: 'insertChild', target: 'n3', args: { index: 1, tag: 'li', html: '추가' } },
    { op: 'reorderChildren', target: 'n3', args: { order: [3, 2, 1, 0] } },
    { op: 'setChildContent', target: 'n3', args: { index: 0, html: '고침' } },
    { op: 'removeChild', target: 'n3', args: { index: 3 } },
  ].entries()) {
    applyCommit(DECK, { commitId: `seq-${i}`, pre: { docHash: hashOf(onDisk()) }, commands: [c] });
  }

  const after = onDisk();
  const deck = buildDeck(DECK, file(), after);
  const { sectionGate } = await import('../tools/harness/gate.js');
  const { loadMapping } = await import('../tools/harness/mapping.js');
  const gate = sectionGate(deck.sections[0].root, after, loadMapping(), 'AFTER');
  assert.ok(gate.pass, gate.findings.map((f) => `${f.rule} ${f.code} ${f.subject}`).join('\n'));
  assert.ok(gate.roundTripLossless);
  assert.equal(items(after).length, 3);
});
