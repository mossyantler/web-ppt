// node --test server/section-commands.test.js
//
// M3 결정 6이 요구한 두 명령. 슬라이드 순서를 왼쪽 목록에서 끌어 바꾸려면 서버에
// `moveSection` 이 있어야 하고, 순서가 바뀌면 꼬리의 페이지 번호가 틀어지므로
// `renumberPages` 가 따라온다.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { hashOf } from '../tools/harness/splice.js';

const REPO = process.cwd();
const DECK = '2026-08-02-sections';

const slide = (id, title, page) => `<section data-slide data-variant="default" data-slide-kind="content" data-node-id="${id}" class="slide">
  <div data-box="region" data-region="body" data-node-id="${id}b" class="slide-body">
    <h2 data-el="title" data-node-id="${id}t" class="slide-title">${title}</h2>
  </div>
  <div data-box="region" data-region="foot" data-node-id="${id}f" class="slide-foot"><span>Weekly Report</span><span class="page">${page}</span></div>
</section>`;

const HTML = `<!DOCTYPE html>
<html data-deck-grammar="v1" lang="ko">
<head><meta charset="utf-8"></head>
<body>
${slide('n1', '첫째 장', '01 / 03')}
<!-- 슬라이드 사이 주석 -->
${slide('n2', '둘째 장', '02 / 03')}
${slide('n3', '셋째 장', '03 / 03')}
</body>
</html>
`;

let sandbox;

before(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'deck-sections-'));
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

const titles = (s) => [...s.matchAll(/class="slide-title">([^<]*)</g)].map((m) => m[1]);
const pages = (s) => [...s.matchAll(/class="page">([^<]*)</g)].map((m) => m[1]);

/* -------------------------------------------------------------- moveSection */

test('moveSection 이 슬라이드 순서를 바꾼다', async () => {
  const { applyCommit } = await api();
  const r = run(applyCommit, [{ op: 'moveSection', target: 'n3', args: { index: 0 } }]);
  assert.equal(r.applied, true);
  assert.deepEqual(titles(onDisk()), ['셋째 장', '첫째 장', '둘째 장']);
});

test('moveSection 은 슬라이드 사이 주석을 자리에 남긴다 (규약 G1)', async () => {
  const { applyCommit } = await api();
  run(applyCommit, [{ op: 'moveSection', target: 'n1', args: { index: 2 } }]);
  const after = onDisk();
  assert.equal((after.match(/<!-- 슬라이드 사이 주석 -->/g) ?? []).length, 1);
  assert.deepEqual(titles(after), ['둘째 장', '셋째 장', '첫째 장']);
});

test('moveSection 은 페이지 번호 말고는 슬라이드 내용을 건드리지 않는다', async () => {
  const { applyCommit } = await api();
  run(applyCommit, [{ op: 'moveSection', target: 'n2', args: { index: 0 } }]);
  const after = onDisk();
  // 이동한 장은 새 자리의 번호만 받고 나머지는 원문 그대로다.
  assert.ok(after.includes(slide('n2', '둘째 장', '01 / 03')));
  // 문서 전체로 봐도 바뀐 것은 섹션 순서와 번호 셋뿐이다.
  const strip = (s) => s.replace(/class="page">[^<]*</g, 'class="page">P<');
  assert.deepEqual(strip(after).match(/<section[\s\S]*?<\/section>/g).length, 3);
  assert.deepEqual(titles(after), ['둘째 장', '첫째 장', '셋째 장']);
});

test('moveSection 은 제자리 이동이면 아무것도 쓰지 않는다', async () => {
  const { applyCommit } = await api();
  const r = run(applyCommit, [{ op: 'moveSection', target: 'n2', args: { index: 1 } }]);
  assert.equal(r.applied, false);
  assert.equal(onDisk(), HTML);
});

test('moveSection 은 없는 섹션과 범위 밖 index 를 거부한다', async () => {
  const { applyCommit } = await api();
  assert.throws(() => run(applyCommit, [{ op: 'moveSection', target: 'n9', args: { index: 0 } }]),
    (e) => e.status === 404);
  assert.throws(() => run(applyCommit, [{ op: 'moveSection', target: 'n1', args: { index: 5 } }]),
    (e) => e.status === 422 && e.code === 'commit.index-out-of-range');
  assert.equal(onDisk(), HTML);
});

/* ----------------------------------------------------------- renumberPages */

test('moveSection 만 보내도 페이지 번호가 자동으로 맞춰진다 (§3.2 자동 부착)', async () => {
  const { applyCommit } = await api();
  // 클라이언트는 순서만 보낸다. 번호를 따로 챙기게 하면 드래그 한 번이 커밋 둘이 되고
  // 되돌리기가 두 번 걸린다 — §3.1 "커밋이 원자 단위" 위반이다.
  run(applyCommit, [{ op: 'moveSection', target: 'n3', args: { index: 0 } }]);

  assert.deepEqual(titles(onDisk()), ['셋째 장', '첫째 장', '둘째 장']);
  assert.deepEqual(pages(onDisk()), ['01 / 03', '02 / 03', '03 / 03']);
});

test('renumberPages 는 멱등이다 — 두 번째는 아무것도 쓰지 않는다', async () => {
  const { applyCommit } = await api();
  const r = run(applyCommit, [{ op: 'renumberPages' }]);
  assert.equal(r.applied, false, '이미 맞는 번호면 편집이 없다');
  assert.equal(onDisk(), HTML);
});

test('한 커밋에 이동과 번호 다시 매기기를 함께 담을 수 있다', async () => {
  const { applyCommit } = await api();
  // 클라이언트가 드래그 한 번에 두 명령을 한 봉투로 보내는 형태다 (§3.1 원자 단위).
  const r = run(applyCommit, [
    { op: 'moveSection', target: 'n1', args: { index: 2 } },
    { op: 'renumberPages' },
  ]);
  assert.equal(r.applied, true);
  assert.deepEqual(titles(onDisk()), ['둘째 장', '셋째 장', '첫째 장']);
  assert.deepEqual(pages(onDisk()), ['01 / 03', '02 / 03', '03 / 03']);
});

/* ------------------------------------------------------------ 재파싱·게이트 */

test('두 명령 뒤에도 전 슬라이드가 문법 게이트를 통과한다', async () => {
  const { applyCommit, buildDeck } = await api();
  run(applyCommit, [
    { op: 'moveSection', target: 'n3', args: { index: 0 } },
    { op: 'renumberPages' },
  ]);

  const after = onDisk();
  const deck = buildDeck(DECK, file(), after);
  const { sectionGate } = await import('../tools/harness/gate.js');
  const { loadMapping } = await import('../tools/harness/mapping.js');
  assert.equal(deck.sections.length, 3);
  for (const s of deck.sections) {
    const gate = sectionGate(s.root, after, loadMapping(), 'AFTER');
    assert.ok(gate.pass, gate.findings.map((f) => `${f.rule} ${f.code} ${f.subject}`).join('\n'));
  }
});
