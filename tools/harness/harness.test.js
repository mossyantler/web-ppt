// node --test tools/harness/harness.test.js
//
// 이 테스트가 지키는 것은 하네스의 **판정 능력**이다. 픽스처가 초록불이 되는 것은
// M2 의 게이트이고, 여기서 요구하는 것은 (a) 초록불을 낼 수 있음 (b) 빨간불의 원인을
// 구별함 (c) 바이트 불변식을 실제로 검사함 셋이다.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadMapping, REQUIRED_CLAUSES } from './mapping.js';
import { buildTree, findSections, parseDocument } from './tree.js';
import { serialize, roundTrip, opaqueInventory, droppedByteSpans } from './serialize.js';
import { spliced, splicedMany, outsideIdentical, hashOf } from './splice.js';
import { documentGate, sectionGate } from './gate.js';
import { runSectionProbes, blockKindsOf, synthesize } from './probes.js';
import { listFixtures, judgeFixture, primaryCause, isAdoptFixable } from './index.js';

const mapping = loadMapping();
const fixtures = listFixtures();

/* ------------------------------------------------------------------ mapping */

test('mapping.json 이 grammar.md §2.4 의 필수 다섯 절을 갖는다', () => {
  for (const clause of REQUIRED_CLAUSES) assert.ok(clause in mapping.json, `누락: ${clause}`);
});

test('어휘 v1 의 크기가 리프 21 + 컨테이너 8 이다 (grammar.md §2.1·§2.2)', () => {
  const keys = Object.keys(mapping.json.blocks);
  assert.equal(keys.filter((k) => k.startsWith('el:')).length, 21);
  assert.equal(keys.filter((k) => k.startsWith('box:')).length, 8);
});

test('불투명 리프는 equation·progress 둘뿐이다 (§3.2 상한)', () => {
  assert.deepEqual(Object.keys(mapping.json.opaqueLeaves).sort(), ['equation', 'progress']);
});

test('어휘 값 21+8 전부가 insertElement 경로를 갖는다 — 빈 매핑이 없다', () => {
  // el:code 는 M1 종료 시점에 blocks 가 `{}` 였다. classFor() 가 항상 null 이면
  // 그 값은 어휘에 이름만 있고 만들 수 없다 — 검증되지 않은 채 통과하던 구멍이다.
  const empty = Object.keys(mapping.json.blocks)
    .filter((k) => k !== 'section')
    .filter((k) => mapping.classFor(k, 'default', k === 'box:region' ? 'body' : null) === null);
  assert.deepEqual(empty, [], '기본 variant 가 없는 어휘 값');
});

test('el:code 가 매핑·기본 태그·CSS 계약을 갖춘다', () => {
  assert.equal(mapping.classFor('el:code'), 'code');
  assert.equal(mapping.defaultTagFor('el:code'), 'pre');
  // `<pre>` 의 공백은 규약 G1 의 불투명 노드다. 화면에서도 보존되어야 문법 통과와
  // 렌더 결과가 어긋나지 않는다 — .prog-fill 과 같은 실패 모드 (§3.2).
  const css = readFileSync(join('themes', 'snu', 'theme.css'), 'utf8');
  assert.match(css, /\.code\s*\{[^}]*white-space:\s*pre/s);
});

test('table 의 구조 자식이 colgroup·col 을 포함한다 (L6 조항 6 깊이 2)', () => {
  for (const tag of ['colgroup', 'col', 'thead', 'tbody', 'tr', 'th', 'td', 'caption']) {
    assert.ok(mapping.isDeclaredStructuralChild('table', tag, []), `미선언: ${tag}`);
  }
});

/* -------------------------------------------------------------------- splice */

test('spliced 는 구간 밖 바이트를 건드리지 않는다', () => {
  const raw = 'abcdefghij';
  const out = spliced(raw, 3, 5, 'XYZ');
  assert.equal(out, 'abcXYZfghij');
  assert.ok(outsideIdentical(raw, out, 3, 5, 'XYZ').ok);
});

test('splicedMany 는 겹치는 구간을 거부한다', () => {
  assert.throws(() => splicedMany('abcdef', [{ start: 0, end: 3, text: 'x' }, { start: 2, end: 4, text: 'y' }]), /겹친다/);
});

