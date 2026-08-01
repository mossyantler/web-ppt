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

// 명령 등록은 부수효과다. 레지스트리가 비어 있으면 모든 커밋이 422 이므로,
// 등록 모듈을 여기서 한 번 적재한다 — 등록 지점을 흩뿌리지 않는다.
import './attr-commands.js';

/**
 * 커밋 하나를 적용한다.
 * @returns CommitResult — 계획 §3.1
 */
export function applyCommit(deckId, envelope) {
  validateEnvelope(envelope);

  const deck = loadDeck(deckId);

  // 4 — 낙관적 락. Estradeck `splice.ts:20` 과 같은 자리다.
  if (envelope.pre.docHash !== deck.docHash) {
    throw new DocError(409, '덱이 그 사이에 바뀌었다. 다시 받아서 재시도하세요.', {
      code: 'commit.stale-hash',
      expected: envelope.pre.docHash,
      actual: deck.docHash,
    });
  }

  // 5 — 메모리에서만 적용한다. 여기서 던지면 파일은 손대지 않은 상태다.
  const edits = [];
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
    edits.push(...(out?.edits ?? []));
    Object.assign(nodeIds, out?.nodeIds ?? {});
  }

  // 명령이 아무 바이트도 바꾸지 않았다면 쓰지 않는다. 빈 커밋으로 history 링을
  // 소모하면 undo 100 회 기준(§11 M2)이 조용히 무너진다.
  if (edits.length === 0) {
    return result({ applied: false, resultHash: deck.docHash, currentHash: deck.docHash, nodeIds });
  }

  const next = splicedMany(deck.raw, edits);
  assertOutsideIdentical(deck.raw, next, edits);

  atomicWrite(deck.path, next);

  const resultHash = hashOf(next);
  return result({ applied: true, resultHash, currentHash: resultHash, nodeIds });
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

function result({ applied, resultHash, currentHash, nodeIds }) {
  return {
    applied,
    resultHash,
    currentHash,
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
