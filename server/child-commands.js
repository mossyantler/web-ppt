/**
 * 구조 자식 명령 4종 — `reorderChildren` · `insertChild` · `removeChild` · `setChildContent`.
 *
 * ## 왜 필요한가
 *
 * `<li>`·`<td>`·`<tr>` 은 L6 구조 자식이라 규칙 2·3 에서 면제된다 — `data-node-id` 를
 * 갖지 않는다(§3.6). 표 하나에 id 24 개가 붙으면 손편집이 불가능해지므로 그 면제는 옳다.
 * 대가는 **명령이 그것들을 지목할 수 없다**는 것이다. `moveElement(<li>, …)` 는 404 다.
 *
 * 그래서 지금까지 목록 순서를 바꾸려면 `setContent` 로 리프 전체를 새 HTML 로 갈아야 했고,
 * `setContent` 는 텍스트 편집 명령이라 `normalizeInline` 을 지난다. **순서만 바꿔도 내용이
 * 정화기를 통과한다** — 실측에서 `<span class="wrf">` 의 클래스가 그렇게 사라졌다.
 * 사용자는 순서만 만졌는데 서식이 없어지고, 무엇이 없어졌는지 모른다. P4 위반이다.
 *
 * ## 이 명령들이 그것을 없애는 방식
 *
 * **자식을 이름이 아니라 순번으로 지목한다.** 부모 리프는 이름이 있으므로 `(리프 id, 순번)`
 * 쌍이면 충분하고, `<li>` 에 id 를 붙일 필요가 없다.
 *
 * 그리고 `reorderChildren`·`removeChild` 는 **HTML 을 받지 않는다.** 순열과 순번만 받으므로
 * 정화기를 지날 이유가 없고, 서버는 기존 자식의 원문 바이트를 자리만 바꿔 다시 붙인다.
 * 내용에 손댈 경로 자체가 없다.
 *
 * `insertChild` 는 새 자식의 **내용**만 받고 태그는 `leafStructure` 선언에서 고른다 —
 * 클라이언트가 구조를 보내지 못하게 하는 것이 §3.2 L2 "삽입 경로" 와 같은 원칙이다.
 *
 * ## 자식 사이의 공백과 주석
 *
 * 재배열은 **자리(슬롯)를 고정하고 내용만 바꾼다.** 자식 사이의 들여쓰기와 주석은 원문
 * 그대로 남는다 — 규약 G1 의 어휘 밖 노드가 정확히 거기 있다.
 */

import { DocError, resolveNode } from './doc.js';
import { registerCommand } from './commands.js';
import { normalizeInline } from './normalize-inline.js';

const isStruct = (n) => n.kind === 'structural-child' && n.isElement;

/** 구조 자식 목록 (문서 순서). 명령의 `index` 가 세는 단위다. */
const structChildren = (node) => node.children.filter(isStruct);

/**
 * 편집 가능한 내부 구간.
 *
 * 닫는 태그가 소스에 없는 요소(`<li>A<li>B` 같은 생략형)는 `innerSpan()` 이 null 이다.
 * 그런 요소도 `[openEnd, end)` 는 항상 유효하므로 그것으로 떨어진다 — 저자의 손버릇에
 * 명령이 달려 있지 않게 하는 것이 §3.6 `<tbody>` 주와 같은 취지다.
 */
function innerRange(node) {
  const span = node.innerSpan();
  if (span) return span;
  if (node.openEnd === null || node.end === null) {
    throw new DocError(422, `내부 구간을 정할 수 없다: <${node.tag}>`, { code: 'commit.no-inner-span' });
  }
  return [node.openEnd, node.end];
}

/** 대상이 구조 자식을 선언한 저작 리프인가. */
function assertStructLeaf(deck, node) {
  if (node.kind !== 'leaf-authored' || !deck.mapping.leafStructureOf(node.value)) {
    throw new DocError(422, `구조 자식 명령의 대상은 leafStructure 를 선언한 저작 리프여야 한다 (현재: ${node.value ?? node.kind})`, {
      code: 'commit.no-leaf-structure',
    });
  }
}

