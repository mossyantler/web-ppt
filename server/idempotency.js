/**
 * `commitId` 리플레이 방지 — 계획 §3.3 "멱등성" 2겹.
 *
 * **실제 실패 모드는 "요청 유실" 이 아니라 "응답 유실" 이다.** 클라이언트가 타임아웃
 * 후 재시도하면 낙관적 락(1겹)만으로는 409 가 나고 사용자에게 **가짜 충돌 배너**가 뜬다.
 * 아무것도 잘못되지 않았는데 충돌이라고 말하는 것이다.
 *
 * ## 1판의 2겹이 만든 더 나쁜 실패 (Architect A1)
 *
 *   1. C1 적용 → 해시 H1. LRU[C1] = H1. **응답 유실**
 *   2. 사용자가 Undo → 디스크 해시 H0′
 *   3. 지연됐던 C1 재시도 도착 → 1판은 H1 을 200 으로 반환
 *   4. 클라이언트는 문서 해시를 H1 로 믿는다. 디스크는 H0′. **조용히 갈라진다**
 *
 * 가짜 충돌을 가짜 성공으로 바꾼 것이고, 후자가 훨씬 나쁘다 — 전자는 사용자가 보지만
 * 후자는 아무도 못 본다 (D1).
 *
 * **수정.** 엔트리에 `{resultHash, seq}` 를 저장하고 응답에 `currentHash` 를 함께 싣는다.
 * `resultHash ≠ currentHash` 면 `superseded: true` 이고, 클라이언트는 이를 성공이 아니라
 * **재동기화 신호**로 다룬다 (`docs/m2-reconcile-policy.md`).
 *
 * 요소 단위 버전(`nodeVersion`)은 쓰지 않는다. 파일 해시 하나로 충분하고, 요소 버전이
 * 더 얻는 것은 "같은 파일의 다른 요소를 동시에 편집" 뿐인데 단일 사용자 로컬 도구에서
 * 일어나지 않는다.
 */

/** 덱마다 기억하는 최근 커밋 수 — 계획 §3.3. */
export const LRU_SIZE = 256;

/** deckId → Map<commitId, {resultHash, seq}>. Map 은 삽입 순서를 보존하므로 그대로 LRU 다. */
const decks = new Map();

let seq = 0;

function ledgerFor(deckId) {
  if (!decks.has(deckId)) decks.set(deckId, new Map());
  return decks.get(deckId);
}

/** 이미 적용된 커밋인가. 아니면 null. */
export function lookup(deckId, commitId) {
  const ledger = ledgerFor(deckId);
  const hit = ledger.get(commitId);
  if (!hit) return null;
  // 조회도 최근 사용으로 친다 — 재시도가 반복되는 id 를 밀어내지 않기 위해서다.
  ledger.delete(commitId);
  ledger.set(commitId, hit);
  return hit;
}

export function remember(deckId, commitId, resultHash) {
  const ledger = ledgerFor(deckId);
  seq += 1;
  ledger.delete(commitId);
  ledger.set(commitId, { resultHash, seq });
  while (ledger.size > LRU_SIZE) ledger.delete(ledger.keys().next().value);
}

/** 테스트 격리용. 프로세스 수명 동안만 사는 상태이므로 지워도 파일에 영향이 없다. */
export function _reset(deckId = null) {
  if (deckId === null) decks.clear();
  else decks.delete(deckId);
}

export function _size(deckId) {
  return ledgerFor(deckId).size;
}
