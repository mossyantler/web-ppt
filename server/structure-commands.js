/**
 * 구조 명령 — 계획 §3.2 "구조 명령" 표. M2-3.
 *
 *   insertElement · removeElement · moveElement · duplicateElement
 *   wrapElements · unwrapElement
 *
 * `setContent` 는 여기 없다. 그 명령의 안전성은 `normalizeInline` 에 달려 있고
 * 그것이 M2-4 이므로, 정규화 없이 임의 HTML 을 받는 경로를 먼저 열지 않는다.
 *
 * **쓰기 단위는 슬라이드 하나다.** 트리를 메모리에서 바꾸고 섹션을 재직렬화해
 * `[section.start, section.end)` 하나를 splice 한다. 명령 여러 개가 같은 섹션을
 * 건드리면 편집도 하나로 합쳐진다 — `splicedMany` 는 겹치는 구간을 거부하므로,
 * 섹션당 하나로 모으지 않으면 한 커밋에 같은 슬라이드를 두 번 고칠 수 없다.
 */

import { serialize } from '../tools/harness/serialize.js';
import { synthesize } from '../tools/harness/probes.js';
import { IdAllocator } from '../tools/adopt/ids.js';
import { DocError, resolveNode } from './doc.js';
import { registerCommand } from './commands.js';
import { assertPropsAllowed } from './props.js';
import { detach, detachRange, insertAtElementIndex, elementChildrenOf, isAncestorOf, markMutated, syntheticNode } from './structure.js';

/**
 * 섹션 단위 편집을 모으는 커밋 스코프.
 *
 * `deck` 에 붙여 커밋이 끝날 때까지 산다. 같은 커밋의 뒤 명령이 앞 명령의 트리 변경을
 * 본다 — 명령 배열은 순서대로 적용되므로(§3.1) 그래야 한다.
 */
function scopeOf(deck) {
  if (!deck._scope) {
    deck._scope = { mutated: new Set(), sections: new Set(), ids: new IdAllocator(deck.raw) };
  }
  return deck._scope;
}

/** 변경된 섹션들을 재직렬화해 편집 배열로 만든다. */
function editsFor(deck) {
  const scope = scopeOf(deck);
  return [...scope.sections].map((section) => ({
    start: section.root.start,
    end: section.root.end,
    text: serialize(section.root, deck.raw, new Map(), scope.mutated),
  }));
}

/** 명령이 건드린 노드를 스코프에 기록한다. */
function touch(deck, node, section) {
  const scope = scopeOf(deck);
  markMutated(scope.mutated, node);
  scope.sections.add(section);
  return scope;
}

function assertContainer(node, what) {
  if (node.kind !== 'container') {
    throw new DocError(422, `${what} 는 컨테이너여야 한다 (현재: ${node.value ?? node.kind})`, {
      code: 'commit.not-a-container',
    });
  }
}

/* -------------------------------------------------------------- removeElement */

registerCommand('removeElement', (deck, command) => {
  const { node, section } = resolveNode(deck, command.target);

  if (node.kind === 'section') {
    throw new DocError(422, '섹션 제거는 removeSection 이다 (§3.2)', { code: 'commit.wrong-command' });
  }
  // §2.2 투명 컨테이너 — region 은 슬라이드의 고정 영역이라 지울 자리가 없다.
  if (node.value === 'region') {
    throw new DocError(422, 'region 은 제거할 수 없다 (투명 컨테이너, §2.2)', { code: 'commit.transparent-container' });
  }

  const parent = node.parent;
  touch(deck, parent, section);
  detach(node);
  return { edits: editsFor(deck) };
});

/* ---------------------------------------------------------------- moveElement */

registerCommand('moveElement', (deck, command) => {
  const { node, section } = resolveNode(deck, command.target);
  const { newParentId, index } = command.args ?? {};
  const { node: newParent, section: targetSection } = resolveNode(deck, newParentId);

  assertContainer(newParent, 'moveElement 의 newParent');
  if (node.kind === 'section') {
    throw new DocError(422, '섹션 이동은 moveSection 이다 (§3.2)', { code: 'commit.wrong-command' });
  }
  // 자기 자신이나 자손 안으로 옮기면 트리가 순환한다. 재직렬화가 무한히 돈다.
  if (isAncestorOf(node, newParent)) {
    throw new DocError(422, '자기 자신이나 자손 안으로는 옮길 수 없다', { code: 'commit.cyclic-move' });
  }
  if (!Number.isInteger(index) || index < 0) {
    throw new DocError(400, 'moveElement 의 args.index 가 0 이상의 정수여야 한다');
  }

  const oldParent = node.parent;
  touch(deck, oldParent, section);
  touch(deck, newParent, targetSection);

  detach(node);
  insertAtElementIndex(newParent, index, [node], deck.raw);
  return { edits: editsFor(deck) };
});

/* -------------------------------------------------------------- insertElement */

