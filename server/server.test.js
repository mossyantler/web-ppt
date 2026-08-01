// node --test server/server.test.js
//
// M2-1 이 지키는 것은 **파일을 지키는 능력**이다. 명령은 아직 하나도 없고,
// 여기서 요구하는 것은 (a) 오래된 해시로 쓰지 못함 (b) _workspace 밖을 못 만짐
// (c) 쓰기가 중간 상태를 남기지 않음 (d) 모르는 명령에 파일이 바뀌지 않음 넷이다.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, readdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { hashOf } from '../tools/harness/splice.js';

const REPO = process.cwd();
const DECK = '2026-08-01-test';

const HTML = `<!DOCTYPE html>
<html data-deck-grammar="v1" lang="ko">
<head><meta charset="utf-8"></head>
<body>
<section data-slide data-variant="default" data-slide-kind="content" data-node-id="n1" class="slide">
  <div data-box="region" data-region="body" data-node-id="n2" class="slide-body">
    <p data-el="text" data-node-id="n3">본문</p>
  </div>
</section>
</body>
</html>
`;

let sandbox;

before(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'deck-server-'));
  mkdirSync(join(sandbox, '_workspace', DECK), { recursive: true });
  writeFileSync(join(sandbox, '_workspace', DECK, 'index.html'), HTML, 'utf8');
  process.chdir(sandbox);
});

after(() => {
  process.chdir(REPO);
  rmSync(sandbox, { recursive: true, force: true });
});

const deckFile = () => join(sandbox, '_workspace', DECK, 'index.html');
const onDisk = () => readFileSync(deckFile(), 'utf8');

// 모듈은 sandbox 로 chdir 한 뒤에 적재해야 한다 — paths.js 는 호출 시점 cwd 를 읽지만
// doc.js 는 적재 시점에 mapping.json 을 읽고, 그 경로는 repo 기준이다.
async function server() {
  return {
    ...(await import('./commit.js')),
    ...(await import('./doc.js')),
    ...(await import('./paths.js')),
    ...(await import('./commands.js')),
    ...(await import('./atomic.js')),
  };
}

/* ------------------------------------------------------------------ 봉쇄 */

test('_workspace/ 밖 경로는 403 이다 — .. 우회', async () => {
  const { deckPath } = await server();
  assert.throws(() => deckPath('../../etc'), (e) => e.status === 403);
  assert.throws(() => deckPath('a/b'), (e) => e.status === 403);
  assert.throws(() => deckPath('a\0b'), (e) => e.status === 403);
});

