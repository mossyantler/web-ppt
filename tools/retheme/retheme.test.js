// node --test tools/retheme/retheme.test.js
//
// 계획 §14 후속 과제 8 — "두 번째 테마를 실제로 만들어 토큰 계약을 실증
// (계약은 사용되기 전까지 가설이다)".
//
// 이 파일이 재는 것은 **어휘가 SNU 에 묶여 있지 않다**는 명제다. 재는 방법은 하나뿐이다 —
// 같은 저작 트리를 다른 테마로 이식해 그 결과가 문법 게이트를 통과하는가.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { loadMapping, mappingPathFor } from '../harness/mapping.js';
import { parseDocument, findSections, buildTree } from '../harness/tree.js';
import { sectionGate, documentGate } from '../harness/gate.js';
import { retheme } from './index.js';

const snu = loadMapping(mappingPathFor('snu'));
const minimal = loadMapping(mappingPathFor('minimal'));

const TEMPLATES = readdirSync('themes/snu/templates')
  .filter((f) => f.endsWith('.html') && f !== 'progress-row.html')
  .sort();

/* ------------------------------------------------------ 어휘 자체의 이식성 */

test('두 테마가 같은 어휘 키 집합을 선언한다 — 어휘는 테마 소유가 아니다', () => {
  assert.deepEqual(Object.keys(minimal.json.blocks).sort(), Object.keys(snu.json.blocks).sort());
  for (const key of Object.keys(snu.json.blocks)) {
    assert.deepEqual(
      Object.keys(minimal.json.blocks[key]).sort(),
      Object.keys(snu.json.blocks[key]).sort(),
      `variant 집합이 다르다: ${key}`,
    );
  }
});

test('클래스 이름은 하나도 겹치지 않는다 — 이름만 바꾼 사본이 아니다', () => {
  const classesOf = (m) => new Set(
    Object.values(m.json.blocks).flatMap((v) => Object.values(v)).flatMap((c) => c.split(/\s+/)).filter(Boolean),
  );
  const a = classesOf(snu);
  const b = classesOf(minimal);
  const shared = [...a].filter((c) => b.has(c));
  assert.deepEqual(shared, [], `두 테마가 클래스를 공유하면 이식을 증명하지 못한다: ${shared.join(', ')}`);
});

test('데이터 채널 프로퍼티 이름이 테마마다 다르다 (§3.4 — 문법은 이름을 요구하지 않는다)', () => {
  assert.deepEqual(Object.keys(snu.json.dataProps.progress), ['--pct']);
  assert.deepEqual(Object.keys(minimal.json.dataProps.progress), ['--fill']);
});

/* ------------------------------------------------------------ 이식 자체 */

test('템플릿 10종이 갭 없이 이식된다 (대상 테마가 모든 (값, variant) 를 선언)', () => {
  for (const f of TEMPLATES) {
    const raw = readFileSync(join('themes/snu/templates', f), 'utf8');
    const r = retheme(raw, snu, minimal);
    assert.deepEqual(r.gaps, [], `${f}: 어휘가 원 테마에 묶인 지점이 있다`);
    assert.ok(r.touched > 0, `${f}: 아무것도 바뀌지 않았다면 이식을 잰 것이 아니다`);
  }
});

test('이식은 어휘 주석을 건드리지 않는다 — class 만 바뀐다', () => {
  const raw = readFileSync('themes/snu/templates/method.html', 'utf8');
  const out = retheme(raw, snu, minimal).html;
  const vocab = (s) => [...s.matchAll(/data-(el|box|variant|node-id|region|slide-kind)="[^"]*"/g)].map((m) => m[0]);
  assert.deepEqual(vocab(out), vocab(raw));
});

/* ---------------------------------------------- 결과가 문법을 통과하는가 */

test('이식 결과가 minimal 테마 아래서 문법 게이트를 통과한다', () => {
  for (const f of TEMPLATES) {
    const raw = readFileSync(join('themes/snu/templates', f), 'utf8');
    const out = retheme(raw, snu, minimal).html;

    const dg = documentGate(out, f);
    assert.ok(dg.ok, `${f} 문서 게이트 실패: ${JSON.stringify(dg.findings)}`);

    const doc = parseDocument(out);
    for (const el of findSections(doc)) {
      const { root } = buildTree(out, el, minimal, 'declared');
      const gate = sectionGate(root, out, minimal, f);
      assert.ok(gate.pass, `${f} 섹션 게이트 실패:\n${gate.findings.map((x) => `${x.rule} ${x.code} ${x.subject}`).join('\n')}`);
      assert.ok(gate.roundTripLossless, `${f} 왕복 손실`);
    }
  }
});

/* ------------------------------------- 이식이 덮지 못하는 표면 (기록) */

test('불투명 리프 스캐폴딩은 이식 대상이 아니다 — 테마마다 손으로 쓴다', () => {
  const a = readFileSync(snu.json.scaffolds.progress, 'utf8');
  const b = readFileSync(minimal.json.scaffolds.progress, 'utf8');
  // 자식 서브트리에 어휘 주석이 하나도 없으므로 기계적 이식의 근거가 없다 (§3.2 L2).
  assert.notEqual(a, b);
  assert.match(a, /--pct/);
  assert.match(b, /--fill/);
  for (const s of [a, b]) assert.match(s, /data-el="progress"/, '어휘 값은 같아야 한다');
});

test('테마 스타일시트 링크가 교체된다 — 게이트가 잡지 못하는 갭', () => {
  const raw = readFileSync('themes/snu/templates/method.html', 'utf8');
  const out = retheme(raw, snu, minimal).html;
  // 문법은 <head> 에 대해 아무 말도 하지 않는다. 클래스를 전부 갈아도 원 테마 시트를
  // 물고 있으면 화면은 깨진 채로 게이트만 통과한다.
  assert.doesNotMatch(out, /href="\.\.\/\.\.\/\.\.\/slides\/slides\.css"/);
  assert.match(out, /href="\.\.\/theme\.css"/);
});
