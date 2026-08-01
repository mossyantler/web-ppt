// node --test server/content-commands.test.js
//
// 계획 §11 M2 수용 기준 11·13·15:
//   11 — §6.3 목록 7번의 **범위** — setContent 를 건 리프 밖은 바이트 동일
//   13 — 불투명 리프에 setContent → 422
//   15 — <script> 를 넣으려는 커밋 → 422, 파일 미변경

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { hashOf } from '../tools/harness/splice.js';

const REPO = process.cwd();
const DECK = '2026-08-01-content';

const HTML = `<!DOCTYPE html>
<html data-deck-grammar="v1" lang="ko">
<head><meta charset="utf-8"></head>
<body>
<section data-slide data-variant="default" data-slide-kind="content" data-node-id="n1" class="slide">
  <!-- 편집과 무관한 주석. 리프 밖이므로 바이트 동일해야 한다 -->
  <div data-box="region" data-region="body" data-node-id="n2" class="slide-body">
    <p data-el="text" data-node-id="n3">고칠 문단</p>
    <p data-el="text" data-node-id="n4">건드리지 않는 문단 <b>굵게</b></p>
    <div data-el="citation" data-node-id="n5" class="ref"><span class="cite">Kim et al.</span> <span class="title">저널 제목</span> <span class="src">J. Fluid Mech.</span></div>
    <ul data-el="list" data-node-id="n6" class="list"><li>첫째</li><li>둘째</li></ul>
    <span data-el="equation" data-node-id="n7" data-tex="a=b" data-display="false"></span>
    <div data-el="progress" data-node-id="n8" data-value="72" style="--pct:72" class="prog-row"><span class="task">작업</span><div class="prog-track"><div class="prog-fill"></div></div><span class="pct">72%</span></div>
    <div data-el="rule" data-node-id="n9" class="title-rule"></div>
  </div>
</section>
</body>
</html>
`;

let sandbox;

before(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'deck-content-'));
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

const api = async () => ({ ...(await import('./commit.js')), ...(await import('./doc.js')) });

function run(applyCommit, commands) {
  const raw = onDisk();
  return applyCommit(DECK, { commitId: `c${Math.random()}`, pre: { docHash: hashOf(raw) }, commands });
}

/* ------------------------------------------------------ 기준 11 — 범위 한정 */

test('기준 11 — setContent 는 대상 리프의 내부만 바꾼다 (여는·닫는 태그 불변)', async () => {
  reset();
  const { applyCommit } = await api();
  const r = run(applyCommit, [{ op: 'setContent', target: 'n3', args: { html: '고친 문단' } }]);
  assert.equal(r.applied, true);
  assert.equal(onDisk(), HTML.replace('>고칠 문단<', '>고친 문단<'),
    '문서 전체에서 바뀐 바이트는 그 리프의 내부뿐이어야 한다');
});

test('기준 11 — 편집하지 않은 리프·불투명 리프·주석은 바이트 동일하다', async () => {
  reset();
  const { applyCommit } = await api();
  run(applyCommit, [{ op: 'setContent', target: 'n3', args: { html: '<div>정규화가 일어나는 리프</div>' } }]);

  const after = onDisk();
  const untouched = [
    '<p data-el="text" data-node-id="n4">건드리지 않는 문단 <b>굵게</b></p>',
    '<div data-el="progress" data-node-id="n8" data-value="72" style="--pct:72" class="prog-row"><span class="task">작업</span><div class="prog-track"><div class="prog-fill"></div></div><span class="pct">72%</span></div>',
    '<!-- 편집과 무관한 주석. 리프 밖이므로 바이트 동일해야 한다 -->',
    '<span data-el="equation" data-node-id="n7" data-tex="a=b" data-display="false"></span>',
  ];
  for (const frag of untouched) assert.ok(after.includes(frag), `바뀌었다:\n${frag}`);
});

test('기준 11 — 정규화는 편집된 리프 안에서만 일어난다', async () => {
  reset();
  const { applyCommit } = await api();
  // n3 안에 붙여넣기 쓰레기를 넣는다. n4 의 `<b>` 는 같은 부모지만 손대지 않았다.
  run(applyCommit, [{ op: 'setContent', target: 'n3', args: { html: '<div style="x">가</div><br>' } }]);
  const after = onDisk();
  assert.match(after, /<p data-el="text" data-node-id="n3">가<\/p>/);
  assert.match(after, /<p data-el="text" data-node-id="n4">건드리지 않는 문단 <b>굵게<\/b><\/p>/);
});

/* ------------------------------------------------- 기준 10 (명령 수준 재확인) */

test('기준 10 — 한 글자만 고쳐도 .cite/.title/.src 가 전부 살아남는다 (F-5ⓒ)', async () => {
  reset();
  const { applyCommit } = await api();
  const inner = '<span class="cite">Kim et al.</span> <span class="title">저널 제목 v2</span> <span class="src">J. Fluid Mech.</span>';
  run(applyCommit, [{ op: 'setContent', target: 'n5', args: { html: inner } }]);

  const after = onDisk();
  for (const c of ['cite', 'title', 'src']) {
    assert.match(after, new RegExp(`class="${c}"`), `${c} 가 사라졌다 — 저널명 서식이 조용히 없어진다`);
  }
  assert.match(after, /저널 제목 v2/);
});

