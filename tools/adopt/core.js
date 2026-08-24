/**
 * `adoptSection` 마이그레이터 **코어** — 계획 §10.1 (a)의 M1 오프라인 산출물.
 *
 * 입력: 문법 밖 HTML 덱 소스 문자열.
 * 출력: 적용할 편집 목록(속성 삽입/치환) + 부여 내역 + **사람 판단이 필요한 항목 목록**.
 *
 * 이 모듈은 `fs`를 import하지 않는다. 파일 I/O는 `index.js` 한 곳에만 있다(§10.1 감시 지표).
 *
 * 원칙 두 개가 구현 전체를 지배한다.
 * 1. **추측하지 않는다.** 클래스로 어휘 값이 확정되지 않으면 부여하지 않고 보고한다.
 * 2. **재직렬화하지 않는다.** 편집은 여는 태그 안의 속성 삽입/치환뿐이므로 편집 구간 밖
 *    바이트는 정의상 동일하다(P2, 규약 G1).
 */

import { parse } from 'parse5';
import {
  INLINE_TAGS, INLINE_ANNOTATABLE, LEAF_ENTRIES, BOX_ENTRIES, TAG_LEAF,
  LEAF_STRUCTURE, OPAQUE_LEAVES, SECTION_VARIANTS, matchEntries,
} from './mapping.js';
import { IdAllocator, walk, getAttr, reissueSubtree } from './ids.js';

const GRAMMAR_VERSION = 'v1';

/* ------------------------------------------------------------------ 노드 유틸 */

function tagOf(node) {
  return (node.tagName || '').toLowerCase();
}

function classListOf(node) {
  const cls = getAttr(node, 'class');
  return cls ? cls.split(/\s+/).filter(Boolean) : [];
}

function startTagLoc(node) {
  return node.sourceCodeLocation?.startTag || null;
}

/** 자기 안에 공백 아닌 글자가 있는가 (자손 포함). */
function hasOwnText(node) {
  for (const c of node.childNodes || []) {
    if (c.nodeName === '#text' && (c.value || '').trim()) return true;
    if (c.tagName && hasOwnText(c)) return true;
  }
  return false;
}

function textOf(node) {
  let out = '';
  for (const child of node.childNodes || []) {
    if (child.nodeName === '#text') out += child.value;
    else if (child.tagName) out += textOf(child);
  }
  return out.trim();
}

/* ------------------------------------------------------------------ 컨텍스트 */

class AdoptContext {
  constructor(source, opts) {
    this.source = source;
    this.opts = opts;
    this.alloc = new IdAllocator(source);
    this.edits = [];
    this.findings = [];
    this.annotations = [];
  }

  /** 여는 태그 안, 태그명 바로 뒤의 삽입 지점 (splice.ts:105 `setSectionId`과 같은 자리) */
  insertPos(node) {
    const st = startTagLoc(node);
    if (!st) return null;
    const head = /^<\s*[^\s/>]+/.exec(this.source.slice(st.startOffset, st.endOffset));
    return head ? st.startOffset + head[0].length : null;
  }

  rawOpenTag(node) {
    const st = startTagLoc(node);
    return st ? this.source.slice(st.startOffset, st.endOffset) : `<${tagOf(node)}>`;
  }

  /**
   * 속성을 부여한다. 이미 같은 이름의 속성이 있으면 건드리지 않는다(손편집 존중).
   * @param {Array<[string, string|null]>} attrs `[name, value]` — value가 null이면 값 없는 속성
   */
  addAttrs(node, attrs, why) {
    const pos = this.insertPos(node);
    if (pos === null) return false;
    const pending = attrs.filter(([name]) => getAttr(node, name) === null
      && !(node.attrs || []).some((a) => a.name === name));
    if (pending.length === 0) return false;
    const text = pending
      .map(([name, value]) => (value === null ? ` ${name}` : ` ${name}="${value}"`))
      .join('');
    this.edits.push({ start: pos, end: pos, text, why });
    return true;
  }

