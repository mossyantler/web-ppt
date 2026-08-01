#!/usr/bin/env node
/**
 * 테마 이식 — 저작 트리를 그대로 두고 `class` 만 대상 테마의 매핑으로 갈아끼운다.
 *
 * 계획 §14 후속 과제 8 의 검증 도구다. **어휘 보편성의 실체적 질문은 하나다** —
 * 같은 저작 트리(`data-el`/`data-box`)를 다른 테마가 렌더할 수 있는가.
 * 그 답은 "대상 테마가 코퍼스가 쓰는 (값, variant) 를 전부 선언하는가" 로 환원되고,
 * 선언하지 않은 것이 하나라도 있으면 그것이 **어휘가 원 테마에 묶인 지점**이다.
 *
 * 사용:
 *   node tools/retheme/index.js <file...> --to=minimal [--out-dir=PATH]
 *
 * 기본은 dry-run 이다. `--out-dir` 이 없으면 어떤 파일도 만들지 않고 갭만 보고한다.
 *
 * **어휘 값을 바꾸지 않는다.** `data-el`·`data-box`·`data-variant`·`data-node-id` 는
 * 손대지 않고 `class` 속성 하나만 splice 한다. 그것이 "문법은 테마와 무관하다" 의
 * 실행 가능한 형태다.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';

import { loadMapping, mappingPathFor } from '../harness/mapping.js';
import { parseDocument, findSections, buildTree } from '../harness/tree.js';
import { splicedMany } from '../harness/splice.js';

export function retheme(raw, from, to) {
  const doc = parseDocument(raw);
  const edits = [];
  const gaps = [];
  let touched = 0;

  // 슬라이드가 없는 파일은 이식 대상이 아니다 — 대표적으로 불투명 리프의 스캐폴딩 조각.
  // 그 안에는 어휘 주석이 없어 짚을 것이 없고(§3.2 L2), 테마마다 손으로 쓴다.
  // **명세에 그렇게 적어 두고 도구가 덮어쓰면 명세가 거짓말이 된다** — 실제로 한 번
  // 그렇게 덮어썼고, 그래서 도구가 스스로 알아보게 만든다.
  if (findSections(doc).length === 0) {
    return { edits: [], gaps: [], touched: 0, html: raw, skipped: 'no-section' };
  }

  // 테마가 소유하는 표면은 `blocks` 하나가 아니다. 아래 셋이 저작 트리에 **어휘 주석
  // 없이** 붙어 있고, 처음 이식을 돌렸을 때 게이트를 60% 로 떨어뜨린 것이 이들이다.
  const structMap = structuralClassMap(from, to);            // L6 구조 자식의 클래스
  const propMap = dataPropMap(from, to);                     // §3.4 데이터 채널 프로퍼티 이름
  const { map: inlineMap, missing } = inlineClassMap(from, to); // §2.4.1 인라인 클래스 역할

  // 대상 테마가 역할을 선언하지 않았다면 그 자리는 이식할 수 없다. 조용히 원 테마
  // 클래스를 남기면 게이트는 통과하고 서식만 틀린다 — 배열 시절의 실패와 같은 종류다.
  for (const role of missing) gaps.push({ kind: 'inlineClasses', role });

  for (const el of findSections(doc)) {
    const { root } = buildTree(raw, el, from, 'declared');
    root.walk((n) => {
      // ① 어휘 값을 가진 요소 — blocks 조회
      const key = keyOf(n);
      if (key) {
        const variant = n.variant ?? 'default';
        const next = to.classFor(key, variant, n.regionSlot ?? null);
        if (next === null) {
          gaps.push({ kind: 'blocks', key, variant, regionSlot: n.regionSlot ?? null, line: n.loc?.line ?? null });
        } else {
          const edit = classEdit(raw, n, next);
          if (edit) { edits.push(edit); touched += 1; }
        }
        // ② 데이터 채널 — 인라인 커스텀 프로퍼티 이름이 테마 소유다
        const styleEdit = dataPropEdit(raw, n, propMap);
        if (styleEdit) { edits.push(styleEdit); touched += 1; }
        return;
      }

      // ③ 구조 자식(L6)·인라인 — 어휘 주석이 없으므로 클래스로만 찾는다
      const rename = renameClasses(n, structMap, inlineMap);
      if (rename) {
        const edit = classEdit(raw, n, rename);
        if (edit) { edits.push(edit); touched += 1; }
      }
    });
  }

  const spliced = edits.length ? splicedMany(raw, edits) : raw;
  return { edits, gaps, touched, html: relink(spliced) };
}

/**
 * `<head>` 의 테마 스타일시트 링크 교체 — `setTheme`(§3.2 문서 명령, M5)의 오프라인 대응물.
 *
 * 클래스를 전부 갈아끼워도 문서가 원 테마의 시트를 물고 있으면 화면은 그대로 깨진다.
 * 문법은 `<head>` 에 대해 아무 말도 하지 않으므로 게이트가 이것을 잡지 못한다 —
 * **이식이 통과했는데 렌더가 깨지는 갭**이고, 실측으로 드러난 자리다.
 *
 * 테마 밖을 가리키는 시트만 지운다. `../theme.css` 는 이식 후 대상 테마의 것을 가리킨다.
 */
