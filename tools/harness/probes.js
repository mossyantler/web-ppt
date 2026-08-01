// 게이트 분자 (2)(3) 의 프로브 — 계획 §11 M1.
//
//  (2) 각 리프의 텍스트 편집과 순서 이동이 성공하고, 편집 구간 밖 바이트가 동일하다.
//  (3) 섹션에 나타나는 각 블록 종류마다 insertElement 로 같은 종류를 하나 더 추가할 수 있다.
//
// 모든 프로브는 메모리에서만 돈다. 파일에 쓰지 않는다 (M2 범위).
// 프로브는 편집 후 소스를 다시 파싱해서 판정한다 — 라이브 DOM 을 직렬화하지 않는다(Z2).

import { existsSync } from 'node:fs';
import { buildTree, findSections, parseDocument } from './tree.js';
import { serialize, opaqueInventory } from './serialize.js';
import { spliced, splicedMany, outsideIdentical } from './splice.js';
import { sectionGate } from './gate.js';

const EDIT_MARK = '·';

/* ------------------------------------------------------------------ 유틸 */

function usedNodeIds(raw) {
  return new Set([...raw.matchAll(/\bdata-node-id="([^"]*)"/g)].map((m) => m[1]));
}

/** §4.1 발급 절차 3항 — 락 안에서 N개를 한 번에. 하네스는 락이 없으므로 순차 발급으로 흉내만 낸다. */
function mintIds(raw, n) {
  const used = usedNodeIds(raw);
  const out = [];
  let i = used.size + 1;
  while (out.length < n) {
    const id = `n${(i++).toString(36)}h`;
    if (!used.has(id)) {
      used.add(id);
      out.push(id);
    }
  }
  return out;
}

/** 편집 후 소스에서 같은 인덱스의 섹션을 다시 파싱해 저작 트리를 만든다. */
function reparseSection(raw, sectionIndex, mapping, mode) {
  const doc = parseDocument(raw);
  const sections = findSections(doc);
  const el = sections[sectionIndex];
  if (!el) return null;
  return buildTree(raw, el, mapping, mode).root;
}

/** 프로브 판정의 공통 뒷검사: 구간 밖 바이트 동일 + 재파싱 후 왕복 무손실 + 게이트 유지. */
function verifyEdit({ before, after, edits, sectionIndex, mapping, mode, file, wasGatePassing }) {
  const checks = { outsideIdentical: true, reparsed: true, roundTripLossless: null, gateHeld: null };
  let shift = 0;
  for (const e of [...edits].sort((a, b) => a.start - b.start)) {
    const r = outsideIdentical(before, after, e.start + shift, e.end + shift, e.text);
    if (!r.ok && edits.length === 1) checks.outsideIdentical = false;
    shift += e.text.length - (e.end - e.start);
  }
  if (edits.length > 1) {
    // 다중 구간: 각 구간을 도려낸 잔여 바이트가 같은지 본다.
    checks.outsideIdentical = carve(before, edits.map((e) => [e.start, e.end])) ===
      carve(after, shiftedSpans(edits));
  }
  const root = reparseSection(after, sectionIndex, mapping, mode);
  if (!root) {
    checks.reparsed = false;
    return checks;
  }
  checks.roundTripLossless = serialize(root, after) === after.slice(root.start, root.end);
  if (wasGatePassing !== null) {
    checks.gateHeld = sectionGate(root, after, mapping, file).pass === wasGatePassing;
  }
  checks.root = root;
  return checks;
}

function carve(s, spans) {
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  let out = '';
  let cur = 0;
  for (const [a, b] of sorted) {
    out += s.slice(cur, a);
    cur = b;
  }
  return out + s.slice(cur);
}

function shiftedSpans(edits) {
  const sorted = [...edits].sort((a, b) => a.start - b.start);
  const out = [];
  let shift = 0;
  for (const e of sorted) {
    out.push([e.start + shift, e.start + shift + e.text.length]);
    shift += e.text.length - (e.end - e.start);
  }
  return out;
}

const ok = (detail = {}) => ({ status: 'pass', ...detail });
const fail = (reason, detail = {}) => ({ status: 'fail', reason, ...detail });

/* ------------------------------------------- (2a) 텍스트 편집 (setContent 등) */

/** 리프 안의 첫 번째 비공백 텍스트 노드. 불투명 서브트리 안은 건너뛴다. */
function firstTextNode(leaf) {
  let hit = null;
  leaf.walk((n) => {
    if (hit) return;
    if (n.kind === 'opaque-subtree' || underOpaque(n, leaf)) return;
    if (n.nodeName === '#text' && !n.whitespaceOnly && n.start !== null) hit = n;
  });
  return hit;
}

function underOpaque(n, stopAt) {
  for (let p = n.parent; p && p !== stopAt.parent; p = p.parent) {
    if (p.kind === 'opaque-subtree' || p.kind === 'leaf-opaque') return true;
  }
  return false;
}

export function textEditProbe(ctx, leaf) {
  const { raw, mapping, mode, file, sectionIndex, gatePassing } = ctx;

  if (leaf.kind === 'leaf-opaque') {
    const info = mapping.opaqueLeafInfo(leaf.value);
    // L2 조항 4 — setContent 는 422. 편집은 전용 명령 하나로만 한다 (L3).
    const cmd = info?.command;
    if (!cmd) return fail(`불투명 리프 ${leaf.value} 의 전용 명령이 mapping 에 선언되지 않았다`);
    if (cmd === 'setValue') return setValueProbe(ctx, leaf);
    if (cmd === 'setTex') return setTexProbe(ctx, leaf);
    return fail(`알 수 없는 전용 명령 ${cmd}`);
  }

  if (leaf.kind === 'leaf-void') {
    // L5 — setContent 대상 아님. 편집은 setProps 로만.
    return setPropsProbe(ctx, leaf);
  }

  const text = firstTextNode(leaf);
  if (!text) {
    return fail('편집할 텍스트 노드가 없다 — setContent 의 대상 표면이 존재하지 않는다', { command: 'setContent' });
  }
  const original = raw.slice(text.start, text.end);
  const edit = { start: text.start, end: text.end, text: original + EDIT_MARK };
  const after = spliced(raw, edit.start, edit.end, edit.text);
  const checks = verifyEdit({ before: raw, after, edits: [edit], sectionIndex, mapping, mode, file, wasGatePassing: gatePassing });
  const changed = after !== raw;
  const inlineHeld = inlineClassesHeld(leaf, raw, checks.root, after, mapping);
  const good = changed && checks.outsideIdentical && checks.reparsed && checks.roundTripLossless !== false && checks.gateHeld !== false && inlineHeld.ok;
  return good
    ? ok({ command: 'setContent', span: [edit.start, edit.end], checks, inlineHeld })
    : fail('setContent 프로브가 불변식을 깼다', { command: 'setContent', checks, inlineHeld });
}

/** F-5ⓒ — setContent 후 inlineClasses 와 구조 자식이 살아 있는가. */
function inlineClassesHeld(leaf, raw, newRoot, after, mapping) {
  const before = [];
  leaf.walk((n) => {
    if (n.isElement && (n.kind === 'inline' || n.kind === 'structural-child')) before.push(`${n.tag}.${n.classes.join('.')}`);
  });
  if (!newRoot) return { ok: false, before, after: null };
  const found = [];
  newRoot.walk((n) => {
    if (n.isElement && (n.kind === 'inline' || n.kind === 'structural-child')) found.push(`${n.tag}.${n.classes.join('.')}`);
  });
  return { ok: before.every((b) => found.includes(b)), before, after: found };
}

/** progress — setValue(id,{value}) 가 data-value 와 --pct 를 함께 갱신한다 (L3·L4). */
function setValueProbe(ctx, leaf) {
  const { raw, mapping, mode, file, sectionIndex, gatePassing } = ctx;
  const props = mapping.dataPropsOf(leaf.value);
  if (!props) return fail(`dataProps[${leaf.value}] 선언이 없다 — setValue 가 무엇을 함께 갱신해야 하는지 알 수 없다`, { command: 'setValue' });
  const [prop, spec] = Object.entries(props)[0];
  const openTag = raw.slice(leaf.openStart, leaf.openEnd);
  const current = leaf.attrs.find((a) => a.name === spec.from)?.value;
  if (current === undefined) {
    return fail(`${spec.from} 속성이 없다 — 불투명 리프의 값이 소스에 없으므로 setValue 의 대상이 없다`, { command: 'setValue' });
  }
  const next = String((Number(current) + 1) % 101);
  let newOpen = openTag.replace(new RegExp(`(\\b${spec.from}=")[^"]*(")`), `$1${next}$2`);
  const styleVal = leaf.attrs.find((a) => a.name === 'style')?.value;
  if (styleVal === undefined || !styleVal.includes(prop)) {
    return fail(`인라인 데이터 채널 ${prop} 이 소스에 없다 — setValue 가 ${spec.from} 과 ${prop} 을 함께 갱신할 수 없다 (§3.4 조항 3, adoptSection 이 치환한다)`,
      { command: 'setValue' });
  }
  newOpen = newOpen.replace(new RegExp(`(${prop}\\s*:\\s*)[^;"']*`), `$1${next}`);
  const edit = { start: leaf.openStart, end: leaf.openEnd, text: newOpen };
  const after = spliced(raw, edit.start, edit.end, edit.text);
  const checks = verifyEdit({ before: raw, after, edits: [edit], sectionIndex, mapping, mode, file, wasGatePassing: gatePassing });
  // 스캐폴딩 바이트 동일 — 불투명 서브트리는 한 바이트도 바뀌지 않아야 한다.
  const scaffoldBefore = leaf.children.map((c) => (c.start === null ? '' : c.bytes(raw))).join('');
  const newLeaf = checks.root ? findById(checks.root, leaf.nodeId) : null;
  const scaffoldAfter = newLeaf ? newLeaf.children.map((c) => (c.start === null ? '' : c.bytes(after))).join('') : null;
  const scaffoldHeld = leaf.nodeId ? scaffoldBefore === scaffoldAfter : null;
  const good = after !== raw && checks.outsideIdentical && checks.reparsed && checks.roundTripLossless !== false && scaffoldHeld !== false;
  return good
    ? ok({ command: 'setValue', span: [edit.start, edit.end], checks, scaffoldHeld })
    : fail('setValue 프로브가 불변식을 깼다', { command: 'setValue', checks, scaffoldHeld });
}

/** equation — setTex(id, tex) 는 data-tex 만 바꾸고 자식은 비어 있어야 한다. */
function setTexProbe(ctx, leaf) {
  const { raw, mapping, mode, file, sectionIndex, gatePassing } = ctx;
  const tex = leaf.attrs.find((a) => a.name === 'data-tex')?.value;
  if (tex === undefined) return fail('data-tex 속성이 없다 — setTex 의 대상이 없다', { command: 'setTex' });
  const openTag = raw.slice(leaf.openStart, leaf.openEnd);
  const newOpen = openTag.replace(/(\bdata-tex=")([^"]*)(")/, (_m, a, v, z) => `${a}${v} + 0${z}`);
  const edit = { start: leaf.openStart, end: leaf.openEnd, text: newOpen };
  const after = spliced(raw, edit.start, edit.end, edit.text);
  const checks = verifyEdit({ before: raw, after, edits: [edit], sectionIndex, mapping, mode, file, wasGatePassing: gatePassing });
  const good = after !== raw && checks.outsideIdentical && checks.reparsed && checks.roundTripLossless !== false;
  return good ? ok({ command: 'setTex', checks }) : fail('setTex 프로브가 불변식을 깼다', { command: 'setTex', checks });
}

/** 무자식 리프 — setProps 로만 편집한다 (L5). */
function setPropsProbe(ctx, leaf) {
  const { raw, mapping, mode, file, sectionIndex, gatePassing } = ctx;
  const openTag = raw.slice(leaf.openStart, leaf.openEnd);
  const selfClosing = /\/>$/.test(openTag);
  const insertAt = openTag.length - (selfClosing ? 2 : 1);
  const newOpen = `${openTag.slice(0, insertAt)} data-track-id="probe"${openTag.slice(insertAt)}`;
  const edit = { start: leaf.openStart, end: leaf.openEnd, text: newOpen };
  const after = spliced(raw, edit.start, edit.end, edit.text);
  const checks = verifyEdit({ before: raw, after, edits: [edit], sectionIndex, mapping, mode, file, wasGatePassing: gatePassing });
  const good = after !== raw && checks.outsideIdentical && checks.reparsed && checks.roundTripLossless !== false && checks.gateHeld !== false;
  return good ? ok({ command: 'setProps', checks }) : fail('setProps 프로브가 불변식을 깼다', { command: 'setProps', checks });
}

function findById(root, id) {
  let hit = null;
  root.walk((n) => {
    if (!hit && n.nodeId && n.nodeId === id) hit = n;
  });
  return hit;
}

/* ------------------------------------------------- (2b) 순서 이동 (moveElement) */

/**
 * moveElement — 형제 요소와 자리를 맞바꾼다. 두 노드의 바이트 구간을 서로 교체하는
 * 2구간 splice 이며, 사이의 공백 텍스트 노드는 손대지 않는다. 그래서 들여쓰기가 보존된다.
 * 형제가 없으면 같은 자리로의 무이동(no-op)을 검사한다 — 항등이므로 바이트가 동일해야 한다.
 */
export function moveProbe(ctx, node) {
  const { raw, mapping, mode, file, sectionIndex, gatePassing } = ctx;
  const parent = node.parent;
  if (!parent) return fail('부모가 없다 — 이동 대상이 아니다', { command: 'moveElement' });
  const sibs = parent.children.filter((c) => c.isElement && c.start !== null);
  const i = sibs.indexOf(node);
  if (i === -1) return fail('부모의 요소 자식 목록에서 자신을 찾지 못했다', { command: 'moveElement' });

  if (sibs.length === 1) {
    // 유일한 형제 — 이동은 항등이다. 항등 이동이 바이트를 바꾸면 재직렬화 결함이다.
    const after = spliced(raw, node.start, node.end, raw.slice(node.start, node.end));
    return after === raw
      ? ok({ command: 'moveElement', noop: true, note: '유일한 요소 자식 — 항등 이동. 바이트 동일 확인' })
      : fail('항등 이동이 바이트를 바꿨다', { command: 'moveElement', noop: true });
  }

  const other = sibs[i === sibs.length - 1 ? i - 1 : i + 1];
  const a = node.start < other.start ? node : other;
  const b = node.start < other.start ? other : node;
  const edits = [
    { start: a.start, end: a.end, text: raw.slice(b.start, b.end) },
    { start: b.start, end: b.end, text: raw.slice(a.start, a.end) },
  ];
  const after = splicedMany(raw, edits);

  const checks = verifyEdit({ before: raw, after, edits, sectionIndex, mapping, mode, file, wasGatePassing: gatePassing });
  // 이동한 두 노드의 바이트가 온전히 살아 있는가.
  const bytesHeld = after.includes(raw.slice(a.start, a.end)) && after.includes(raw.slice(b.start, b.end));
  // 규약 G1 조항 4 — 명령이 직접 건드린 노드 밖의 불투명 노드는 개수·순서·바이트 보존.
  const g1 = opaqueG1(ctx, checks.root, after, [a, b]);
  const good = after !== raw && checks.reparsed && checks.roundTripLossless !== false && bytesHeld && g1.ok && checks.gateHeld !== false;
  return good
    ? ok({ command: 'moveElement', swappedWith: other.nodeId ?? other.tag, checks, bytesHeld, g1 })
    : fail('moveElement 프로브가 불변식을 깼다', { command: 'moveElement', checks, bytesHeld, g1 });
}

/** 규약 G1 — 건드린 노드 밖 어휘 밖 노드의 개수·순서·바이트 보존. */
function opaqueG1(ctx, newRoot, after, touched) {
  const { raw, root } = ctx;
  const inTouched = (n, source) => touched.some((t) => n.start !== null && n.start >= t.start && n.end <= t.end && source === raw);
  const before = opaqueInventory(root, raw).filter((_, idx) => true);
  const beforeOutside = [];
  root.walk((n) => {
    if ((n.kind === 'opaque-node' || n.kind === 'opaque-subtree') && n.start !== null && !inTouched(n, raw)) {
      beforeOutside.push(n.bytes(raw));
    }
  });
  if (!newRoot) return { ok: false, reason: '편집 후 섹션을 다시 파싱하지 못했다' };
  const afterAll = opaqueInventory(newRoot, after).map((o) => o.bytes);
  const missing = beforeOutside.filter((b) => !afterAll.includes(b));
  return {
    ok: missing.length === 0 && before.length === afterAll.length,
    beforeCount: before.length,
    afterCount: afterAll.length,
    missing: missing.slice(0, 5),
  };
}

/* --------------------------------------------- (3) insertElement 로 같은 종류 추가 */

/** 섹션에 나타나는 블록 종류 = (data-el|data-box, data-variant) 쌍 (§2.1 L5). */
export function blockKindsOf(root) {
  const kinds = new Map();
  root.walk((n) => {
    if (n === root) return;
    if (!n.key) return;
    if (!['container', 'leaf-authored', 'leaf-opaque', 'leaf-void'].includes(n.kind)) return;
    const variant = n.variant ?? 'default';
    // region 은 (슬롯, 조판) 두 축이 함께 블록 종류를 정한다 — head 를 하나 더 만드는 것과
    // body 를 하나 더 만드는 것은 다른 삽입이다.
    const k = n.value === 'region' ? `${n.key}@${n.regionSlot}|${variant}` : `${n.key}|${variant}`;
    if (!kinds.has(k)) kinds.set(k, { key: n.key, variant, regionSlot: n.regionSlot ?? null, kind: n.kind, value: n.value, nodes: [] });
    kinds.get(k).nodes.push(n);
  });
  return kinds;
}

export function insertProbe(ctx, blockKind) {
  const { raw, mapping, mode, file, sectionIndex, gatePassing } = ctx;
  const { key, variant, kind, value, nodes, regionSlot } = blockKind;

  const cls = mapping.classFor(key, variant, regionSlot);
  if (cls === null) {
    return fail(`mapping.blocks 에 (${key}, ${variant}${regionSlot ? `, region=${regionSlot}` : ''}) 로 가는 경로가 없다 — insertElement 로 같은 종류를 만들 수 없다 (§11 M1 분자 3의 목적)`,
      { command: 'insertElement' });
  }

  if (kind === 'leaf-opaque') {
    // §3.3 삽입 경로 — 클라이언트 원시 HTML 을 쓰지 않는다. 테마 scaffolds 조각을 복사한다.
    const scaffold = mapping.scaffoldOf(value);
    const info = mapping.opaqueLeafInfo(value);
    if (info?.sourceChildren === 'present') {
      if (!scaffold) {
        return fail(`scaffolds[${value}] 선언이 없다 — 서버가 복사할 테마 조각이 없으므로 삽입 경로가 존재하지 않는다`, { command: 'insertElement' });
      }
      const exists = fileExists(scaffold);
      if (!exists) {
        return fail(`scaffolds[${value}] 가 가리키는 테마 조각 파일이 없다: ${scaffold} (테마 templates/ 미구현 — M5 범위)`,
          { command: 'insertElement', scaffold });
      }
    }
  }

  const anchor = nodes[0];
  const [id] = mintIds(raw, 1);
  const html = synthesize(mapping, { key, variant, kind, value, id, regionSlot });
  if (!html) return fail(`(${key}, ${variant}) 의 소스 조각을 합성할 방법이 없다`, { command: 'insertElement' });

  const insertAt = anchor.end;
  const edit = { start: insertAt, end: insertAt, text: html };
  const after = spliced(raw, insertAt, insertAt, html);
  const checks = verifyEdit({ before: raw, after, edits: [edit], sectionIndex, mapping, mode, file, wasGatePassing: gatePassing });

  // 삽입된 노드가 정말 같은 종류로 파싱되는가.
  const newNode = checks.root ? findById(checks.root, id) : null;
  const sameKind = !!newNode && newNode.key === key && (newNode.variant ?? 'default') === variant
    && newNode.kind === kind && (newNode.regionSlot ?? null) === (regionSlot ?? null);
  const good = checks.outsideIdentical && checks.reparsed && checks.roundTripLossless !== false && sameKind && checks.gateHeld !== false;
  return good
    ? ok({ command: 'insertElement', inserted: html.trim(), checks, sameKind })
    : fail('insertElement 프로브가 불변식을 깼다', {
        command: 'insertElement',
        inserted: html.trim(),
        checks,
        sameKind,
        parsedAs: newNode ? { key: newNode.key, variant: newNode.variant, kind: newNode.kind } : null,
      });
}

function fileExists(p) {
  return existsSync(p);
}

/** (값, variant) 로부터 삽입할 소스 조각을 만든다. 어휘와 mapping 만 근거로 쓴다. */
export function synthesize(mapping, { key, variant, kind, value, id, regionSlot = null }) {
  const tag = mapping.defaultTagFor(key);
  const cls = mapping.classFor(key, variant, regionSlot) ?? '';
  const attr = key.startsWith('box:') ? `data-box="${value}"` : `data-el="${value}"`;
  const parts = [attr, `data-node-id="${id}"`];
  if (key === 'box:region' && regionSlot) parts.push(`data-region="${regionSlot}"`);
  if (variant && variant !== 'default') parts.push(`data-variant="${variant}"`);
  if (cls) parts.push(`class="${cls}"`);

  if (kind === 'leaf-void') {
    if (tag === 'img') return `\n<img ${parts.join(' ')} src="" alt="">`;
    return `\n<${tag} ${parts.join(' ')}></${tag}>`;
  }
  if (kind === 'leaf-opaque') {
    if (value === 'equation') return `\n<${tag} ${parts.join(' ')} data-tex="x" data-display="false"></${tag}>`;
    const props = mapping.dataPropsOf(value) ?? {};
    const [prop, spec] = Object.entries(props)[0] ?? [];
    const dataAttrs = spec ? ` ${spec.from}="0"` : '';
    const style = prop ? ` style="${prop}:0"` : '';
    return `\n<${tag} ${parts.join(' ')}${dataAttrs}${style}></${tag}>`;
  }
  if (kind === 'container') return `\n<${tag} ${parts.join(' ')}></${tag}>`;

  const struct = mapping.leafStructureOf(value);
  if (struct) return `\n<${tag} ${parts.join(' ')}>${minimalStructure(value, struct)}</${tag}>`;
  return `\n<${tag} ${parts.join(' ')}>삽입</${tag}>`;
}

function minimalStructure(value, struct) {
  if (value === 'list') return '<li>삽입</li>';
  if (value === 'table') return '<tr><td>삽입</td></tr>';
  return struct.map((d) => `<${d.tag}${d.class ? ` class="${d.class}"` : ''}>삽입</${d.tag}>`).join('');
}

/* ------------------------------------------------------------ 섹션 단위 실행 */

export function runSectionProbes({ raw, root, mapping, mode, file, sectionIndex, gatePassing }) {
  const ctx = { raw, root, mapping, mode, file, sectionIndex, gatePassing };

  const leaves = [];
  root.walk((n) => {
    if (['leaf-authored', 'leaf-opaque', 'leaf-void'].includes(n.kind)) leaves.push(n);
  });

  const leafResults = leaves.map((leaf) => ({
    key: leaf.key,
    variant: leaf.variant ?? 'default',
    line: leaf.loc?.line ?? null,
    nodeId: leaf.nodeId,
    edit: textEditProbe(ctx, leaf),
    move: moveProbe(ctx, leaf),
  }));

  const kinds = [...blockKindsOf(root).values()];
  const insertResults = kinds.map((k) => ({
    key: k.key,
    variant: k.variant,
    count: k.nodes.length,
    result: insertProbe(ctx, k),
  }));

  const c2 = leaves.length > 0 && leafResults.every((r) => r.edit.status === 'pass' && r.move.status === 'pass');
  const c3 = kinds.length > 0 && insertResults.every((r) => r.result.status === 'pass');

  return {
    leafCount: leaves.length,
    blockKindCount: kinds.length,
    leafResults,
    insertResults,
    criterion2: c2 ? 'pass' : 'fail',
    criterion3: c3 ? 'pass' : 'fail',
    criterion2Reason: leaves.length === 0 ? '리프가 하나도 없다 — 편집 표면이 존재하지 않는다' : null,
    criterion3Reason: kinds.length === 0 ? '블록 종류가 하나도 없다 — 어휘로 인식된 블록이 없다' : null,
  };
}
