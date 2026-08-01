// node --test server/p2-matrix.test.js
//
// 계획 §11 M2 수용 기준 5·14 — M2-6.
//
//   5  — **모든 명령 종류에 대해** splice 구간 밖 바이트가 편집 전후 동일 (P2 의 직접 테스트)
//   14 — 데이터 채널: `width:72%` 와 `--pct:72px` 는 error, `--pct:72` 는 통과
//
// 기준 5 의 구간은 **핸들러가 돌려준 값**(`CommitResult.spliceRanges`)을 그대로 쓴다.
// 테스트가 구간을 다시 계산하면 같은 버그를 두 번 쓰는 것이고, 그러면 이 테스트는
// 스스로를 검사할 뿐 아무것도 재지 않는다.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { hashOf, outsideIdentical } from '../tools/harness/splice.js';
import { loadMapping } from '../tools/harness/mapping.js';
import { sectionGate } from '../tools/harness/gate.js';
import { parseDocument, findSections, buildTree } from '../tools/harness/tree.js';

const REPO = process.cwd();
const DECK = '2026-08-01-p2';
const mapping = loadMapping();

const HTML = `<!DOCTYPE html>
<html data-deck-grammar="v1" lang="ko">
<head><meta charset="utf-8"></head>
<body>
<section data-slide data-variant="default" data-slide-kind="content" data-node-id="n1" class="slide">
  <!-- 구간 밖 주석 -->
  <div data-box="region" data-region="body" data-node-id="n2" class="slide-body">
    <div data-box="stack" data-node-id="n3" class="stack">
      <p data-el="text" data-node-id="n4">첫째</p>
      <p data-el="text" data-node-id="n5">둘째</p>
    </div>
    <div data-box="card" data-node-id="n6" class="card">
      <div data-el="heading" data-node-id="n7" class="card-head">제목</div>
    </div>
    <ul data-el="list" data-node-id="nc" class="list"><li>첫째</li><li>둘째</li><li>셋째</li></ul>
    <span data-el="equation" data-node-id="n8" data-tex="a=b" data-display="false"></span>
    <div data-el="progress" data-node-id="n9" data-value="72" style="--pct:72" class="prog-row"><span class="task">작업</span><div class="prog-track"><div class="prog-fill"></div></div><span class="pct">72%</span></div>
    <div data-box="canvas" data-node-id="na" class="free-layer">
      <div data-el="text" data-node-id="nb">자유 배치</div>
    </div>
  </div>
</section>
</body>
</html>
`;

let sandbox;

before(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'deck-p2-'));
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

/** 명령 종류마다 하나씩. 등록된 op 전부를 덮는지는 아래 완전성 테스트가 검사한다. */
const MATRIX = [
  ['setProps', { target: 'n4', args: { patch: { class: 'lead' } } }],
  ['setSectionProps', { target: 'n1', args: { patch: { 'data-label': '표지' } } }],
  ['setTex', { target: 'n8', args: { tex: 'x^2' } }],
  ['setValue', { target: 'n9', args: { value: 45 } }],
  ['setPosition', { target: 'nb', args: { x: 10, y: 20 } }],
  ['setContent', { target: 'n4', args: { html: '고침' } }],
  ['insertElement', { args: { parentId: 'n3', index: 1, type: 'text' } }],
  ['removeElement', { target: 'n5' }],
  ['moveElement', { target: 'n5', args: { newParentId: 'n6', index: 0 } }],
  ['duplicateElement', { target: 'n6' }],
  ['wrapElements', { target: ['n4', 'n5'], args: { boxType: 'card' } }],
  ['unwrapElement', { target: 'n3' }],
  ['reserveSections', { args: { n: 2, templateId: 'blockers' } }],
  ['reorderChildren', { target: 'nc', args: { order: [2, 0, 1] } }],
  ['insertChild', { target: 'nc', args: { index: 1, tag: 'li', html: '새 항목' } }],
  ['removeChild', { target: 'nc', args: { index: 1 } }],
  ['setChildContent', { target: 'nc', args: { index: 0, html: '고침' } }],
];

/* --------------------------------------------------------------- 기준 5 */

for (const [op, command] of MATRIX) {
  test(`기준 5 — ${op}: splice 구간 밖 바이트가 편집 전후 동일하다`, async () => {
    const { applyCommit } = await import('./commit.js');
    const before = onDisk();

    const r = applyCommit(DECK, {
      commitId: `p2-${op}`,
      pre: { docHash: hashOf(before) },
      commands: [{ op, ...command }],
    });

    assert.equal(r.applied, true, `${op} 이 아무것도 바꾸지 않았다 — 이 케이스는 P2 를 재지 못한다`);
    assert.ok(r.spliceRanges.length, 'spliceRanges 가 비어 있으면 검사할 구간이 없다');

    const after = onDisk();

    // 구간이 하나면 그대로 검사한다. 여럿이면 뒤에서부터 누적 적용하며 각각을 본다
    // (`splicedMany` 와 같은 순서 — 앞쪽 구간의 오프셋이 밀리지 않는다).
    let cursor = before;
    for (const e of [...r.spliceRanges].sort((a, b) => a.start - b.start).reverse()) {
      const applied = cursor.slice(0, e.start) + e.text + cursor.slice(e.end);
      const check = outsideIdentical(cursor, applied, e.start, e.end, e.text);
      assert.ok(check.ok, `${op}: 구간 [${e.start},${e.end}) 밖이 바뀌었다 (prefix=${check.prefixOk} suffix=${check.suffixOk})`);
      cursor = applied;
    }
    assert.equal(cursor, after, `${op}: 구간을 개별 적용한 결과가 디스크와 다르다`);
  });
}