registerCommand('insertElement', (deck, command) => {
  const { parentId, index, type, variant = 'default', regionSlot = null, props = null } = command.args ?? {};
  const { node: parent, section } = resolveNode(deck, parentId);

  assertContainer(parent, 'insertElement 의 parent');
  if (typeof type !== 'string') throw new DocError(400, 'insertElement 의 args.type 이 필요하다');
  if (!Number.isInteger(index) || index < 0) {
    throw new DocError(400, 'insertElement 의 args.index 가 0 이상의 정수여야 한다');
  }

  // 어휘 안인가. `mapping.json` 에 (값, variant) 쌍이 없으면 만들 방법이 없다 —
  // 이것이 계획 §12 완화 3 의 "뭉뚱그리면 점수가 떨어진다" 를 명령 층에서 집행한다.
  const key = deck.mapping.hasBlockKey(`el:${type}`) ? `el:${type}`
    : deck.mapping.hasBlockKey(`box:${type}`) ? `box:${type}` : null;
  if (!key) {
    throw new DocError(422, `어휘에 없는 종류다: ${type}`, { code: 'commit.unknown-type' });
  }
  if (deck.mapping.classFor(key, variant, regionSlot) === null) {
    throw new DocError(422, `테마가 선언하지 않은 (값, variant) 쌍이다: ${key}|${variant}`, {
      code: 'commit.undeclared-variant',
    });
  }

  const scope = touch(deck, parent, section);
  const id = scope.ids.next();
  const kind = kindOf(deck.mapping, key, type);
  const markup = synthesize(deck.mapping, { key, variant, kind, value: type, id, regionSlot }).trimStart();

  // 넣으면서 속성까지 정한다. 두 명령으로 나누면 **같은 봉투 안에서 뒤 명령이 앞 명령이 만든
  // 노드를 지목할 수 없다** — 새 노드는 재직렬화 뒤에야 트리에 나타나기 때문이다. 나눠서 두
  // 커밋으로 보내면 되돌리기가 두 번 걸린다. 허용 목록은 `setProps` 와 같은 것을 쓴다.
  const withProps = props ? applyProps(markup, props, type) : markup;

  insertAtElementIndex(parent, index, [syntheticNode(withProps)], deck.raw);
  return { edits: editsFor(deck), nodeIds: { [command.args.slot ?? id]: id } };
});

/**
 * 합성된 조각의 여는 태그에 속성을 얹는다.
 *
 * 조각은 방금 우리가 만든 것이므로 여는 태그가 어디까지인지 알고 있다 — 문서를 파싱하지
 * 않는다. 같은 이름이 이미 있으면(무자식 리프의 `src=""`) 그 값을 갈아 끼운다.
 */
function applyProps(markup, props, value) {
  if (typeof props !== 'object' || Array.isArray(props)) {
    throw new DocError(400, 'insertElement 의 args.props 가 객체여야 한다');
  }
  assertPropsAllowed(props, { value });

  let out = markup;
  for (const [rawName, raw] of Object.entries(props)) {
    const name = rawName.toLowerCase();
    if (raw === null) continue;
    const text = `${name}="${String(raw).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}"`;
    const existing = new RegExp(`\\s${name}="[^"]*"`);
    out = existing.test(out) ? out.replace(existing, ` ${text}`) : out.replace(/(<\w+)/, `$1 ${text}`);
  }
  return out;
}

/** 어휘 값의 리프 범주 — `synthesize` 가 삽입 조각의 모양을 정할 때 쓴다 (§3.1 L1). */
function kindOf(mapping, key, value) {
  if (key.startsWith('box:')) return 'container';
  if (mapping.opaqueLeafInfo?.(value)) return 'leaf-opaque';
  if ((mapping.json.voidLeaves ?? []).includes(value)) return 'leaf-void';
  return 'leaf-authored';
}

/* ----------------------------------------------------------- duplicateElement */

registerCommand('duplicateElement', (deck, command) => {
  const { node, section } = resolveNode(deck, command.target);
  if (node.kind === 'section') {
    throw new DocError(422, '섹션 복제는 duplicateSection 이다 (§3.2)', { code: 'commit.wrong-command' });
  }
  if (node.value === 'region') {
    throw new DocError(422, 'region 은 복제할 수 없다 (투명 컨테이너, §2.2)', { code: 'commit.transparent-container' });
  }

  const parent = node.parent;
  const scope = touch(deck, parent, section);

  // §4.1 "서브트리 복제 시 재발급" — 원본 바이트를 그대로 베끼되 서브트리의 모든
  // `data-node-id` 를 새로 발급한다. `data-track-id` 는 손대지 않는다 (§4.2 — 주차 간
  // 안정 id 는 복제를 따라가는 것이 목적이다).
  const reissued = {};
  const copy = node.bytes(deck.raw).replace(/(\bdata-node-id\s*=\s*")([^"]*)(")/g, (_m, a, old, z) => {
    const fresh = scope.ids.next();
    reissued[old] = fresh;
    return `${a}${fresh}${z}`;
  });

  const elems = elementChildrenOf(parent);
  insertAtElementIndex(parent, elems.indexOf(node) + 1, [syntheticNode(copy)], deck.raw);
  return { edits: editsFor(deck), nodeIds: reissued };
});