test('outsideIdentical 은 구간 밖 변조를 잡는다', () => {
  const raw = 'abcdefghij';
  const bad = 'aXcQEFfghij';
  assert.equal(outsideIdentical(raw, bad, 3, 5, 'QEF').ok, false);
});

test('hashOf 는 안정적이다', () => {
  assert.equal(hashOf('a'), hashOf('a'));
  assert.notEqual(hashOf('a'), hashOf('b'));
});

/* ------------------------------------------------- 저작 트리 · 왕복 (규칙 7 · G1) */

test('픽스처 15개 + 테마 템플릿 10개 전부: 섹션 재직렬화가 원문 바이트와 동일하다', () => {
  assert.equal(fixtures.filter((f) => f.rel.startsWith('fixtures/')).length, 15,
    '픽스처는 정확히 15개다 (계획 §11 M1)');
  assert.equal(fixtures.filter((f) => f.inDenominator).length, 10,
    '게이트 분모는 themes/snu/templates/*.html 10개다 (계획 §11 M1 F-1)');
  for (const fx of fixtures) {
    const raw = readFileSync(fx.path, 'utf8');
    const doc = parseDocument(raw);
    for (const el of findSections(doc)) {
      const { root } = buildTree(raw, el, mapping, 'declared');
      assert.equal(serialize(root, raw), raw.slice(root.start, root.end), `${fx.rel} 섹션 왕복 손실`);
      assert.ok(roundTrip(root, raw).lossless, `${fx.rel} roundTrip.lossless=false`);
    }
  }
});

test('<pre> 여는 태그 직후 개행 — 파서가 버린 바이트를 저작 트리가 보존한다', () => {
  const fx = fixtures.find((f) => f.rel.includes('adv-02'));
  const raw = readFileSync(fx.path, 'utf8');
  const { root } = buildTree(raw, findSections(parseDocument(raw))[0], mapping, 'declared');
  const dropped = droppedByteSpans(root, raw);
  assert.ok(dropped.some((d) => d.tag === 'pre' && d.bytes.startsWith('\n')), '<pre> 직후 개행이 버려진 바이트로 관측되어야 한다');
  assert.equal(serialize(root, raw), raw.slice(root.start, root.end));
});

test('<tbody> 없는 표 — parse5 가 삽입한 요소는 태그 없이 자식만 직렬화된다 (§5.1 삭제 근거 2)', () => {
  const fx = fixtures.find((f) => f.rel.includes('method'));
  const raw = readFileSync(fx.path, 'utf8');
  const { root, notes } = buildTree(raw, findSections(parseDocument(raw))[0], mapping, 'declared');
  assert.ok(notes.some((n) => n.code === 'harness.synthesized-element' && n.tag === 'tbody'));
  assert.equal(serialize(root, raw), raw.slice(root.start, root.end));
  assert.equal(raw.includes('<tbody'), false, '소스에는 <tbody> 가 없다[g7]');
});

test('규약 G1 — moveElement 후 주석·CDATA 바이트가 개수·순서·바이트 모두 보존된다', () => {
  const fx = fixtures.find((f) => f.rel.includes('adv-01'));
  const raw = readFileSync(fx.path, 'utf8');
  const { root } = buildTree(raw, findSections(parseDocument(raw))[0], mapping, 'declared');
  const before = opaqueInventory(root, raw).filter((o) => o.nodeName === '#comment');
  assert.ok(before.length >= 5, `주석이 충분히 있어야 한다 (관측 ${before.length})`);

  const sibs = root.children.filter((c) => c.isElement && c.start !== null);
  const [a, b] = [sibs[0], sibs[1]];
  const after = splicedMany(raw, [
    { start: a.start, end: a.end, text: raw.slice(b.start, b.end) },
    { start: b.start, end: b.end, text: raw.slice(a.start, a.end) },
  ]);
  assert.notEqual(after, raw);

  const { root: root2 } = buildTree(after, findSections(parseDocument(after))[0], mapping, 'declared');
  const afterComments = opaqueInventory(root2, after).filter((o) => o.nodeName === '#comment');
  assert.equal(afterComments.length, before.length, '주석 개수 보존');
  for (const c of before) {
    assert.ok(afterComments.some((x) => x.bytes === c.bytes), `주석 바이트 소실: ${c.bytes.slice(0, 40)}`);
  }
});

