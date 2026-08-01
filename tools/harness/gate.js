// 섹션 게이트 (core/grammar.md §5 규칙 1~7) + 문서 레벨 게이트 (§6) 판정.
//
// 모든 실패는 §5.2 의 다섯 필드를 갖춘다 — rule · code · location · subject · remedy.
// remedy 를 비우지 않는다. 고칠 방법이 없으면 없다는 사실과 이유를 쓴다.

import { attrOf, hasAttr, classesOf, findSections, parseDocument, INLINE_TAGS } from './tree.js';
import { roundTrip } from './serialize.js';

const GEOMETRY_PROPS = ['left', 'top', 'width', 'height'];

function finding(rule, code, node, raw, file, remedy, extra = {}) {
  return {
    rule,
    code,
    location: {
      file,
      line: node?.loc?.line ?? null,
      col: node?.loc?.col ?? null,
      span: node && node.start !== null ? [node.start, node.end] : null,
    },
    subject: node && node.openStart != null ? raw.slice(node.openStart, node.openEnd) : (node?.nodeName ?? null),
    remedy,
    ...extra,
  };
}

/** 규칙 2·3 의 면제 대상인가 (ⓐ 인라인 ⓑ 불투명 서브트리 ⓒ 선언된 구조 자식). */
function isExempt(n) {
  return n.kind === 'inline' || n.kind === 'opaque-subtree' || n.kind === 'structural-child' || n.kind === 'synthesized';
}

/** 인라인 style 선언을 (prop, value) 로 쪼갠다. 커스텀 프로퍼티도 그대로 나온다. */
export function parseStyle(style) {
  return (style ?? '')
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => {
      const i = d.indexOf(':');
      return { prop: d.slice(0, i).trim().toLowerCase(), value: d.slice(i + 1).trim() };
    })
    .filter((d) => d.prop);
}

/**
 * 문서 레벨 게이트 (§6). 판정 결과는 { ok, findings, scripts, styles }.
 * 정적 판정을 흉내 내지 않는다 — 스크립트를 목록화하고 선언을 조회하기만 한다 (§6.3).
 */
export function documentGate(raw, file) {
  const doc = parseDocument(raw);
  const findings = [];
  const scripts = [];
  const styles = [];
  let htmlEl = null;

  (function walk(n) {
    if (typeof n.tagName === 'string') {
      if (n.tagName === 'html') htmlEl = n;
      if (n.tagName === 'script') {
        const loc = n.sourceCodeLocation;
        const src = attrOf(n, 'src');
        const text = n.childNodes?.[0]?.value ?? '';
        scripts.push({
          kind: src ? 'external' : 'inline',
          ref: src ?? `inline@${loc ? lineOf(raw, loc.startOffset) : '?'}`,
          preview: src ?? text.replace(/\s+/g, ' ').trim().slice(0, 40),
          size: src ? null : text.split('\n').length,
          line: loc ? lineOf(raw, loc.startOffset) : null,
          declaration: 'undeclared',
        });
      }
      if (n.tagName === 'style') {
        const loc = n.sourceCodeLocation;
        styles.push({ line: loc ? lineOf(raw, loc.startOffset) : null, scope: 'deck-local' });
      }
    }
    for (const c of n.childNodes ?? []) walk(c);
  })(doc);

  // 선언 조회 (§6.3 2단계) — <meta name="deck-script-policy">
  const policy = readScriptPolicy(doc);
  for (const s of scripts) {
    const decl = policy.find((p) => p.ref === s.ref);
    if (decl) s.declaration = decl.as ?? 'undeclared';
    if (decl?.as === 'runtime-leaf') s.leaf = decl.leaf ?? null;
  }

  const grammarAttr = htmlEl ? attrOf(htmlEl, 'data-deck-grammar') : undefined;
  if (grammarAttr !== 'v1') {
    findings.push({
      rule: '5-DOC',
      code: 'grammar.missing-deck-grammar',
      location: { file, line: htmlEl?.sourceCodeLocation ? lineOf(raw, htmlEl.sourceCodeLocation.startOffset) : null, col: null, span: null },
      subject: htmlEl?.sourceCodeLocation ? raw.slice(htmlEl.sourceCodeLocation.startTag.startOffset, htmlEl.sourceCodeLocation.startTag.endOffset) : null,
      remedy: '<html data-deck-grammar="v1"> 을 선언해야 섹션 판정으로 내려간다 (grammar.md §5 문서 수준 전제). adoptSection 이 문서 단위로 부여한다',
    });
  }

  // §6.3 4단계 — 잠금은 "모순"에만 발동한다. 미선언은 경고이지 잠금 사유가 아니다.
  const undeclared = scripts.filter((s) => s.declaration === 'undeclared');
  const contradictions = scripts.filter((s) => s.declaration === 'runtime-leaf' && s.leaf !== 'equation');
  for (const s of contradictions) {
    findings.push({
      rule: '6.2-D1',
      code: 'grammar.document-script',
      location: { file, line: s.line, col: null, span: null },
      subject: s.ref,
      remedy: `선언(as=runtime-leaf, leaf=${s.leaf})과 문법이 모순된다 — 그 이름의 런타임 렌더 리프가 어휘 v1 에 없다. 선언을 고치거나 계획을 개정한다`,
      fixable: false,
    });
  }

  return {
    ok: findings.length === 0,
    locked: findings.some((f) => f.code === 'grammar.document-script'),
    findings,
    scripts,
    styles,
    undeclaredScripts: undeclared.length,
    warnings: undeclared.length
      ? [`선언되지 않은 스크립트 ${undeclared.length}개 (${undeclared.map((s) => `${s.ref}, line ${s.line}`).join(' · ')}). 이 스크립트가 슬라이드 내용을 바꾸는지 확인이 필요합니다.`]
      : [],
    doc,
  };
}