  finding(node, f) {
    const st = startTagLoc(node);
    this.findings.push({
      rule: f.rule,
      code: f.code,
      severity: f.severity || 'error',
      needsHuman: f.needsHuman !== false,
      location: {
        line: st?.startLine ?? node.sourceCodeLocation?.startLine ?? 0,
        col: st?.startCol ?? node.sourceCodeLocation?.startCol ?? 0,
        start: st?.startOffset ?? -1,
        end: st?.endOffset ?? -1,
      },
      subject: this.rawOpenTag(node),
      remedy: f.remedy,
      candidates: f.candidates,
    });
  }

  record(node, a) {
    const st = startTagLoc(node);
    this.annotations.push({ ...a, line: st?.startLine ?? 0, subject: this.rawOpenTag(node) });
  }
}

/* ------------------------------------------------------------------ 분류 */

/**
 * 요소 하나를 어휘에 대응시킨다. **확정되지 않으면 값을 만들어내지 않는다.**
 * @returns {{type:'leaf'|'box'|'ambiguous'|'unmapped'|'inline', ...}}
 */
export function classify(node) {
  const tag = tagOf(node);
  const classes = classListOf(node);

  // 런타임 렌더 리프는 클래스가 아니라 data-tex의 존재로 확정된다 (grammar §3.2)
  if (getAttr(node, 'data-tex') !== null) {
    return { type: 'leaf', value: 'equation', residual: classes };
  }

  const leaf = matchEntries(LEAF_ENTRIES, classes);
  const box = matchEntries(BOX_ENTRIES, classes);

  const leafHit = leaf.chosen && !leaf.ambiguous;
  const boxHit = box.chosen && !box.ambiguous;

  if (leaf.ambiguous || box.ambiguous || (leafHit && boxHit)) {
    const cands = [
      ...leaf.matches.map((m) => `data-el="${m.value}"${m.variant ? ` (variant ${m.variant})` : ''}`),
      ...box.matches.map((m) => `data-box="${m.value}"${m.variant ? ` (variant ${m.variant})` : ''}`),
    ];
    return { type: 'ambiguous', candidates: [...new Set(cands)] };
  }

  if (leafHit) {
    return {
      type: 'leaf', value: leaf.chosen.value, variant: leaf.chosen.variant, residual: leaf.residual,
    };
  }
  if (boxHit) {
    return {
      type: 'box',
      value: box.chosen.value,
      variant: box.chosen.variant,
      region: box.chosen.region,
      cols: box.chosen.cols,
      residual: box.residual,
    };
  }

  // 어휘 클래스가 하나도 없을 때만 태그 규칙을 쓴다
  if (TAG_LEAF[tag]) {
    return { type: 'leaf', value: TAG_LEAF[tag].value, residual: classes, viaTag: true };
  }
  if (INLINE_TAGS.has(tag)) return { type: 'inline' };

  // 면제 ⓓ — SVG 는 다른 이름공간이다 (grammar §3.7). 이름표를 붙이지 않고, 안으로도
  // 내려가지 않는다.
  //
  // 처음에는 `<svg>` 자신에게 `el:figure` 를 줬다. 게이트가 막았다 — `figure` 는 저작
  // 리프라 `setContent` 로 고치는데 SVG 안에는 고칠 텍스트 노드가 없다. 인라인 태그와
  // 같은 처지다: 어휘의 어느 값도 이것을 뜻하지 않는다. 그러면 값을 만들어 붙이는 대신
  // 면제하는 것이 이 문법의 답이다. 그림을 옮기거나 지우는 일은 그것을 감싼 컨테이너로
  // 한다.
  if (tag === 'svg') return { type: 'exempt' };

  return byStructure(node, classes);
}

