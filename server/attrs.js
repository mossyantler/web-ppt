/**
 * 여는 태그 단위 splice — 속성 명령의 공통 기반 (계획 §3.2 "속성 명령").
 *
 * 계획 §11 M2 수용 기준: "`setProps` 커밋 후 대상 요소의 **내부 HTML이 바이트 동일**
 * (여는 태그만 변경)".
 *
 * **여는 태그를 통째로 다시 쓰지 않는다.** 다시 쓰면 P2("구간 밖 동일")는 성립하지만
 * 구간 **안**에서 손대지 않은 속성의 인용 부호·공백·순서가 정규화된다. 사용자가 바꾼
 * 것은 속성 하나인데 diff 는 줄 전체로 뜨고, 손편집 저자의 서식이 조용히 사라진다.
 * 규약 G1 이 어휘 밖 노드에 대해 요구하는 것과 같은 성질을 여는 태그 안에서도 지킨다.
 *
 * 그래서 편집 단위는 **속성 하나**다. parse5 의 `sourceCodeLocation.startTag.attrs` 가
 * 속성별 구간을 주고, 이 모듈은 그 구간만 splice 한다.
 */

import { DocError } from './doc.js';

/**
 * 속성 패치를 splice 편집 배열로 바꾼다.
 *
 * @param {object} node 저작 트리 노드
 * @param {string} raw  원문
 * @param {Record<string, string|null>} patch  `null` = 속성 제거
 * @returns {{start:number,end:number,text:string}[]}
 */
export function attrEdits(node, raw, patch) {
  if (node.openStart === null || node.openEnd === null) {
    throw new DocError(422, `여는 태그의 소스 구간이 없다 — 속성 명령을 적용할 수 없다: <${node.tag}>`);
  }

  const locs = node.attrLocs ?? {};
  const edits = [];
  const inserts = [];

  for (const [rawName, value] of Object.entries(patch)) {
    const name = rawName.toLowerCase();
    const loc = locs[name];

    if (value === null) {
      if (!loc) continue; // 없는 속성의 제거는 성공이고 바이트는 바뀌지 않는다.
      edits.push({ start: withLeadingSpace(raw, loc.startOffset, node.openStart), end: loc.endOffset, text: '' });
      continue;
    }

    const text = `${name}="${escapeAttrValue(String(value))}"`;
    if (loc) {
      edits.push({ start: loc.startOffset, end: loc.endOffset, text });
    } else {
      inserts.push(text);
    }
  }

  if (inserts.length) {
    const at = insertionPoint(raw, node);
    edits.push({ start: at, end: at, text: ` ${inserts.join(' ')}` });
  }

  assertInsideOpenTag(edits, node);
  return edits;
}

/**
 * 속성 제거 시 앞선 공백 하나를 같이 지운다.
 *
 * 지우지 않으면 `<div  class="x">` 처럼 공백이 겹쳐 남는다. 여는 태그 시작 이전으로는
 * 넘어가지 않는다 — 태그 이름과 첫 속성 사이의 공백은 문법상 필수다.
 */
function withLeadingSpace(raw, start, openStart) {
  return start - 1 > openStart && /\s/.test(raw[start - 1]) ? start - 1 : start;
}

/**
 * 새 속성을 끼워 넣을 오프셋 — 여는 태그의 `>` 직전 (자기닫힘이면 `/>` 직전).
 */
function insertionPoint(raw, node) {
  let i = node.openEnd - 1;
  if (raw[i] !== '>') {
    throw new DocError(500, `여는 태그가 '>' 로 끝나지 않는다: ${JSON.stringify(raw.slice(node.openStart, node.openEnd))}`);
  }
  i -= 1;
  if (raw[i] === '/') i -= 1;
  while (i > node.openStart && /\s/.test(raw[i])) i -= 1;
  return i + 1;
}

/**
 * 모든 편집이 여는 태그 안인지 확인한다.
 *
 * 이 검사가 곧 "내부 HTML 바이트 동일" 의 보증이다. 오프셋 계산이 틀려 한 바이트라도
 * 밖으로 나가면 쓰기 전에 죽는다 — `commit.js` 의 P2 검사가 잡기 전에, 더 좁은 계약으로.
 */
function assertInsideOpenTag(edits, node) {
  for (const e of edits) {
    if (e.start < node.openStart || e.end > node.openEnd) {
      throw new DocError(500, `속성 편집이 여는 태그 밖으로 나갔다: [${e.start},${e.end}) ⊄ [${node.openStart},${node.openEnd})`, {
        code: 'commit.attr-out-of-open-tag',
      });
    }
  }
}

/**
 * 속성값 이스케이프.
 *
 * 큰따옴표로 인용하므로 `"` 와 `&` 만 막으면 값이 태그 밖으로 새지 않는다. `<` 와 `>`
 * 는 속성값 안에서 리터럴로 유효하지만, 손편집 저자가 소스를 읽을 때 태그 경계로
 * 오독하기 쉬우므로 같이 이스케이프한다.
 */
export function escapeAttrValue(s) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 인라인 `style` 선언을 파싱한다. 순서를 보존한다. */
export function parseStyle(style) {
  if (!style) return [];
  return style.split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
    const i = d.indexOf(':');
    return i < 0 ? { prop: d, value: '' } : { prop: d.slice(0, i).trim(), value: d.slice(i + 1).trim() };
  });
}

/**
 * `style` 선언 목록에 패치를 적용해 다시 문자열로 만든다.
 *
 * 기존 선언의 **순서를 보존하고**, 없는 것만 뒤에 붙인다. 순서를 재정렬하면 손편집
 * 저자가 읽던 소스가 이유 없이 흔들린다.
 */
export function patchStyle(style, patch) {
  const decls = parseStyle(style);
  const seen = new Set();
  const out = [];
  for (const d of decls) {
    if (!(d.prop in patch)) {
      out.push(d);
      continue;
    }
    seen.add(d.prop);
    const v = patch[d.prop];
    if (v !== null) out.push({ prop: d.prop, value: String(v) });
  }
  for (const [prop, v] of Object.entries(patch)) {
    if (seen.has(prop) || v === null) continue;
    out.push({ prop, value: String(v) });
  }
  return out.map((d) => `${d.prop}:${d.value}`).join(';');
}
