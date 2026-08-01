#!/usr/bin/env node
// M1-3 왕복 하네스 — 계획 §11 M1 게이트를 실제로 판정한다.
//
// 판정 3종 (셋 전부 성립해야 그 섹션이 1점):
//   (1) adoptSection 없이 문법 v1 통과
//   (2) 각 리프의 텍스트 편집·순서 이동 성공 + 편집 구간 밖 바이트 동일
//   (3) 섹션에 나타나는 각 블록 종류마다 insertElement 로 같은 종류 추가 가능
//
// 미구현 항목은 SKIP 이 아니라 FAIL 이다. 초록불은 M1 의 게이트가 아니다 — 판정 가능함이 게이트다.
//
// 사용법
//   node tools/harness/index.js                 픽스처 전체 판정 + 게이트 요약
//   node tools/harness/index.js --json          기계 판독용 JSON
//   node tools/harness/index.js --verbose       섹션별 실패 진단 전부
//   node tools/harness/index.js --diagnose      비게이팅 Axis B (추정 분류) 까지
//   node tools/harness/index.js <경로…>          지정한 파일만

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
import { loadMapping } from './mapping.js';
import { buildTree, findSections } from './tree.js';
import { documentGate, sectionGate } from './gate.js';
import { roundTrip, opaqueInventory } from './serialize.js';
import { runSectionProbes } from './probes.js';
import { splicedMany } from './splice.js';

const ROOT = process.cwd();

// 게이트 분모는 계획 §11 M1 F-1 이 정한 대로 `themes/snu/templates/*.html` 10섹션이다.
// `fixtures/templates/*.html` 은 같은 10종의 **주석 이전** 바이트 사본이며, 분모가 아니라
// adoptSection 의 입력이자 왕복 바이트 픽스처다. 둘을 분모에 함께 넣으면 같은 섹션을 두 번 센다.
const GROUPS = [
  { name: 'theme-templates', dir: 'themes/snu/templates', inDenominator: true },
  { name: 'templates', dir: 'fixtures/templates', inDenominator: false },
  { name: 'legacy', dir: 'fixtures/legacy', inDenominator: false },
  { name: 'adversarial', dir: 'fixtures/adversarial', inDenominator: false },
];

/** 테마 조각 파일(mapping.scaffolds 가 가리키는 것)은 슬라이드가 아니므로 판정 대상이 아니다. */
const NOT_A_DECK = new Set(['progress-row.html']);

function listFixtures() {
  const out = [];
  for (const g of GROUPS) {
    const dir = join(ROOT, g.dir);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.html') && !NOT_A_DECK.has(f)).sort()) {
      out.push({ group: g.name, inDenominator: g.inDenominator, path: join(dir, f), rel: `${g.dir}/${f}` });
    }
  }
  return out;
}

/** 경로로 지정한 파일도 그룹을 추론한다 — 템플릿을 지정하면 분모에 들어간다. */
function adHocFixture(p) {
  const path = isAbsolute(p) ? p : join(ROOT, p);
  const rel = relative(ROOT, path);
  // repo 안이면 경로 접두사로 정확히 가른다. repo 밖(스크래치패드)이면 마지막 디렉터리 이름으로
  // 추론한다 — `…/templates/x.html` 은 테마 템플릿의 후보본이므로 분모에 들어간다.
  const g = GROUPS.find((g) => rel.startsWith(g.dir))
    ?? GROUPS.find((g) => path.includes(`/${g.dir.split('/').pop()}/`));
  return { group: g?.name ?? 'ad-hoc', inDenominator: g?.inDenominator ?? false, path, rel: rel.startsWith('..') ? path : rel };
}

/**
 * 진단이 adoptSection 으로 치유되는 범주인가.
 *
 * 이 구분이 하네스의 존재 이유 절반이다 — "구현 전이라 빨간불"(adopt 미실행)과
 * "픽스처·문법이 잘못돼서 빨간불"(어휘 부재)을 가른다. 앞은 M1-4/M8 의 일이고,
 * 뒤는 M1 이 어휘를 넓혀서 끝내야 하는 일이다 (계획 §11 M1 F-1).
 */