test('기준 5 — 매트릭스가 등록된 명령을 전부 덮는다', async () => {
  await import('./commit.js');
  const { registeredOps } = await import('./commands.js');
  const covered = new Set(MATRIX.map(([op]) => op));
  assert.deepEqual(registeredOps().filter((op) => !covered.has(op)), [],
    '등록했는데 P2 를 재지 않은 명령이 있다');
});

test('기준 5 — 문서 전체가 재파싱되고 게이트를 통과한다 (전 명령 순차 적용 후)', async () => {
  const { applyCommit } = await import('./commit.js');
  // 서로 충돌하지 않는 순서로 이어 붙인다. 각 커밋은 직전 결과 위에서 돈다.
  const sequence = [
    { op: 'setProps', target: 'n4', args: { patch: { class: 'lead' } } },
    { op: 'setTex', target: 'n8', args: { tex: 'y=mx+b' } },
    { op: 'setValue', target: 'n9', args: { value: 30 } },
    { op: 'setContent', target: 'n7', args: { html: '새 제목' } },
    { op: 'insertElement', args: { parentId: 'n3', index: 0, type: 'text' } },
    { op: 'duplicateElement', target: 'n6' },
    { op: 'removeElement', target: 'n5' },
  ];
  for (const [i, c] of sequence.entries()) {
    applyCommit(DECK, { commitId: `seq-${i}`, pre: { docHash: hashOf(onDisk()) }, commands: [c] });
  }

  const after = onDisk();
  const doc = parseDocument(after);
  for (const el of findSections(doc)) {
    const { root } = buildTree(after, el, mapping, 'declared');
    const gate = sectionGate(root, after, mapping, 'AFTER');
    assert.ok(gate.pass, gate.findings.map((f) => `${f.rule} ${f.code} ${f.subject}`).join('\n'));
    assert.ok(gate.roundTripLossless);
  }
});

/* -------------------------------------------------------------- 기준 14 */

function gateOf(source) {
  const doc = parseDocument(source);
  const el = findSections(doc)[0];
  const { root } = buildTree(source, el, mapping, 'declared');
  return sectionGate(root, source, mapping, 'PROBE');
}

test('기준 14 — style="--pct:72" 는 통과한다 (단위 없는 수 = 데이터)', () => {
  const g = gateOf(HTML);
  assert.deepEqual(g.findings.filter((f) => f.code === 'design.data-prop-misuse'), []);
  assert.ok(g.pass);
});

test('기준 14 — style="--pct:72px" 는 design.data-prop-misuse (단위가 붙으면 디자인 값)', () => {
  const bad = HTML.replace('style="--pct:72"', 'style="--pct:72px"');
  const hits = gateOf(bad).findings.filter((f) => f.code === 'design.data-prop-misuse');
  assert.equal(hits.length, 1, JSON.stringify(gateOf(bad).findings, null, 1));
  assert.match(hits[0].remedy ?? hits[0].message ?? '', /단위 없는 수/);
});

test('기준 14 — style="width:72%" 는 규칙 5 가 잡는다 (인라인 기하)', () => {
  const bad = HTML.replace('style="--pct:72"', 'style="width:72%"');
  const codes = gateOf(bad).findings.map((f) => f.code);
  assert.ok(codes.includes('grammar.illegal-child'), `잡히지 않았다: ${codes.join(', ')}`);
});

test('기준 14 — 선언되지 않은 커스텀 프로퍼티도 misuse 다', () => {
  const bad = HTML.replace('style="--pct:72"', 'style="--pct:72;--rogue:3"');
  const hits = gateOf(bad).findings.filter((f) => f.code === 'design.data-prop-misuse');
  assert.equal(hits.length, 1);
  assert.match(hits[0].remedy ?? '', /허용목록에 없다/);
});

test('기준 14 — setValue 는 desync 상태를 만들 수 없다', async () => {
  const { applyCommit } = await import('./commit.js');
  applyCommit(DECK, {
    commitId: 'sync-1',
    pre: { docHash: hashOf(onDisk()) },
    commands: [{ op: 'setValue', target: 'n9', args: { value: 45 } }],
  });
  const g = gateOf(onDisk());
  assert.deepEqual(g.findings.filter((f) => f.code === 'grammar.data-prop-desync'), []);
});

test('기준 14 — 한쪽만 바꾼 소스는 grammar.data-prop-desync 로 잡힌다', () => {
  const bad = HTML.replace('data-value="72"', 'data-value="45"');
  const hits = gateOf(bad).findings.filter((f) => f.code === 'grammar.data-prop-desync');
  assert.equal(hits.length, 1);
});