test('유니코드 픽스처 — 재직렬화가 NFC 정규화나 이스케이프 재작성을 하지 않는다', () => {
  const fx = fixtures.find((f) => f.rel.includes('adv-04'));
  const raw = readFileSync(fx.path, 'utf8');
  const { root } = buildTree(raw, findSections(parseDocument(raw))[0], mapping, 'declared');
  const out = serialize(root, raw);
  assert.equal(out, raw.slice(root.start, root.end));
  assert.equal(out.normalize('NFC') === out, raw.slice(root.start, root.end).normalize('NFC') === raw.slice(root.start, root.end));
});

/* -------------------------------------------- 양성 대조군 — 초록불이 존재한다 */

// 문법 v1 을 만족하도록 손으로 주석한 최소 섹션. 하네스가 PASS 를 낼 수 있음을
// 증명하는 것이 이 대조군의 전부다. "미구현이라 전부 FAIL" 과 구별되지 않으면
// 하네스는 판정기가 아니다.
const GREEN = `<!DOCTYPE html>
<html lang="ko" data-deck-grammar="v1">
<head><meta charset="utf-8"></head>
<body>
<section data-slide data-slide-kind="content" data-node-id="n1" class="slide">
  <div data-box="region" data-region="head" data-node-id="n2" class="slide-head">
    <div data-el="meta" data-variant="lab" data-node-id="n3" class="lab">Lab <span>· 학부</span></div>
    <div data-el="meta" data-node-id="n4" class="meta">W28</div>
  </div>
  <div data-box="region" data-region="body" data-node-id="n5" class="slide-body">
    <!-- 어휘 밖 노드: 이 주석은 불투명하게 보존된다 -->
    <h2 data-el="title" data-node-id="n6" class="slide-title">제목</h2>
    <ul data-el="list" data-node-id="n7" class="list">
      <li>항목 하나</li>
      <li>항목 <b>둘</b></li>
    </ul>
    <div data-el="callout" data-node-id="n8" class="callout">
      <div class="q">질문</div>
      <div class="a">답</div>
    </div>
    <table data-el="table" data-node-id="n9" class="tbl">
      <colgroup><col style="width:40%"><col style="width:60%"></colgroup>
      <tr><td>가</td><td>나</td></tr>
    </table>
    <pre data-el="code" data-node-id="nd" class="code">u_t + u u_x = 0</pre>
    <div data-el="progress" data-node-id="na" class="prog-row" data-value="72" style="--pct:72">
      <span class="task">작업</span>
      <div class="prog-track"><div class="prog-fill" ></div></div>
      <span class="pct">72%</span>
    </div>
    <span data-el="equation" data-node-id="nb" data-tex="a=b" data-display="false"></span>
    <div data-el="rule" data-node-id="nc" class="title-rule"></div>
  </div>
</section>
</body>
</html>
`;

function greenSection() {
  const doc = parseDocument(GREEN);
  const el = findSections(doc)[0];
  return buildTree(GREEN, el, mapping, 'declared').root;
}

test('양성 대조군 — 손으로 주석한 섹션이 문서 게이트와 섹션 게이트를 통과한다', () => {
  const dg = documentGate(GREEN, 'GREEN');
  assert.ok(dg.ok, `문서 게이트 실패: ${JSON.stringify(dg.findings, null, 1)}`);
  const root = greenSection();
  const gate = sectionGate(root, GREEN, mapping, 'GREEN');
  assert.ok(gate.pass, `섹션 게이트 실패:\n${gate.findings.map((f) => `${f.rule} ${f.code} @${f.location.line} ${f.subject}`).join('\n')}`);
  assert.ok(gate.roundTripLossless);
});

test('양성 대조군 — 각 리프의 텍스트 편집과 순서 이동이 성공한다 (분자 2)', () => {
  const root = greenSection();
  const p = runSectionProbes({ raw: GREEN, root, mapping, mode: 'declared', file: 'GREEN', sectionIndex: 0, gatePassing: true });
  const bad = p.leafResults.filter((r) => r.edit.status !== 'pass' || r.move.status !== 'pass');
  assert.deepEqual(
    bad.map((b) => `${b.key} edit=${b.edit.status}:${b.edit.reason ?? ''} move=${b.move.status}:${b.move.reason ?? ''}`),
    [],
  );
  assert.equal(p.criterion2, 'pass');
  assert.ok(p.leafCount >= 8, `리프가 충분히 있어야 한다 (관측 ${p.leafCount})`);
});

