/**
 * 회귀 테스트 — `node --test tools/**\/*.test.js`
 *
 * 계획 §10.1: "M1의 픽스처가 곧 마이그레이터의 회귀 테스트다."
 * 여기서 시험하는 것은 넷이다.
 *   1. 재직렬화하지 않는다 — 부여한 속성 말고는 바이트가 그대로다 (P2, 규약 G1)
 *   2. 추측하지 않는다 — 확정되지 않으면 부여 대신 보고한다
 *   3. id는 문서 전체에서 유일하고, 복제 서브트리에서 재발급된다 (§4.1)
 *   4. `data-track-id`를 부여하지 않는다 (§4.2 — 문서 간 안정 id는 별도 사양)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { adoptDocument, classify } from './core.js';
import { applyEdits } from './splice.js';
import { IdAllocator, reissueSubtree, walk, getAttr } from './ids.js';
import { parseArgs, run } from './index.js';
import { unifiedDiff } from './report.js';
import { parse } from 'parse5';

const ROOT = resolve(import.meta.dirname, '../..');
const fixture = (p) => readFileSync(join(ROOT, 'fixtures', p), 'utf8');

const TEMPLATES = [
  'templates/blockers.html', 'templates/method.html', 'templates/next-steps.html',
  'templates/references.html', 'templates/results.html', 'templates/summary-plan.html',
  'templates/title-a.html', 'templates/title-b.html', 'templates/title-c.html',
];
const ADVERSARIAL = [
  'adversarial/adv-01-comment-cdata.html', 'adversarial/adv-02-pre-whitespace.html',
  'adversarial/adv-03-syntax-mix.html', 'adversarial/adv-04-unicode-control.html',
];

/** 부여된 속성만 지우면 원문으로 되돌아가야 한다 — 재직렬화의 부재를 직접 시험한다 */
const ADDED_ATTR_RE = / data-(?:el|box|node-id|variant|region|cols|slide-kind|slide|deck-grammar)(?:="[^"]*")?/g;

function adoptSource(source, opts) {
  const r = adoptDocument(source, opts);
  return { ...r, output: applyEdits(source, r.edits) };
}

test('바이트 보존 — 부여 속성 외에는 원문 그대로다 (P2 · 규약 G1)', () => {
  // adv-01은 주석 **안에** `data-el="text" data-node-id="nFAKE"` 문자열을 담고 있어
  // 문자열 치환식 비교의 대상이 아니다. 그 픽스처는 아래 구조 불변식으로 시험한다.
  for (const name of [...TEMPLATES, ...ADVERSARIAL.filter((n) => !n.includes('adv-01'))]) {
    const source = fixture(name);
    const { output } = adoptSource(source);
    assert.equal(output.replace(ADDED_ATTR_RE, ''), source, `${name}: 부여 외 바이트가 바뀌었다`);
  }
});

test('편집은 전부 여는 태그 안의 속성 삽입/치환이다 — 재직렬화 경로가 없다', () => {
  for (const name of [...TEMPLATES, ...ADVERSARIAL, 'templates/progress.html', 'legacy/w31-2026-07-27-001.html']) {
    const source = fixture(name);
    const { edits } = adoptDocument(source);
    for (const e of edits) {
      // 여는 태그 안인가 — 직전의 '<'가 직전의 '>'보다 뒤에 있어야 한다
      assert.ok(
        source.lastIndexOf('<', e.start) > source.lastIndexOf('>', e.start - 1),
        `${name}: 편집이 태그 밖이다 @${e.start}`,
      );
      if (e.start === e.end) continue; // 순수 삽입
      const replaced = source.slice(e.start, e.end);
      assert.match(
        replaced, /^\s?(style|data-node-id|data-flow-after)\s*=/,
        `${name}: 속성 아닌 구간을 치환했다: ${JSON.stringify(replaced)}`,
      );
    }
  }
});

test('바이트 보존 — 주석·CDATA는 손대지 않는다 (adv-01, 규약 G1)', () => {
  const source = fixture('adversarial/adv-01-comment-cdata.html');
  const { output } = adoptSource(source);
  for (const raw of [
    '주석 안에 속성처럼 보이는 것: data-el="text" data-node-id="nFAKE"',
    '<![CDATA[ 여기는 XML CDATA 문법이다.',
    '<!--[if IE]>',
    '<!-- 섹션 닫는 태그 직전 주석 -->',
  ]) {
    assert.ok(output.includes(raw), `주석/CDATA 바이트가 바뀌었다: ${raw}`);
  }
  assert.equal(
    (output.match(/<!--/g) || []).length, (source.match(/<!--/g) || []).length,
    '주석 개수가 바뀌었다',
  );
});

