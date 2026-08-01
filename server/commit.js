/**
 * 커밋 파이프라인 — `POST /deck/:id/commit` 의 본체.
 *
 * 계획 §3.1 봉투 · §3.3 멱등성 · §11 M2 수용 기준.
 *
 * 순서가 계약이다.
 *
 *   1. 경로 봉쇄        → 403   (`paths.js`)
 *   2. 봉투 검증        → 400
 *   3. 덱 적재·파싱     → 404
 *   4. `pre.docHash` 대조 → 409  ← **낙관적 락. 파일은 아직 열리지 않았다**
 *   5. 명령 적용(메모리) → 422   (전부 성공 아니면 전부 롤백)
 *   6. P2 검증          → 500   ← 불변식 위반은 쓰지 않고 죽는다
 *   7. `atomicWrite`
 *
 * **6 이 있는 이유.** P2("편집 구간 밖 바이트 동일")는 `splicedMany` 에서 구조적으로
 * 상속되지만, 핸들러가 잘못된 구간을 계산하면 상속은 성립해도 **엉뚱한 곳이 바뀐다**.
 * 쓰기 전에 스스로 검사하고, 어긋나면 파일을 건드리지 않는다. 이 시스템에서 소스는
 * 유일한 진실이므로 조용한 손상은 다른 어떤 실패보다 비싸다 (D1).
 */

import { splicedMany, spliced, outsideIdentical, hashOf } from '../tools/harness/splice.js';
import { loadDeck, DocError } from './doc.js';
import { handlerFor } from './commands.js';
import { atomicWrite } from './atomic.js';
import { lookup, remember } from './idempotency.js';
import * as history from './history.js';

// 명령 등록은 부수효과다. 레지스트리가 비어 있으면 모든 커밋이 422 이므로,
// 등록 모듈을 여기서 한 번 적재한다 — 등록 지점을 흩뿌리지 않는다.
import './attr-commands.js';
import './structure-commands.js';
import './content-commands.js';
import './child-commands.js';
import './section-commands.js';

/**
 * 커밋 하나를 적용한다.
 * @returns CommitResult — 계획 §3.1
 */
export function applyCommit(deckId, envelope) {
  validateEnvelope(envelope);

  const deck = loadDeck(deckId);

  // 3.5 — 멱등 2겹. **낙관적 락보다 먼저 본다.** 순서가 뒤바뀌면 재시도가 409 를 받고
  // 사용자에게 가짜 충돌 배너가 뜬다 — 멱등이 막으려던 바로 그 실패다 (§3.3).
  const replay = lookup(deckId, envelope.commitId);
  if (replay) {
    return result({
      applied: false,
      resultHash: replay.resultHash,
      currentHash: deck.docHash,
      nodeIds: {},
    });
  }

  // 4 — 낙관적 락. Estradeck `splice.ts:20` 과 같은 자리다.
  if (envelope.pre.docHash !== deck.docHash) {
    throw new DocError(409, '덱이 그 사이에 바뀌었다. 다시 받아서 재시도하세요.', {
      code: 'commit.stale-hash',
      expected: envelope.pre.docHash,
      actual: deck.docHash,
    });
  }

  // 5 — 메모리에서만 적용한다. 여기서 던지면 파일은 손대지 않은 상태다.
  //
  // 구조 명령은 **같은 섹션에 대해 같은 구간**을 반복해서 낸다 — 트리를 누적해서
  // 바꾸고 매번 그 시점의 섹션 전체를 재직렬화하기 때문이다. `splicedMany` 는 겹치는
  // 구간을 거부하므로 구간을 키로 삼아 마지막 것만 남긴다. 재직렬화는 그 시점 트리의
  // 함수이므로 마지막 것이 누적 결과다.
  const byRange = new Map();
  const nodeIds = {};
  for (const [i, command] of envelope.commands.entries()) {
    const handler = handlerFor(command.op);
    let out;
    try {
      out = handler(deck, command, { index: i, envelope });
    } catch (err) {
      if (err instanceof DocError) throw err;
      throw new DocError(422, `명령 ${i} (${command.op}) 적용 실패: ${err.message}`, {
        code: 'commit.command-failed',
        commandIndex: i,
      });
    }
    for (const e of out?.edits ?? []) byRange.set(`${e.start}:${e.end}`, e);
    Object.assign(nodeIds, out?.nodeIds ?? {});
  }
  const edits = [...byRange.values()].filter((e) => deck.raw.slice(e.start, e.end) !== e.text);

  // 명령이 아무 바이트도 바꾸지 않았다면 쓰지 않는다. 빈 커밋으로 history 링을
  // 소모하면 undo 100 회 기준(§11 M2)이 조용히 무너진다.
  if (edits.length === 0) {
    return result({ applied: false, resultHash: deck.docHash, currentHash: deck.docHash, nodeIds });
  }

  const next = splicedMany(deck.raw, edits);
  assertOutsideIdentical(deck.raw, next, edits);

  // 7 — 쓰기 직전 스냅샷. Estradeck `writeSpliced` 가 `recordHistory` 를 부르는 자리다.
  history.push(deckId, 'edit', deck.raw, envelope.label ?? '');
  // §3.4 커서 모델 — 새 편집은 redo 를 무효화한다. 남겨 두면 이어지지 않는 두 역사가 생긴다.
  history.clear(deckId, 'redo');

  atomicWrite(deck.path, next);

  const resultHash = hashOf(next);
  remember(deckId, envelope.commitId, resultHash);
  return result({
    applied: true,
    resultHash,
    currentHash: resultHash,
    nodeIds,
    spliceRanges: edits.map((e) => ({ start: e.start, end: e.end, text: e.text })),
  });
}

