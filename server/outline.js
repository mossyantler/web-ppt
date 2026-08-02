/**
 * 슬라이드 목차 — 화면이 "무엇을 고를 수 있는가" 를 묻는 자리. M3-3.
 *
 * **어휘 판정을 브라우저에서 다시 하지 않는다.** 클릭한 것이 카드인지 진행바인지,
 * 고칠 수 있는지, 고친다면 어떤 명령인지는 전부 매핑이 정하는 일이다. 그 판정을
 * 화면이 클래스 이름으로 흉내내기 시작하면 `doc.js` 가 파서에 대해 막아 둔 실패가
 * 그대로 재현된다 — **게이트가 재는 트리와 화면이 고르는 트리가 갈라진다.**
 *
 * 그래서 화면은 iframe 안 DOM 에서 `data-node-id` 하나만 읽고, 그 id 의 뜻은 전부
 * 여기서 받는다. DOM 은 좌표를 주고, 의미는 서버가 준다.
 *
 * **읽기만 한다.** 이 응답은 명령이 아니고 파일을 열지도 않는다 (`loadDeck` 이 읽는다).
 */

import { attrOf } from '../tools/harness/tree.js';
import { ringsOf } from './commit.js';

/** 고를 수 있는 노드의 종류. 나머지(인라인·구조 자식·불투명 자식)는 지목 대상이 아니다. */
const SELECTABLE = new Set(['container', 'leaf-authored', 'leaf-opaque', 'leaf-void']);

/** 잠금 사유를 몇 개까지 실을 것인가. 전부 실으면 목차가 진단 덤프가 된다. */
const MAX_REASONS = 10;

export function outlineOf(deck) {
  return {
    deckId: deck.deckId,
    docHash: deck.docHash,
    // 열 때의 되돌리기·다시하기 잔량 (M3-6). 이후로는 커밋 응답이 갱신해 준다.
    rings: ringsOf(deck.deckId),
    sections: deck.sections.map((section) => sectionOutline(deck, section)),
  };
}

/**
 * 섹션 하나.
 *
 * **`annotated` 와 `blockers` 는 다른 것을 잰다.** 앞은 "섹션 자신을 명령이 지목할 수
 * 있는가"(이름표가 있는가)이고, 뒤는 "그 안에 어휘 밖 노드가 있는가"다. 둘을 하나의
 * `editable` 로 합치지 않는 이유 — **어디까지 잠글 것인가는 UX 정책이고 M3-9 의 몫**이다.
 * 여기서 합쳐 버리면 정책이 바뀔 때마다 서버 응답의 뜻이 바뀐다.
 *
 * (합치는 쪽이 자명해 보이지만 그렇지 않다. 실측 — 이름표를 갓 붙인 W31 덱은 13 개
 *  섹션 전부가 이름표를 갖고, 동시에 12 개가 어휘 밖 노드를 하나 이상 갖는다.
 *  "하나라도 있으면 잠근다" 로 합치면 편집 가능한 슬라이드가 1 장이 된다.)
 */
function sectionOutline(deck, section) {
  const root = section.root;
  const blockers = blockersIn(root);

  return {
    index: section.index,
    nodeId: root.nodeId ?? null,
    label: attrOf(section.element, 'data-screen-label')
      ?? attrOf(section.element, 'data-label')
      ?? null,
    annotated: root.kind === 'section' && root.nodeId !== null,
    // 어휘 밖 노드를 세어서 함께 준다. "편집할 수 없습니다" 만 띄우고 이유를 안 주면
    // 사용자에게 나갈 문이 없다 (결정 9).
    blockerCount: blockers.length,
    blockers: blockers.slice(0, MAX_REASONS),
    children: childrenOf(deck, root),
  };
}

/**
 * 지목 가능한 자식들. 이름표가 없는 요소는 **건너뛰고 그 안을 본다.**
 *
 * 인라인 `<span>` 이나 불투명 스캐폴딩(`.prog-track`)은 노드가 아니라 그 노드의
 * 겉모습 일부다. 목차에 실으면 화면이 고를 수 없는 것을 고를 수 있다고 표시한다.
 */
function childrenOf(deck, node) {
  const out = [];
  for (const child of node.children) {
    if (!child.isElement) continue;
    if (child.nodeId && SELECTABLE.has(child.kind)) out.push(nodeOutline(deck, child));
    else out.push(...childrenOf(deck, child));
  }
  return out;
}

function nodeOutline(deck, node) {
  return {
    nodeId: node.nodeId,
    kind: node.kind,
    value: node.value,
    variant: node.variant ?? null,
    tag: node.tag,
    // 이 노드의 **내용**을 고치는 명령. 컨테이너는 내용이 없으므로 null 이다.
    edit: editCommandFor(deck, node),
    children: childrenOf(deck, node),
  };
}

/**
 * 내용 편집 명령의 이름.
 *
 * 판정은 `content-commands.js` 의 `assertEditableLeaf` 와 같은 근거를 쓴다. 화면이
 * 422 를 받고 나서야 "아, 이건 setContent 가 아니었구나" 를 알게 하지 않으려는 것이다
 * — 거부는 방향을 함께 준다는 §3.5 를 **거부 전에** 지키는 쪽이다.
 */
function editCommandFor(deck, node) {
  if (node.kind === 'leaf-authored') return 'setContent';
  if (node.kind === 'leaf-opaque') return deck.mapping.opaqueLeafInfo(node.value)?.command ?? null;
  if (node.kind === 'leaf-void') return 'setProps';
  return null;
}

/**
 * 이 섹션을 잠그는 노드들 — 어휘 밖 요소와 이름표 없는 노드.
 *
 * 소스 줄 번호를 함께 준다. "편집할 수 없습니다" 만으로는 사용자가 무엇을 고쳐야
 * 하는지 알 수 없고, 손편집으로 나갈 문은 줄 번호뿐이다 (§11 M3 수용 기준).
 */
function blockersIn(root) {
  const out = [];
  root.walk((node) => {
    if (node.kind === 'unknown-element') {
      out.push({
        code: node.violation === 'value-outside-vocabulary'
          ? 'grammar.unknown-value'
          : 'grammar.unknown-element',
        tag: node.tag,
        classes: node.classes ?? [],
        declared: node.declared?.el ?? node.declared?.box ?? null,
        line: node.loc?.line ?? null,
      });
      return;
    }
    // 어휘 안이지만 이름표가 없으면 명령이 지목할 수 없다 — 잠금 사유는 같다.
    if (SELECTABLE.has(node.kind) && !node.nodeId) {
      out.push({
        code: 'grammar.missing-id',
        tag: node.tag,
        classes: node.classes ?? [],
        declared: node.value ?? null,
        line: node.loc?.line ?? null,
      });
    }
  });
  return out;
}
