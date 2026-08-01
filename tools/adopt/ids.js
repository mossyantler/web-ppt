/**
 * `data-node-id` 발급기 — grammar.md §4.1
 *
 * 형식 `n<base36>` (`^n[0-9a-z]+$`). 문서 전체 유일.
 *
 * 참고 패턴: `reference/estradeck/server/src/deck/splice.ts:125` (읽기 전용)
 *   `const usedIds = new Set([...raw.matchAll(/\bid\s*=\s*"([^"]*)"/g)].map((m) => m[1]));`
 * 같은 방식으로 **소스 전체를 훑어 사용 중인 집합을 먼저 만들고**, 그 집합과 충돌하지 않는
 * 값만 내준다. 오프라인 CLI에는 문서 쓰기 락이 없지만(§4.1 절차 1은 서버의 조항이다),
 * 한 번의 실행이 곧 하나의 직렬 구간이므로 같은 보장이 성립한다 — 발급은 전부 이 한
 * 인스턴스에서만 일어나고, 실행 중 파일을 다시 읽지 않는다.
 *
 * `data-track-id`는 **발급하지 않는다.** 문서 간 안정 id는 별도 사양이며(§4.2),
 * 이 도구는 그 속성을 읽지도 쓰지도 않는다.
 */

const NODE_ID_RE = /\bdata-node-id\s*=\s*"([^"]*)"/g;

export class IdAllocator {
  /** @param {string} source 문서 원문 전체 */
  constructor(source) {
    this.used = new Set([...source.matchAll(NODE_ID_RE)].map((m) => m[1]));
    this.counter = 0;
    this.issued = [];
  }

  /** 새 id 하나. 기존 집합·이번 실행에서 발급한 것 어느 쪽과도 충돌하지 않는다. */
  next() {
    for (;;) {
      this.counter += 1;
      const id = `n${this.counter.toString(36)}`;
      if (!this.used.has(id)) {
        this.used.add(id);
        this.issued.push(id);
        return id;
      }
    }
  }
}

/** 요소 노드인가 (주석·텍스트·doctype 제외) */
function isElement(node) {
  return Boolean(node.tagName) && Boolean(node.childNodes || node.attrs);
}

/** 서브트리를 문서 순서로 순회 (자기 자신 포함) */
export function* walk(node) {
  yield node;
  for (const child of node.childNodes || []) {
    if (isElement(child)) yield* walk(child);
  }
}

export function getAttr(node, name) {
  const a = (node.attrs || []).find((x) => x.name === name);
  return a ? a.value : null;
}

/**
 * 서브트리 복제 시의 id 재발급 — grammar.md §4.1 "서브트리 복제 시 재발급".
 *
 * 복제된 서브트리의 **모든** `data-node-id`를 새로 발급하고, 서브트리 **안에서**
 * id를 참조하는 속성(`data-flow-after`)을 매핑을 따라 함께 갱신한다.
 * 서브트리 **밖**을 가리키던 참조는 그대로 둔다.
 *
 * @param {object} root 재발급 대상 서브트리의 루트 노드 (parse5, sourceCodeLocation 필요)
 * @param {IdAllocator} alloc
 * @returns {{mapping: Map<string,string>, edits: Array<{start:number,end:number,text:string,why:string}>}}
 */
export function reissueSubtree(root, alloc) {
  const mapping = new Map();
  const nodes = [];
  for (const node of walk(root)) {
    const old = getAttr(node, 'data-node-id');
    if (old === null) continue;
    if (!mapping.has(old)) mapping.set(old, alloc.next());
    nodes.push(node);
  }

  const edits = [];
  for (const node of nodes) {
    const loc = node.sourceCodeLocation?.attrs?.['data-node-id'];
    if (!loc) continue;
    const old = getAttr(node, 'data-node-id');
    edits.push({
      start: loc.startOffset,
      end: loc.endOffset,
      text: `data-node-id="${mapping.get(old)}"`,
      why: `id 재발급 ${old} → ${mapping.get(old)}`,
    });
  }

  // 서브트리 안의 id 참조 갱신 (§4.1). v1에서 id를 참조하는 속성은 data-flow-after 하나다.
  for (const node of walk(root)) {
    const ref = getAttr(node, 'data-flow-after');
    if (ref === null || !mapping.has(ref)) continue; // 밖을 가리키면 그대로 둔다
    const loc = node.sourceCodeLocation?.attrs?.['data-flow-after'];
    if (!loc) continue;
    edits.push({
      start: loc.startOffset,
      end: loc.endOffset,
      text: `data-flow-after="${mapping.get(ref)}"`,
      why: `앵커 참조 갱신 ${ref} → ${mapping.get(ref)}`,
    });
  }

  return { mapping, edits };
}