test('양성 대조군 — 블록 종류마다 insertElement 로 같은 종류를 추가할 수 있다 (분자 3)', () => {
  const root = greenSection();
  const p = runSectionProbes({ raw: GREEN, root, mapping, mode: 'declared', file: 'GREEN', sectionIndex: 0, gatePassing: true });
  const bad = p.insertResults.filter((r) => r.result.status !== 'pass');
  // progress 의 삽입 경로는 themes/snu/templates/progress-row.html 이 생기면서 열렸다 (G-5).
  assert.deepEqual(bad.map((b) => `${b.key}|${b.variant}: ${b.result.reason}`), []);
  assert.equal(p.criterion3, 'pass');
  const good = p.insertResults.filter((r) => r.result.status === 'pass');
  assert.ok(good.length >= 6, `삽입 성공 종류가 충분해야 한다 (관측 ${good.length})`);
});

test('scaffolds[progress] 가 가리키는 조각 파일이 실제로 있다 (G-5)', () => {
  const p = mapping.scaffoldOf('progress');
  assert.ok(p, 'scaffolds[progress] 선언이 있어야 한다');
  assert.ok(readFileSync(p, 'utf8').includes('data-el="progress"'));
});

test('양성 대조군 — setContent 가 inlineClasses·구조 자식을 보존한다 (F-5ⓒ)', () => {
  const root = greenSection();
  const p = runSectionProbes({ raw: GREEN, root, mapping, mode: 'declared', file: 'GREEN', sectionIndex: 0, gatePassing: true });
  const list = p.leafResults.find((r) => r.key === 'el:list');
  assert.equal(list.edit.status, 'pass');
  assert.ok(list.edit.inlineHeld.ok);
  assert.ok(list.edit.inlineHeld.after.some((x) => x.startsWith('li.')), '구조 자식 <li> 가 살아 있어야 한다');
});

test('양성 대조군 — setValue 가 data-value 와 --pct 를 함께 갱신하고 스캐폴딩 바이트는 동일하다', () => {
  const root = greenSection();
  const p = runSectionProbes({ raw: GREEN, root, mapping, mode: 'declared', file: 'GREEN', sectionIndex: 0, gatePassing: true });
  const prog = p.leafResults.find((r) => r.key === 'el:progress');
  assert.equal(prog.edit.command, 'setValue');
  assert.equal(prog.edit.status, 'pass');
  assert.equal(prog.edit.scaffoldHeld, true);
});

test('규칙 6-b — data-value 와 --pct 가 어긋난 소스는 grammar.data-prop-desync 로 잡힌다', () => {
  const bad = GREEN.replace('data-value="72" style="--pct:72"', 'data-value="72" style="--pct:45"');
  const root = buildTree(bad, findSections(parseDocument(bad))[0], mapping, 'declared').root;
  const gate = sectionGate(root, bad, mapping, 'BAD');
  assert.ok(gate.findings.some((f) => f.code === 'grammar.data-prop-desync'), '동기 불변식 위반을 잡아야 한다');
});

test('§3.4 조항 2 — 단위 붙은 데이터 채널 값은 design.data-prop-misuse 다', () => {
  const bad = GREEN.replace('style="--pct:72"', 'style="--pct:72px"');
  const root = buildTree(bad, findSections(parseDocument(bad))[0], mapping, 'declared').root;
  const gate = sectionGate(root, bad, mapping, 'BAD');
  assert.ok(gate.findings.some((f) => f.code === 'design.data-prop-misuse'));
});

test('규칙 5 — canvas 밖 요소의 인라인 width 는 grammar.illegal-child 다. --* 는 대상이 아니다', () => {
  const bad = GREEN.replace('class="slide-title">제목', 'class="slide-title" style="width:50%">제목');
  const root = buildTree(bad, findSections(parseDocument(bad))[0], mapping, 'declared').root;
  const gate = sectionGate(root, bad, mapping, 'BAD');
  assert.ok(gate.findings.some((f) => f.code === 'grammar.illegal-child' && f.rule === '5-R5'));
  // 대조: --pct 는 규칙 5 를 발화시키지 않는다
  const clean = sectionGate(greenSection(), GREEN, mapping, 'GREEN');
  assert.equal(clean.findings.filter((f) => f.rule === '5-R5').length, 0);
});

