// 저작 트리 — parse5 의 sourceCodeLocationInfo 로 소스 바이트 구간을 들고 있는 트리를
// 만든다. 참고 구현: reference/estradeck/server/src/deck/parse.ts (읽기 전용).
//
// 이 트리의 성질 셋:
//   1. 모든 노드가 [start, end) 를 갖는다. 노드의 원문 바이트는 raw.slice(start, end) 다.
//   2. 어휘 밖 노드(주석·CDATA·공백 텍스트·PI·doctype)는 파싱된 하위 구조를 갖지 않고
//      바이트 문자열로만 존재한다 — 규약 G1 보존 계약 1항.
//   3. parse5 가 소스에 없는 요소를 삽입한 경우(<tbody>) sourceCodeLocation 이 null 이다.
//      그 노드는 kind='synthesized' 이며 직렬화 시 태그 없이 자식만 낸다 — 그래서
//      <tbody> 없는 표[g7]가 왕복 프로브를 통과한다 (grammar.md §5.1 삭제 근거 2).

import { parse } from 'parse5';

export const INLINE_TAGS = new Set(['b', 'i', 'em', 'strong', 'span', 'br', 'a', 'sup', 'sub', 'code']);

// 규약 G1 의 불투명 노드 종류 (닫힌 목록, grammar.md §1)
export const OPAQUE_NODE_NAMES = new Set(['#comment', '#documentType', '#text']);

const isElementNode = (n) => typeof n?.tagName === 'string';
const childNodesOf = (n) => n?.childNodes ?? [];

export function attrOf(node, name) {
  return node.attrs?.find((a) => a.name === name)?.value;
}

export function hasAttr(node, name) {
  return !!node.attrs?.some((a) => a.name === name);
}

export function classesOf(node) {
  return (attrOf(node, 'class') ?? '').split(/\s+/).filter(Boolean);
}

export function parseDocument(raw) {
  return parse(raw, { sourceCodeLocationInfo: true });
}

/** 문서 안의 모든 <section> 요소를 문서 순서로 반환한다. */
export function findSections(doc) {
  const out = [];
  (function walk(n) {
    if (isElementNode(n) && n.tagName === 'section') out.push(n);
    for (const c of childNodesOf(n)) walk(c);
  })(doc);
  return out;
}

function locOf(node) {
  return node.sourceCodeLocation ?? null;
}

function lineColOf(raw, offset) {
  let line = 1;
  let last = -1;
  for (let i = 0; i < offset; i++) {
    if (raw[i] === '\n') {
      line++;
      last = i;
    }
  }
  return { line, col: offset - last };
}

/**
 * 저작 트리 노드.
 *
 * kind 는 다음 중 하나다.
 *   section | container | leaf-authored | leaf-opaque | leaf-void
 *   structural-child      ... L6 선언된 구조 자식 (규칙 2·3 면제)
 *   inline                ... 허용 인라인 태그 (규칙 2·3 면제 ⓐ)
 *   opaque-subtree        ... 불투명 리프의 자식 (규칙 2·3 면제 ⓑ)
 *   opaque-node           ... 어휘 밖 노드 (주석·CDATA·텍스트·doctype) — 규약 G1
 *   synthesized           ... parse5 가 삽입한, 소스에 없는 요소
 *   unknown-element       ... 위 어디에도 해당하지 않는 요소 = 규칙 2 위반
 */
export class Node {
  constructor(fields) {
    Object.assign(this, fields);
    this.children = [];
  }

  get isElement() {
    return this.tag !== null;
  }

  /** 이 노드의 원문 바이트. */
  bytes(raw) {
    return raw.slice(this.start, this.end);
  }

  /** 여는 태그 밖 ~ 닫는 태그 안, 즉 편집 가능한 내부 구간. 없으면 null. */
  innerSpan() {
    if (this.innerStart === null || this.innerEnd === null) return null;
    return [this.innerStart, this.innerEnd];
  }

  elementChildren() {
    return this.children.filter((c) => c.isElement || c.kind === 'synthesized');
  }

  walk(fn) {
    fn(this);
    for (const c of this.children) c.walk(fn);
  }
}