test('_workspace/ 안을 가리키는 심볼릭 링크가 밖으로 나가면 403 이다', async () => {
  const { deckPath } = await server();
  const outside = mkdtempSync(join(tmpdir(), 'deck-outside-'));
  mkdirSync(join(outside, 'evil'), { recursive: true });
  writeFileSync(join(outside, 'evil', 'index.html'), HTML, 'utf8');
  symlinkSync(join(outside, 'evil'), join(sandbox, '_workspace', 'linked'));
  try {
    // resolve 만으로는 _workspace/linked/index.html 이라 통과한다. realpath 가 잡는다.
    assert.throws(() => deckPath('linked'), (e) => e.status === 403);
  } finally {
    rmSync(join(sandbox, '_workspace', 'linked'), { force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('정상 deckId 는 _workspace 안의 index.html 로 해석된다', async () => {
  const { deckPath } = await server();
  // macOS 의 /var 는 /private/var 로의 심볼릭 링크다. chdir 후 process.cwd() 는
  // 실경로를 돌려주므로 기대값도 실경로로 맞춘다 — 봉쇄 검사가 실경로 비교인 것과 같은 이유다.
  assert.equal(deckPath(DECK), join(realpathSync(sandbox), '_workspace', DECK, 'index.html'));
});

/* -------------------------------------------------------------- 낙관적 락 */

test('오래된 docHash → 409 이고 파일은 바뀌지 않는다', async () => {
  const { applyCommit } = await server();
  const before = onDisk();
  assert.throws(
    () => applyCommit(DECK, { commitId: 'c1', pre: { docHash: 'a'.repeat(64) }, commands: [] }),
    (e) => e.status === 409 && e.code === 'commit.stale-hash',
  );
  assert.equal(onDisk(), before, '409 는 파일을 건드리지 않아야 한다');
});

test('맞는 docHash + 빈 명령 → applied:false 이고 파일은 바뀌지 않는다', async () => {
  const { applyCommit } = await server();
  const before = onDisk();
  const r = applyCommit(DECK, { commitId: 'c2', pre: { docHash: hashOf(before) }, commands: [] });
  assert.equal(r.applied, false);
  assert.equal(r.resultHash, hashOf(before));
  assert.equal(r.currentHash, hashOf(before));
  assert.equal(r.superseded, false);
  assert.equal(onDisk(), before);
});

test('없는 덱 → 404', async () => {
  const { applyCommit } = await server();
  assert.throws(
    () => applyCommit('nosuchdeck', { commitId: 'c3', pre: { docHash: 'x' }, commands: [] }),
    (e) => e.status === 404,
  );
});

/* ------------------------------------------------------------------ 봉투 */

test('봉투 검증 — commitId·pre.docHash·commands 가 없으면 400', async () => {
  const { applyCommit } = await server();
  const bad = [
    {},
    { commitId: 'c' },
    { commitId: 'c', pre: {} },
    { commitId: 'c', pre: { docHash: 'x' } },
    { commitId: 'c', pre: { docHash: 'x' }, commands: [{}] },
  ];
  for (const envelope of bad) {
    assert.throws(() => applyCommit(DECK, envelope), (e) => e.status === 400, JSON.stringify(envelope));
  }
});

/* ---------------------------------------------------------------- 레지스트리 */

test('미등록 명령 → 422 이고 파일은 바뀌지 않는다 (조용한 무시 없음)', async () => {
  const { applyCommit } = await server();
  const before = onDisk();
  assert.throws(
    () => applyCommit(DECK, {
      commitId: 'c4',
      pre: { docHash: hashOf(before) },
      commands: [{ op: 'setContent', target: 'n3', args: { html: '바뀜' } }],
    }),
    (e) => e.status === 422 && e.code === 'commit.unknown-op',
  );
  assert.equal(onDisk(), before);
});

test('구조 명령은 아직 등록되지 않았다 — M2-3 의 단계 경계', async () => {
  const { registeredOps } = await server();
  const structural = ['insertElement', 'removeElement', 'moveElement', 'setContent',
    'wrapElements', 'unwrapElement', 'duplicateElement', 'adoptSection'];
  const registered = new Set(registeredOps());
  assert.deepEqual(structural.filter((op) => registered.has(op)), [], 'M2-3 이 채운다');
});

/* ------------------------------------------------------------------ 트리 */

test('저작 트리가 nodeId 를 인덱싱하고 중복은 409 로 잡는다', async () => {
  const { loadDeck, buildDeck } = await server();
  const deck = loadDeck(DECK);
  assert.equal(deck.sections.length, 1);
  for (const id of ['n1', 'n2', 'n3']) assert.ok(deck.index.has(id), `누락: ${id}`);

  const dup = HTML.replace('data-node-id="n3"', 'data-node-id="n2"');
  assert.throws(
    () => buildDeck(DECK, deckFile(), dup),
    (e) => e.status === 409 && e.code === 'grammar.duplicate-id',
  );
});

/* -------------------------------------------------------------- 원자적 쓰기 */

test('atomicWrite 는 임시 파일을 남기지 않는다', async () => {
  const { atomicWrite } = await server();
  const dir = join(sandbox, '_workspace', DECK);
  atomicWrite(join(dir, 'atomic-probe.html'), '<html>ok</html>');
  const leftovers = readdirSync(dir).filter((f) => f.endsWith('.tmp'));
  assert.deepEqual(leftovers, []);
  assert.equal(readFileSync(join(dir, 'atomic-probe.html'), 'utf8'), '<html>ok</html>');
});

test('쓰기 도중 kill → 파일은 온전한 이전 버전이다 (반쯤 쓰인 상태 없음)', () => {
  // 자식 프로세스가 atomicWrite 의 rename 직전에 스스로 죽는다. 원자성이 없으면
  // 여기서 잘린 파일이 남는다. 계획 §11 M2 수용 기준 그대로의 재현이다.
  const target = join(sandbox, '_workspace', DECK, 'kill-probe.html');
  writeFileSync(target, HTML, 'utf8');

  const script = `
    import { writeFileSync, openSync, fsyncSync, closeSync } from 'node:fs';
    const target = ${JSON.stringify(target)};
    const tmp = target + '.' + process.pid + '.tmp';
    writeFileSync(tmp, 'X'.repeat(1024 * 512), 'utf8');
    const fd = openSync(tmp, 'r+'); fsyncSync(fd); closeSync(fd);
    process.kill(process.pid, 'SIGKILL');   // rename 직전에 죽는다
  `;
  try {
    execFileSync(process.execPath, ['--input-type=module', '-e', script], { stdio: 'ignore' });
  } catch {
    // SIGKILL 이므로 비정상 종료가 정상이다.
  }

  assert.equal(readFileSync(target, 'utf8'), HTML, '대상 파일은 이전 버전 그대로여야 한다');
});
