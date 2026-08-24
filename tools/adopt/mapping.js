/**
 * SNU 테마 역매핑 — 클래스 → (data-el | data-box, data-variant)
 *
 * **단일 진실 원천은 `themes/snu/mapping.json`이다.** 이 모듈은 그 파일을 읽어 역방향 표로
 * 뒤집기만 한다. 값을 여기에 손으로 적지 않는다 — 계획 3판 "M1 개정 기록 2 · 단일 매핑 원천을
 * M1으로 당긴다"가 고친 결함이 정확히 그것이었다(하네스 전사와 마이그레이터 전사가 갈라짐).
 *
 * **판정 규칙 (추측 금지의 실체)**
 * 1. 항목의 `classes`가 요소 클래스 집합의 **부분집합**일 때만 후보가 된다.
 * 2. 후보의 값(`value`)이 둘 이상 다르면, 클래스 집합이 나머지 전부를 **진부분집합으로 포함하는**
 *    후보가 하나 있을 때만 그것을 고른다. 없으면 **모호**이고 부여하지 않고 보고한다.
 *    (`class="slide-body cols-2"`는 region|body|cols2 ⊃ grid|cols2 이므로 region 이 이긴다.)
 * 3. 같은 값의 variant가 여럿이면 `classes`가 가장 큰 것(가장 구체적인 것)을 고른다.
 * 4. 남는 클래스(residual)는 정보 항목으로만 보고한다. 소스의 class 속성은 건드리지 않는다.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

/** 테마 매핑의 단일 진실 원천 — 하네스(`tools/harness/mapping.js`)와 같은 파일이다. */
export const MAPPING_PATH = join(HERE, '..', '..', 'themes', process.env.THEME || 'snu', 'mapping.json');

export const THEME = JSON.parse(readFileSync(MAPPING_PATH, 'utf8'));

/** 허용 인라인 태그 (닫힌 목록) — grammar.md §3.1 L1 */
export const INLINE_TAGS = new Set([
  'b', 'i', 'em', 'strong', 'span', 'br', 'a', 'sup', 'sub', 'code',
]);

/**
 * 인라인 태그에도 어휘 값을 부여하는 예외.
 * 실측 코퍼스에서 `pill`은 `<span class="pill">`, `equation`은 `<span data-tex>`다.
 * 그 밖의 인라인은 규칙 2·3의 면제 ⓐ이므로 주석하지 않는다.
 */
export const INLINE_ANNOTATABLE = new Set(['pill', 'equation']);

const splitClasses = (s) => (s ?? '').split(/\s+/).filter(Boolean);

function entriesFor(prefix) {
  const out = [];
  for (const [key, variants] of Object.entries(THEME.blocks)) {
    if (!key.startsWith(prefix)) continue;
    const value = key.slice(prefix.length);
    for (const [variant, cls] of Object.entries(variants)) {
      if (key === 'box:region') {
        // region 은 두 축이다 — data-region(슬롯) × data-variant(조판). 역방향 후보는 곱집합이다.
        for (const [slot, slotCls] of Object.entries(THEME.regionSlots)) {
          const classes = [...splitClasses(slotCls), ...splitClasses(cls)];
          if (!classes.length) continue;
          out.push({ value, variant: variant === 'default' ? undefined : variant, region: slot, classes });
        }
        continue;
      }
      const classes = splitClasses(cls);
      // 클래스 없는 매핑은 역방향 키가 없다. 그런 값은 클래스로 되찾지 못하고
      // 구조 규칙(§2.6 클래스 없는 <div>)이나 태그 규칙으로만 도달한다.
      if (!classes.length) continue;
      out.push({ value, variant: variant === 'default' ? undefined : variant, classes });
    }
  }
  return out;
}

/** 리프 — `data-el`. grammar.md §2.1 */
export const LEAF_ENTRIES = entriesFor('el:');

/** 컨테이너 — `data-box`. grammar.md §2.2 */
export const BOX_ENTRIES = entriesFor('box:').map((e) => (
  e.value === 'grid' ? { ...e, cols: e.variant === 'cols3' ? '3' : e.variant === undefined ? '2' : undefined } : e
));

/**
 * 태그만으로 확정되는 매핑 (클래스가 어휘에 하나도 걸리지 않을 때만 쓴다).
 * grammar.md §2.1은 `text`의 SNU 클래스를 `<p>`(default)로, `image`를 `<img>`로 적는다.
 */
export const TAG_LEAF = {
  p: { value: 'text' },
  img: { value: 'image' },
  // 태그가 곧 뜻인 것들. 클래스가 어휘에 안 걸린다고 이것들까지 구조 규칙(§2.6)에
  // 맡기면 `<table>` 이 컨테이너가 되고 그 안의 `<col>`·`<tr>` 이 하나씩 이름표를
  // 받는다 — `<col>` 은 글자를 담을 수 없으므로 "고칠 텍스트가 없다" 로 게이트가
  // 죽는다(실측). 어휘가 이미 `table`·`list` 를 갖고 있고, 둘 다 leafStructure 로
  // 자기 구조 자식을 선언해 두었다. 태그로 확정하는 편이 맞다.
  table: { value: 'table' },
  ul: { value: 'list' },
  ol: { value: 'list' },
  hr: { value: 'rule' },
};

/** 저작 리프의 구조 자식 — grammar.md §3.6 L6. */
export const LEAF_STRUCTURE = THEME.leafStructure;

/** 불투명 리프 — grammar.md §3.2 L2. 자식 서브트리는 규약 G1의 불투명 노드다. */
export const OPAQUE_LEAVES = THEME.opaqueLeaves;

/** 섹션 variant — grammar.md §2.3. */
export const SECTION_VARIANTS = Object.entries(THEME.blocks.section)
  .map(([variant, cls]) => ({
    variant,
    classes: splitClasses(cls),
    kind: variant === 'title' ? 'title' : undefined,
  }))
  .sort((a, b) => b.classes.length - a.classes.length);

/**
 * 클래스 집합에 대해 후보 항목을 고른다.
 * @returns {{matches: Array, chosen: object|null, ambiguous: boolean, residual: string[]}}
 */
export function matchEntries(entries, classList) {
  const classes = new Set(classList);
  const matches = entries.filter((e) => e.classes.length > 0 && e.classes.every((c) => classes.has(c)));
  if (matches.length === 0) return { matches, chosen: null, ambiguous: false, residual: classList };

  const values = new Set(matches.map((m) => m.value));
  let pool = matches;
  if (values.size > 1) {
    // 규칙 2 — 나머지 전부를 포함하는 가장 구체적인 후보가 하나면 그것이 이긴다.
    const widest = matches.reduce((a, b) => (b.classes.length > a.classes.length ? b : a));
    const wide = new Set(widest.classes);
    const covers = matches.every((m) => m === widest || m.classes.every((c) => wide.has(c)));
    const tied = matches.filter((m) => m.classes.length === widest.classes.length && m.value !== widest.value);
    if (!covers || tied.length) return { matches, chosen: null, ambiguous: true, residual: classList };
    pool = matches.filter((m) => m.value === widest.value);
  }

  // 같은 값의 여러 variant → 가장 구체적인(클래스 수가 가장 많은) 것
  const chosen = pool.reduce((a, b) => (b.classes.length > a.classes.length ? b : a));
  const used = new Set(chosen.classes);
  const residual = classList.filter((c) => !used.has(c));
  return { matches, chosen, ambiguous: false, residual };
}