/**
 * Undo / Redo — 계획 §3.4.
 *
 * 역연산이 아니라 **스냅샷 복원**이다. 되돌리기 전 상태를 반대편 링에 넣고, 대상 링에서
 * 꺼낸 바이트를 그대로 쓴다. 두 방향이 완전히 대칭이므로 편집 100 + undo 100 + redo 100
 * 이 전부 성립한다.
 *
 * **`history.push` 로 기록하되 `edit` 링을 소모하지 않는다** — 그것이 A2 가 고친 결함이고,
 * 링을 나눈 유일한 이유다.
 */
export function applyUndo(deckId, { label = 'undo' } = {}) {
  return shiftHistory(deckId, 'edit', 'redo', label);
}

export function applyRedo(deckId, { label = 'redo' } = {}) {
  return shiftHistory(deckId, 'redo', 'edit', label);
}

function shiftHistory(deckId, from, to, label) {
  const deck = loadDeck(deckId);
  const snapshot = history.pop(deckId, from);
  if (!snapshot) {
    throw new DocError(409, `${from} 링이 비어 있다 — 되돌릴 것이 없다`, { code: `commit.${from}-empty` });
  }

  history.push(deckId, to, deck.raw, label);
  atomicWrite(deck.path, snapshot.content);

  const resultHash = hashOf(snapshot.content);
  return result({ applied: true, resultHash, currentHash: resultHash, nodeIds: {} });
}

/**
 * 6 — P2 를 편집마다 직접 검사한다.
 *
 * `splicedMany` 는 뒤에서부터 적용하므로 앞쪽 구간의 오프셋이 밀리지 않는다.
 * 같은 순서로 검사하면 각 편집을 그 시점의 소스에 대해 확인할 수 있다.
 */
function assertOutsideIdentical(before, after, edits) {
  const sorted = [...edits].sort((a, b) => a.start - b.start);
  let cursor = before;
  for (const e of [...sorted].reverse()) {
    const applied = spliced(cursor, e.start, e.end, e.text);
    const check = outsideIdentical(cursor, applied, e.start, e.end, e.text);
    if (!check.ok) {
      throw new DocError(500, `P2 위반 — splice 구간 [${e.start},${e.end}) 밖의 바이트가 바뀌었다. 파일은 쓰지 않았다.`, {
        code: 'commit.p2-violation',
        prefixOk: check.prefixOk,
        suffixOk: check.suffixOk,
      });
    }
    cursor = applied;
  }
  if (cursor !== after) {
    throw new DocError(500, 'P2 위반 — 편집을 개별 적용한 결과가 일괄 적용 결과와 다르다. 파일은 쓰지 않았다.', {
      code: 'commit.splice-mismatch',
    });
  }
}

function result({ applied, resultHash, currentHash, nodeIds, spliceRanges = [] }) {
  return {
    applied,
    resultHash,
    currentHash,
    // 계획 §11 관측성 — 어느 구간이 splice 되었는가. 델타 경로가 틀렸을 때 어디를 봐야
    // 하는지가 이것에만 있다 (`docs/m2-reconcile-policy.md` "M2 가 지켜야 하는 것" 3항).
    // P2 매트릭스 테스트도 이 값을 쓴다 — 테스트가 구간을 다시 계산하면 같은 버그를 두 번 쓴다.
    spliceRanges,
    // §3.3 — resultHash ≠ currentHash 이면 클라이언트는 성공이 아니라 재동기화로 다룬다.
    // M2-1 에는 멱등 재생 경로가 없으므로 항상 false 다. M2-5 가 채운다.
    superseded: resultHash !== currentHash,
    nodeIds,
    diagnostics: [],
  };
}

function validateEnvelope(envelope) {
  if (!envelope || typeof envelope !== 'object') throw new DocError(400, '봉투가 객체가 아니다');
  if (typeof envelope.commitId !== 'string' || !envelope.commitId) {
    throw new DocError(400, 'commitId 가 필요하다 (멱등 키)');
  }
  if (!envelope.pre || typeof envelope.pre.docHash !== 'string') {
    throw new DocError(400, 'pre.docHash 가 필요하다 (낙관적 락)');
  }
  if (!Array.isArray(envelope.commands)) throw new DocError(400, 'commands 가 배열이어야 한다');
  for (const [i, c] of envelope.commands.entries()) {
    if (!c || typeof c.op !== 'string') throw new DocError(400, `commands[${i}].op 가 필요하다`);
  }
}