test('바이트 보존 — 악성 픽스처의 공백·유니코드·표기가 살아 있다', () => {
  const ws = fixture('adversarial/adv-02-pre-whitespace.html');
  const { output: wsOut } = adoptSource(ws);
  assert.ok(wsOut.includes('\t'), '탭 문자가 사라졌다');
  assert.match(wsOut, / \n/, '행 말미 공백이 사라졌다');

  const mix = fixture('adversarial/adv-03-syntax-mix.html');
  const { output: mixOut } = adoptSource(mix);
  assert.ok(mixOut.includes('<SECTION'), '대문자 태그가 소문자화됐다');
  assert.ok(mixOut.includes("class='slide'"), '홑따옴표 속성이 재인용됐다');
  assert.ok(mixOut.includes('<BR/>'), '자기닫힘 표기가 바뀌었다');

  const uni = fixture('adversarial/adv-04-unicode-control.html');
  const { output: uniOut } = adoptSource(uni);
  assert.equal(uniOut.replace(ADDED_ATTR_RE, ''), uni, '유니코드 정규화·이스케이프 재작성이 일어났다');
});

test('id — 형식·문서 전체 유일성·기존 id 보존', () => {
  for (const name of [...TEMPLATES, 'templates/progress.html', 'legacy/w31-2026-07-27-001.html']) {
    const { output, issuedIds } = adoptSource(fixture(name));
    for (const id of issuedIds) assert.match(id, /^n[0-9a-z]+$/, `${name}: id 형식 위반 ${id}`);
    const all = [...output.matchAll(/\bdata-node-id="([^"]*)"/g)].map((m) => m[1]);
    assert.equal(new Set(all).size, all.length, `${name}: data-node-id가 중복이다`);
  }
});

test('id — 기존 id는 재발급하지 않고, 새 id는 그것을 피한다', () => {
  const src = '<html><body><section class="slide">'
    + '<div class="slide-head" data-node-id="n1"><div class="meta">x</div></div>'
    + '</section></body></html>';
  const { output } = adoptSource(src);
  assert.ok(output.includes('class="slide-head" data-node-id="n1"')
    || output.includes('data-node-id="n1"'), '기존 id가 사라졌다');
  const ids = [...output.matchAll(/\bdata-node-id="([^"]*)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes('n1'));
});

test('data-track-id는 절대 부여하지 않는다 (§4.2)', () => {
  for (const name of [...TEMPLATES, ...ADVERSARIAL, 'templates/progress.html']) {
    const { output } = adoptSource(fixture(name));
    assert.ok(!output.includes('data-track-id'), `${name}: data-track-id가 나타났다`);
  }
});

test('서브트리 복제 — 중복 id 치유 시 재발급 + data-flow-after 매핑', () => {
  const src = '<html><body><section class="slide" data-node-id="s1">'
    + '<div class="slide-body" data-node-id="d1"><p class="lead" data-node-id="p1">a</p></div>'
    + '<div class="slide-foot" data-node-id="d1"><p class="lead" data-node-id="p1" data-flow-after="d1">b</p></div>'
    + '</section></body></html>';
  const { output, findings } = adoptSource(src);
  const ids = [...output.matchAll(/\bdata-node-id="([^"]*)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, '중복 id가 남아 있다');
  assert.ok(findings.some((f) => f.code === 'grammar.duplicate-id'), '중복을 보고하지 않았다');

  // 서브트리 안을 가리키던 앵커는 새 id를 가리켜야 한다
  const anchor = /data-flow-after="([^"]*)"/.exec(output)[1];
  assert.notEqual(anchor, 'd1');
  assert.ok(ids.includes(anchor), '앵커가 존재하지 않는 id를 가리킨다');
});

test('reissueSubtree — 서브트리 밖 참조는 그대로 둔다 (§4.1)', () => {
  const src = '<html><body><section data-node-id="s1">'
    + '<div data-node-id="a1"><p data-node-id="a2" data-flow-after="outside"></p></div>'
    + '</section></body></html>';
  const { edits } = adoptDocument(src); // 중복이 없으므로 재발급은 없다
  assert.ok(!edits.some((e) => e.why?.includes('앵커 참조 갱신')));

  // 직접 호출: 서브트리 안 참조만 매핑된다
  const doc = parse(src, { sourceCodeLocationInfo: true });
  const root = [...walk(doc)].find((n) => getAttr(n, 'data-node-id') === 'a1');
  const alloc = new IdAllocator(src);
  const { mapping, edits: reEdits } = reissueSubtree(root, alloc);
  assert.equal(mapping.size, 2);
  assert.ok(!reEdits.some((e) => e.text.includes('data-flow-after')), '밖을 가리키는 참조를 건드렸다');
});

