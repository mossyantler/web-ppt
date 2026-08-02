// node --test server/create-deck.test.js
//
// 새 리포트 만들기 — `docs/specs/새-리포트-만들기.md` 결정 6.
//
// 여기서 재는 것 셋이다. ① 만들어진 문서가 **게이트를 통과하는가** (통과하지 못하는 것을
// 만들면 편집기가 열자마자 잠긴다) ② 덮어쓰지 않는가 ③ 설정 값이 문서에 닿는가.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, cpSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = process.cwd();
let sandbox;

before(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'deck-create-'));
  // 테마·공용 시트는 레포에서 그대로 가져온다 — 만들기는 그 파일들을 읽는다.
  for (const dir of ['themes', 'tools', 'slides', 'templates']) {
    cpSync(join(REPO, dir), join(sandbox, dir), { recursive: true });
  }
  mkdirSync(join(sandbox, '_workspace'), { recursive: true });
  process.chdir(sandbox);
});

after(() => {
  process.chdir(REPO);
  rmSync(sandbox, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(join(sandbox, '_workspace'), { recursive: true, force: true });
  mkdirSync(join(sandbox, '_workspace'), { recursive: true });
});

const read = (deckId) => readFileSync(join(sandbox, '_workspace', deckId, 'index.html'), 'utf8');

test('만든 문서가 섹션 게이트를 통과한다', async () => {
  const { createDeck } = await import('./create-deck.js');
  const { buildDeck } = await import('./doc.js');
  const { sectionGate } = await import('../tools/harness/gate.js');
  const { loadMapping } = await import('../tools/harness/mapping.js');

  const { deckId } = createDeck({ date: '2026-08-03', title: '주간 보고', week: '2026 · W32' });
  const raw = read(deckId);
  const deck = buildDeck(deckId, 'x', raw);

  assert.equal(deck.sections.length, 1, '표지 한 장으로 시작한다 (결정 6)');
  const gate = sectionGate(deck.sections[0].root, raw, loadMapping(), 'AFTER');
  assert.ok(gate.pass, gate.findings.map((f) => `${f.rule} ${f.code} ${f.subject}`).join('\n'));
  assert.ok(gate.roundTripLossless);
});

test('테마 시트를 물고 나온다 — 이 줄이 빠지면 게이트는 통과하고 화면만 깨진다', async () => {
  const { createDeck } = await import('./create-deck.js');
  const { deckId } = createDeck({ date: '2026-08-03' });
  const raw = read(deckId);

  assert.match(raw, /<link rel="stylesheet" href="\.\.\/\.\.\/themes\/snu\/theme\.css">/);
  assert.match(raw, /<html data-deck-grammar="v1"/);
  assert.match(raw, /<deck-stage width="1280" height="720">/);
});

test('이름은 날짜로 짓고, 같은 날 두 번째는 -002 다', async () => {
  const { createDeck } = await import('./create-deck.js');
  const a = createDeck({ date: '2026-08-03' });
  const b = createDeck({ date: '2026-08-03' });

  assert.equal(a.deckId, '2026-08-03-001');
  assert.equal(b.deckId, '2026-08-03-002');
});

test('이미 있는 리포트는 덮지 않는다', async () => {
  const { createDeck } = await import('./create-deck.js');
  const { deckId } = createDeck({ date: '2026-08-03' });
  const before = read(deckId);

  await assert.rejects(
    async () => createDeck({ date: '2026-08-03', deckId }),
    (err) => err.status === 409 && err.code === 'create.exists',
  );
  assert.equal(read(deckId), before, '덮어쓰기가 일어나면 지난주 리포트가 사라진다');
});

test('_workspace 밖으로는 만들지 못한다', async () => {
  const { createDeck } = await import('./create-deck.js');
  for (const deckId of ['../밖으로', '2026-08-03-001/../../밖', '/tmp/밖']) {
    await assert.rejects(async () => createDeck({ deckId }), (err) => err.status === 400 || err.status === 403);
  }
  assert.ok(!existsSync(join(sandbox, '밖으로')), '봉쇄 밖에 파일이 생겼다');
});

/* ------------------------------------------------------------- 설정이 닿는가 */

test('색·글꼴·글자 크기가 이 리포트만의 토큰으로 들어간다', async () => {
  const { createDeck } = await import('./create-deck.js');
  const { deckId } = createDeck({
    date: '2026-08-03',
    mainColor: '#003876',
    subColor: '#0f9d8f',
    font: "'Pretendard', sans-serif",
    bodySize: '21px',
  });

  const raw = read(deckId);
  assert.match(raw, /<style id="deck-tokens">[\s\S]*--brand-main: #003876;[\s\S]*<\/style>/);
  assert.match(raw, /--brand-sub: #0f9d8f;/);
  assert.match(raw, /--text-body: 21px;/);
});

test('설정을 안 주면 빈 토큰 블록이 남는다 — 나중에 다시 쓸 자리다', async () => {
  const { createDeck } = await import('./create-deck.js');
  const { deckId } = createDeck({ date: '2026-08-03' });
  assert.match(read(deckId), /<style id="deck-tokens"><\/style>/);
});

test('토큰 값으로 스타일 규칙을 닫고 나가려는 시도는 422 다', async () => {
  const { createDeck } = await import('./create-deck.js');
  await assert.rejects(
    async () => createDeck({ date: '2026-08-03', mainColor: 'red} body{display:none' }),
    (err) => err.status === 422 && err.code === 'create.bad-token',
  );
});

test('배경 기본값이 표지에 붙는다 (결정 4)', async () => {
  const { createDeck } = await import('./create-deck.js');
  const { deckId } = createDeck({ date: '2026-08-03', bg: 'dark' });
  assert.match(read(deckId), /<section data-bg="dark"/);
});

/* ------------------------------------------------------------------ 이어짐 */

test('만든 뒤 바로 명령이 먹는다 — 편집기가 열자마자 고칠 수 있다', async () => {
  const { createDeck } = await import('./create-deck.js');
  const { applyCommit } = await import('./commit.js');
  const { loadDeck } = await import('./doc.js');
  const { hashOf } = await import('../tools/harness/splice.js');

  const { deckId } = createDeck({ date: '2026-08-03' });
  const deck = loadDeck(deckId);
  const hero = [...deck.index.entries()].find(([, v]) => v.node.value === 'hero')?.[0];
  assert.ok(hero, '표지에 제목 리프가 있어야 한다');

  const r = applyCommit(deckId, {
    commitId: 'first-edit',
    pre: { docHash: hashOf(read(deckId)) },
    commands: [{ op: 'setContent', target: hero, args: { html: '2026 W32 주간 보고' } }],
  });

  assert.equal(r.applied, true);
  assert.match(read(deckId), /2026 W32 주간 보고/);
});

test('표지의 랩 이름·주차·날짜·발표자가 설정 값으로 채워진다', async () => {
  const { createDeck } = await import('./create-deck.js');
  const { deckId } = createDeck({
    date: '2026-08-03',
    lab: 'Flow Physics Lab',
    department: '건설환경공학부',
    title: '2026 W32 주간 보고',
    subtitle: 'TEPS · 논문 리뷰',
    week: '2026 · W32',
    presenter: '장민엽',
  });

  const raw = read(deckId);
  assert.match(raw, /2026 W32 주간 보고/);
  assert.match(raw, /TEPS · 논문 리뷰/);
  assert.match(raw, />2026 · W32</);
  assert.match(raw, />2026-08-03</);
  assert.match(raw, />장민엽</);
  assert.match(raw, /Flow Physics Lab <span>· 건설환경공학부<\/span>/);
  // 템플릿의 옛 값이 남아 있으면 안 된다.
  assert.ok(!raw.includes('W28'), '템플릿 주차가 남았다');
  assert.ok(!raw.includes('학부연구생 장민엽'), '템플릿 발표자가 남았다');
});

test('안 준 값은 템플릿 그대로 둔다 — 빈 자리보다 예시가 낫다', async () => {
  const { createDeck } = await import('./create-deck.js');
  const { deckId } = createDeck({ date: '2026-08-03' });
  const raw = read(deckId);
  assert.match(raw, /Weekly Research Report/);
  assert.match(raw, /Flow Physics and Informatics Laboratory/);
});

test('표지에 넣은 글자가 문서를 깨지 않는다 (게이트 재확인)', async () => {
  const { createDeck } = await import('./create-deck.js');
  const { buildDeck } = await import('./doc.js');
  const { sectionGate } = await import('../tools/harness/gate.js');
  const { loadMapping } = await import('../tools/harness/mapping.js');

  const { deckId } = createDeck({ date: '2026-08-03', title: '<b>굵게</b> & 특수문자', week: 'W32' });
  const raw = read(deckId);
  assert.ok(!raw.includes('<b>굵게</b>'), '설정 값이 태그로 들어가면 안 된다');

  const deck = buildDeck(deckId, 'x', raw);
  const gate = sectionGate(deck.sections[0].root, raw, loadMapping(), 'AFTER');
  assert.ok(gate.pass, gate.findings.map((f) => `${f.code} ${f.subject}`).join('\n'));
});
