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

/* ------------------------------ §2.4.1 인라인 클래스 — 역할로 짝짓는다 */

test('inlineClasses 는 배열이 아니라 역할 이름 표다 (§2.4.1)', () => {
  for (const [name, m] of [['snu', snu], ['minimal', minimal]]) {
    const v = m.json.inlineClasses;
    assert.ok(v && !Array.isArray(v) && typeof v === 'object', `${name}: 배열이면 순서로 짝지어야 하고, 그 추측이 오매핑을 냈다`);
  }
});

test('두 테마가 같은 역할 키 집합을 쓴다 — 키가 갈리면 이식이 다시 추측이 된다', () => {
  assert.deepEqual(Object.keys(minimal.json.inlineClasses).sort(), Object.keys(snu.json.inlineClasses).sort());
});

test('역할이 의미를 건너뛰지 않는다 — numeric 은 numeric 으로만 간다', () => {
  // 2026-08-01 회귀 테스트. 배열 시절 순서 짝짓기가 SNU 의 `num`(수치 셀, 고정폭·우측정렬)을
  // minimal 의 6번째 항목(그림 클래스)으로 보냈고, 표의 숫자 열이 서식을 잃었다.
  // 게이트는 10/10 통과했다 — 게이트가 인라인 클래스의 의미를 재지 않기 때문이다.
  const raw = readFileSync('themes/snu/templates/method.html', 'utf8');
  const out = retheme(raw, snu, minimal).html;

  const src = snu.json.inlineClasses.numeric;      // 'num'
  const dst = minimal.json.inlineClasses.numeric;  // 'm-num'
  assert.ok(raw.includes(`class="${src}"`), '픽스처 전제: 원본에 수치 셀이 있다');
  assert.ok(out.includes(`class="${dst}"`), `수치 셀이 ${dst} 로 가야 한다`);

  // 그리고 그 클래스에 대상 테마의 CSS 규칙이 실제로 있어야 한다. 이름만 맞고 규칙이
  // 없으면 서식은 똑같이 사라진다 — 오매핑과 구별되지 않는 실패다.
  const css = readFileSync('themes/minimal/theme.css', 'utf8');
  assert.match(css, new RegExp(`\\.${dst}\\b`), `${dst} 에 대응하는 CSS 규칙이 없다`);
});

/**
 * 이식 결과에 원 테마 클래스가 남는 자리 — **여섯 번째 표면.**
 *
 * §2.4 의 다섯 표면(blocks · leafStructure · dataProps · inlineClasses · scaffolds)을
 * 전부 처리해도 원 테마 클래스가 셋 남는다. 어느 것도 어휘 값이나 역할 이름을 갖지
 * 않으므로 이식 도구가 짚을 근거가 없다.
 *
 * **0 을 요구하지 않고 목록을 고정한다.** 0 을 요구하면 통과시키려고 테스트를 느슨하게
 * 만들게 되고, 그러면 갭이 사라진 것이 아니라 보이지 않게 된다. 새 갭이 생기면 이 테스트가
 * 깨진다 — 그것이 여기서 얻을 수 있는 보증의 전부다.
 */
const KNOWN_ORPHANS = {
  'prog-track': '불투명 리프 `progress` 스캐폴딩 내부. 조각 파일은 테마마다 손으로 쓰지만 문서에 **이미 박힌 인스턴스**는 이식되지 않는다',
  'prog-fill': '위와 같음',
  done: '스캐폴딩의 상태 수식 클래스 (`prog-fill done`). 역할 이름이 없다',
  block: '스캐폴딩의 상태 수식 (`prog-fill block`). `el:pill|block` 과 글자는 같지만 그 자리는 불투명 서브트리 안이라 도달하지 못한다',
  up: '`delta up` 의 방향 수식. `delta` 는 역할 `metricDelta` 가 있으나 `up` 은 없다',
  page: '`<span class="page">` — 꼬리의 페이지 번호. `el:meta|page` 매핑은 있으나 이 span 은 주석되지 않았다',
  note: '`<span class="note">` (summary-plan.html). `el:text|note` 매핑은 있으나 이 span 은 주석되지 않았다',
};

test('이식 결과에 남는 원 테마 클래스가 알려진 것뿐이다 (여섯 번째 표면)', () => {
  // 주석을 먼저 지운다. 이 파일의 주석은 SNU 클래스를 인용하고 있어서, 지우지 않으면
  // "주석에 적혀 있으니 선언된 것" 으로 세어 갭 하나를 통째로 감춘다 (실제로 감췄다).
  const css = readFileSync('themes/minimal/theme.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const declared = new Set([...css.matchAll(/\.([a-z][\w-]*)/g)].map((m) => m[1]));

  const used = new Set();
  for (const f of TEMPLATES) {
    const out = retheme(readFileSync(join('themes/snu/templates', f), 'utf8'), snu, minimal).html;
    const body = out.slice(out.indexOf('<section'));
    for (const m of body.matchAll(/class="([^"]*)"/g)) {
      for (const c of m[1].split(/\s+/).filter(Boolean)) used.add(c);
    }
  }

  const orphans = [...used].filter((c) => !declared.has(c)).sort();
  assert.deepEqual(orphans, Object.keys(KNOWN_ORPHANS).sort(),
    '이식이 덮지 못하는 자리가 바뀌었다. 늘었다면 새 갭이고, 줄었다면 KNOWN_ORPHANS 를 갱신한다.');
});

test('알려진 갭 중 인라인 역할을 가진 것은 하나도 없다 — §2.4.1 회귀 가드', () => {
  // 갭이 남는 이유는 둘 중 하나다. (a) 클래스에 역할·값이 아예 없다(`up`·`prog-track`),
  // (b) 값은 있으나 **그 자리**가 주석되지 않았거나 불투명 서브트리 안이다(`page`·`note`·`block`).
  // 어느 쪽도 §2.4.1 이 고친 표면이 아니다 — 인라인 역할 표에 있는데도 남는 것이 있다면
  // 그것은 이번 수정의 회귀이므로 여기서 잡는다.
  const roles = new Set(Object.values(snu.json.inlineClasses));
  for (const c of Object.keys(KNOWN_ORPHANS)) {
    assert.ok(!roles.has(c), `${c} 는 인라인 역할을 갖는다 — §2.4.1 대로라면 이식되었어야 한다`);
  }
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