/**
 * `parentPath` 를 따라 리프 안쪽 컨테이너로 내려간다.
 *
 * 표는 `table > tbody > tr > td` 로 깊이 2 를 허용한다(§3.6 조항 6). 행을 재배열하려면
 * `tbody` 를 가리켜야 하므로 순번 경로가 필요하다. 기본값은 `[]` — 리프 자신이다.
 */
function resolveParent(leaf, parentPath) {
  if (!Array.isArray(parentPath)) throw new DocError(400, 'parentPath 가 배열이어야 한다');
  let node = leaf;
  for (const [depth, i] of parentPath.entries()) {
    const kids = structChildren(node);
    if (!Number.isInteger(i) || i < 0 || i >= kids.length) {
      throw new DocError(422, `parentPath[${depth}] 가 범위를 벗어났다: ${i} ∉ [0, ${kids.length})`, {
        code: 'commit.index-out-of-range',
      });
    }
    node = kids[i];
  }
  return node;
}

function assertIndex(i, len, what = 'index') {
  if (!Number.isInteger(i) || i < 0 || i >= len) {
    throw new DocError(422, `${what} 가 범위를 벗어났다: ${i} ∉ [0, ${len})`, { code: 'commit.index-out-of-range' });
  }
}

/* ------------------------------------------------------------ reorderChildren */

registerCommand('reorderChildren', (deck, command) => {
  const { node: leaf } = resolveNode(deck, command.target);
  assertStructLeaf(deck, leaf);

  const parent = resolveParent(leaf, command.args?.parentPath ?? []);
  const kids = structChildren(parent);
  const order = command.args?.order;

  if (!Array.isArray(order) || order.length !== kids.length) {
    throw new DocError(400, `order 는 자식 ${kids.length}개의 순열이어야 한다`);
  }
  const seen = new Set(order);
  if (seen.size !== order.length || order.some((i) => !Number.isInteger(i) || i < 0 || i >= kids.length)) {
    throw new DocError(422, 'order 가 0..n-1 의 순열이 아니다', { code: 'commit.bad-permutation' });
  }

  const raw = deck.raw;
  const [lo, hi] = innerRange(parent);
  let out = '';
  let cursor = lo;
  let k = 0;
  for (const c of parent.children) {
    if (!isStruct(c)) continue;
    out += raw.slice(cursor, c.start);                     // 앞의 공백·주석은 자리에 남는다
    out += raw.slice(kids[order[k]].start, kids[order[k]].end);
    cursor = c.end;
    k += 1;
  }
  out += raw.slice(cursor, hi);

  return { edits: [{ start: lo, end: hi, text: out }] };
});

/* --------------------------------------------------------------- removeChild */

registerCommand('removeChild', (deck, command) => {
  const { node: leaf } = resolveNode(deck, command.target);
  assertStructLeaf(deck, leaf);

  const parent = resolveParent(leaf, command.args?.parentPath ?? []);
  const kids = structChildren(parent);
  const index = command.args?.index;
  assertIndex(index, kids.length);

  const raw = deck.raw;
  const [lo, hi] = innerRange(parent);
  let out = '';
  let cursor = lo;
  let k = 0;
  for (const c of parent.children) {
    if (!isStruct(c)) continue;
    // 지울 자식은 **앞의 공백과 함께** 빠진다. 남기면 빈 줄이 하나씩 자란다.
    if (k !== index) out += raw.slice(cursor, c.start) + raw.slice(c.start, c.end);
    cursor = c.end;
    k += 1;
  }
  out += raw.slice(cursor, hi);

  return { edits: [{ start: lo, end: hi, text: out }] };
});

/* --------------------------------------------------------------- insertChild */

