// node --test server/upload.test.js
//
// 덱 폴더에 그림 넣기 — 결정 5(로고). 새 쓰기 표면이므로 여기서 재는 것은 대부분
// **무엇을 거절하는가** 다.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = process.cwd();
const DECK = '2026-08-03-asset';

/** 진짜 PNG 머리 여덟 바이트 + 아무 꼬리. 매직 넘버 검사를 통과해야 한다. */
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(64, 7)]);

let sandbox;
let server;
let base;

before(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'deck-asset-'));
  mkdirSync(join(sandbox, '_workspace', DECK), { recursive: true });
  writeFileSync(join(sandbox, '_workspace', DECK, 'index.html'), '<html><body></body></html>', 'utf8');
  process.chdir(sandbox);

  const { createDeckServer } = await import('./index.js');
  server = createDeckServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  process.chdir(REPO);
  await new Promise((r) => server.close(r));
  rmSync(sandbox, { recursive: true, force: true });
});

const put = (name, body, deck = DECK) => fetch(
  `${base}/deck/${encodeURIComponent(deck)}/asset?name=${encodeURIComponent(name)}`,
  { method: 'POST', body },
);

test('그림이 덱 폴더 안에 들어가고, 문서가 쓸 상대 경로를 돌려준다', async () => {
  const res = await put('logo.png', PNG);
  assert.equal(res.status, 201);

  const body = await res.json();
  assert.equal(body.src, 'asset/logo.png', '문서에 그대로 쓰는 경로여야 한다');
  assert.ok(existsSync(join(sandbox, '_workspace', DECK, 'asset', 'logo.png')));
});

test('넣은 그림을 문서와 같은 경로로 다시 내준다', async () => {
  await put('logo.png', PNG);
  // 문서가 `asset/logo.png` 라고 쓰면 브라우저는 이 주소를 부른다.
  const res = await fetch(`${base}/deck/${DECK}/asset/logo.png`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.equal(Buffer.from(await res.arrayBuffer()).length, PNG.length);
});

test('SVG 는 받지 않는다 — 스크립트를 품을 수 있고 같은 출처에서 나간다', async () => {
  const res = await put('logo.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'));
  assert.equal(res.status, 422);
  assert.equal((await res.json()).code, 'asset.bad-type');
  assert.ok(!existsSync(join(sandbox, '_workspace', DECK, 'asset', 'logo.svg')));
});

test('확장자와 내용이 다르면 거절한다 — 이름만 .png 인 파일', async () => {
  const res = await put('가짜.png', Buffer.from('이건 그림이 아니다'));
  assert.equal(res.status, 422);
  assert.equal((await res.json()).code, 'asset.content-mismatch');
});

test('경로가 든 이름은 거절한다', async () => {
  for (const name of ['../밖.png', 'a/b.png', '.숨김.png']) {
    const res = await put(name, PNG);
    assert.equal(res.status, 400, name);
  }
  assert.ok(!existsSync(join(sandbox, '_workspace', '밖.png')));
});

test('없는 덱에는 넣지 못한다', async () => {
  const res = await put('logo.png', PNG, '없는덱');
  assert.equal(res.status, 404);
});

test('빈 파일과 큰 파일은 거절한다', async () => {
  assert.equal((await put('logo.png', Buffer.alloc(0))).status, 400);

  const big = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]);
  const res = await put('큰.png', big);
  assert.equal(res.status, 413);
});

test('jpeg 도 받는다', async () => {
  const res = await put('mark.jpg', JPEG);
  assert.equal(res.status, 201);
  assert.equal((await res.json()).src, 'asset/mark.jpg');
});

test('같은 이름은 덮어쓴다 — 로고를 바꾸는 일이 파일 목록을 늘리지 않는다', async () => {
  await put('logo.png', PNG);
  await put('logo.png', Buffer.concat([PNG, Buffer.alloc(8, 1)]));

  const onDisk = readFileSync(join(sandbox, '_workspace', DECK, 'asset', 'logo.png'));
  assert.equal(onDisk.length, PNG.length + 8);
});
