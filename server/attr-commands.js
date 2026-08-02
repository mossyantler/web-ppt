/**
 * 속성 명령 — 계획 §3.2 "속성 명령" 표. M2-2.
 *
 *   setProps · setSectionProps · setTex · setValue · setPosition
 *
 * 전부 **여는 태그 단위 쓰기**다. 재직렬화가 없으므로 대상 요소의 내부 HTML 은
 * 정의상 바이트 동일하고, 그것이 이 다섯을 구조 명령과 가르는 유일한 기준이다.
 *
 * 각 명령이 무엇을 거부하는지가 곧 문법의 집행 지점이다. 거부는 전부 422 이고,
 * 422 는 파일을 건드리지 않는다.
 */

import { DocError, resolveNode } from './doc.js';
import { registerCommand } from './commands.js';
import { attrEdits, patchStyle } from './attrs.js';

/** 규칙 5 — 인라인 기하는 canvas 의 자식만 (§5 규칙 5). */
const GEOMETRY_PROPS = ['left', 'top', 'width', 'height'];

/**
 * `setProps` 가 건드릴 수 있는 속성.
 *
 * 계획 §3.2: "patch 키가 `class` 또는 `data-*` 화이트리스트".
 * 아래 셋은 `data-*` 이지만 **제외**한다 — 문법의 뼈대이지 사용자 속성이 아니다.
 */
const PROPS_DENY = new Set([
  'data-node-id',  // §2.2 — 서버가 락 안에서 발급한다. 바뀌면 undo 의 선택 복원과 인덱스가 깨진다
  'data-slide',    // §2.3 — 섹션임을 선언하는 표지. 지우면 문서 구조가 무너진다
  'data-el',       // §2   — 어휘 값 변경은 구조 명령이다 (같은 자리에 다른 종류를 넣는 것)
  'data-box',
]);

/**
 * `image` 리프에만 추가로 열리는 속성 — 문법 §3.5 L5.1 *(2026-08-03 신설)*.
 *
 * 그림의 내용은 `src` 에 있는데 허용 목록이 `class`·`data-*` 뿐이라, **`image` 는 넣을 수는
 * 있고 무엇을 가리킬지는 정할 수 없는 유일한 어휘 값이었다.** `style` 을 열지 않는 이유는
 * 그대로다 — 인라인 기하는 규칙 5 위반이고 토큰 우회다. `src`·`alt` 는 기하가 아니라 내용이다.
 */
const IMAGE_PROPS = new Set(['src', 'alt']);

function assertPropsAllowed(patch, node) {
  const isImage = node?.value === 'image';

  for (const key of Object.keys(patch)) {
    const name = key.toLowerCase();
    if (PROPS_DENY.has(name)) {
      throw new DocError(422, `setProps 로 바꿀 수 없는 속성이다: ${name}`, { code: 'commit.forbidden-prop' });
    }
    if (name === 'class' || name.startsWith('data-')) continue;
    if (isImage && IMAGE_PROPS.has(name)) {
      if (name === 'src') assertInsideDeck(patch[key]);
      continue;
    }
    throw new DocError(422, `setProps 는 class 와 data-* 만 다룬다: ${name}`, { code: 'commit.forbidden-prop' });
  }
}

/**
 * 그림 경로는 **덱 폴더 안**이어야 한다 (§3.5 L5.1).
 *
 * 외부 URL 을 허용하면 발표 중 네트워크에 의존하게 되고, 리포트 하나가 자기 폴더로 닫히지
 * 않는다. `javascript:`·`data:` 는 그 이전에 주입 표면이다.
 */
function assertInsideDeck(value) {
  const src = String(value ?? '');
  const bad = /^[a-z][a-z0-9+.-]*:/i.test(src)   // 스킴이 붙은 것 전부 (http·data·javascript…)
    || src.startsWith('//')                      // 프로토콜 상대 URL
    || src.startsWith('/')                       // 서버 루트 — 덱 밖이다
    || src.split('/').includes('..');            // 덱 밖으로 올라가기

  if (bad) {
    throw new DocError(422, `그림 경로는 덱 폴더 안의 상대 경로여야 한다: ${src}`, {
      code: 'commit.outside-deck',
    });
  }
}

function assertPatchShape(patch, op) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new DocError(400, `${op} 의 args.patch 가 객체여야 한다`);
  }
  for (const [k, v] of Object.entries(patch)) {
    if (v !== null && typeof v !== 'string' && typeof v !== 'number') {
      throw new DocError(400, `${op} 의 patch.${k} 는 문자열·숫자·null 이어야 한다`);
    }
  }
}

/* ------------------------------------------------------------------ setProps */