export function isAdoptFixable(f) {
  if (f.code === 'grammar.missing-id') return true;
  if (f.code === 'grammar.missing-deck-grammar') return true;
  if (f.code === 'grammar.data-prop-desync') return true; // adoptSection 이 --pct 를 치환한다 (§3.2)
  if (f.code === 'grammar.unknown-element') {
    return f.violation === 'missing-data-el-or-data-box' || f.rule === '5-R1' || !f.violation;
  }
  return false;
}

/* --------------------------------------------------------------- 픽스처 판정 */

function judgeFixture(fx, mapping, { mode = 'declared' } = {}) {
  const raw = readFileSync(fx.path, 'utf8');
  const docGate = documentGate(raw, fx.rel);
  const sections = findSections(docGate.doc);

  const sectionResults = sections.map((el, i) => {
    const { root, notes } = buildTree(raw, el, mapping, mode);
    const gate = sectionGate(root, raw, mapping, fx.rel);
    const rt = roundTrip(root, raw);

    // 문서 수준 전제가 깨지면 섹션 판정으로 내려가지 않는다 (grammar.md §5).
    const docBlocked = !docGate.ok;
    const criterion1 = !docBlocked && gate.pass ? 'pass' : 'fail';

    const probes = runSectionProbes({
      raw,
      root,
      mapping,
      mode,
      file: fx.rel,
      sectionIndex: i,
      gatePassing: gate.pass,
    });

    const score = criterion1 === 'pass' && probes.criterion2 === 'pass' && probes.criterion3 === 'pass' ? 1 : 0;

    // 비게이팅 정합성 — 선언된 (값, variant) 가 mapping 의 클래스와 어긋나는가.
    // 문법 §5 의 규칙 1~7 에 없으므로 점수에 넣지 않는다. L7 조항 4("서버가 blocks 를
    // 조회해 class 를 함께 갱신한다")가 M2 에서 지켜지는지 보는 계측이다.
    const classVariantMismatches = [];
    root.walk((n) => {
      if (!n.key || !['container', 'leaf-authored', 'leaf-opaque', 'leaf-void'].includes(n.kind)) return;
      const expected = mapping.classFor(n.key, n.variant ?? 'default', n.regionSlot ?? null);
      if (expected === null) return;
      const want = expected.split(/\s+/).filter(Boolean);
      if (!want.every((c) => n.classes.includes(c))) {
        classVariantMismatches.push({
          line: n.loc?.line ?? null, key: n.key, variant: n.variant ?? 'default',
          expected, actual: n.classes.join(' '),
        });
      }
    });

    return {
      index: i,
      line: root.loc?.line ?? null,
      nodeId: root.nodeId,
      criterion1,
      criterion2: probes.criterion2,
      criterion3: probes.criterion3,
      score,
      docBlocked,
      gate,
      roundTrip: { lossless: rt.lossless, unexplained: rt.unexplained },
      probes,
      notes,
      classVariantMismatches,
      primaryCause: primaryCause({ docGate, gate, rt, probes }),
      opaqueNodeCount: opaqueInventory(root, raw).length,
      root,
      raw,
    };
  });

  return { fx, raw, docGate, sectionResults };
}

/**
 * 빨간불의 1차 원인을 하나로 압축한다. 이것이 "구현 전이라 빨간불" 과 "픽스처가 잘못돼서
 * 빨간불" 을 가르는 축이다.
 *
 *  unannotated        — 주석이 아예 없다. 어휘의 결함이 아니라 adoptSection 미실행 (M8/M1-4)
 *  vocabulary-gap     — 주석은 있는데 어휘·mapping 에 대응 값이 없다 → 문법의 결함
 *  round-trip-loss    — 재직렬화가 원문과 다르다 → 저작 트리·하네스의 결함
 *  probe-failure      — 문법은 통과하는데 편집/이동/삽입이 깨진다 → 명령 계층의 결함
 *  document-gate      — 문서 수준 전제 미충족
 *  none               — 전부 통과
 */
function primaryCause({ docGate, gate, rt, probes }) {
  if (!rt.lossless) return 'round-trip-loss';
  const codes = gate.findings.map((f) => f.code);
  const unknown = gate.findings.filter((f) => f.code === 'grammar.unknown-element');
  const missingId = codes.filter((c) => c === 'grammar.missing-id').length;
  if (unknown.length && unknown.every((f) => f.violation === 'missing-data-el-or-data-box' || !f.violation)) {
    return missingId > 0 ? 'unannotated' : 'vocabulary-gap';
  }
  if (unknown.some((f) => f.violation === 'no-vocabulary-mapping-for-classes' || f.violation === 'value-outside-vocabulary')) {
    return 'vocabulary-gap';
  }
  if (!docGate.ok && gate.pass) return 'document-gate';
  if (gate.pass && (probes.criterion2 === 'fail' || probes.criterion3 === 'fail')) return 'probe-failure';
  if (gate.findings.length) return 'grammar-violation';
  if (!docGate.ok) return 'document-gate';
  return 'none';
}

