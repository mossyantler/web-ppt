// node --test server/token-commands.test.js
//
// `setDeckTokens` — 리포트 하나의 색·글꼴·글자 크기 (결정 2).
//
// 여기서 재는 것은 "설정이 문서에 닿는가" 하나다. 닿지 않으면 설정 화면은 먹은 것처럼
// 보이는데 아무 일도 하지 않는다 — 가장 나쁜 종류의 실패다.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { hashOf } from '../tools/harness/splice.js';

const REPO = process.cwd();
const DECK = '2026-08-03-tokens';

const deck = (head) => `<!DOCTYPE html>
<html data-deck-grammar="v1" lang="ko">
<head><meta charset="utf-8">
${head}
</head>
<body>
<section data-slide data-variant="default" data-slide-kind="content" data-node-id="n1" class="slide">
  <div data-box="region" data-region="body" data-node-id="n2" class="slide-body">
    <p data-el="text" data-node-id="n3">본문</p>
  </div>
</section>
</body>
</html>
`;

const WITH_BLOCK = deck('<style id="deck-tokens"></style>');
// 테마 링크를 넣어 둔다. 없으면 "링크보다 뒤에 끼웠는가" 가 -1 과 비교되어 그냥 통과한다.
const WITHOUT_BLOCK = deck('<title>옛 덱</title>\n<link rel="stylesheet" href="../../styles.css">');

let sandbox;

before(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'deck-tokens-'));
  mkdirSync(join(sandbox, '_workspace', DECK), { recursive: true });
  process.chdir(sandbox);
});

after(() => {
  process.chdir(REPO);
  rmSync(sandbox, { recursive: true, force: true });
});

const file = () => join(sandbox, '_workspace', DECK, 'index.html');
const onDisk = () => readFileSync(file(), 'utf8');
beforeEach(() => writeFileSync(file(), WITH_BLOCK, 'utf8'));

const api = async () => import('./commit.js');
const run = (applyCommit, args) => applyCommit(DECK, {
  commitId: `c${Math.random()}`,
  pre: { docHash: hashOf(onDisk()) },
  commands: [{ op: 'setDeckTokens', args }],
});

test('고른 색이 테마가 읽는 토큰으로 들어간다', async () => {
  const { applyCommit } = await api();
  const r = run(applyCommit, { mainColor: '#0f766e', subColor: '#f59e0b' });

  assert.equal(r.applied, true);
  const after = onDisk();
  assert.match(after, /--accent: #0f766e;/);
  assert.match(after, /--surface-accent: #0f766e;/);
  assert.match(after, /--accent-2: #f59e0b;/);
});

test('블록 밖은 한 글자도 바뀌지 않는다', async () => {
  const { applyCommit } = await api();
  const before = onDisk();
  run(applyCommit, { bodySize: '22px' });

  const after = onDisk();
  const cut = (s) => s.slice(0, s.indexOf('<style id="deck-tokens">')) + s.slice(s.indexOf('</style>'));
  assert.equal(cut(after), cut(before), '토큰 블록 밖이 바뀌었다');
});

test('다시 걸면 앞의 것을 대체한다 — 쌓이지 않는다', async () => {
  const { applyCommit } = await api();
  run(applyCommit, { mainColor: '#111111' });
  run(applyCommit, { mainColor: '#222222' });

  const after = onDisk();
  assert.ok(!after.includes('#111111'), '옛 값이 남으면 나중 규칙이 이기는지가 순서에 달린다');
  assert.match(after, /--accent: #222222;/);
});

test('아무것도 안 주면 블록이 비워진다 — 테마 기본으로 돌아간다', async () => {
  const { applyCommit } = await api();
  run(applyCommit, { mainColor: '#0f766e' });
  run(applyCommit, {});

  assert.match(onDisk(), /<style id="deck-tokens"><\/style>/);
});

test('되돌리기로 옛 색이 돌아온다', async () => {
  const { applyCommit, applyUndo } = await api();
  const before = onDisk();
  run(applyCommit, { mainColor: '#0f766e' });
  applyUndo(DECK);

  assert.equal(onDisk(), before, '되돌린 파일이 원문과 바이트 동일해야 한다');
});

test('스타일 규칙을 닫고 나가려는 값은 422 다', async () => {
  const { applyCommit } = await api();
  for (const bad of ['red} body{display:none', 'url(x);}', 'a</style><script>']) {
    assert.throws(
      () => run(applyCommit, { mainColor: bad }),
      (err) => err.status === 422 && err.code === 'create.bad-token',
      `막지 못했다: ${bad}`,
    );
  }
});

test('모르는 항목은 조용히 버리지 않고 400 이다', async () => {
  const { applyCommit } = await api();
  assert.throws(
    () => run(applyCommit, { headingFont: 'Times' }),
    (err) => err.status === 400 && err.code === 'commit.unknown-arg',
  );
});

test('토큰 자리가 없는 옛 덱에는 자리를 만든다 — `</head>` 바로 앞에', async () => {
  writeFileSync(file(), WITHOUT_BLOCK, 'utf8');
  const { applyCommit } = await api();

  // 실측: `_workspace` 의 리포트 다섯 개 전부 이 자리가 없다. 422 를 내면 테마 창이
  // 열리는 족족 거부되고, 사용자에게 그것은 고장과 구별되지 않는다.
  const r = run(applyCommit, { mainColor: '#0f766e' });
  assert.equal(r.applied, true);

  const html = onDisk();
  assert.match(html, /<style id="deck-tokens">[\s\S]*--accent: #0f766e;[\s\S]*<\/style>/);
  // **`</head>` 앞**이어야 한다. 테마의 <link> 보다 뒤에 와야 `:root` 싸움에서 이긴다.
  assert.ok(html.indexOf('<style id="deck-tokens">') < html.indexOf('</head>'), '<head> 밖에 만들었다');
  assert.ok(html.indexOf('<link') < html.indexOf('<style id="deck-tokens">'), '테마 링크보다 앞에 끼웠다 — 값이 안 먹는다');

  // 두 번째부터는 그 자리를 다시 쓴다. 블록이 둘이 되면 안 된다.
  run(applyCommit, { mainColor: '#b91c1c' });
  assert.equal((onDisk().match(/<style id="deck-tokens">/g) ?? []).length, 1);
  assert.match(onDisk(), /--accent: #b91c1c;/);
});

test('제목 크기도 토큰으로 바꾼다 — `.slide-title` 이 읽는 이름이다', async () => {
  const { applyCommit } = await api();
  run(applyCommit, { titleSize: '36px' });
  assert.match(onDisk(), /--text-display: 36px;/);
});