test('규칙 6-c — 열거 밖 data-variant 는 grammar.unknown-variant 다', () => {
  const bad = GREEN.replace('data-el="meta" data-variant="lab"', 'data-el="meta" data-variant="nonexistent"');
  const root = buildTree(bad, findSections(parseDocument(bad))[0], mapping, 'declared').root;
  const gate = sectionGate(root, bad, mapping, 'BAD');
  assert.ok(gate.findings.some((f) => f.code === 'grammar.unknown-variant'));
});

test('규칙 4 — 섹션 안 <script> 는 grammar.document-script 이고 fixable:false 다', () => {
  const bad = GREEN.replace('<h2 data-el="title"', '<script>void 0</script>\n    <h2 data-el="title"');
  const root = buildTree(bad, findSections(parseDocument(bad))[0], mapping, 'declared').root;
  const gate = sectionGate(root, bad, mapping, 'BAD');
  const f = gate.findings.find((x) => x.code === 'grammar.document-script');
  assert.ok(f);
  assert.equal(f.fixable, false);
});

test('§4.1 — 중복 data-node-id 는 grammar.duplicate-id 이고 양쪽을 지목한다', () => {
  const bad = GREEN.replace('data-node-id="n7"', 'data-node-id="n6"');
  const root = buildTree(bad, findSections(parseDocument(bad))[0], mapping, 'declared').root;
  const gate = sectionGate(root, bad, mapping, 'BAD');
  assert.equal(gate.findings.filter((f) => f.code === 'grammar.duplicate-id').length, 2);
});

test('§5.2 — 모든 진단이 다섯 필드를 갖고 remedy 가 비어 있지 않다', () => {
  for (const fx of fixtures) {
    const r = judgeFixture(fx, mapping);
    for (const f of [...r.docGate.findings, ...r.sectionResults.flatMap((s) => s.gate.findings)]) {
      assert.ok(f.rule, 'rule 누락');
      assert.ok(f.code, 'code 누락');
      assert.ok(f.location && f.location.file, 'location 누락');
      assert.ok(typeof f.remedy === 'string' && f.remedy.length > 0, `remedy 가 비었다: ${f.code}`);
    }
  }
});

/* ---------------------------------------------------- 판정의 구별 능력 · 게이트 */

test('미구현은 SKIP 이 아니라 FAIL 로 분류된다 — pass/fail 외의 상태가 없다', () => {
  for (const fx of fixtures) {
    const r = judgeFixture(fx, mapping);
    for (const s of r.sectionResults) {
      for (const c of [s.criterion1, s.criterion2, s.criterion3]) {
        assert.ok(['pass', 'fail'].includes(c), `SKIP 상태가 나왔다: ${c}`);
      }
      assert.ok([0, 1].includes(s.score));
    }
  }
});

test('1차 원인이 unannotated 와 vocabulary-gap 을 구별한다', () => {
  const tpl = fixtures.filter((f) => f.group === 'templates').map((f) => judgeFixture(f, mapping));
  // 템플릿은 주석 커버리지 0%[g4] 이므로 선언 모드의 1차 원인은 unannotated 여야 한다.
  for (const r of tpl) {
    for (const s of r.sectionResults) assert.equal(s.primaryCause, 'unannotated', `${r.fx.rel}: ${s.primaryCause}`);
  }
  // 어휘 밖 값을 손으로 넣으면 vocabulary-gap 으로 갈린다.
  const bad = GREEN.replace('data-el="title"', 'data-el="doesnotexist"');
  const root = buildTree(bad, findSections(parseDocument(bad))[0], mapping, 'declared').root;
  const gate = sectionGate(root, bad, mapping, 'BAD');
  const cause = primaryCause({
    docGate: documentGate(bad, 'BAD'),
    gate,
    rt: { lossless: true, unexplained: [] },
    probes: { criterion2: 'fail', criterion3: 'fail' },
  });
  assert.equal(cause, 'vocabulary-gap');
});