/* ------------------------------------------- 악성 픽스처 — P2 · 규약 G1 전용 판정 */

/**
 * 악성 4개는 어휘의 시험 대상이 아니다. 시험하는 것은 둘이다.
 *   P2 — 편집 구간 밖 바이트 보존
 *   G1 — 어휘 밖 노드(주석·CDATA·<pre> 공백·유니코드)의 불투명 보존
 *
 * 섹션 전체를 재직렬화하는 경로(구조 명령)를 실제로 지나가게 한 뒤 바이트를 본다.
 */
function judgeAdversarial(fixResult, mapping) {
  const { raw, sectionResults } = fixResult;
  const out = [];
  for (const s of sectionResults) {
    const root = s.root;
    const before = opaqueInventory(root, raw);
    const sibs = root.children.filter((c) => c.isElement && c.start !== null);

    let move = { status: 'fail', reason: '섹션에 맞바꿀 요소 자식이 둘 이상 없다' };
    let after = raw;
    let touched = [];
    if (sibs.length >= 2) {
      const [a, b] = [sibs[0], sibs[1]];
      touched = [a, b];
      const edits = [
        { start: a.start, end: a.end, text: raw.slice(b.start, b.end) },
        { start: b.start, end: b.end, text: raw.slice(a.start, a.end) },
      ];
      after = splicedMany(raw, edits);
      move = { status: 'pass', swapped: [a.tag, b.tag] };
    }

    // 재직렬화 경로: 편집 후 소스를 다시 파싱해 섹션을 직렬화하고 바이트를 비교한다.
    const reparsed = after === raw ? root : buildTree(after, findSections(documentGate(after, fixResult.fx.rel).doc)[s.index], mapping, 'declared').root;
    const afterInv = opaqueInventory(reparsed, after);

    const outsideBefore = before.filter((o) => !touched.some((t) => within(o, t)));
    const missing = outsideBefore.filter((o) => !afterInv.some((x) => x.bytes === o.bytes));
    const countHeld = before.length === afterInv.length;
    const orderHeld = sameOrder(outsideBefore.map((o) => o.bytes), afterInv.map((o) => o.bytes));
    const sectionBytesHeld = sibs.length >= 2
      ? after.includes(raw.slice(sibs[0].start, sibs[0].end)) && after.includes(raw.slice(sibs[1].start, sibs[1].end))
      : null;

    out.push({
      index: s.index,
      opaqueBefore: before.length,
      opaqueAfter: afterInv.length,
      move,
      g1: {
        status: missing.length === 0 && countHeld && orderHeld ? 'pass' : 'fail',
        countHeld,
        orderHeld,
        missing: missing.slice(0, 5).map((m) => trunc(m.bytes)),
      },
      p2: {
        status: s.roundTrip.lossless && sectionBytesHeld !== false ? 'pass' : 'fail',
        roundTripLossless: s.roundTrip.lossless,
        movedBytesHeld: sectionBytesHeld,
      },
    });
  }
  return out;
}

/** 불투명 노드 o 가 명령이 직접 건드린 노드 t 의 바이트 구간 안에 있는가. */
const within = (o, t) => o.start !== null && t.start !== null && o.start >= t.start && o.end <= t.end;

function sameOrder(subset, full) {
  let i = 0;
  for (const b of full) {
    if (i < subset.length && b === subset[i]) i++;
  }
  return i === subset.length;
}

const trunc = (s, n = 60) => (s.length <= n ? s : `${s.slice(0, n)}…`).replace(/\n/g, '\\n');

/* --------------------------------------------------------------------- 출력 */

const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);
const mark = (v) => (v === 'pass' ? '✔' : v === 'fail' ? '✘' : '·');