test('추측 금지 — 매핑이 모호하면 부여 대신 보고한다', () => {
  // 같은 크기의 클래스 집합이 서로 다른 값에 걸린다 → 어느 쪽인지 도구가 정할 수 없다.
  const src = '<html><body><section class="slide">'
    + '<div class="kicker meta">x</div>'
    + '</section></body></html>';
  const { output, findings } = adoptSource(src);
  assert.ok(!/class="kicker meta"[^>]*data-el/.test(output));
  assert.ok(output.includes('<div class="kicker meta">'), '모호한 요소에 값을 부여했다');
  const f = findings.find((x) => x.code === 'adopt.ambiguous-mapping');
  assert.ok(f, '모호를 보고하지 않았다');
  assert.ok(f.candidates.length >= 2 && f.remedy.length > 0);
  assert.equal(f.needsHuman, true);
});

test('G-2 — 슬롯과 조판을 함께 진 요소는 region 의 두 축으로 확정된다', () => {
  const src = '<html><body><section class="slide">'
    + '<div class="slide-body cols-2"><p class="lead">x</p></div>'
    + '</section></body></html>';
  const { output, findings } = adoptSource(src);
  // region|body|cols2 의 클래스 집합이 grid|cols2 를 진부분집합으로 포함하므로 모호가 아니다.
  assert.match(output, /data-box="region" data-variant="cols2" data-region="body"/);
  assert.equal(findings.filter((f) => f.code === 'adopt.ambiguous-mapping').length, 0);
});

test('추측 금지 — 값이 여럿이면 보고한다. 하나도 안 걸리면 구조가 가른다', () => {
  // 어휘에 **하나도** 안 걸리는 클래스는 클래스로 도달할 수 없다. 클래스 없는 요소와
  // 같은 처지이므로 같은 규칙(§2.6 구조)으로 가른다 — 추측이 아니라 적용이다.
  const plain = adoptSource('<html><body><section class="slide">'
    + '<p class="nosuchclass">x</p><span class="nope"><em class="alsonope">y</em></span>'
    + '<article class="whatever">z</article></section></body></html>');
  assert.ok(plain.output.includes('<article data-el="text"'), '어휘 밖 요소를 잠긴 채로 남겼다');
  assert.ok(plain.output.includes('class="whatever"'), 'class 를 건드렸다 — 조판은 클래스가 한다');
  assert.equal(plain.findings.filter((f) => f.code === 'grammar.unknown-element').length, 0);

  // 어휘 값 **여럿**에 걸리는 것은 다르다. 무엇인지는 사람이 정한다.
  const both = adoptSource('<html><body><section class="slide">'
    + '<div class="card meta">x</div></section></body></html>');
  assert.ok(both.output.includes('<div class="card meta">'), '모호한 요소에 값을 부여했다');
  const f = both.findings.find((x) => x.code === 'adopt.ambiguous-mapping');
  assert.ok(f && f.remedy.trim().length > 0, '§5.2 remedy 계약 위반');
  assert.ok(f.subject.startsWith('<div'), '§5.2 subject는 원문 여는 태그다');
  assert.ok(f.location.line > 0);
});

test('면제 ⓓ — SVG 는 통째로 면제한다. 이름표도 안 붙이고 보고도 안 한다 (§3.7)', () => {
  const { output, findings } = adoptSource('<html><body><section class="slide">'
    + '<div class="fig-band"><svg viewBox="0 0 10 10"><defs><g><path d="M0 0"/></g></defs></svg></div>'
    + '</section></body></html>');
  assert.ok(output.includes('<svg viewBox="0 0 10 10">'), 'svg 에 값을 부여했다');
  assert.ok(output.includes('<path d="M0 0"/>'), 'svg 안쪽에 값을 부여했다');
  assert.equal(findings.filter((f) => f.code === 'grammar.unknown-element').length, 0);
  // 그림을 옮기거나 지우는 일은 그것을 감싼 컨테이너로 한다 — 그 컨테이너는 잡혀야 한다.
  assert.ok(output.includes('<div data-box="group"'), '그림을 감싼 껍데기가 컨테이너로 안 잡혔다');
});