test('isAdoptFixable 이 주석 부재와 어휘 부재를 가른다', () => {
  assert.equal(isAdoptFixable({ code: 'grammar.missing-id' }), true);
  assert.equal(isAdoptFixable({ code: 'grammar.unknown-element', violation: 'missing-data-el-or-data-box' }), true);
  assert.equal(isAdoptFixable({ code: 'grammar.unknown-element', violation: 'no-vocabulary-mapping-for-classes' }), false);
  assert.equal(isAdoptFixable({ code: 'grammar.unknown-variant' }), false);
  assert.equal(isAdoptFixable({ code: 'grammar.document-script' }), false);
});

test('게이트 분모는 템플릿 10섹션이고 악성·W31 은 제외된다', () => {
  const results = fixtures.map((f) => judgeFixture(f, mapping));
  const denom = results.filter((r) => r.fx.inDenominator).flatMap((r) => r.sectionResults);
  assert.equal(denom.length, 10);
  const excluded = results.filter((r) => !r.fx.inDenominator);
  assert.equal(excluded.filter((r) => r.fx.group === 'legacy').flatMap((r) => r.sectionResults).length, 13);
  assert.equal(excluded.filter((r) => r.fx.group === 'adversarial').length, 4);
});

test('legacyEditableRatio 를 산출한다 (게이트 아님)', () => {
  const legacy = fixtures.filter((f) => f.group === 'legacy').map((f) => judgeFixture(f, mapping));
  const s = legacy.flatMap((r) => r.sectionResults);
  assert.equal(s.length, 13);
  const ratio = s.filter((x) => x.score === 1).length / s.length;
  assert.ok(ratio >= 0 && ratio <= 1);
});

/* ------------------------------------------------------------------ 삽입 합성 */

test('synthesize 가 선언되지 않은 (값, variant) 쌍을 만들어내지 않는다', () => {
  // el:code 는 M1 종료 시점에 blocks 가 `{}` 였고 이 자리에 그 구멍이 기대값으로 박혀
  // 있었다. 매핑이 채워졌으므로 이제는 선언되지 않은 variant 로 같은 성질을 검사한다.
  assert.equal(mapping.classFor('el:code', 'nosuchvariant'), null, '선언되지 않은 variant 는 만들어내지 않는다');
  assert.equal(mapping.classFor('box:grid', 'tab'), null, 'col-tab 은 grid 의 variant 가 아니라 el:heading 이다');
  const kinds = blockKindsOf(greenSection());
  for (const [, k] of kinds) {
    const html = synthesize(mapping, { ...k, id: 'nzz' });
    assert.ok(html.includes(`data-node-id="nzz"`));
    const attr = k.key.startsWith('box:') ? 'data-box' : 'data-el';
    assert.ok(html.includes(`${attr}="${k.value}"`));
  }
});

test('문서 레벨 게이트 — 미선언 스크립트는 경고이고 잠금이 아니다 (§6.3 3단계)', () => {
  const withScript = GREEN.replace('</head>', '<script src="assets/analytics.js"></script></head>');
  const dg = documentGate(withScript, 'BAD');
  assert.equal(dg.undeclaredScripts, 1);
  assert.equal(dg.locked, false);
  assert.equal(dg.warnings.length, 1);
  assert.match(dg.warnings[0], /선언되지 않은 스크립트 1개/);
});

test('문서 레벨 게이트 — 선언과 문법의 모순만 문서를 잠근다 (§6.3 4단계)', () => {
  const policy = `<meta name="deck-script-policy" content='[{"ref":"a.js","as":"runtime-leaf","leaf":"nosuchleaf"}]'>`;
  const doc = GREEN.replace('</head>', `${policy}<script src="a.js"></script></head>`);
  const dg = documentGate(doc, 'BAD');
  assert.equal(dg.locked, true);
  assert.ok(dg.findings.some((f) => f.code === 'grammar.document-script' && f.fixable === false));

  const good = GREEN.replace('</head>', `<meta name="deck-script-policy" content='[{"ref":"katex.js","as":"runtime-leaf","leaf":"equation"}]'><script src="katex.js"></script></head>`);
  const dg2 = documentGate(good, 'OK');
  assert.equal(dg2.locked, false);
  assert.equal(dg2.undeclaredScripts, 0);
});