function relink(html) {
  return html.replace(/^[ \t]*<link rel="stylesheet" href="(?!\.\.\/theme\.css)[^"]*">\n/gm, '');
}

/**
 * L6 구조 자식의 클래스 대응표.
 *
 * 선언은 리프 값별 `(태그, 클래스)` 목록이고 **클래스는 테마가 소유한다.** 그런데 구조
 * 자식은 규칙 2·3 면제 대상이라 `data-el` 이 없다 — 즉 **어휘로는 찾을 수 없고 클래스로만
 * 찾을 수 있다.** 두 테마의 선언을 같은 리프·같은 태그 안에서 순서로 짝짓는다.
 */
function structuralClassMap(from, to) {
  const map = new Map();
  for (const [leaf, fromDecl] of Object.entries(from.json.leafStructure ?? {})) {
    const toDecl = to.json.leafStructure?.[leaf] ?? [];
    for (const tag of new Set(fromDecl.map((d) => d.tag))) {
      const a = fromDecl.filter((d) => d.tag === tag && d.class);
      const b = toDecl.filter((d) => d.tag === tag && d.class);
      a.forEach((d, i) => { if (b[i]) map.set(d.class, b[i].class); });
    }
  }
  return map;
}

/** §3.4 데이터 채널 — 프로퍼티 이름과 출처 속성 이름이 둘 다 테마 소유다. */
function dataPropMap(from, to) {
  const map = new Map();
  for (const [leaf, fromSpec] of Object.entries(from.json.dataProps ?? {})) {
    const toSpec = to.json.dataProps?.[leaf] ?? {};
    const a = Object.entries(fromSpec);
    const b = Object.entries(toSpec);
    a.forEach(([prop], i) => { if (b[i]) map.set(prop, b[i][0]); });
  }
  return map;
}

/**
 * §2.4.1 인라인 클래스 대응표 — **역할 이름으로 짝짓는다.**
 *
 * 배열이던 시절에는 순서로 짝지을 수밖에 없었고, 그 때문에 SNU 의 `num`(수치 셀)이
 * 다른 테마의 6번째 항목으로 가서 표의 숫자 열이 서식을 잃었다. 게이트는 통과했다 —
 * 게이트가 인라인 클래스의 의미를 재지 않기 때문이다. 역할 이름이 그 추측을 없앤다.
 *
 * 키 집합이 갈리면 이식이 다시 추측이 되므로, 갈린 키는 갭으로 보고한다.
 */
function inlineClassMap(from, to) {
  const a = from.json.inlineClasses ?? {};
  const b = to.json.inlineClasses ?? {};
  const map = new Map();
  const missing = [];
  for (const [role, cls] of Object.entries(a)) {
    if (b[role] === undefined) { missing.push(role); continue; }
    map.set(cls, b[role]);
  }
  return { map, missing };
}

/** 어휘 값이 없는 요소의 클래스를 두 표로 갈아끼운다. 바뀔 게 없으면 null. */
function renameClasses(n, structMap, inlineMap) {
  const current = n.attrs?.find((a) => a.name === 'class')?.value;
  if (!current) return null;
  const next = current.split(/\s+/).filter(Boolean)
    .map((c) => structMap.get(c) ?? inlineMap.get(c) ?? c)
    .join(' ');
  return next === current ? null : next;
}

/** 인라인 `style` 의 커스텀 프로퍼티 이름만 갈아끼운다. 값은 손대지 않는다. */
function dataPropEdit(raw, n, propMap) {
  const loc = n.attrLocs?.style;
  const style = n.attrs?.find((a) => a.name === 'style')?.value;
  if (!loc || !style) return null;

  const next = style.replace(/(^|;)\s*(--[\w-]+)\s*:/g, (m, sep, prop) => (
    propMap.has(prop) ? `${sep}${propMap.get(prop)}:` : m
  ));
  if (next === style) return null;
  return { start: loc.startOffset, end: loc.endOffset, text: `style="${next}"` };
}