/* ------------------------------------------------ 기준 13 — 불투명·무자식 리프 */

test('기준 13 — 불투명 리프에 setContent 를 걸면 422 이고 전용 명령을 알려준다', async () => {
  reset();
  const { applyCommit } = await api();

  for (const [target, use] of [['n7', 'setTex'], ['n8', 'setValue']]) {
    try {
      run(applyCommit, [{ op: 'setContent', target, args: { html: 'x' } }]);
      assert.fail(`${target} 은 거부되어야 한다`);
    } catch (e) {
      assert.equal(e.status, 422);
      assert.equal(e.code, 'commit.opaque-leaf');
      assert.equal(e.use, use, '거부이지 무시가 아니다 — 어떤 명령을 쓸지 명시한다');
    }
  }
  assert.equal(onDisk(), HTML);
});

test('무자식 리프·컨테이너·섹션도 거부되고 대안을 안내한다', async () => {
  reset();
  const { applyCommit } = await api();
  assert.throws(() => run(applyCommit, [{ op: 'setContent', target: 'n9', args: { html: 'x' } }]),
    (e) => e.status === 422 && e.code === 'commit.void-leaf' && e.use === 'setProps');
  assert.throws(() => run(applyCommit, [{ op: 'setContent', target: 'n2', args: { html: 'x' } }]),
    (e) => e.status === 422 && e.code === 'commit.wrong-target');
  assert.throws(() => run(applyCommit, [{ op: 'setContent', target: 'n1', args: { html: 'x' } }]),
    (e) => e.status === 422 && e.code === 'commit.wrong-target');
  assert.equal(onDisk(), HTML);
});

/* ------------------------------------------------------- 기준 15 — script 거부 */

test('기준 15 — <script> 를 넣으려는 커밋은 422 이고 파일이 바뀌지 않는다', async () => {
  reset();
  const { applyCommit } = await api();
  for (const html of [
    '<script>alert(1)</script>',
    '본문 <script src="//evil/x.js"></script>',
    '<b onclick="fetch(\'//evil\')">굵게</b>',
    '<a href="javascript:alert(1)">링크</a>',
  ]) {
    assert.throws(
      () => run(applyCommit, [{ op: 'setContent', target: 'n3', args: { html } }]),
      (e) => e.status === 422 && e.code === 'commit.rejected-content',
      html,
    );
  }
  assert.equal(onDisk(), HTML, '거부된 커밋이 파일을 건드리면 안 된다');
});

test('기준 15 — 커밋의 다른 명령이 유효해도 전체가 롤백된다', async () => {
  reset();
  const { applyCommit } = await api();
  assert.throws(() => run(applyCommit, [
    { op: 'setContent', target: 'n3', args: { html: '정상' } },
    { op: 'setContent', target: 'n4', args: { html: '<script>x</script>' } },
  ]), (e) => e.status === 422);
  assert.equal(onDisk(), HTML);
});

/* ------------------------------------------------------------ 구조 자식 보존 */

test('구조 자식(L6)을 가진 리프의 <li> 가 보존된다', async () => {
  reset();
  const { applyCommit } = await api();
  // §3.6 L6 조항 5 — normalizeInline 은 대상 리프의 leafStructure 선언을 받아 보존한다.
  // 받지 못하면 <li> 가 허용 인라인 목록에 없다는 이유로 언랩되고 목록이 뭉개진다.
  const r = run(applyCommit, [{ op: 'setContent', target: 'n6', args: { html: '<li>첫째</li><li>셋째</li>' } }]);
  assert.equal(r.applied, true);
  assert.match(onDisk(), /data-node-id="n6" class="list"><li>첫째<\/li><li>셋째<\/li><\/ul>/);
});

test('구조 자식은 선언한 리프에서만 살아남는다', async () => {
  reset();
  const { applyCommit } = await api();
  // 같은 <li> 라도 text 리프 안에서는 선언되지 않았으므로 언랩된다. 닫힌 목록이라는 뜻이다.
  run(applyCommit, [{ op: 'setContent', target: 'n3', args: { html: '<li>목록 아님</li>' } }]);
  assert.match(onDisk(), /data-node-id="n3">목록 아님<\/p>/);
});

/* ------------------------------------------------------------ 재파싱·게이트 */

test('setContent 뒤에도 문서가 다시 파싱되고 섹션 게이트를 통과한다', async () => {
  reset();
  const { applyCommit, buildDeck } = await api();
  run(applyCommit, [{ op: 'setContent', target: 'n3', args: { html: '고친 <b>문단</b>' } }]);

  const after = onDisk();
  const deck = buildDeck(DECK, file(), after);
  const { sectionGate } = await import('../tools/harness/gate.js');
  const { loadMapping } = await import('../tools/harness/mapping.js');
  const gate = sectionGate(deck.sections[0].root, after, loadMapping(), 'AFTER');
  assert.ok(gate.pass, gate.findings.map((f) => `${f.rule} ${f.code} ${f.subject}`).join('\n'));
  assert.ok(gate.roundTripLossless);
});
