/**
 * `normalizeInline` — 계획 §6.2. `setContent` 가 받는 유일한 정화기.
 *
 * **마일스톤이 아니라 순수 함수다.** 입력은 문자열, 출력은 문자열 또는 거부.
 * 브라우저가 필요 없고 단위 테스트로 닫힌다.
 *
 *   normalizeInline(html, mapping) → { ok: true, html } | { ok: false, reason }
 *
 * **거부하는 것은 스크립트뿐이다.** 나머지는 전부 언랩·제거로 통과시킨다. 이유는
 * §6.2 마지막 문단에 있다 — "붙여넣기가 안 되는 편집기" 를 만들지 않기 위해서다.
 * 워드나 웹에서 복사한 마크업은 `<div>`·`<font>`·`style` 로 뒤덮여 오는 것이 정상이고,
 * 그것을 거부하면 사용자는 편집기를 쓰지 않는다.
 *
 * 이 함수가 하는 변환은 계획 §6.3 "허용되는 무음 변환의 닫힌 목록" 의 5번이다.
 * 목록에 없는 변환을 추가하려면 계획 개정이 필요하다.
 */

import { parseFragment } from 'parse5';

/** 허용 인라인 태그 (닫힌 목록) — grammar.md §3.1 L1 */
const ALLOWED = new Set(['b', 'i', 'em', 'strong', 'span', 'br', 'a', 'sup', 'sub', 'code']);

/** 자식을 갖지 않는 인라인. */
const VOID = new Set(['br']);

/**
 * 존재만으로 거부하는 요소.
 *
 * 언랩하지 않는 이유 — `<script>` 를 언랩하면 그 **텍스트 내용이 본문으로 남는다.**
 * 코드가 문단에 섞여 들어가는 것은 조용한 손상이므로, 명령 자체를 실패시킨다.
 */
const REJECT_TAGS = new Set(['script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template']);

/** `href` 에 허용하는 스킴. 상대경로는 스킴이 없으므로 통과한다. */
const SAFE_HREF = /^(?:https?:|mailto:|[^a-z0-9+.-]|[^:]*$)/i;

/**
 * @param {string} html
 * @param {object} mapping  테마 매핑 (`inlineClasses`, `leafStructure`)
 * @param {string|null} leafValue  대상 리프의 어휘 값. 그 값의 구조 자식(L6)이 함께 허용된다.
 */
export function normalizeInline(html, mapping, leafValue = null) {
  if (typeof html !== 'string') return { ok: false, reason: 'html 이 문자열이 아니다' };

  const inlineClasses = new Set(mapping?.json?.inlineClasses ?? []);

  // grammar.md §3.6 L6 조항 5 — "normalizeInline 은 해당 리프 값의 leafStructure 선언을
  // 받아, 선언된 (태그, 클래스) 쌍을 **보존**한다". 받지 않으면 `<li>`·`<td>` 가 허용
  // 인라인 목록에 없다는 이유로 언랩되고, 목록·표 편집이 텍스트 뭉치로 뭉개진다.
  const struct = leafValue ? (mapping?.json?.leafStructure?.[leafValue] ?? []) : [];
  const structTags = new Set(struct.map((d) => d.tag));

  const frag = parseFragment(html);

  let rejection = null;
  const parts = [];

  const emitChildren = (node) => {
    for (const child of node.childNodes ?? []) {
      if (rejection) return;
      emit(child);
    }
  };

  const emit = (node) => {
    if (node.nodeName === '#text') {
      parts.push({ text: node.value ?? '' });
      return;
    }
    // 주석은 편집 내용이 아니다. 남기면 사용자가 지울 방법이 없는 바이트가 생긴다.
    if (node.nodeName === '#comment') return;
    if (!node.tagName) return;

    const tag = node.tagName.toLowerCase();
    if (REJECT_TAGS.has(tag)) {
      rejection = `스크립트성 요소는 허용하지 않는다: <${tag}>`;
      return;
    }
    // 이벤트 핸들러는 태그가 무엇이든 거부한다. 언랩해도 속성이 사라질 뿐이지만,
    // 그 입력은 붙여넣기가 아니라 주입 시도이므로 조용히 통과시키지 않는다.
    const onAttr = (node.attrs ?? []).find((a) => a.name.toLowerCase().startsWith('on'));
    if (onAttr) {
      rejection = `이벤트 핸들러 속성은 허용하지 않는다: ${onAttr.name}`;
      return;
    }
    const href = (node.attrs ?? []).find((a) => a.name.toLowerCase() === 'href');
    if (href && /^\s*javascript:/i.test(href.value)) {
      rejection = 'javascript: href 는 허용하지 않는다';
      return;
    }

    const isStruct = structTags.has(tag);
    if (!ALLOWED.has(tag) && !isStruct) {
      emitChildren(node); // 언랩 — 자식 인라인 내용만 남긴다
      return;
    }

    const attrs = keepAttrs(tag, node.attrs ?? [], inlineClasses, isStruct ? struct : []);
    if (VOID.has(tag)) {
      parts.push({ tag, open: `<${tag}${attrs}>`, void: true });
      return;
    }
    parts.push({ tag, open: `<${tag}${attrs}>` });
    emitChildren(node);
    parts.push({ close: `</${tag}>` });
  };

  emitChildren(frag);
  if (rejection) return { ok: false, reason: rejection };

  dropTrailingBreaks(parts);
  return { ok: true, html: render(mergeText(parts)) };
}