function printFixtureTable(results) {
  console.log('\n## 픽스처 × 섹션 판정\n');
  console.log(`${pad('픽스처', 34)} ${pad('§', 3)} ${pad('line', 5)} ${pad('(1)문법', 7)} ${pad('(2)편집·이동', 12)} ${pad('(3)삽입', 7)} ${pad('점수', 4)} 1차 원인`);
  console.log('-'.repeat(110));
  for (const r of results) {
    for (const s of r.sectionResults) {
      console.log(
        `${pad(r.fx.rel.replace('fixtures/', ''), 34)} ${pad(s.index, 3)} ${pad(s.line ?? '-', 5)} ` +
        `${pad(mark(s.criterion1), 7)} ${pad(mark(s.criterion2), 12)} ${pad(mark(s.criterion3), 7)} ${pad(s.score, 4)} ${s.primaryCause}`,
      );
    }
  }
}

function printGateSummary(results) {
  const denom = results.filter((r) => r.fx.inDenominator);
  const sections = denom.flatMap((r) => r.sectionResults);
  const passed = sections.filter((s) => s.score === 1).length;
  const pct = sections.length ? ((passed / sections.length) * 100).toFixed(0) : '0';

  console.log('\n## M1 커버리지 게이트\n');
  console.log(`분모  템플릿 ${denom.length}개 파일 / ${sections.length} 섹션`);
  console.log(`분자  ${passed} 섹션 ((1)(2)(3) 전부 성립)`);
  console.log(`커버리지  ${passed}/${sections.length} = ${pct}%   기준 100%   →  ${passed === sections.length && sections.length > 0 ? 'PASS' : 'FAIL'}`);

  const byCause = new Map();
  for (const s of sections) byCause.set(s.primaryCause, (byCause.get(s.primaryCause) ?? 0) + 1);
  console.log('\n실패 1차 원인 분포');
  for (const [cause, n] of [...byCause].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${pad(cause, 20)} ${padL(n, 3)} 섹션`);
  }

  const criteria = ['criterion1', 'criterion2', 'criterion3'];
  console.log('\n기준별 통과 수');
  for (const c of criteria) {
    const n = sections.filter((s) => s[c] === 'pass').length;
    console.log(`  ${pad(c, 20)} ${padL(n, 3)}/${sections.length}`);
  }
}

function printLegacy(results) {
  const legacy = results.filter((r) => r.fx.group === 'legacy');
  if (!legacy.length) return;
  console.log('\n## legacyEditableRatio (비게이팅 기록)\n');
  for (const r of legacy) {
    const s = r.sectionResults;
    const g1 = s.filter((x) => x.criterion1 === 'pass').length;
    const all = s.filter((x) => x.score === 1).length;
    console.log(`${r.fx.rel}`);
    console.log(`  문법 v1 통과            ${g1}/${s.length}`);
    console.log(`  (1)(2)(3) 전부 성립     ${all}/${s.length}   ← legacyEditableRatio`);
    const byCause = new Map();
    for (const x of s) byCause.set(x.primaryCause, (byCause.get(x.primaryCause) ?? 0) + 1);
    console.log(`  1차 원인 분포           ${[...byCause].map(([c, n]) => `${c}:${n}`).join(' · ')}`);
  }
}

function printAdversarial(results, mapping) {
  const adv = results.filter((r) => r.fx.group === 'adversarial');
  if (!adv.length) return;
  console.log('\n## 악성 픽스처 — P2 · 규약 G1 (어휘 커버리지 아님)\n');
  console.log(`${pad('픽스처', 40)} ${pad('불투명 노드', 11)} ${pad('moveElement', 12)} ${pad('G1', 4)} ${pad('P2', 4)} 비고`);
  console.log('-'.repeat(100));
  for (const r of adv) {
    const judged = judgeAdversarial(r, mapping);
    for (const j of judged) {
      const note = [
        j.g1.status === 'fail' ? `G1 누락 ${j.g1.missing.length}건` : '',
        j.g1.countHeld ? '' : `개수 ${j.opaqueBefore}→${j.opaqueAfter}`,
        j.move.status === 'fail' ? j.move.reason : '',
      ].filter(Boolean).join(' · ');
      console.log(
        `${pad(r.fx.rel.replace('fixtures/', ''), 40)} ${pad(j.opaqueBefore, 11)} ${pad(mark(j.move.status), 12)} ` +
        `${pad(mark(j.g1.status), 4)} ${pad(mark(j.p2.status), 4)} ${note}`,
      );
      if (j.g1.missing.length) for (const m of j.g1.missing) console.log(`    누락 바이트: ${m}`);
    }
  }
}

function printDiagnostics(results, mapping, { verbose }) {
  console.log('\n## 진단 — 섹션별 실패 상세\n');
  for (const r of results) {
    if (r.docGate.findings.length || r.docGate.warnings.length) {
      console.log(`${r.fx.rel}  [문서 레벨]`);
      for (const f of r.docGate.findings) console.log(`  ✘ ${f.rule} ${f.code} @${f.location.line} — ${f.remedy}`);
      for (const w of r.docGate.warnings) console.log(`  ⚠ ${w}`);
      const undecl = r.docGate.scripts.filter((s) => s.declaration === 'undeclared');
      for (const s of undecl) console.log(`    스크립트 목록: ${s.kind} ${s.ref} (line ${s.line}, ${s.size ?? '-'}줄) — declaration=undeclared`);
      if (r.docGate.styles.length) console.log(`    deck-local <style> ${r.docGate.styles.length}개 (D-3 통과, setTheme 적용 범위 보고 대상)`);
    }
    for (const s of r.sectionResults) {
      if (s.score === 1) continue;
      const uniq = dedupeFindings(s.gate.findings);
      console.log(`${r.fx.rel} §${s.index} (line ${s.line}) — 1차 원인 ${s.primaryCause}`);
      console.log(`  문법 진단 ${s.gate.findings.length}건 (고유 ${uniq.length}종)`);
      for (const [key, group] of uniq.slice(0, verbose ? 100 : 6)) {
        const f = group[0];
        console.log(`   ✘ ${pad(f.rule, 7)} ${pad(f.code, 26)} ×${padL(group.length, 3)}  ${trunc(f.subject ?? '', 44)}`);
        console.log(`       line ${group.slice(0, 6).map((x) => x.location.line).join(',')}${group.length > 6 ? ',…' : ''} — ${f.remedy}`);
      }
      if (!verbose && uniq.length > 6) console.log(`   … ${uniq.length - 6}종 더 (--verbose)`);
      const p = s.probes;
      console.log(`  리프 ${p.leafCount}개 · 블록 종류 ${p.blockKindCount}개 · (2)=${p.criterion2} (3)=${p.criterion3}`);
      const badEdits = p.leafResults.filter((x) => x.edit.status === 'fail' || x.move.status === 'fail');
      for (const b of (verbose ? badEdits : badEdits.slice(0, 4))) {
        if (b.edit.status === 'fail') console.log(`   ✘ 편집 ${b.key}|${b.variant} line ${b.line} — ${b.edit.reason}`);
        if (b.move.status === 'fail') console.log(`   ✘ 이동 ${b.key}|${b.variant} line ${b.line} — ${b.move.reason}`);
      }
      if (!verbose && badEdits.length > 4) console.log(`   … 리프 프로브 실패 ${badEdits.length - 4}건 더 (--verbose)`);
      const badIns = p.insertResults.filter((x) => x.result.status === 'fail');
      for (const b of (verbose ? badIns : badIns.slice(0, 4))) {
        console.log(`   ✘ 삽입 ${b.key}|${b.variant} ×${b.count} — ${b.result.reason}`);
      }
      if (!verbose && badIns.length > 4) console.log(`   … 삽입 프로브 실패 ${badIns.length - 4}건 더 (--verbose)`);
      if (s.classVariantMismatches.length) {
        console.log(`  ⚠ 비게이팅 — (값, variant) ↔ class 불일치 ${s.classVariantMismatches.length}건 (L7 조항 4 계측)`);
        for (const m of s.classVariantMismatches.slice(0, verbose ? 100 : 3)) {
          console.log(`     line ${m.line} ${m.key}|${m.variant} 기대 class="${m.expected}" 실제 class="${m.actual}"`);
        }
      }
      if (p.criterion2Reason) console.log(`   · (2) ${p.criterion2Reason}`);
      if (p.criterion3Reason) console.log(`   · (3) ${p.criterion3Reason}`);
      console.log('');
    }
  }
}

function dedupeFindings(findings) {
  const m = new Map();
  for (const f of findings) {
    const k = `${f.rule}|${f.code}|${f.violation ?? ''}`;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(f);
  }
  return [...m].sort((a, b) => b[1].length - a[1].length);
}

/**
 * Axis B — 비게이팅 진단. 클래스 역방향 조회로 분류를 추정한 뒤 같은 판정을 돌린다.
 * 게이트에 영향을 주지 않는다. 답하는 질문은 하나다 —
 * "주석만 붙이면 통과하는가(=unannotated), 아니면 어휘가 부족한가(=vocabulary-gap)?"
 */
function printAxisB(fixtures, mapping) {
  console.log('\n## Axis B — 추정 분류 판정 (비게이팅)\n');
  console.log('클래스 역방향 조회로 (data-el|data-box, variant) 를 추정한 뒤 같은 세 판정을 돌린다.');
  console.log('추정 분류에서도 실패하면 원인은 주석 부재가 아니라 어휘·mapping 부재다.\n');
  console.log('(1*) = adoptSection 이 치유하는 진단(id·data-el 부여·--pct 치환)을 제외한 잔여 진단이 0인가.');
  console.log('     (1*)✔ 이면 "주석만 붙이면 통과" 다. (1*)✘ 이면 어휘·mapping 을 넓혀야 한다.\n');
  console.log(`${pad('픽스처', 34)} ${pad('§', 3)} ${pad('(1*)', 5)} ${pad('(2)', 4)} ${pad('(3)', 4)} ${pad('미매핑', 6)} 잔여 진단 / 미매핑 클래스`);
  console.log('-'.repeat(126));

  const unmappedAll = new Map();
  const residualAll = new Map();
  const rows = [];
  for (const fx of fixtures) {
    const r = judgeFixture(fx, mapping, { mode: 'inferred' });
    for (const s of r.sectionResults) {
      const unmapped = [];
      s.root.walk((n) => {
        if (n.kind === 'unknown-element' && n.violation === 'no-vocabulary-mapping-for-classes') {
          const label = `${n.tag}.${n.classes.join('.') || '(클래스 없음)'}`;
          unmapped.push(label);
          unmappedAll.set(label, (unmappedAll.get(label) ?? 0) + 1);
        }
      });
      const residual = s.gate.findings.filter((f) => !isAdoptFixable(f));
      for (const f of residual) residualAll.set(f.code, (residualAll.get(f.code) ?? 0) + 1);
      const c1star = residual.length === 0 && s.roundTrip.lossless ? 'pass' : 'fail';
      const note = [
        ...new Set(residual.map((f) => f.code)),
        ...new Set(unmapped),
      ].slice(0, 4).join(' ');
      rows.push({ rel: fx.rel, s, unmapped, residual, c1star });
      console.log(
        `${pad(fx.rel.replace('fixtures/', ''), 34)} ${pad(s.index, 3)} ${pad(mark(c1star), 5)} ` +
        `${pad(mark(s.criterion2), 4)} ${pad(mark(s.criterion3), 4)} ${pad(unmapped.length, 6)} ${note}`,
      );
      for (const p of s.probes.leafResults) {
        if (p.edit.status === 'fail') console.log(`      ✘ 편집 ${p.key}|${p.variant} line ${p.line} — ${p.edit.reason}`);
        if (p.move.status === 'fail') console.log(`      ✘ 이동 ${p.key}|${p.variant} line ${p.line} — ${p.move.reason}`);
      }
      for (const p of s.probes.insertResults) {
        if (p.result.status === 'fail') console.log(`      ✘ 삽입 ${p.key}|${p.variant} ×${p.count} — ${p.result.reason}`);
      }
    }
  }

  const denomRows = rows.filter((r) => r.rel.startsWith('fixtures/templates'));
  if (denomRows.length) {
    const n = denomRows.filter((r) => r.c1star === 'pass' && r.s.criterion2 === 'pass' && r.s.criterion3 === 'pass').length;
    console.log(`\n템플릿 분모에서 (1*)(2)(3) 전부 성립: ${n}/${denomRows.length}`);
    console.log('  = adoptSection 이 주석을 부여했다고 가정했을 때 도달 가능한 커버리지 상한 (비게이팅 추정)');
  }
  if (residualAll.size) {
    console.log('\n잔여 진단 (adoptSection 이 치유하지 않는 것) 분포');
    for (const [code, n] of [...residualAll].sort((a, b) => b[1] - a[1])) console.log(`  ${padL(n, 4)}  ${code}`);
  }

  console.log('\n어휘·mapping 이 표현하지 못하는 노드 (전 픽스처 집계)');
  for (const [label, n] of [...unmappedAll].sort((a, b) => b[1] - a[1]).slice(0, 30)) {
    console.log(`  ${padL(n, 4)}  ${label}`);
  }
  return rows;
}

/* ---------------------------------------------------------------------- main */

function main() {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith('--')));
  const paths = args.filter((a) => !a.startsWith('--'));

  const mapping = loadMapping();
  const fixtures = paths.length ? paths.map(adHocFixture) : listFixtures();

  if (!fixtures.length) {
    console.error('픽스처를 찾지 못했다. fixtures/ 가 있는 repo 루트에서 실행한다.');
    process.exit(2);
  }

  const results = fixtures.map((fx) => judgeFixture(fx, mapping));

  if (flags.has('--json')) {
    console.log(JSON.stringify(toJson(results, mapping), null, 2));
    return;
  }

  console.log('# M1 왕복 하네스 판정');
  console.log(`\nmapping  ${relative(ROOT, mapping.path)} (단일 진실 원천 — adopt 도 같은 파일을 읽는다)`);
  console.log(`픽스처   ${fixtures.length}개 / 섹션 ${results.reduce((a, r) => a + r.sectionResults.length, 0)}개`);

  printFixtureTable(results);
  printGateSummary(results);
  printLegacy(results);
  printAdversarial(results, mapping);
  printDiagnostics(results, mapping, { verbose: flags.has('--verbose') });
  if (flags.has('--diagnose')) printAxisB(fixtures, mapping);

  const denomSections = results.filter((r) => r.fx.inDenominator).flatMap((r) => r.sectionResults);
  const gatePass = denomSections.length > 0 && denomSections.every((s) => s.score === 1);
  console.log(`\n게이트 판정: ${gatePass ? 'PASS' : 'FAIL'} (미구현 항목은 SKIP 이 아니라 FAIL 이다)`);
  process.exitCode = gatePass ? 0 : 1;
}

function toJson(results, mapping) {
  const denom = results.filter((r) => r.fx.inDenominator).flatMap((r) => r.sectionResults);
  return {
    mapping: relative(ROOT, mapping.path),
    gate: {
      denominator: denom.length,
      numerator: denom.filter((s) => s.score === 1).length,
      threshold: '100%',
      pass: denom.length > 0 && denom.every((s) => s.score === 1),
    },
    legacyEditableRatio: (() => {
      const s = results.filter((r) => r.fx.group === 'legacy').flatMap((r) => r.sectionResults);
      return s.length ? { passed: s.filter((x) => x.score === 1).length, total: s.length, grammarOnly: s.filter((x) => x.criterion1 === 'pass').length } : null;
    })(),
    fixtures: results.map((r) => ({
      path: r.fx.rel,
      group: r.fx.group,
      inDenominator: r.fx.inDenominator,
      documentGate: {
        ok: r.docGate.ok,
        locked: r.docGate.locked,
        findings: r.docGate.findings,
        scripts: r.docGate.scripts,
        undeclaredScripts: r.docGate.undeclaredScripts,
        deckLocalStyles: r.docGate.styles.length,
      },
      sections: r.sectionResults.map((s) => ({
        index: s.index,
        line: s.line,
        criterion1: s.criterion1,
        criterion2: s.criterion2,
        criterion3: s.criterion3,
        score: s.score,
        primaryCause: s.primaryCause,
        roundTripLossless: s.roundTrip.lossless,
        opaqueNodeCount: s.opaqueNodeCount,
        leafCount: s.probes.leafCount,
        blockKindCount: s.probes.blockKindCount,
        findings: s.gate.findings,
        leafProbes: s.probes.leafResults.map((x) => ({
          key: x.key, variant: x.variant, line: x.line,
          edit: { status: x.edit.status, command: x.edit.command ?? null, reason: x.edit.reason ?? null },
          move: { status: x.move.status, reason: x.move.reason ?? null, noop: x.move.noop ?? false },
        })),
        insertProbes: s.probes.insertResults.map((x) => ({
          key: x.key, variant: x.variant, count: x.count,
          status: x.result.status, reason: x.result.reason ?? null,
        })),
      })),
    })),
  };
}

export { judgeFixture, judgeAdversarial, listFixtures, primaryCause, toJson };

if (import.meta.url === `file://${process.argv[1]}`) main();