/**
 * 클래스로 확정되지 않는 요소 — grammar.md §2.6 (구조 규칙).
 *
 * 원래 이 규칙은 **클래스 없는 `<div>`** 에만 걸려 있었다. 클래스가 없으면 역방향 조회로는
 * 영원히 도달할 수 없으니 구조로 가른다는 뜻이었다. 그 이유는 클래스가 **있지만 어휘에
 * 없는** 요소에도 똑같이 성립한다 — `.equation-grid` 는 조회로 도달할 수 없다는 점에서
 * 클래스가 없는 것과 같다. 그래서 규칙을 좁게 걸어 둘 근거가 없다.
 *
 * 좁게 걸어 둔 대가는 실측으로 나온다. 어휘 밖으로 남은 요소는 편집기가 "고칠 수 없는
 * 자리" 로 표시하는데, 리포트 한 장에 **479 개**가 나왔다. 그중 사람이 실제로 고치고 싶은
 * 것은 하나도 없다 — 전부 격자·띠 같은 껍데기다. 껍데기를 컨테이너라고 부르는 데에는
 * 사람 판단이 필요하지 않다.
 *
 *   주석 대상 요소 자식이 있다  → 컨테이너.  인라인 flex 를 선언했으면 row, 아니면 group
 *   없다(텍스트·면제 인라인뿐)  → 저작 리프 text
 *
 * **클래스는 그대로 둔다.** 부여하는 것은 `data-box`/`data-el` 뿐이고 조판은 여전히
 * 클래스가 한다. 그래서 이 부여는 화면을 한 픽셀도 바꾸지 않는다.
 */
function byStructure(node, residual = []) {
  const hasAnnotatableChild = (node.childNodes || []).some((c) => {
    if (!c.tagName) return false;
    if (!INLINE_TAGS.has(tagOf(c))) return true;
    const inner = classify(c);
    return inner.type === 'leaf' && INLINE_ANNOTATABLE.has(inner.value);
  });
  if (!hasAnnotatableChild) return { type: 'leaf', value: 'text', residual, viaStructure: true };
  const style = getAttr(node, 'style') || '';
  const isFlexRow = /display\s*:\s*(inline-)?flex/i.test(style);
  if (isFlexRow) return { type: 'box', value: 'row', residual, viaStructure: true };
  // variant 는 **클래스가 없을 때만** 붙인다. variant → 클래스 대응표는 새 요소를 지을 때
  // 쓰는 것이라, 이미 자기 클래스를 가진 요소에 붙이면 없는 사실을 적는 셈이 된다.
  const variant = residual.length ? undefined : 'plain';
  return { type: 'box', value: 'group', variant, residual, viaStructure: true };
}

/** 선언된 구조 자식인가 (grammar §3.6 L6) */
function isDeclaredStructural(node, leafValue) {
  const decl = LEAF_STRUCTURE[leafValue];
  if (!decl) return false;
  const tag = tagOf(node);
  const classes = new Set(classListOf(node));
  return decl.some((d) => d.tag === tag && (!d.class || classes.has(d.class)));
}

/* ------------------------------------------------------------------ 불투명 리프 */

/** `equation` — 소스 자식이 비어 있어야 한다 (grammar §5 규칙 6) */
function checkEquation(node, ctx) {
  const children = node.childNodes || [];
  const nonEmpty = children.some(
    (c) => (c.nodeName === '#text' ? c.value.trim() !== '' : true),
  );
  if (!nonEmpty) return;
  ctx.finding(node, {
    rule: '5-R6',
    code: 'grammar.illegal-child',
    severity: 'error',
    remedy: '런타임 렌더 리프(equation)의 소스 자식은 비어 있어야 합니다. '
      + '자식이 저작물인지 렌더 산출물인지는 사람이 판단합니다 — 도구는 지우지 않습니다.',
  });
}

/**
 * `progress` — 데이터 채널 이관 (grammar §3.4 L4, 계획 §10.1 "`--pct` 치환")
 * 스캐폴딩 안의 인라인 `style="width:N%"`를 리프의 `style="--pct:N"` + `data-value`로 옮긴다.
 */
