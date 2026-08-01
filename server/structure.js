/**
 * 저작 트리 변형 — 구조 명령의 공통 기반 (계획 §3.2 "구조 명령").
 *
 * 속성 명령과 다른 점이 하나다. **쓰기 단위가 슬라이드 전체**다. 트리를 메모리에서
 * 바꾸고 섹션을 재직렬화해 `[section.start, section.end)` 를 splice 한다.
 *
 * 그래서 섹션 **안**의 주석·CDATA·`<pre>` 공백이 splice 구간 **안**에 들어온다.
 * P2("구간 밖 동일")의 보호를 받지 못하고, **규약 G1(어휘 밖 노드의 불투명 보존)이
 * 유일한 방어선**이다 (계획 3판 F-5ⓐ 가 2판의 무조건 서술을 정정한 지점).
 *
 * G1 이 성립하는 방식은 하나다 — 어휘 밖 노드는 저작 트리의 **자식으로 존재하고**,
 * 재직렬화가 그 원문 바이트를 그대로 낸다. 이 모듈이 자식 배열을 만질 때 공백 텍스트
 * 노드를 요소와 함께 다루는 이유가 그것이다. 공백을 "사이의 빈 것" 으로 보고 요소만
 * 옮기면 들여쓰기와 주석이 조용히 자리를 잃는다.
 */

import { DocError } from './doc.js';

/** 이 노드가 공백뿐인 텍스트 노드인가 (들여쓰기). */
export function isWhitespaceText(node) {
  return node?.kind === 'opaque-node' && node.nodeName === '#text' && node.whitespaceOnly;
}

/** 소스에 대응 바이트가 없는 합성 노드. 재직렬화가 `text` 를 그대로 낸다. */
export function syntheticNode(text) {
  return { synthetic: true, text, children: [], isElement: false, kind: 'synthetic' };
}

/** 부모의 요소 자식 목록 (명령의 `index` 가 세는 단위). */
export function elementChildrenOf(parent) {
  return parent.children.filter((c) => c.isElement || c.kind === 'synthetic');
}

/**
 * 요소를 부모에서 떼어낸다. **바로 앞의 공백 텍스트 노드를 함께 뗀다.**
 *
 * 함께 떼지 않으면 제거할 때마다 빈 줄이 하나씩 남고, 이동할 때는 원래 자리의
 * 들여쓰기가 남은 채 새 자리에 들여쓰기가 없는 요소가 붙는다.
 */
export function detach(node) {
  const parent = node.parent;
  if (!parent) throw new DocError(422, '부모가 없는 노드는 뗄 수 없다 (섹션 자신인가?)');
  const i = parent.children.indexOf(node);
  if (i < 0) throw new DocError(500, '트리 불일치 — 자식 배열에 노드가 없다');

  const from = i > 0 && isWhitespaceText(parent.children[i - 1]) ? i - 1 : i;
  const removed = parent.children.splice(from, i - from + 1);
  node.parent = null;
  return { parent, removed, at: from };
}

/**
 * 소스 구간 `[lo, hi)` 에 걸치는 자식을 **전부** 떼어낸다.
 *
 * `wrapElements` 는 묶을 구간을 원문에서 통째로 떠온다. 그때 요소만 떼면 그 사이의
 * 주석·CDATA 는 부모에 남고 동시에 새 컨테이너 안에도 들어가 **두 번 나온다** —
 * 규약 G1 의 "개수·순서·바이트 보존" 중 개수가 깨지는 실패다. 구간에 걸친 자식은
 * 종류를 가리지 않고 함께 떼야 한다.
 */
export function detachRange(parent, lo, hi) {
  const kids = parent.children;
  const inRange = (n) => n.start !== null && n.start !== undefined && n.start >= lo && n.end <= hi;

  let from = kids.findIndex(inRange);
  if (from < 0) throw new DocError(500, `트리 불일치 — 구간 [${lo},${hi}) 에 걸치는 자식이 없다`);
  let to = from;
  while (to + 1 < kids.length && inRange(kids[to + 1])) to += 1;

  // 첫 요소의 들여쓰기도 함께. 새 컨테이너가 자기 들여쓰기를 다시 받는다.
  if (from > 0 && isWhitespaceText(kids[from - 1])) from -= 1;

  const removed = kids.splice(from, to - from + 1);
  for (const n of removed) n.parent = null;
  return { removed, at: from };
}

/**
 * 요소 인덱스 `elemIndex` 자리에 노드들을 끼운다.
 *
 * 들여쓰기는 **형제에게서 베낀다.** 새로 만들어 붙이면 부모마다 다른 들여쓰기 폭을
 * 서버가 추측해야 하고, 그 추측이 틀리면 손편집 저자의 소스가 어긋난다.
 */
export function insertAtElementIndex(parent, elemIndex, nodes, raw) {
  const kids = parent.children;
  const elems = elementChildrenOf(parent);
  if (elemIndex < 0 || elemIndex > elems.length) {
    throw new DocError(422, `index 가 범위를 벗어났다: ${elemIndex} ∉ [0, ${elems.length}]`, {
      code: 'commit.index-out-of-range',
    });
  }

  const indent = siblingIndent(parent, raw);
  const payload = indent === null ? [...nodes] : [syntheticNode(indent), ...nodes];

  // elemIndex 번째 요소 **앞**. 마지막이면 마지막 요소 뒤(= 닫는 태그 앞 공백 앞).
  const anchor = elemIndex < elems.length
    ? kids.indexOf(elems[elemIndex])
    : lastElementEnd(kids, elems);

  // 앵커 앞의 공백은 그 요소의 들여쓰기다. 그 앞에 끼워야 순서가 유지된다.
  const at = anchor > 0 && isWhitespaceText(kids[anchor - 1]) && elemIndex < elems.length
    ? anchor - 1
    : anchor;

  kids.splice(at, 0, ...payload);
  for (const n of nodes) n.parent = parent;
  return at;
}

function lastElementEnd(kids, elems) {
  if (!elems.length) {
    // 요소가 하나도 없으면 닫는 태그 앞 공백의 앞에 넣는다.
    const trailing = kids.length && isWhitespaceText(kids[kids.length - 1]) ? kids.length - 1 : kids.length;
    return trailing;
  }
  return kids.indexOf(elems[elems.length - 1]) + 1;
}

/** 형제의 앞 공백에서 들여쓰기 문자열을 얻는다. 없으면 null (한 줄짜리 부모). */
function siblingIndent(parent, raw) {
  const kids = parent.children;
  for (let i = 0; i < kids.length; i++) {
    if (kids[i].isElement && i > 0 && isWhitespaceText(kids[i - 1])) {
      // 공백 텍스트 노드의 바이트는 개행 + 들여쓰기를 통째로 담고 있다. 그대로 베낀다.
      return kids[i - 1].bytes(raw);
    }
  }
  return null;
}

/** `ancestor` 가 `node` 의 조상인가 (자기 자신 포함). 순환 이동 방지. */
export function isAncestorOf(ancestor, node) {
  for (let n = node; n; n = n.parent) if (n === ancestor) return true;
  return false;
}

/** 노드에서 섹션 루트까지 올라가며 부모들을 mutated 로 표시한다. */
export function markMutated(mutated, node) {
  for (let n = node; n; n = n.parent) mutated.add(n);
}