/**
 * 섹션 하나의 저작 트리를 만든다.
 *
 * mode='declared'  — data-el / data-box 속성으로만 분류한다. 문법 v1 판정의 유일한 모드.
 * mode='inferred'  — 속성이 없으면 클래스 역방향 조회로 분류를 추정한다. 비게이팅 진단용.
 */
export function buildTree(raw, sectionEl, mapping, mode = 'declared') {
  const notes = [];
  const root = makeNode(raw, sectionEl, mapping, mode, null, notes);
  fill(raw, sectionEl, root, mapping, mode, notes);
  return { root, notes };
}

function makeNode(raw, node, mapping, mode, parent, notes) {
  const loc = locOf(node);

  if (!isElementNode(node)) {
    // 어휘 밖 노드 — 텍스트·주석·CDATA(bogus comment)·doctype
    const start = loc?.startOffset ?? null;
    const end = loc?.endOffset ?? null;
    return new Node({
      kind: 'opaque-node',
      nodeName: node.nodeName,
      tag: null,
      classes: [],
      value: null,
      variant: null,
      attrs: [],
      start,
      end,
      innerStart: null,
      innerEnd: null,
      parent,
      whitespaceOnly: node.nodeName === '#text' && !/\S/.test(node.value ?? ''),
      loc: start === null ? null : lineColOf(raw, start),
    });
  }

  if (!loc) {
    // parse5 가 삽입한 요소 (소스에 없다). 예: <tbody>
    notes.push({ code: 'harness.synthesized-element', tag: node.tagName });
    return new Node({
      kind: 'synthesized',
      nodeName: node.tagName,
      tag: node.tagName,
      classes: classesOf(node),
      value: null,
      variant: null,
      attrs: node.attrs ?? [],
      start: null,
      end: null,
      innerStart: null,
      innerEnd: null,
      parent,
      loc: null,
    });
  }

  const el = attrOf(node, 'data-el');
  const box = attrOf(node, 'data-box');
  const classes = classesOf(node);
  const n = new Node({
    kind: 'unknown-element',
    nodeName: node.tagName,
    tag: node.tagName,
    classes,
    value: null,
    variant: attrOf(node, 'data-variant') ?? null,
    declared: { el: el ?? null, box: box ?? null },
    inferred: null,
    attrs: node.attrs ?? [],
    hasSlideAttr: hasAttr(node, 'data-slide'),
    nodeId: attrOf(node, 'data-node-id') ?? null,
    trackId: attrOf(node, 'data-track-id') ?? null,
    start: loc.startOffset,
    end: loc.endOffset,
    openStart: loc.startTag?.startOffset ?? null,
    openEnd: loc.startTag?.endOffset ?? null,
    closeStart: loc.endTag?.startOffset ?? null,
    closeEnd: loc.endTag?.endOffset ?? null,
    innerStart: loc.startTag && loc.endTag ? loc.startTag.endOffset : null,
    innerEnd: loc.startTag && loc.endTag ? loc.endTag.startOffset : null,
    parent,
    loc: lineColOf(raw, loc.startOffset),
  });

  classify(n, node, mapping, mode, parent);
  return n;
}