test('표·목록은 태그로 확정한다 — 구조 자식이 낱개로 쪼개지지 않는다', () => {
  const { output } = adoptSource('<html><body><section class="slide">'
    + '<table class="data-table"><colgroup><col style="width:30%"></colgroup>'
    + '<tbody><tr><td>가</td></tr></tbody></table>'
    + '<ul class="bullets"><li>하나</li></ul>'
    + '</section></body></html>');
  assert.ok(output.includes('<table data-el="table"'), '표가 컨테이너로 쪼개졌다');
  assert.ok(output.includes('<col style="width:30%">'), '<col> 에 값을 부여했다 — 글자를 담을 수 없다');
  assert.ok(output.includes('<td>가</td>'), '표 구조 자식에 값을 부여했다');
  assert.ok(output.includes('<ul data-el="list"'), '목록이 컨테이너로 쪼개졌다');
  assert.ok(output.includes('<li>하나</li>'), '<li> 에 값을 부여했다');
});

test('면제 ⓐⓑⓒ — 인라인·불투명 자식·구조 자식은 주석하지 않는다', () => {
  const { output } = adoptSource(fixture('templates/method.html'));
  assert.ok(output.includes('<li><b>유한요소 해석(FEM)</b>'), '구조 자식 <li>에 값을 부여했다');
  assert.ok(/<tr><td>압축지수 <span class="mono">Cc<\/span><\/td>/.test(output), '표 구조 자식을 건드렸다');
  assert.ok(output.includes('<div class="ic">▦</div>'), 'figure의 구조 자식을 건드렸다');

  const prog = adoptSource(fixture('templates/progress.html')).output;
  assert.ok(prog.includes('<div class="prog-track">'), '불투명 리프의 자식에 값을 부여했다');
});

