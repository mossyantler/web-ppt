/**
 * `setContent` — 계획 §3.2 "구조 명령" 표의 마지막 하나. M2-4.
 *
 * 이름은 구조 명령이지만 **쓰기 단위는 리프의 내부 구간 하나**다.
 * `[innerStart, innerEnd)` 만 splice 하므로 여는 태그도 닫는 태그도 바뀌지 않는다.
 *
 * **§6.3 목록 7번의 범위가 여기서 정해진다.** 브라우저 직렬화 정규화(속성 재인용,
 * 태그명 소문자화, `<br/>` 의 `/` 소거)는 `setContent` 가 실제로 실행된 리프 **안에서만**
 * 일어난다. 편집되지 않은 리프, 불투명 리프, 슬라이드의 나머지는 규약 G1 의 불투명
 * 보존을 받는다. 오염 표면이 문서 전체에서 리프 하나로 줄었을 뿐 0 은 아니고,
 * 그것을 정직하게 적는 것이 P4 다.
 */

import { DocError, resolveNode } from './doc.js';
import { registerCommand } from './commands.js';
import { normalizeInline } from './normalize-inline.js';

registerCommand('setContent', (deck, command) => {
  const { node } = resolveNode(deck, command.target);
  const html = command.args?.html;

  if (typeof html !== 'string') throw new DocError(400, 'setContent 의 args.html 이 문자열이어야 한다');

  assertEditableLeaf(node, deck);

  const span = node.innerSpan();
  if (!span) {
    throw new DocError(422, `내부 구간이 없는 리프다 — setContent 를 적용할 수 없다: <${node.tag}>`, {
      code: 'commit.no-inner-span',
    });
  }

  // 정화기가 거부하면 명령이 실패한다. 언랩이 아니라 422 다 (§6.2 마지막 행).
  // 리프 값을 함께 넘긴다 — L6 조항 5 가 그 값의 `leafStructure` 선언을 보존하라고
  // 요구한다. 넘기지 않으면 `<li>`·`<td>` 가 언랩되어 목록·표가 텍스트 뭉치가 된다.
  //
  // 리프 **안**의 이름표 붙은 노드(인라인 수식)는 원문 바이트로 되돌린다. 화면은 그
  // 자리에 빈 자리표만 보낸다 — 렌더된 KaTeX 를 되돌려 보내는 일이 없어야 한다.
  const result = normalizeInline(html, deck.mapping, node.value, addressableInside(deck, node));
  if (!result.ok) {
    throw new DocError(422, `인라인 정화기가 거부했다: ${result.reason}`, { code: 'commit.rejected-content' });
  }

  return { edits: [{ start: span[0], end: span[1], text: result.html }] };
});

/**
 * 이 리프 안에 사는, 이름표가 붙은 노드들 — id → 원문 바이트.
 *
 * 깊이를 가리지 않는다. 수식이 `<strong>` 안에 들어 있어도 자리표는 같은 뜻이어야 한다.
 *
 * **자리표로 오지 않은 노드는 지워진다.** 사용자가 문단에서 수식을 지운 경우가 그것이고,
 * 지울 방법이 없으면 편집기가 아니다. 대신 정화기 쪽에서 남의 id·중복 id 를 거부하므로,
 * 지우는 일은 되고 엉뚱한 것을 되살리거나 복제하는 일은 안 된다.
 */
function addressableInside(deck, node) {
  const out = new Map();
  const visit = (n) => {
    for (const child of n.children ?? []) {
      if (child.nodeId) out.set(child.nodeId, deck.raw.slice(child.start, child.end));
      visit(child);
    }
  };
  visit(node);
  return out;
}

/**
 * `setContent` 의 대상 판정.
 *
 * 거부할 때마다 **어떤 명령을 대신 써야 하는지** 응답에 담는다. §3.2 L2 조항 4 가
 * "거부이지 무시가 아니다. 응답은 어떤 전용 명령을 써야 하는지 명시한다" 로 요구한 것이다.
 */
function assertEditableLeaf(node, deck) {
  if (node.kind === 'section') {
    throw new DocError(422, '섹션에는 setContent 를 걸 수 없다', { code: 'commit.wrong-target' });
  }
  if (node.kind === 'container') {
    throw new DocError(422, '컨테이너에는 setContent 를 걸 수 없다. 자식 리프를 지목하세요.', {
      code: 'commit.wrong-target',
    });
  }
  if (node.kind === 'leaf-opaque') {
    // §3.2 L2 — 자식 서브트리가 저작물이 아니라 테마·런타임의 산출물이다.
    const info = deck.mapping.opaqueLeafInfo(node.value);
    throw new DocError(422, `불투명 리프는 전용 명령으로 편집한다: ${info?.command ?? '(미선언)'}`, {
      code: 'commit.opaque-leaf',
      use: info?.command ?? null,
    });
  }
  if (node.kind === 'leaf-void') {
    // §3.1 L5 — 자식을 가지면 위반이다. 편집은 속성으로만 한다.
    throw new DocError(422, '무자식 리프는 setProps 로 편집한다', {
      code: 'commit.void-leaf',
      use: 'setProps',
    });
  }
  if (node.kind !== 'leaf-authored') {
    throw new DocError(422, `setContent 의 대상은 저작 리프여야 한다 (현재: ${node.kind})`, {
      code: 'commit.wrong-target',
    });
  }
}
