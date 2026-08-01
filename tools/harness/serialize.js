// 저작 트리 재직렬화 — 바이트 슬라이스만 쓴다. 이스케이프 재계산·공백 정규화·속성
// 재인용을 하지 않는다 (규약 G1 보존 계약 2항).
//
// 라이브 DOM 을 직렬화하지 않는다는 결정(계획 Z2)의 하네스측 대응물이다. 여기서 나오는
// 바이트는 전부 원문 raw 의 조각이거나, 명령이 명시적으로 만든 새 문자열이다.

/**
 * 노드를 재직렬화한다.
 *
 * @param {import('./tree.js').Node} node
 * @param {string} raw 원문
 * @param {Map<import('./tree.js').Node, string>} overrides 노드별 대체 바이트 (편집)
 */
export function serialize(node, raw, overrides = new Map()) {
  if (overrides.has(node)) return overrides.get(node);

  // parse5 가 삽입한 요소는 소스에 없다 → 태그를 내지 않고 자식만 낸다.
  if (node.kind === 'synthesized') {
    return serializeChildren(node, raw, overrides, spanOf(node));
  }

  // 어휘 밖 노드와 불투명 서브트리는 통째로 원문 바이트다.
  if (node.kind === 'opaque-node' || node.kind === 'opaque-subtree') {
    return node.bytes(raw);
  }

  if (!node.isElement) return node.bytes(raw);

  // 자식이 없는 표기(void, 자기닫힘)는 여는 태그 구간이 곧 전체다.
  if (node.closeStart === null) {
    if (node.children.length === 0) return node.bytes(raw);
    // 닫는 태그가 소스에 없는 요소 (예: </li> 생략) — 여는 태그 + 자식 + 자식 밖 잔여 바이트.
    const open = raw.slice(node.openStart, node.openEnd);
    return open + serializeChildren(node, raw, overrides, [node.openEnd, node.end]);
  }

  const open = raw.slice(node.openStart, node.openEnd);
  const close = raw.slice(node.closeStart, node.closeEnd);
  return open + serializeChildren(node, raw, overrides, [node.innerStart, node.innerEnd]) + close;
}

/**
 * 자식들을 직렬화하면서 **자식 사이의 빈 바이트를 원문에서 채운다.**
 *
 * 파서가 노드로 만들지 않고 버린 바이트가 있다 — 대표적으로 `<pre>` 여는 태그 직후의
 * 개행(HTML 파싱 규칙이 버린다)이다. 그 바이트는 어휘 밖이므로 규약 G1 의 불투명
 * 보존 대상이고, 저작 트리가 들고 있어야 한다. 자식 span 사이를 원문으로 메우는 것이
 * 그 보존이다. 메운 바이트는 notes 가 아니라 트리 자신에 남으므로 편집 시에도 살아난다.
 */
function serializeChildren(node, raw, overrides, [from, to]) {
  if (from === null || to === null) {
    return node.children.map((c) => serialize(c, raw, overrides)).join('');
  }
  let out = '';
  let cursor = from;
  for (const c of node.children) {
    const span = spanOf(c);
    if (span && span[0] >= cursor) {
      out += raw.slice(cursor, span[0]);
      cursor = span[1];
    }
    out += serialize(c, raw, overrides);
  }
  return out + raw.slice(cursor, to);
}

/** 노드의 실효 바이트 구간. 파서가 삽입한 노드는 자손에서 구한다. */
export function spanOf(node) {
  if (node.start !== null && node.start !== undefined) return [node.start, node.end];
  let lo = Infinity;
  let hi = -Infinity;
  node.walk?.((n) => {
    if (n.start !== null && n.start !== undefined) {
      lo = Math.min(lo, n.start);
      hi = Math.max(hi, n.end);
    }
  });
  return lo === Infinity ? null : [lo, hi];
}

/** 파서가 노드로 만들지 않고 버린 바이트 구간을 나열한다 (진단용). */
export function droppedByteSpans(root, raw) {
  const out = [];
  root.walk((n) => {
    if (!n.isElement && n.kind !== 'synthesized') return;
    const from = n.kind === 'synthesized' ? null : n.innerStart;
    const to = n.kind === 'synthesized' ? null : n.innerEnd;
    if (from === null || to === null) return;
    let cursor = from;
    for (const c of n.children) {
      const span = spanOf(c);
      if (!span) continue;
      if (span[0] > cursor) out.push({ line: n.loc?.line ?? null, tag: n.tag, bytes: raw.slice(cursor, span[0]) });
      cursor = Math.max(cursor, span[1]);
    }
    if (cursor < to) out.push({ line: n.loc?.line ?? null, tag: n.tag, bytes: raw.slice(cursor, to) });
  });
  return out.filter((d) => d.bytes.length > 0);
}

/**
 * 왕복 프로브 (grammar.md §5.1 규칙 7).
 *
 * 반환: { lossless, expected, actual, unexplained[] }
 *  - lossless   — 재직렬화 결과가 원문 바이트와 동일한가.
 *  - unexplained — "모델링"도 "불투명 바이트 보존"도 아닌 노드 목록.
 */
export function roundTrip(root, raw) {
  const expected = raw.slice(root.start, root.end);
  const actual = serialize(root, raw);
  const unexplained = [];
  root.walk((n) => {
    if (n.kind === 'unknown-element') {
      unexplained.push({
        tag: n.tag,
        line: n.loc?.line ?? null,
        violation: n.violation ?? null,
        subject: n.openStart === null ? null : raw.slice(n.openStart, n.openEnd),
      });
    }
    if (n.kind === 'opaque-node' && n.start === null) {
      unexplained.push({ tag: n.nodeName, line: null, violation: 'no-source-location', subject: null });
    }
  });
  return { lossless: expected === actual, expected, actual, unexplained };
}

/** 규약 G1 검증용 — 서브트리의 어휘 밖 노드를 문서 순서로 나열한다. */
export function opaqueInventory(root, raw) {
  const out = [];
  root.walk((n) => {
    if (n.kind === 'opaque-node' || n.kind === 'opaque-subtree') {
      out.push({
        nodeName: n.nodeName,
        whitespaceOnly: !!n.whitespaceOnly,
        line: n.loc?.line ?? null,
        start: n.start,
        end: n.end,
        bytes: n.start === null ? '' : n.bytes(raw),
      });
    }
  });
  return out;
}