/**
 * 살아남는 속성은 둘뿐이다 — 허용목록에 있는 `class`, 안전한 `href`.
 *
 * `style` 을 제거하는 것은 디자인 토큰 우회를 원천 차단하기 위해서다(§6.2). 인라인
 * 스타일을 허용하면 `design.token-escape` 진단이 잡아야 할 것을 편집기가 만들어낸다.
 */
function keepAttrs(tag, attrs, inlineClasses, struct = []) {
  const out = [];

  // 이 태그의 구조 자식 선언이 요구하는 클래스 (예: figure 의 `div.ic`·`div.cap`).
  // 인라인 허용목록에는 없지만 L6 이 선언한 것이므로 보존한다.
  const structClasses = new Set(struct.filter((d) => d.tag === tag && d.class).map((d) => d.class));

  const cls = attrs.find((a) => a.name.toLowerCase() === 'class');
  if (cls) {
    // §8.6 / F-5ⓒ — 허용목록에 있는 클래스만 보존한다. 2판은 class 를 통째로 지워
    // `.cite`/`.title`/`.src` 같은 저자 서식을 조용히 없앴고, 그것이 P4 위반이었다.
    const kept = cls.value.split(/\s+/).filter((c) => c && (inlineClasses.has(c) || structClasses.has(c)));
    if (kept.length) out.push(` class="${escapeAttr(kept.join(' '))}"`);
  }

  if (tag === 'a') {
    const href = attrs.find((a) => a.name.toLowerCase() === 'href');
    if (href && SAFE_HREF.test(href.value.trim())) out.push(` href="${escapeAttr(href.value.trim())}"`);
  }

  return out.join('');
}

/**
 * 말미 bogus `<br>` 제거 (§6.2).
 *
 * contenteditable 은 빈 줄을 유지하려고 내용 끝에 `<br>` 을 붙인다. 저장하면 문단마다
 * 빈 줄이 하나씩 자라난다 — 사용자가 만들지 않은 바이트다.
 */
function dropTrailingBreaks(parts) {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (p.void && p.tag === 'br') { parts.splice(i, 1); continue; }
    if (p.text !== undefined && !p.text.trim()) continue;
    break;
  }
}

/** 쪼개진 텍스트 노드 병합 (§6.2). contenteditable 이 한 문장을 여러 노드로 쪼갠다. */
function mergeText(parts) {
  const out = [];
  for (const p of parts) {
    const last = out[out.length - 1];
    if (p.text !== undefined && last?.text !== undefined) last.text += p.text;
    else out.push({ ...p });
  }
  return out;
}

function render(parts) {
  return parts.map((p) => (p.text !== undefined ? escapeText(p.text) : p.open ?? p.close)).join('');
}

/**
 * 텍스트 이스케이프 — §6.3 목록 4번.
 *
 * `&nbsp;` 런(2개 이상 연속)은 일반 공백 하나로 축약한다. **단일 `&nbsp;` 는 보존한다**
 * — 저자가 줄바꿈을 막으려고 일부러 넣은 것일 수 있고, 런과 달리 의도로 읽힌다.
 */
function escapeText(s) {
  return s
    .replace(/\u00A0{2,}/g, ' ')   // nbsp 런 → 일반 공백 1개
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\u00A0/g, '&nbsp;'); // 남은 단일 nbsp 는 그대로 되돌린다
}

function escapeAttr(s) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