test('파일에 쓰지 않는다 — 픽스처의 해시가 판정 전후 동일하다', () => {
  const before = fixtures.map((f) => hashOf(readFileSync(f.path, 'utf8')));
  fixtures.forEach((f) => judgeFixture(f, mapping));
  const after = fixtures.map((f) => hashOf(readFileSync(f.path, 'utf8')));
  assert.deepEqual(after, before);
  const mappingPath = join('themes', 'snu', 'mapping.json');
  assert.ok(readFileSync(mappingPath, 'utf8').length > 0);
});

/* ------------------------------------------- region 두 축 · 클래스 없는 <div> (G-1~G-4) */

test('region 은 data-region(슬롯)과 data-variant(조판) 두 축을 진다 (G-2)', () => {
  assert.equal(mapping.classFor('box:region', 'default', 'body'), 'slide-body');
  assert.equal(mapping.classFor('box:region', 'cols2', 'body'), 'slide-body cols-2');
  assert.equal(mapping.classFor('box:region', 'cols57', 'body'), 'slide-body cols-5-7');
  assert.equal(mapping.classFor('box:region', 'stackGap6', 'body'), 'slide-body stack gap-6');
  assert.deepEqual(mapping.regionSlots(), mapping.json.regionEnum);
});

test('data-region 이 열거 밖이거나 없으면 규칙 6-c 로 잡힌다', () => {
  const bad = GREEN.replace('data-region="body"', 'data-region="middle"');
  const doc = parseDocument(bad);
  const root = buildTree(bad, findSections(doc)[0], mapping, 'declared').root;
  const g = sectionGate(root, bad, mapping, 'BAD');
  assert.ok(g.findings.some((f) => f.rule === '5-R6c' && /middle/.test(f.remedy)));

  const none = GREEN.replace(' data-region="body"', '');
  const doc2 = parseDocument(none);
  const root2 = buildTree(none, findSections(doc2)[0], mapping, 'declared').root;
  assert.ok(sectionGate(root2, none, mapping, 'BAD2').findings.some((f) => f.rule === '5-R6c'));
});

test('같은 region 값이라도 슬롯이 다르면 다른 블록 종류다 (분자 3)', () => {
  const kinds = [...blockKindsOf(greenSection()).keys()];
  assert.ok(kinds.includes('box:region@head|default'));
  assert.ok(kinds.includes('box:region@body|default'));
});

test('클래스 없는 <div> 는 구조로 갈린다 — 컨테이너 vs 리프 (G-1·G-3)', async () => {
  const { classify } = await import('../adopt/core.js');
  const parseOne = (html) => findSections(parseDocument(
    `<html><body><section>${html}</section></body></html>`,
  ))[0].childNodes.find((n) => n.tagName);

  // 요소 자식이 주석 대상 → 컨테이너
  assert.deepEqual(
    (({ type, value, variant }) => ({ type, value, variant }))(classify(parseOne('<div><div class="card-head">x</div></div>'))),
    { type: 'box', value: 'group', variant: 'plain' },
  );
  // 인라인 flex 를 선언한 래퍼 → row
  assert.equal(classify(parseOne('<div style="display:flex"><span class="pill">x</span></div>')).value, 'row');
  // 인라인·텍스트뿐 → 저작 리프 text
  assert.deepEqual(
    (({ type, value }) => ({ type, value }))(classify(parseOne('<div><span class="k">Week</span><span class="v">W28</span></div>'))),
    { type: 'leaf', value: 'text' },
  );
});

/* -------------------------------------------------- 게이트 자체 (계획 §11 M1 F-1) */

test('M1 커버리지 게이트 — 테마 템플릿 10섹션이 100% 통과한다', () => {
  const denom = fixtures.filter((f) => f.inDenominator)
    .flatMap((f) => judgeFixture(f, mapping).sectionResults);
  assert.equal(denom.length, 10, '분모는 10 섹션이다');
  const failed = denom.filter((s) => s.score !== 1);
  assert.deepEqual(failed.map((s) => `${s.index}: ${s.primaryCause}`), [], '기준은 10/10 = 100% 다');
});