registerCommand('insertChild', (deck, command) => {
  const { node: leaf } = resolveNode(deck, command.target);
  assertStructLeaf(deck, leaf);

  const parent = resolveParent(leaf, command.args?.parentPath ?? []);
  const kids = structChildren(parent);
  const { index, tag, html = '', className = null } = command.args ?? {};

  if (!Number.isInteger(index) || index < 0 || index > kids.length) {
    throw new DocError(422, `index 가 범위를 벗어났다: ${index} ∉ [0, ${kids.length}]`, {
      code: 'commit.index-out-of-range',
    });
  }

  // 태그는 `leafStructure` 선언에서만 고른다. 클라이언트가 구조를 보내지 못하게 하는 것이
  // §3.2 L2 "삽입 경로" 와 같은 원칙이다 — 스캐폴딩의 모양은 테마가 정한다.
  const decl = (deck.mapping.leafStructureOf(leaf.value) ?? [])
    .filter((d) => d.tag === tag && (className === null ? !d.class : d.class === className));
  if (!decl.length) {
    throw new DocError(422, `${leaf.value} 의 leafStructure 에 없는 자식이다: <${tag}${className ? ` class="${className}"` : ''}>`, {
      code: 'commit.undeclared-child',
    });
  }

  const inner = normalizeInline(html, deck.mapping, leaf.value);
  if (!inner.ok) {
    throw new DocError(422, `인라인 정화기가 거부했다: ${inner.reason}`, { code: 'commit.rejected-content' });
  }
  const newEl = `<${tag}${className ? ` class="${className}"` : ''}>${inner.html}</${tag}>`;

  const raw = deck.raw;
  const [lo, hi] = innerRange(parent);
  let out = '';
  let cursor = lo;
  let k = 0;
  let lastGap = '';
  let placed = false;

  for (const c of parent.children) {
    if (!isStruct(c)) continue;
    const gap = raw.slice(cursor, c.start);
    lastGap = gap;
    if (k === index && !placed) {
      out += gap + newEl;   // 새 자식도 형제와 같은 들여쓰기를 받는다
      placed = true;
    }
    out += gap + raw.slice(c.start, c.end);
    cursor = c.end;
    k += 1;
  }
  if (!placed) out += lastGap + newEl;   // 끝에 붙이기
  out += raw.slice(cursor, hi);

  return { edits: [{ start: lo, end: hi, text: out }] };
});

/* ----------------------------------------------------------- setChildContent */

registerCommand('setChildContent', (deck, command) => {
  const { node: leaf } = resolveNode(deck, command.target);
  assertStructLeaf(deck, leaf);

  const parent = resolveParent(leaf, command.args?.parentPath ?? []);
  const kids = structChildren(parent);
  const { index, html } = command.args ?? {};
  assertIndex(index, kids.length);

  if (typeof html !== 'string') throw new DocError(400, 'setChildContent 의 args.html 이 문자열이어야 한다');

  const child = kids[index];
  if (structChildren(child).length) {
    // `tbody` 처럼 자식이 또 구조 자식인 노드는 내용 편집 대상이 아니다. 그 안의
    // 항목을 고치려면 parentPath 로 한 단계 더 내려가야 한다.
    throw new DocError(422, `<${child.tag}> 는 구조 자식을 갖는다 — parentPath 로 내려가서 그 자식을 지목하세요`, {
      code: 'commit.nested-child',
    });
  }

  const result = normalizeInline(html, deck.mapping, leaf.value);
  if (!result.ok) {
    throw new DocError(422, `인라인 정화기가 거부했다: ${result.reason}`, { code: 'commit.rejected-content' });
  }

  // **자식 하나의 내부만** splice 한다. 형제 항목은 바이트 동일이다 — 이것이 리프 통째
  // `setContent` 와 갈리는 지점이고, §6.3 목록 7번의 범위를 항목 하나로 좁힌다.
  const [lo, hi] = innerRange(child);
  return { edits: [{ start: lo, end: hi, text: result.html }] };
});