function classify(n, node, mapping, mode, parent) {
  const isSection = n.tag === 'section' && hasAttr(node, 'data-slide');

  // 부모가 불투명 리프면 자식 전체가 불투명 서브트리다 (면제 ⓑ, L2 조항 2).
  if (parent && (parent.kind === 'leaf-opaque' || parent.kind === 'opaque-subtree')) {
    n.kind = 'opaque-subtree';
    return;
  }

  const el = n.declared.el;
  const box = n.declared.box;

  if (isSection || (n.tag === 'section' && mode === 'inferred')) {
    n.kind = 'section';
    n.value = 'section';
    return;
  }

  if (el && box) {
    n.kind = 'unknown-element';
    n.violation = 'both-el-and-box';
    return;
  }

  if (el || box) {
    n.value = el ?? box;
    n.vocabKind = el ? 'el' : 'box';
    n.key = `${n.vocabKind}:${n.value}`;
    if (!mapping.hasBlockKey(n.key)) {
      n.kind = 'unknown-element';
      n.violation = 'value-outside-vocabulary';
      return;
    }
    // region 은 두 축을 진다 — data-region 은 슬롯(닫힌 열거), data-variant 는 조판이다.
    // 한 요소가 슬롯과 레이아웃을 동시에 지는 실측(6종 템플릿의 `slide-body cols-2` 등)을
    // 표현할 자리가 이것이다 (계획 3판 M1 개정 기록 2 G-2).
    if (n.value === 'region') n.regionSlot = attrOf(node, 'data-region') ?? null;
    n.kind = leafKindOf(mapping, n.value, n.vocabKind);
    return;
  }

  // 여기부터는 data-el/data-box 가 없는 요소다.

  // 면제 ⓒ — 부모 저작 리프가 leafStructure 로 선언한 구조 자식
  if (parent && parent.kind === 'leaf-authored' && mapping.isDeclaredStructuralChild(parent.value, n.tag, n.classes)) {
    n.kind = 'structural-child';
    return;
  }
  // 깊이 2 예외: table 의 thead/tbody 아래 tr/th/td (L6 조항 6)
  if (parent && parent.kind === 'structural-child' && parent.structRoot === 'table') {
    if (mapping.isDeclaredStructuralChild('table', n.tag, n.classes)) {
      n.kind = 'structural-child';
      n.structRoot = 'table';
      return;
    }
  }
  if (parent && parent.kind === 'synthesized' && parent.structRoot === 'table') {
    if (mapping.isDeclaredStructuralChild('table', n.tag, n.classes)) {
      n.kind = 'structural-child';
      n.structRoot = 'table';
      return;
    }
  }

  // 면제 ⓐ — 허용 인라인 태그
  if (INLINE_TAGS.has(n.tag)) {
    n.kind = 'inline';
    n.unknownInlineClasses = n.classes.filter((c) => !mapping.inlineClasses.has(c));
    return;
  }

  if (mode === 'inferred') {
    const hit = n.classes.length ? mapping.lookupClasses(n.classes) : { exact: mapping.lookupTag(n.tag), partial: [] };
    const cand = hit.exact[0] ?? hit.partial[0]?.cand ?? null;
    if (cand) {
      n.inferred = {
        key: cand.key,
        variant: cand.variant,
        exact: hit.exact.length > 0,
        extraClasses: hit.exact.length ? [] : (hit.partial[0].extraClasses ?? []),
        ambiguous: (hit.exact.length || hit.partial.length) > 1,
      };
      n.value = cand.key === 'section' ? 'section' : cand.key.slice(cand.key.indexOf(':') + 1);
      n.vocabKind = cand.key.startsWith('box:') ? 'box' : cand.key.startsWith('el:') ? 'el' : 'section';
      n.key = cand.key;
      n.variant = cand.variant;
      if (cand.regionSlot) n.regionSlot = cand.regionSlot;
      n.kind = n.key === 'section' ? 'section' : leafKindOf(mapping, n.value, n.vocabKind);
      return;
    }
    n.kind = 'unknown-element';
    n.violation = 'no-vocabulary-mapping-for-classes';
    return;
  }

  n.kind = 'unknown-element';
  n.violation = 'missing-data-el-or-data-box';
}

function leafKindOf(mapping, value, vocabKind) {
  if (vocabKind === 'box') return 'container';
  if (mapping.isOpaqueLeaf(value)) return 'leaf-opaque';
  if (mapping.isVoidLeaf(value)) return 'leaf-void';
  return 'leaf-authored';
}

function fill(raw, parse5Node, treeNode, mapping, mode, notes) {
  for (const c of childNodesOf(parse5Node)) {
    const child = makeNode(raw, c, mapping, mode, treeNode, notes);
    if (treeNode.kind === 'leaf-authored' && child.kind === 'structural-child') {
      child.structRoot = treeNode.value;
    } else if (treeNode.structRoot) {
      child.structRoot = treeNode.structRoot;
    }
    if (child.kind === 'synthesized' && treeNode.value === 'table') child.structRoot = 'table';
    treeNode.children.push(child);
    fill(raw, c, child, mapping, mode, notes);
  }
}