test('progress — 데이터 채널 이관 (§3.4 L4, 계획 §10.1 --pct 치환)', () => {
  const { output } = adoptSource(fixture('templates/progress.html'));
  assert.equal((output.match(/data-el="progress"/g) || []).length, 5);
  assert.equal((output.match(/--pct:/g) || []).length, 5);
  assert.ok(!/prog-fill[^>]*style="width/.test(output), '인라인 width가 남아 있다');
  assert.ok(output.includes('data-value="72"') && output.includes('data-label="수치해석 모델 구축"'));
  // 상태 클래스는 스캐폴딩의 일부로 보존된다 (§3.2 [g10])
  assert.ok(output.includes('class="prog-fill done"') && output.includes('class="prog-fill block"'));
});

test('progress — 스캐폴딩 폭과 표시 텍스트가 어긋나면 보고한다', () => {
  const src = '<html><body><section class="slide"><div class="prog-row">'
    + '<span class="task">t</span><div class="prog-track"><div class="prog-fill" style="width:70%"></div></div>'
    + '<span class="pct">72%</span></div></section></body></html>';
  const { findings } = adoptSource(src);
  assert.ok(findings.some((f) => f.code === 'grammar.data-prop-desync'));
});

test('equation — 런타임 렌더 리프. 소스 자식이 비면 통과, 있으면 보고', () => {
  const ok = '<html><body><section class="slide">'
    + '<span data-tex="x^2" data-display="false"></span></section></body></html>';
  const okRes = adoptSource(ok);
  assert.ok(okRes.output.includes('data-el="equation"'));
  assert.ok(!okRes.findings.some((f) => f.code === 'grammar.illegal-child'));

  const bad = '<html><body><section class="slide">'
    + '<span data-tex="x^2"><span class="katex">rendered</span></span></section></body></html>';
  const badRes = adoptSource(bad);
  assert.ok(badRes.findings.some((f) => f.code === 'grammar.illegal-child'));
});

test('섹션 — data-slide 부여, kind는 확정될 때만', () => {
  const title = adoptSource(fixture('templates/title-a.html'));
  assert.ok(title.output.includes('data-slide data-variant="title" data-slide-kind="title"'));
  assert.ok(!title.findings.some((f) => f.code === 'adopt.section-kind-undecided'));

  const content = adoptSource(fixture('templates/summary-plan.html'));
  assert.ok(content.output.includes('data-slide data-variant="default"'));
  assert.ok(!content.output.includes('data-slide-kind'), 'kind를 추측했다');
  assert.ok(content.findings.some((f) => f.code === 'adopt.section-kind-undecided'));
});

test('문서 수준 전제 — data-deck-grammar="v1"을 붙인다', () => {
  const { output } = adoptSource(fixture('templates/title-b.html'));
  assert.match(output, /<html data-deck-grammar="v1"/);
});

test('classify — 태그 규칙은 어휘 클래스가 없을 때만 쓴다', () => {
  const doc = parse('<p class="kicker">x</p><p>y</p><article>z</article>', { sourceCodeLocationInfo: true });
  const els = [...walk(doc)].filter((n) => ['p', 'article'].includes((n.tagName || '')));
  assert.deepEqual(classify(els[0]).value, 'kicker');
  assert.deepEqual(classify(els[1]).value, 'text');
  // 태그 규칙에도 없고 클래스도 안 걸린다 — 구조가 가른다 (§2.6). 글자뿐이므로 text.
  assert.deepEqual(classify(els[2]).value, 'text');
  assert.equal(classify(els[2]).viaStructure, true);
});

test('classify — 클래스 없는 <div> 는 구조로 갈린다 (G-1·G-3, grammar §2.6)', () => {
  const src = '<div><div class="card-head">a</div></div>'
    + '<div style="display:flex; gap:8px"><span class="pill">b</span></div>'
    + '<div><span class="k">Week</span><span class="v">W28</span></div>'
    + '<div>텍스트뿐</div>';
  const doc = parse(src, { sourceCodeLocationInfo: true });
  const bare = [...walk(doc)].filter((n) => n.tagName === 'div' && !(n.attrs || []).some((a) => a.name === 'class'));
  const seen = bare.map((n) => {
    const r = classify(n);
    return `${r.type}:${r.value}${r.variant ? `|${r.variant}` : ''}`;
  });
  assert.deepEqual(seen, ['box:group|plain', 'box:row', 'leaf:text', 'leaf:text']);
});

test('applyEdits — 겹치는 편집은 조용히 뭉개지 않고 던진다', () => {
  assert.throws(() => applyEdits('abcdef', [
    { start: 1, end: 4, text: 'X' }, { start: 2, end: 5, text: 'Y' },
  ]), /겹칩니다/);
  assert.equal(applyEdits('abc', []), 'abc');
});

test('diff — 변경이 없으면 빈 문자열', () => {
  assert.equal(unifiedDiff('a\nb\n', 'a\nb\n'), '');
  assert.match(unifiedDiff('a\nb\n', 'a\nX\n'), /^--- a\n\+\+\+ b\n@@/);
});

test('--section=N — 지정한 섹션만 주석한다', () => {
  const src = '<html><body>'
    + '<section class="slide"><p class="kicker">1</p></section>'
    + '<section class="slide"><p class="kicker">2</p></section>'
    + '</body></html>';
  const one = adoptSource(src, { section: 2 });
  assert.equal(one.adoptedSections.length, 1);
  assert.equal((one.output.match(/data-slide\b/g) || []).length, 1);
  assert.equal(one.sectionCount, 2);
  assert.throws(() => adoptDocument(src, { section: 5 }), /섹션 5번이 없습니다/);
});

test('CLI 인자 — 기본은 dry-run, --write와 --out은 배타', () => {
  assert.throws(() => parseArgs(['f.html', '--write', '--out=x.html']), /함께 쓸 수 없습니다/);
  assert.throws(() => parseArgs(['f.html', '--section=0']), /1 이상의 정수/);
  assert.throws(() => parseArgs(['f.html', '--nope']), /알 수 없는 옵션/);
  const opts = parseArgs(['f.html', '--section=2', '--info']);
  assert.equal(opts.file, 'f.html');
  assert.equal(opts.section, 2);
  assert.equal(opts.info, true);
  assert.equal(opts.write, undefined);
  assert.equal(opts.out, undefined);
});

test('CLI — dry-run은 파일을 만들지 않고, --out은 새 파일, --write만 원본을 바꾼다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'adopt-'));
  const src = join(dir, 'deck.html');
  const original = fixture('templates/title-a.html');
  writeFileSync(src, original);

  const dry = run({ file: src, context: 2 });
  assert.equal(dry.written, null);
  assert.equal(readFileSync(src, 'utf8'), original, 'dry-run이 원본을 건드렸다');
  assert.ok(dry.diff.includes('data-slide'));

  const outPath = join(dir, 'deck.adopted.html');
  run({ file: src, out: outPath, context: 2 });
  assert.ok(existsSync(outPath));
  assert.equal(readFileSync(src, 'utf8'), original, '--out이 원본을 건드렸다');
  assert.ok(readFileSync(outPath, 'utf8').includes('data-el="hero"'));

  run({ file: src, write: true, context: 2 });
  assert.notEqual(readFileSync(src, 'utf8'), original, '--write가 원본을 바꾸지 않았다');
});

test('멱등 — 이미 주석된 문서를 다시 돌려도 새 편집이 없다', () => {
  for (const name of ['templates/title-a.html', 'templates/progress.html', 'templates/references.html']) {
    const once = adoptSource(fixture(name));
    const twice = adoptSource(once.output);
    assert.equal(twice.output, once.output, `${name}: 두 번째 실행이 문서를 또 바꿨다`);
  }
});