function readScriptPolicy(doc) {
  let out = [];
  (function walk(n) {
    if (n.tagName === 'meta' && attrOf(n, 'name') === 'deck-script-policy') {
      try {
        const parsed = JSON.parse(attrOf(n, 'content') ?? '[]');
        if (Array.isArray(parsed)) out = parsed;
      } catch {
        /* 형식 오류는 미선언과 같게 취급한다 — 선언을 다시 받는다 */
      }
    }
    for (const c of n.childNodes ?? []) walk(c);
  })(doc);
  return out;
}

function lineOf(raw, offset) {
  let line = 1;
  for (let i = 0; i < offset; i++) if (raw[i] === '\n') line++;
  return line;
}

/**
 * 섹션 게이트 판정. 반환 { pass, findings[] }.
 * 첫 실패에서 멈추지 않는다 (§5.2 표현 규칙 3항).
 */
export function sectionGate(root, raw, mapping, file) {
  const findings = [];

  // 규칙 1 — <section data-slide data-node-id="…">
  if (root.declared?.el || root.declared?.box) {
    findings.push(finding('5-R1', 'grammar.unknown-element', root, raw, file,
      '섹션은 data-el/data-box 를 갖지 않는다. data-slide 만 쓴다 (grammar.md §2.3)'));
  }
  if (!root.hasSlideAttr) {
    findings.push(finding('5-R1', 'grammar.unknown-element', root, raw, file,
      'data-slide 표지 속성이 없다 — 이 <section> 이 슬라이드임을 문법이 알 수 없다. adoptSection 이 부여한다'));
  }
  if (!root.nodeId) {
    findings.push(finding('5-R1', 'grammar.missing-id', root, raw, file,
      'data-node-id 를 락 안에서 발급하면 통과한다 — 원클릭 치유 대상 (§4.1 외부 편집 유입)'));
  }
  const kind = root.attrs.find((a) => a.name === 'data-slide-kind')?.value;
  if (kind !== undefined && !mapping.json.slideKindEnum.includes(kind)) {
    findings.push(finding('5-R1', 'grammar.unknown-variant', root, raw, file,
      `data-slide-kind 는 닫힌 열거다: ${mapping.json.slideKindEnum.join('｜')}`));
  }

  const seenIds = new Map();

  root.walk((n) => {
    if (n === root) {
      registerId(n, seenIds);
      return;
    }
    if (n.kind === 'opaque-node' || n.kind === 'opaque-subtree') return;
    if (n.kind === 'synthesized') return;

    registerId(n, seenIds);

    // 규칙 4 — <script>/<style>/on* (면제 없음, 불투명 서브트리 안이라도 검사한다)
    if (n.tag === 'script' || n.tag === 'style') {
      findings.push(finding('5-R4', 'grammar.document-script', n, raw, file,
        '섹션 안의 <script>/<style> 은 제거해야 한다. 제거는 렌더를 바꾸므로 사람 판단이 필요하다', { fixable: false }));
    }
    for (const a of n.attrs) {
      if (/^on/i.test(a.name)) {
        findings.push(finding('5-R4', 'grammar.document-script', n, raw, file,
          `이벤트 핸들러 속성 ${a.name} 은 허용되지 않는다. 제거는 동작을 바꾸므로 사람 판단이 필요하다`, { fixable: false }));
      }
    }

    // 규칙 2 — data-el 또는 data-box 를 정확히 하나
    if (!isExempt(n)) {
      if (n.kind === 'unknown-element') {
        findings.push(finding('5-R2', n.violation === 'both-el-and-box' ? 'grammar.unknown-element' : 'grammar.unknown-element', n, raw, file,
          n.violation === 'both-el-and-box'
            ? 'data-el 과 data-box 를 동시에 가질 수 없다 (§2 어휘 서문)'
            : 'adoptSection 으로 data-el 또는 data-box 를 부여하세요 — 수정 후보 없음(자동): 어떤 값으로 매핑할지는 사람 판단입니다',
          { fixable: false, violation: n.violation ?? null }));
      }
      // 규칙 3 — data-node-id
      if (n.kind !== 'unknown-element' && !n.nodeId) {
        findings.push(finding('5-R3', 'grammar.missing-id', n, raw, file,
          'data-node-id 를 락 안에서 일괄 발급하면 통과한다 — 원클릭 치유 대상'));
      }
    }

    const style = n.attrs.find((a) => a.name === 'style')?.value;
    const decls = parseStyle(style);

    // 규칙 5 — 인라인 기하는 canvas 의 자식만. 커스텀 프로퍼티는 대상 아님 (§3.4)
    //
    // 예외: `table` 의 <col>/<colgroup>. 이 둘은 박스를 만들지 않으므로 자기 기하를
    // 결정하지 않는다 — 표 안에서 열이 갖는 지분을 선언할 뿐이다. 규칙 5 의 목적은
    // "요소의 위치·크기 권한을 흐름과 canvas 둘로만 나눈다" 인데, 열 지분은 그 어느
    // 쪽도 결정할 수 없다(표마다 다르고 테마 CSS 가 알 수 없다). §5 규칙 5 예외 참조.
    const isColumnSpec = n.kind === 'structural-child' && n.structRoot === 'table'
      && (n.tag === 'col' || n.tag === 'colgroup');
    const geom = decls.filter((d) => GEOMETRY_PROPS.includes(d.prop) && !(isColumnSpec && d.prop === 'width'));
    if (geom.length && !(n.parent && n.parent.value === 'canvas')) {
      findings.push(finding('5-R5', 'grammar.illegal-child', n, raw, file,
        `인라인 ${geom.map((g) => g.prop).join('/')} 는 data-box="canvas" 의 자식에서만 허용된다. 흐름 배치는 컨테이너가, 자유 배치는 canvas 가 결정한다`,
        { inlineGeometry: geom }));
    }

    // 규칙 6 — 불투명 리프의 소스 자식
    if (n.kind === 'leaf-opaque') {
      const info = mapping.opaqueLeafInfo(n.value);
      const hasChildContent = n.children.some((c) => c.kind !== 'opaque-node' || !c.whitespaceOnly);
      if (info?.sourceChildren === 'empty' && hasChildContent) {
        findings.push(finding('5-R6', 'grammar.illegal-child', n, raw, file,
          `런타임 렌더 리프(${n.value})의 소스 자식은 비어 있어야 한다. 내용은 전용 속성에만 둔다 (§3.2)`));
      }
      // 규칙 6-b — 데이터 채널 동기 불변식
      const props = mapping.dataPropsOf(n.value);
      if (props) {
        for (const [prop, spec] of Object.entries(props)) {
          const declared = decls.find((d) => d.prop === prop);
          const from = n.attrs.find((a) => a.name === spec.from)?.value;
          if (from === undefined && !declared) continue;
          // 형식(단위·열거)을 먼저 본다 — 단위가 붙으면 그것은 디자인 값이고, 동기 여부보다
          // 앞선 위반이다 (§3.4 조항 2·5).
          if (declared && !/^-?\d+(\.\d+)?$/.test(declared.value)) {
            findings.push(finding('5-R6b', 'design.data-prop-misuse', n, raw, file,
              `데이터 채널 값은 단위 없는 수만 허용한다 (§3.4 조항 2). 받은 값: ${declared.value}`));
          } else if (!declared || from === undefined || String(declared.value).trim() !== String(from).trim()) {
            findings.push(finding('5-R6b', 'grammar.data-prop-desync', n, raw, file,
              `${spec.from}(${from ?? '없음'}) 과 인라인 ${prop}(${declared?.value ?? '없음'}) 가 일치해야 한다. setValue 가 둘을 동시에 갱신한다 (§3.3 L3)`));
          }
        }
      }
    }
    // 목록 밖 인라인 커스텀 프로퍼티
    for (const d of decls) {
      if (!d.prop.startsWith('--')) continue;
      const allowed = n.value ? mapping.dataPropsOf(n.value) : null;
      if (!allowed || !(d.prop in allowed)) {
        findings.push(finding('5-R6b', 'design.data-prop-misuse', n, raw, file,
          `${d.prop} 는 이 리프 값의 dataProps 허용목록에 없다 (§3.4 조항 5). 테마 mapping.json 에 선언하거나 인라인 선언을 제거한다`));
      }
    }

    // 규칙 6-c — data-region 슬롯 열거 (닫힘, §2.2). 조판은 data-variant 가 따로 진다.
    if (n.value === 'region') {
      if (!n.regionSlot) {
        findings.push(finding('5-R6c', 'grammar.unknown-variant', n, raw, file,
          `data-box="region" 은 data-region 슬롯을 함께 선언한다. 열거: ${mapping.regionSlots().join('｜')}`));
      } else if (!mapping.regionSlots().includes(n.regionSlot)) {
        findings.push(finding('5-R6c', 'grammar.unknown-variant', n, raw, file,
          `data-region="${n.regionSlot}" 는 닫힌 열거 밖이다. 열거: ${mapping.regionSlots().join('｜')}`));
      }
    }

    // 규칙 6-c — data-variant 열거
    if (n.variant !== null && n.key) {
      if (!mapping.variantsOf(n.key).includes(n.variant)) {
        findings.push(finding('5-R6c', 'grammar.unknown-variant', n, raw, file,
          `data-variant="${n.variant}" 는 ${n.key} 의 열거에 없다. 열거: ${mapping.variantsOf(n.key).join('｜') || '(선언 없음)'}`));
      }
    }

    // 무자식 리프
    if (n.kind === 'leaf-void' && n.children.some((c) => c.kind !== 'opaque-node' || !c.whitespaceOnly)) {
      findings.push(finding('5-R2', 'grammar.illegal-child', n, raw, file,
        `${n.value} 는 무자식 리프다 (§3.5 L5). 자식을 제거하고 setProps 로 편집한다`));
    }
  });

  // 중복 id — 문서 범위이지만 섹션 판정에서도 잡는다 (§4.1)
  for (const [id, nodes] of seenIds) {
    if (nodes.length > 1) {
      for (const n of nodes) {
        findings.push(finding('4.1', 'grammar.duplicate-id', n, raw, file,
          `data-node-id="${id}" 가 ${nodes.length}곳에 있다. 어느 쪽이 원본인지 문법이 알 수 없으므로 사람이 고른다`, { fixable: false }));
      }
    }
  }

  // 규칙 7 — 저작 트리 왕복 프로브
  const rt = roundTrip(root, raw);
  if (!rt.lossless) {
    findings.push(finding('5-R7', 'grammar.unknown-element', root, raw, file,
      '재직렬화가 원문과 다르다 — 저작 트리가 모델링도 보존도 하지 못한 것이 있다. 아래 unexplained 목록의 노드를 보라',
      { fixable: false, unexplained: rt.unexplained, roundTrip: false }));
  }
  for (const u of rt.unexplained) {
    findings.push({
      rule: '5-R7',
      code: 'grammar.unknown-element',
      location: { file, line: u.line, col: null, span: null },
      subject: u.subject,
      remedy: '왕복의 근거가 없다 — 어휘 안이면 모델링으로, 어휘 밖이면 불투명 바이트 보존으로 설명되어야 한다 (§5.1)',
      fixable: false,
    });
  }

  return { pass: findings.length === 0, findings, roundTripLossless: rt.lossless };
}

function registerId(n, seen) {
  if (!n.nodeId) return;
  if (!seen.has(n.nodeId)) seen.set(n.nodeId, []);
  seen.get(n.nodeId).push(n);
}

export { findSections, hasAttr, classesOf, INLINE_TAGS };
