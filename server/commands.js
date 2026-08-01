/**
 * 명령 레지스트리 — 계획 §3.2 의 명령 목록이 여기에 등록된다.
 *
 * M2-1 은 레지스트리와 계약만 만든다. 실제 명령은 M2-2(속성)·M2-3(구조)에서 채운다.
 *
 * **미등록 op 는 422 이고 파일은 바뀌지 않는다.** "모르는 명령은 무시한다" 는
 * 선택지를 두지 않는 이유 — 커밋은 전부 성공 아니면 전부 롤백이므로(§3.1),
 * 하나를 무시하면 클라이언트는 성공 응답을 받고 자기 미러에는 그 변경을 적용한다.
 * 그때부터 미러와 디스크가 조용히 갈라진다.
 */

import { DocError } from './doc.js';

/**
 * 명령 핸들러 계약.
 *
 *   handler(deck, command, ctx) -> { edits: Edit[], nodeIds?: Record<string,string> }
 *   Edit = { start, end, text }   // 소스 바이트 오프셋 구간과 대체 문자열
 *
 * 핸들러는 **파일을 만지지 않는다.** splice 구간만 계산해 돌려주고, 쓰기는
 * `commit.js` 가 `atomicWrite` 하나로 수행한다 (계획 §10.1 쓰기 경로 단일화).
 */
const REGISTRY = new Map();

export function registerCommand(op, handler) {
  if (REGISTRY.has(op)) throw new Error(`명령이 이미 등록되어 있다: ${op}`);
  REGISTRY.set(op, handler);
}

export function hasCommand(op) {
  return REGISTRY.has(op);
}

export function registeredOps() {
  return [...REGISTRY.keys()].sort();
}

export function handlerFor(op) {
  const handler = REGISTRY.get(op);
  if (!handler) {
    throw new DocError(422, `구현되지 않은 명령이다: ${op}`, {
      code: 'commit.unknown-op',
      registered: registeredOps(),
    });
  }
  return handler;
}

/** 테스트 격리용. 프로덕션 경로에서는 쓰지 않는다. */
export function _resetRegistry() {
  REGISTRY.clear();
}
