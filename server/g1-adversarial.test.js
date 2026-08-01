// node --test server/g1-adversarial.test.js
//
// 계획 §11 M2: "**규약 G1 테스트** — 섹션 **안**에 주석·CDATA·`<pre>` 공백을 넣은
// 악성 픽스처에 `moveElement`(슬라이드 전체 재직렬화 경로)를 걸었을 때 그 노드들이
// 원문 바이트 그대로 남아 있음 ← §2.0 G1 이 없으면 실패하는 테스트".
//
// 손으로 만든 픽스처가 아니라 `fixtures/adversarial/*` 를 쓴다. 그 파일들은 M1 이
// "이런 것이 실제로 온다" 고 판단해 모아 둔 코퍼스이고, 여기서 다시 쓰지 않으면
// 악성 코퍼스가 하네스 전용 장식으로 남는다.
//
// 픽스처는 주석 이전 상태이므로 `tools/adopt` 로 먼저 주석한다 — 그것이 M8 이 올
// 자리이고, 지금은 오프라인 CLI 로 같은 일을 한다.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { adoptDocument } from '../tools/adopt/core.js';
import { applyEdits } from '../tools/adopt/splice.js';
import { hashOf } from '../tools/harness/splice.js';

const REPO = process.cwd();

/** 악성 픽스처를 주석해 편집 가능한 상태로 만든다. */
function annotate(relPath) {
  const raw = readFileSync(join(REPO, relPath), 'utf8');
  const res = adoptDocument(raw, { file: relPath });
  return applyEdits(raw, res.edits);
}

/** 어휘 밖 노드의 원문 인벤토리 — 개수·순서·바이트를 한꺼번에 본다 (G1 보존 계약 4항). */
function opaqueInventory(source) {
  const body = source.slice(source.indexOf('<section'), source.lastIndexOf('</section>'));
  return {
    comments: [...body.matchAll(/<!--[\s\S]*?-->/g)].map((m) => m[0]),
    pre: [...body.matchAll(/<pre[\s\S]*?<\/pre>/g)].map((m) => m[0]),
  };
}

const CASES = [
  { file: 'fixtures/adversarial/adv-01-comment-cdata.html', what: '주석 · CDATA' },
  { file: 'fixtures/adversarial/adv-02-pre-whitespace.html', what: '<pre> 유의미 공백' },
  { file: 'fixtures/adversarial/adv-03-syntax-mix.html', what: '문법 혼재' },
  { file: 'fixtures/adversarial/adv-04-unicode-control.html', what: '유니코드 제어문자' },
];

let sandbox;

before(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'deck-g1-'));
});

after(() => {
  process.chdir(REPO);
  rmSync(sandbox, { recursive: true, force: true });
});

for (const { file, what } of CASES) {
  test(`G1 — ${what} (${file.split('/').pop()}) 가 구조 명령을 견딘다`, async () => {
    process.chdir(REPO);
    const annotated = annotate(file);

    const deckId = file.split('/').pop().replace('.html', '');
    mkdirSync(join(sandbox, '_workspace', deckId), { recursive: true });
    writeFileSync(join(sandbox, '_workspace', deckId, 'index.html'), annotated, 'utf8');
    process.chdir(sandbox);

    const { applyCommit } = await import('./commit.js');
    const { loadDeck } = await import('./doc.js');

    const deck = loadDeck(deckId);
    const before = opaqueInventory(deck.raw);

    // 슬라이드 전체 재직렬화를 강제하는 명령을 고른다 — 컨테이너 안에 형제가 둘 이상
    // 있는 자리를 찾아 순서를 뒤집는다. 그런 자리가 없으면 이 픽스처는 대상이 아니다.
    // 건너뛰지 않는다. 네 픽스처 모두 형제가 둘 이상인 컨테이너를 갖고 있고, 그것이
    // 없어졌다면 픽스처가 바뀐 것이므로 조용히 통과시키는 대신 실패해야 한다.
    const target = pickMovable(deck);
    assert.ok(target, '이동 대상이 없다 — 이 테스트는 아무것도 재지 않는다');

    applyCommit(deckId, {
      commitId: `g1-${deckId}`,
      pre: { docHash: hashOf(deck.raw) },
      commands: [{ op: 'moveElement', target: target.node.nodeId, args: { newParentId: target.parent.nodeId, index: 0 } }],
    });

    const after = opaqueInventory(readFileSync(join(sandbox, '_workspace', deckId, 'index.html'), 'utf8'));

    assert.equal(after.comments.length, before.comments.length, '주석 개수가 바뀌었다 (G1 4항)');
    assert.deepEqual(after.comments, before.comments, '주석 바이트 또는 순서가 바뀌었다 (G1 1·4항)');
    assert.deepEqual(after.pre, before.pre, '<pre> 안의 유의미 공백이 바뀌었다 (G1 1항)');
  });
}

/** 형제가 둘 이상인 컨테이너에서 마지막 요소를 고른다. */
function pickMovable(deck) {
  for (const section of deck.sections) {
    let found = null;
    section.root.walk((n) => {
      if (found || n.kind !== 'container' || !n.nodeId) return;
      const elems = n.children.filter((c) => c.isElement && c.nodeId);
      if (elems.length >= 2) found = { parent: n, node: elems[elems.length - 1] };
    });
    if (found) return found;
  }
  return null;
}
