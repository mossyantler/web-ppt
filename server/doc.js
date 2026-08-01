/**
 * 서버 저작 트리 — 편집 모델의 유일한 진실 (계획 §1.3 결정 Z2).
 *
 * 브라우저 라이브 DOM 은 렌더 전용이고 저장 경로에 없다. 명령이 지목하는 노드는
 * 전부 여기서 나온다.
 *
 * **파싱 모듈을 새로 쓰지 않는다.** `tools/harness/tree.js` 가 M1 에서 이미
 * 어휘 판정·면제 규칙·구조 자식 깊이까지 구현했고, 하네스가 그것으로 게이트를
 * 재고 있다. 서버가 별도 구현을 가지면 **게이트가 재는 트리와 명령이 바꾸는 트리가
 * 갈라진다** — M1 개정 기록 2 가 매핑에서 이미 한 번 고친 실패다.
 */

import { readFileSync, existsSync } from 'node:fs';

import { parseDocument, findSections, buildTree } from '../tools/harness/tree.js';
import { hashOf } from '../tools/harness/splice.js';
import { loadMapping } from '../tools/harness/mapping.js';
import { deckPath } from './paths.js';

export class DocError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    Object.assign(this, extra);
  }
}

const mapping = loadMapping();

/** 덱 파일을 읽어 저작 트리와 nodeId 인덱스를 만든다. */
export function loadDeck(deckId) {
  const path = deckPath(deckId);
  if (!existsSync(path)) throw new DocError(404, `덱을 찾을 수 없다: ${deckId}`);

  const raw = readFileSync(path, 'utf8');
  return buildDeck(deckId, path, raw);
}

/** 소스 문자열로부터 덱 상태를 만든다 (테스트와 커밋 후 재검증이 공유한다). */
export function buildDeck(deckId, path, raw) {
  const doc = parseDocument(raw);
  const sectionEls = findSections(doc);

  const sections = sectionEls.map((el, index) => {
    const { root } = buildTree(raw, el, mapping, 'declared');
    return { index, root, element: el };
  });

  return {
    deckId,
    path,
    raw,
    docHash: hashOf(raw),
    mapping,
    sections,
    index: indexNodes(sections),
  };
}

/**
 * `data-node-id` → { node, section } 인덱스.
 *
 * 중복 id 는 여기서 오류다. 문법 §4 는 문서 안 유일성을 요구하고, 중복이 있으면
 * 명령이 어느 노드를 가리키는지 정해지지 않는다 — 그 상태로 splice 하면 사용자가
 * 고른 것과 다른 요소가 바뀐다. **조용한 오작동이므로 여기서 막는다.**
 */
function indexNodes(sections) {
  const map = new Map();
  for (const section of sections) {
    walk(section.root, (node) => {
      if (!node.nodeId) return;
      if (map.has(node.nodeId)) {
        throw new DocError(409, `data-node-id 가 중복이다: ${node.nodeId}`, { code: 'grammar.duplicate-id' });
      }
      map.set(node.nodeId, { node, section });
    });
  }
  return map;
}

export function walk(node, fn) {
  fn(node);
  for (const child of node.children ?? []) walk(child, fn);
}

/** 명령의 `target` 을 노드로 바꾼다. 없으면 404 — 명령을 조용히 무시하지 않는다. */
export function resolveNode(deck, nodeId) {
  const hit = deck.index.get(nodeId);
  if (!hit) throw new DocError(404, `nodeId 를 찾을 수 없다: ${nodeId}`, { code: 'commit.unknown-target' });
  return hit;
}