registerCommand('setProps', (deck, command) => {
  const { node } = resolveNode(deck, command.target);
  const patch = command.args?.patch;
  assertPatchShape(patch, 'setProps');
  assertPropsAllowed(patch, node);

  if (node.kind === 'section') {
    throw new DocError(422, '섹션의 속성은 setSectionProps 로 바꾼다 (§3.2)', { code: 'commit.wrong-command' });
  }
  return { edits: attrEdits(node, deck.raw, patch) };
});

/* ----------------------------------------------------------- setSectionProps */

registerCommand('setSectionProps', (deck, command) => {
  const { node } = resolveNode(deck, command.target);
  const patch = command.args?.patch;
  assertPatchShape(patch, 'setSectionProps');
  // 섹션에는 `src`·`alt` 를 열지 않는다 — 노드를 넘기지 않으면 `class`·`data-*` 만 남는다.
  assertPropsAllowed(patch);

  if (node.kind !== 'section') {
    throw new DocError(422, `setSectionProps 의 대상은 섹션이어야 한다: ${command.target}`, { code: 'commit.wrong-target' });
  }
  return { edits: attrEdits(node, deck.raw, patch) };
});

/* -------------------------------------------------------------------- setTex */

registerCommand('setTex', (deck, command) => {
  const { node } = resolveNode(deck, command.target);
  const tex = command.args?.tex;

  if (node.value !== 'equation') {
    throw new DocError(422, `setTex 의 대상은 data-el="equation" 이어야 한다 (현재: ${node.value ?? node.kind})`, {
      code: 'commit.wrong-target',
    });
  }
  if (typeof tex !== 'string') throw new DocError(400, 'setTex 의 args.tex 가 문자열이어야 한다');

  // §3.2 "data-tex 속성만 바꿈". 자식 서브트리는 런타임 산출물이므로 건드리지 않는다.
  return { edits: attrEdits(node, deck.raw, { 'data-tex': tex }) };
});

/* ------------------------------------------------------------------ setValue */

registerCommand('setValue', (deck, command) => {
  const { node } = resolveNode(deck, command.target);
  const value = command.args?.value;

  const spec = deck.mapping.dataPropsOf(node.value);
  if (node.kind !== 'leaf-opaque' || !spec) {
    throw new DocError(422, `setValue 의 대상은 데이터 채널을 선언한 불투명 리프여야 한다 (현재: ${node.value ?? node.kind})`, {
      code: 'commit.wrong-target',
    });
  }

  const [prop, rule] = Object.entries(spec)[0];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new DocError(400, 'setValue 의 args.value 가 유한한 수여야 한다');
  }
  if (value < rule.min || value > rule.max) {
    throw new DocError(422, `값이 범위를 벗어났다: ${value} ∉ [${rule.min}, ${rule.max}]`, { code: 'commit.value-range' });
  }

  // §3.4 동기 불변식 — `data-value` 와 `--pct` 를 **함께** 갱신한다. 한쪽만 바꾼 소스는
  // `grammar.data-prop-desync` 로 잡히므로, 명령이 그 상태를 만들어서는 안 된다.
  const style = node.attrs.find((a) => a.name === 'style')?.value ?? '';
  return {
    edits: attrEdits(node, deck.raw, {
      [rule.from]: String(value),
      style: patchStyle(style, { [prop]: String(value) }),
    }),
  };
});

/* --------------------------------------------------------------- setPosition */

registerCommand('setPosition', (deck, command) => {
  const { node } = resolveNode(deck, command.target);
  const box = command.args ?? {};

  // §2.2 canvas 규칙 — 부모가 canvas 가 아니면 422. 흐름 배치의 기하는 컨테이너가 정한다.
  if (!node.parent || node.parent.value !== 'canvas') {
    throw new DocError(422, 'setPosition 은 data-box="canvas" 의 자식에서만 유효하다 (§2.2)', {
      code: 'commit.not-in-canvas',
    });
  }

  const patch = {};
  for (const [key, prop] of [['x', 'left'], ['y', 'top'], ['w', 'width'], ['h', 'height']]) {
    if (box[key] === undefined) continue;
    if (typeof box[key] !== 'number' || !Number.isFinite(box[key])) {
      throw new DocError(400, `setPosition 의 args.${key} 가 유한한 수여야 한다`);
    }
    patch[prop] = `${box[key]}px`;
  }
  if (!Object.keys(patch).length) throw new DocError(400, 'setPosition 에 x·y·w·h 가 하나도 없다');

  const style = node.attrs.find((a) => a.name === 'style')?.value ?? '';
  return { edits: attrEdits(node, deck.raw, { style: patchStyle(style, patch) }) };
});

export { GEOMETRY_PROPS };