/* --------------------------------------------------------------- wrapElements */

registerCommand('wrapElements', (deck, command) => {
  const ids = command.target;
  const { boxType, variant = 'default' } = command.args ?? {};
  if (!Array.isArray(ids) || ids.length < 1) {
    throw new DocError(400, 'wrapElements 의 target 이 nodeId 배열이어야 한다');
  }

  const hits = ids.map((id) => resolveNode(deck, id));
  const parent = hits[0].node.parent;
  const section = hits[0].section;

  // §3.5 — 같은 스코프의 연속 형제. 실제 부모가 갈리면 거부하되 길을 준다.
  if (hits.some((h) => h.node.parent !== parent)) {
    throw new DocError(422, '선택한 요소들의 실제 부모가 다르다. 먼저 같은 부모로 모으세요.', {
      code: 'grammar.cross-scope-wrap',
      fixes: [{
        label: '먼저 같은 부모로 모으기',
        commands: [
          ...hits.slice(1).map((h) => ({
            op: 'moveElement',
            target: h.node.nodeId,
            args: { newParentId: parent.nodeId, index: 0 },
          })),
          { op: 'wrapElements', target: ids, args: { boxType, variant } },
        ],
      }],
    });
  }

  const elems = elementChildrenOf(parent);
  const positions = hits.map((h) => elems.indexOf(h.node)).sort((a, b) => a - b);
  if (positions.at(-1) - positions[0] !== positions.length - 1) {
    throw new DocError(422, '연속한 형제만 묶을 수 있다 (§3.5)', { code: 'commit.not-contiguous' });
  }

  const key = `box:${boxType}`;
  if (!deck.mapping.hasBlockKey(key) || deck.mapping.classFor(key, variant) === null) {
    throw new DocError(422, `어휘에 없거나 테마가 선언하지 않은 컨테이너다: ${boxType}|${variant}`, {
      code: 'commit.unknown-type',
    });
  }

  const scope = touch(deck, parent, section);
  const id = scope.ids.next();
  const cls = deck.mapping.classFor(key, variant);
  const tag = deck.mapping.defaultTagFor(key);
  const attrs = [`data-box="${boxType}"`, `data-node-id="${id}"`];
  if (variant !== 'default') attrs.push(`data-variant="${variant}"`);
  if (cls) attrs.push(`class="${cls}"`);

  // 묶을 구간을 **원문에서 통째로** 떠온다. 요소별 바이트를 이어붙이면 그 사이의
  // 공백과 주석이 사라진다 — 규약 G1 의 어휘 밖 노드가 정확히 그 자리에 있다.
  const lo = elems[positions[0]].start;
  const hi = elems[positions.at(-1)].end;
  const inner = deck.raw.slice(lo, hi);

  // 그리고 그 구간의 자식을 **전부** 뗀다. 요소만 떼면 사이의 주석이 부모에도 남아
  // 두 번 나온다 (G1 의 개수 보존 위반).
  detachRange(parent, lo, hi);

  const wrapper = syntheticNode(`<${tag} ${attrs.join(' ')}>${inner}</${tag}>`);
  insertAtElementIndex(parent, positions[0], [wrapper], deck.raw);
  return { edits: editsFor(deck), nodeIds: { wrapper: id } };
});

/* -------------------------------------------------------------- unwrapElement */

registerCommand('unwrapElement', (deck, command) => {
  const { node, section } = resolveNode(deck, command.target);

  assertContainer(node, 'unwrapElement 의 대상');
  // §2.2 투명 컨테이너 — 벗기면 슬라이드의 영역 구조나 좌표 레이어가 사라진다.
  if (node.value === 'region' || node.value === 'canvas') {
    throw new DocError(422, `${node.value} 는 벗길 수 없다 (투명 컨테이너, §2.2)`, {
      code: 'commit.transparent-container',
    });
  }

  const parent = node.parent;
  const scope = touch(deck, parent, section);
  scope.mutated.add(node);

  const at = elementChildrenOf(parent).indexOf(node);
  const span = node.innerSpan();
  if (!span) throw new DocError(422, '내부 구간이 없는 컨테이너는 벗길 수 없다');

  // 내부를 **원문 그대로** 꺼낸다. 자식 요소만 이어붙이면 그 사이의 주석·공백이 사라진다
  // — 슬라이드 재직렬화 경로에서 규약 G1 이 지켜야 하는 바로 그 바이트다.
  const inner = deck.raw.slice(span[0], span[1]).replace(/^\s*\n/, '').replace(/\s+$/, '');

  detach(node);
  insertAtElementIndex(parent, at, [syntheticNode(inner)], deck.raw);
  return { edits: editsFor(deck) };
});
