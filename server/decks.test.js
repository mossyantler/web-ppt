// node --test server/decks.test.js
//
// M3 결정 11(서버가 화면도 내준다)·12(리포트 목록이 먼저)의 서버 쪽.
// 라우트는 실제로 서버를 띄워서 잰다 — 함수만 부르면 경로 봉쇄가 라우팅 뒤에 있는지
// 앞에 있는지를 확인하지 못한다.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = process.cwd();

const deck = (grammar, body) => `<!DOCTYPE html>
<html${grammar ? ' data-deck-grammar="v1"' : ''} lang="ko">
<head><meta charset="utf-8"></head>
<body>
${body}
</body>
</html>
`;

// id 는 문서 안에서 유일해야 한다(§4). 같은 조각을 두 번 붙이면 서버가 409 로 막는다.
const slideAt = (n, title) => `<section data-slide data-variant="title" data-slide-kind="title" data-node-id="s${n}" class="slide">
  <h1 data-el="hero" data-node-id="s${n}h" class="report-hero">${title}</h1>
</section>`;
const SLIDE = slideAt(1, 'W32 주간 보고');

let sandbox;
let server;
let base;

before(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'deck-list-'));
  const ws = join(sandbox, '_workspace');

  mkdirSync(join(ws, '2026-08-01-001'), { recursive: true });
  writeFileSync(join(ws, '2026-08-01-001', 'index.html'),
    deck(true, `${slideAt(1, 'W32 주간 보고')}\n${slideAt(2, '둘째 장')}`), 'utf8');
  writeFileSync(join(ws, '2026-08-01-001', 'figure.svg'), '<svg/>', 'utf8');

  mkdirSync(join(ws, '2026-07-27-001'), { recursive: true });
  writeFileSync(join(ws, '2026-07-27-001', 'index.html'), deck(false, '<section class="slide">옛 리포트</section>'), 'utf8');

  // 리포트가 아닌 것들 — 목록에 나오면 안 된다.
  mkdirSync(join(ws, '_ui-proto'), { recursive: true });
  writeFileSync(join(ws, '_ui-proto', 'index.html'), deck(true, SLIDE), 'utf8');
  mkdirSync(join(ws, 'no-index'), { recursive: true });

  process.chdir(sandbox);

  const { createDeckServer } = await import('./index.js');
  server = createDeckServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((r) => server.close(r));
  process.chdir(REPO);
  rmSync(sandbox, { recursive: true, force: true });
});

const get = async (path) => {
  const res = await fetch(base + path);
  const type = res.headers.get('content-type') ?? '';
  return { status: res.status, type, body: type.includes('json') ? await res.json() : await res.text() };
};

/* ------------------------------------------------------------- 덱 목록 */

test('덱 목록이 리포트만 담는다 — 밑줄로 시작하는 것과 index.html 없는 것은 뺀다', async () => {
  const { status, body } = await get('/decks');
  assert.equal(status, 200);
  assert.deepEqual(body.decks.map((d) => d.deckId).sort(), ['2026-07-27-001', '2026-08-01-001']);
});

test('덱 목록이 이름·슬라이드 수·편집 가능 여부를 담는다', async () => {
  const { body } = await get('/decks');
  const fresh = body.decks.find((d) => d.deckId === '2026-08-01-001');
  const old = body.decks.find((d) => d.deckId === '2026-07-27-001');

  assert.equal(fresh.label, 'W32 주간 보고', '표지 제목을 이름으로 쓴다');
  assert.equal(fresh.slideCount, 2);
  assert.equal(fresh.annotated, true);

  // 문법을 선언하지 않은 덱은 열어도 잠긴 채다(결정 9). 목록에서 미리 알린다.
  assert.equal(old.annotated, false);
  assert.equal(old.label, '2026-07-27-001', '제목을 못 찾으면 폴더 이름을 쓴다');
});

test('덱 목록이 최근 수정 순이다', async () => {
  const { body } = await get('/decks');
  const times = body.decks.map((d) => d.modifiedAt);
  assert.deepEqual(times, [...times].sort().reverse());
});

/* ---------------------------------------------------------- 편집기 화면 */

test('/ 가 편집기 화면을 내준다', async () => {
  const { status, type, body } = await get('/');
  assert.equal(status, 200);
  assert.match(type, /text\/html/);
  assert.match(body, /주간 리포트 편집기/);
});

test('화면 파일이 알맞은 종류로 나간다', async () => {
  const css = await get('/app.css');
  assert.equal(css.status, 200);
  assert.match(css.type, /text\/css/);

  const js = await get('/app.js');
  assert.equal(js.status, 200);
  assert.match(js.type, /javascript/);
});

test('편집 중 파일이 계속 바뀌므로 캐시를 남기지 않는다', async () => {
  const res = await fetch(base + '/app.js');
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('화면 경로가 server/ui 밖으로 나가지 않는다', async () => {
  for (const path of ['/../commit.js', '/..%2Fcommit.js', '/../../package.json']) {
    const { status } = await get(path);
    assert.equal(status, 404, path);
  }
});

/* ------------------------------------------------------------- 덱 자산 */

test('덱 안의 파일을 내주고 덱 밖은 404 다', async () => {
  const ok = await get('/deck/2026-08-01-001/asset/figure.svg');
  assert.equal(ok.status, 200);
  assert.match(ok.type, /svg/);

  for (const rel of ['../../package.json', '../2026-07-27-001/index.html']) {
    const { status } = await get(`/deck/2026-08-01-001/asset/${encodeURIComponent(rel)}`);
    assert.equal(status, 404, rel);
  }
});

test('_workspace 밖을 가리키는 심볼릭 링크는 자산으로도 안 나간다', async () => {
  const outside = mkdtempSync(join(tmpdir(), 'deck-outside-'));
  writeFileSync(join(outside, 'secret.txt'), '비밀', 'utf8');
  symlinkSync(join(outside, 'secret.txt'), join(sandbox, '_workspace', '2026-08-01-001', 'link.txt'));
  try {
    const { status } = await get('/deck/2026-08-01-001/asset/link.txt');
    assert.equal(status, 404);
  } finally {
    rmSync(join(sandbox, '_workspace', '2026-08-01-001', 'link.txt'), { force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------- 기존 경로 유지 */

test('덱 읽기와 커밋 경로가 그대로 산다', async () => {
  const read = await get('/deck/2026-08-01-001');
  assert.equal(read.status, 200);
  assert.equal(read.body.sectionCount, 2);

  const res = await fetch(`${base}/deck/2026-08-01-001/commit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ commitId: 'x', pre: { docHash: 'stale' }, commands: [] }),
  });
  assert.equal(res.status, 409, '오래된 해시는 여전히 409 다');
});