/** 노드의 blocks 키. 섹션은 `section`, 나머지는 `el:`/`box:` 접두사다. */
function keyOf(n) {
  if (n.kind === 'section') return 'section';
  if (n.key) return n.key;
  return null;
}

/**
 * `class` 속성 하나만 바꾸는 편집.
 *
 * 속성별 소스 구간(`attrLocs`)을 쓰므로 같은 여는 태그의 다른 속성은 바이트 동일하다.
 * 서버의 속성 명령과 같은 성질이고, 같은 이유다 — 손대지 않은 것을 다시 쓰지 않는다.
 */
function classEdit(raw, n, next) {
  const loc = n.attrLocs?.class;
  const current = n.attrs.find((a) => a.name === 'class')?.value ?? null;

  if (next === '') {
    if (!loc) return null; // 원래도 클래스가 없다
    // 앞선 공백 하나까지 지워 `<div  data-...>` 가 되지 않게 한다.
    const start = loc.startOffset - 1 > n.openStart && /\s/.test(raw[loc.startOffset - 1])
      ? loc.startOffset - 1 : loc.startOffset;
    return { start, end: loc.endOffset, text: '' };
  }

  if (!loc) {
    // 클래스가 없던 요소에 새로 붙인다 — 여는 태그의 `>` 직전.
    const at = insertionPoint(raw, n);
    return { start: at, end: at, text: ` class="${next}"` };
  }

  if (current === next) return null;
  return { start: loc.startOffset, end: loc.endOffset, text: `class="${next}"` };
}

function insertionPoint(raw, n) {
  let i = n.openEnd - 1;
  if (raw[i] !== '>') throw new Error(`여는 태그가 '>' 로 끝나지 않는다: <${n.tag}>`);
  i -= 1;
  if (raw[i] === '/') i -= 1;
  while (i > n.openStart && /\s/.test(raw[i])) i -= 1;
  return i + 1;
}

/* ------------------------------------------------------------------ CLI */

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const files = args.filter((a) => !a.startsWith('--'));
  const toName = (args.find((a) => a.startsWith('--to=')) ?? '').slice(5);
  const outDir = (args.find((a) => a.startsWith('--out-dir=')) ?? '').slice(10) || null;

  if (!files.length || !toName) {
    console.error('사용: node tools/retheme/index.js <file...> --to=<theme> [--out-dir=PATH]');
    process.exit(2);
  }

  const from = loadMapping();
  const to = loadMapping(mappingPathFor(toName));
  if (outDir) mkdirSync(outDir, { recursive: true });

  let totalGaps = 0;
  let totalTouched = 0;

  console.log(`\n# 테마 이식 — ${process.env.THEME || 'snu'} → ${toName}\n`);
  for (const file of files) {
    const raw = readFileSync(file, 'utf8');
    const r = retheme(raw, from, to);
    totalGaps += r.gaps.length;
    totalTouched += r.touched;

    if (r.skipped) {
      console.log(`– ${basename(file).padEnd(22)} 건너뜀 (슬라이드 없음 — 테마마다 손으로 쓰는 조각)`);
      continue;
    }
    const mark = r.gaps.length ? '✘' : '✔';
    console.log(`${mark} ${basename(file).padEnd(22)} 클래스 ${String(r.touched).padStart(3)}개 교체 · 갭 ${r.gaps.length}`);
    for (const g of r.gaps) {
      console.log(g.kind === 'inlineClasses'
        ? `    미선언  inlineClasses.${g.role}  (§2.4.1 역할 키가 갈렸다)`
        : `    미선언  ${g.key}|${g.variant}${g.regionSlot ? `@${g.regionSlot}` : ''}  (line ${g.line})`);
    }
    if (outDir) writeFileSync(join(outDir, basename(file)), r.html, 'utf8');
  }

  console.log(`\n합계 — 클래스 ${totalTouched}개 교체 · 갭 ${totalGaps}개`);
  console.log(totalGaps === 0
    ? '\n판정: PASS — 대상 테마가 코퍼스의 (값, variant) 를 전부 선언한다.\n'
    : `\n판정: FAIL — ${totalGaps}개 지점에서 어휘가 원 테마에 묶여 있다.\n`);
  process.exit(totalGaps === 0 ? 0 : 1);
}