function migrateProgress(node, ctx) {
  let fill = null;
  let task = null;
  let pct = null;
  for (const el of walk(node)) {
    const classes = classListOf(el);
    if (classes.includes('prog-fill') && !fill) fill = el;
    if (classes.includes('task') && !task) task = el;
    if (classes.includes('pct') && !pct) pct = el;
  }

  const styleAttr = fill ? getAttr(fill, 'style') : null;
  const width = styleAttr ? /(?:^|;)\s*width\s*:\s*(\d+(?:\.\d+)?)\s*%\s*(?:;|$)/.exec(styleAttr) : null;

  const label = task ? textOf(task) : null;
  const attrs = [];
  if (label) attrs.push(['data-label', label.replace(/"/g, '&quot;')]);

  if (!width) {
    ctx.finding(node, {
      rule: '3.4-L4',
      code: 'adopt.progress-value-unknown',
      severity: 'warn',
      remedy: fill
        ? `.prog-fill의 인라인 width를 읽을 수 없습니다(style=${JSON.stringify(styleAttr)}). `
          + 'data-value와 --pct는 사람이 정합니다.'
        : '스캐폴딩에 .prog-fill이 없습니다. data-value와 --pct는 사람이 정합니다.',
    });
    if (attrs.length) ctx.addAttrs(node, attrs, 'progress 라벨 이관');
    return;
  }

  const value = String(Math.round(Number(width[1])));
  const pctText = pct ? textOf(pct) : null;
  const pctNum = pctText ? /(\d+(?:\.\d+)?)\s*%/.exec(pctText) : null;
  if (pctNum && String(Math.round(Number(pctNum[1]))) !== value) {
    ctx.finding(node, {
      rule: '5-R6b',
      code: 'grammar.data-prop-desync',
      severity: 'warn',
      remedy: `스캐폴딩 폭(${value}%)과 표시 텍스트(${pctText})가 다릅니다. `
        + `도구는 폭을 값으로 채택했습니다 — 어느 쪽이 맞는지는 사람이 확인합니다.`,
    });
  }

  attrs.push(['data-value', value]);
  const existingStyle = getAttr(node, 'style');
  if (existingStyle === null) {
    attrs.push(['style', `--pct:${value}`]);
  } else {
    const loc = node.sourceCodeLocation?.attrs?.style;
    if (loc) {
      const merged = `${existingStyle.replace(/;\s*$/, '')};--pct:${value}`;
      ctx.edits.push({
        start: loc.startOffset, end: loc.endOffset,
        text: `style="${merged}"`, why: '데이터 채널 --pct 병합',
      });
    }
  }
  ctx.addAttrs(node, attrs, 'progress 데이터 채널 이관');

  // 스캐폴딩 쪽 인라인 width 제거 — 이관이지 복제가 아니다
  const fillLoc = fill.sourceCodeLocation?.attrs?.style;
  if (fillLoc) {
    const rest = styleAttr.replace(width[0], width[0].startsWith(';') ? ';' : '').replace(/^\s*;|;\s*$/g, '').trim();
    if (rest === '') {
      let start = fillLoc.startOffset;
      if (start > 0 && /\s/.test(ctx.source[start - 1])) start -= 1;
      ctx.edits.push({ start, end: fillLoc.endOffset, text: '', why: '인라인 width 제거 (--pct로 이관)' });
    } else {
      ctx.edits.push({
        start: fillLoc.startOffset, end: fillLoc.endOffset,
        text: `style="${rest}"`, why: '인라인 width 제거 (--pct로 이관)',
      });
    }
  }
}

/* ------------------------------------------------------------------ 순회 */

const MODE = {
  NORMAL: 'normal',
  /** 저작 리프의 내용부 — 인라인만 와야 한다 */
  LEAF_CONTENT: 'leaf-content',
  /** 선언된 구조 자식 안 (grammar §3.6 L6) */
  STRUCTURAL: 'structural',
};

function visit(node, ctx, mode, leafValue) {
  const tag = tagOf(node);

  if (mode === MODE.STRUCTURAL || mode === MODE.LEAF_CONTENT) {
    if (mode === MODE.STRUCTURAL && isDeclaredStructural(node, leafValue)) {
      // 규칙 2·3 면제. 주석하지 않고 안으로만 들어간다 (table의 tbody > tr > td)
      for (const c of node.childNodes || []) if (c.tagName) visit(c, ctx, MODE.STRUCTURAL, leafValue);
      return;
    }
    if (INLINE_TAGS.has(tag)) {
      const cls = classListOf(node);
      const inlineClassed = classify(node);
      if (inlineClassed.type === 'leaf' && INLINE_ANNOTATABLE.has(inlineClassed.value)) {
        annotateLeaf(node, inlineClassed, ctx);
        return;
      }
      void cls; // inlineClasses 허용목록은 테마 소유(§8.6). 도구는 보존만 한다
      return;
    }
    ctx.finding(node, {
      rule: '5-R2',
      code: 'grammar.unknown-element',
      severity: 'error',
      remedy: `data-el="${leafValue}" 리프 안의 선언되지 않은 비인라인 자식입니다. `
        + '이 구조를 테마 leafStructure에 선언할지, 리프를 컨테이너로 바꿀지는 사람이 정합니다.',
    });
    for (const c of node.childNodes || []) if (c.tagName) visit(c, ctx, mode, leafValue);
    return;
  }

  const result = classify(node);

  if (result.type === 'exempt') return;   // 면제 ⓓ — SVG 서브트리 (§3.7)

  if (result.type === 'inline') {
    // 면제 ⓐ 는 **리프 안의** 인라인을 위한 것이다 — `<b>` 나 `<span class="en">` 은 그
    // 리프가 쓴 글의 일부이므로 따로 세지 않는다. 그런데 컨테이너 **바로 아래**의 인라인은
    // 자기를 품을 리프가 없다. 그대로 두면 그 글자는 어느 리프에도 속하지 않아 영원히
    // 고칠 수 없다 (실측 — 머리말의 랩 이름과 쪽번호가 그렇다). 품을 것이 없으면
    // **그것이 리프다.**
    if (mode === MODE.NORMAL && hasOwnText(node)) {
      annotateLeaf(node, { type: 'leaf', value: 'text', residual: classListOf(node) }, ctx);
      return;
    }
    for (const c of node.childNodes || []) if (c.tagName) visit(c, ctx, MODE.NORMAL);
    return;
  }

  if (result.type === 'ambiguous') {
    ctx.finding(node, {
      rule: '5-R2',
      code: 'adopt.ambiguous-mapping',
      severity: 'error',
      remedy: '클래스가 어휘 값 여럿에 동시에 걸립니다. 한 요소는 data-el과 data-box 중 '
        + '정확히 하나를 가지므로(§2), 어느 쪽인지는 사람이 정합니다.',
      candidates: result.candidates,
    });
    for (const c of node.childNodes || []) if (c.tagName) visit(c, ctx, MODE.NORMAL);
    return;
  }

  if (result.type === 'unmapped') {
    ctx.finding(node, {
      rule: '5-R2',
      code: 'grammar.unknown-element',
      severity: 'error',
      remedy: '어떤 data-el/data-box로 매핑할지는 사람 판단입니다 — 클래스가 어휘에 '
        + '걸리지 않아 도구가 추측하지 않았습니다(§5.2 "수정 후보 없음").',
    });
    for (const c of node.childNodes || []) if (c.tagName) visit(c, ctx, MODE.NORMAL);
    return;
  }

  if (result.type === 'leaf') {
    if (INLINE_TAGS.has(tag) && !INLINE_ANNOTATABLE.has(result.value)) {
      // 리프 안에서는 면제 ⓐ다 — 클래스가 걸려도 어휘 값으로 승격하지 않는다.
      // 컨테이너 바로 아래라면 얘기가 다르다 (위 인라인 분기와 같은 이유).
      if (mode !== MODE.NORMAL || !hasOwnText(node)) {
        for (const c of node.childNodes || []) if (c.tagName) visit(c, ctx, MODE.NORMAL);
        return;
      }
    }
    annotateLeaf(node, result, ctx);
    return;
  }

  // 컨테이너
  const attrs = [['data-box', result.value]];
  if (result.variant) attrs.push(['data-variant', result.variant]);
  if (result.region) attrs.push(['data-region', result.region]);
  if (result.cols) attrs.push(['data-cols', result.cols]);
  const id = ensureId(node, ctx, attrs);
  ctx.addAttrs(node, attrs, `컨테이너 ${result.value}`);
  ctx.record(node, { nodeId: id, kind: 'box', value: result.value, variant: result.variant });
  reportResidual(node, result, ctx);
  for (const c of node.childNodes || []) if (c.tagName) visit(c, ctx, MODE.NORMAL);
}

function annotateLeaf(node, result, ctx) {
  const attrs = [['data-el', result.value]];
  if (result.variant) attrs.push(['data-variant', result.variant]);
  const id = ensureId(node, ctx, attrs);
  ctx.addAttrs(node, attrs, `리프 ${result.value}`);
  ctx.record(node, { nodeId: id, kind: 'el', value: result.value, variant: result.variant });
  reportResidual(node, result, ctx);

  const opaque = OPAQUE_LEAVES[result.value];
  if (opaque) {
    if (result.value === 'equation') checkEquation(node, ctx);
    if (result.value === 'progress') migrateProgress(node, ctx);
    return; // 자식 서브트리는 규약 G1의 불투명 노드다 — 내려가지 않는다
  }

  if (LEAF_STRUCTURE[result.value]) {
    for (const c of node.childNodes || []) if (c.tagName) visit(c, ctx, MODE.STRUCTURAL, result.value);
    return;
  }
  for (const c of node.childNodes || []) if (c.tagName) visit(c, ctx, MODE.LEAF_CONTENT, result.value);
}

function ensureId(node, ctx, attrs) {
  const existing = getAttr(node, 'data-node-id');
  if (existing !== null) return existing;
  const id = ctx.alloc.next();
  attrs.push(['data-node-id', id]);
  return id;
}

function reportResidual(node, result, ctx) {
  if (!result.residual || result.residual.length === 0) return;
  ctx.finding(node, {
    rule: '2.4',
    code: 'adopt.residual-class',
    severity: 'info',
    needsHuman: false,
    remedy: `어휘에 걸리지 않는 클래스가 남아 있습니다: ${result.residual.join(' ')}. `
      + 'class 속성은 그대로 보존했습니다 — 테마 mapping.json이 이 클래스를 흡수할지는 M5의 판단입니다.',
  });
}

/* ------------------------------------------------------------------ 섹션·문서 */

function adoptSection(section, ctx, index) {
  const classes = classListOf(section);
  const match = SECTION_VARIANTS
    .filter((v) => v.classes.every((c) => classes.includes(c)))
    .sort((a, b) => b.classes.length - a.classes.length)[0];

  const attrs = [['data-slide', null]];
  if (match) {
    attrs.push(['data-variant', match.variant]);
    if (match.kind) attrs.push(['data-slide-kind', match.kind]);
  } else {
    ctx.finding(section, {
      rule: '2.3',
      code: 'adopt.section-variant-unknown',
      severity: 'error',
      remedy: '섹션의 조판 variant를 클래스로 판정할 수 없습니다. '
        + 'data-variant는 사람이 정합니다(테마 열거: default｜split｜title).',
    });
  }
  if (!match?.kind) {
    ctx.finding(section, {
      rule: '2.3',
      code: 'adopt.section-kind-undecided',
      severity: 'warn',
      remedy: 'data-slide-kind는 닫힌 열거 title｜content｜break｜closing이고, '
        + '클래스로는 title만 확정됩니다. 나머지는 사람이 고릅니다 — 도구는 추측하지 않습니다.',
      candidates: ['title', 'content', 'break', 'closing'],
    });
  }

  const id = ensureId(section, ctx, attrs);
  ctx.addAttrs(section, attrs, `섹션 ${index + 1}`);
  ctx.record(section, { nodeId: id, kind: 'section', value: 'section', variant: match?.variant });

  for (const c of section.childNodes || []) if (c.tagName) visit(c, ctx, MODE.NORMAL);
}

/** `<html data-deck-grammar="v1">` — 문서 수준 전제 (grammar §5) */
function ensureDeckGrammar(doc, ctx) {
  const html = [...walk(doc)].find((n) => tagOf(n) === 'html');
  if (!html) return;
  if (getAttr(html, 'data-deck-grammar') !== null) return;
  if (!startTagLoc(html)) {
    ctx.finding(html, {
      rule: '5',
      code: 'adopt.missing-html-tag',
      severity: 'warn',
      remedy: '소스에 <html> 여는 태그가 없어 data-deck-grammar를 붙일 자리가 없습니다. '
        + '문서 수준 전제는 사람이 채웁니다.',
    });
    return;
  }
  ctx.addAttrs(html, [['data-deck-grammar', GRAMMAR_VERSION]], '문서 수준 전제');
}

/**
 * 문서 전체 id 충돌 회피 — grammar §4.1 "충돌 회피" + splice.ts:125 패턴.
 * 중복된 id를 가진 서브트리 중 **뒤에 나온 것**을 재발급한다. 어느 쪽이 원본인지는
 * 문법이 알 수 없으므로(§4.1) 기본값은 선착순이고, 그 사실을 반드시 보고한다.
 */
function healDuplicateIds(doc, ctx) {
  const byId = new Map();
  for (const node of walk(doc)) {
    const id = getAttr(node, 'data-node-id');
    if (id === null) continue;
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(node);
  }
  const targets = [];
  for (const [id, nodes] of byId) {
    if (nodes.length < 2) continue;
    for (const node of nodes.slice(1)) targets.push({ id, node });
  }
  targets.sort((a, b) => (a.node.sourceCodeLocation?.startOffset ?? 0)
    - (b.node.sourceCodeLocation?.startOffset ?? 0));

  const handled = new Set();
  for (const { id, node } of targets) {
    if (handled.has(node)) continue;
    const { mapping, edits } = reissueSubtree(node, ctx.alloc);
    for (const n of walk(node)) handled.add(n);
    ctx.edits.push(...edits);
    ctx.finding(node, {
      rule: '4.1',
      code: 'grammar.duplicate-id',
      severity: 'warn',
      remedy: `data-node-id="${id}"가 문서에서 중복입니다. 이 서브트리의 id ${mapping.size}개를 `
        + '재발급했습니다(선착순 — 앞의 것을 원본으로 봄). 어느 쪽이 원본인지는 사람이 확인합니다.',
    });
  }
}

/* ------------------------------------------------------------------ 공개 API */

/**
 * @param {string} source HTML 덱 원문
 * @param {{section?: number}} [opts] `section`은 1-based. 주면 그 섹션만 주석한다
 * @returns {{edits: Array, findings: Array, annotations: Array, sectionCount: number,
 *            issuedIds: string[], adoptedSections: number[]}}
 */
export function adoptDocument(source, opts = {}) {
  const doc = parse(source, { sourceCodeLocationInfo: true });
  const ctx = new AdoptContext(source, opts);

  healDuplicateIds(doc, ctx);
  ensureDeckGrammar(doc, ctx);

  const sections = [...walk(doc)].filter((n) => tagOf(n) === 'section');
  const adopted = [];
  sections.forEach((section, i) => {
    if (opts.section && opts.section !== i + 1) return;
    adopted.push(i + 1);
    adoptSection(section, ctx, i);
  });

  if (opts.section && !adopted.length) {
    throw new Error(`섹션 ${opts.section}번이 없습니다 (문서의 섹션 수: ${sections.length}).`);
  }

  return {
    edits: ctx.edits,
    findings: ctx.findings,
    annotations: ctx.annotations,
    sectionCount: sections.length,
    adoptedSections: adopted,
    issuedIds: ctx.alloc.issued,
  };
}
