/**
 * 속성 허용 목록 — `setProps` 와 `insertElement` 가 **같은 규칙**을 쓴다.
 *
 * 두 곳에 따로 적으면 한쪽만 넓어진다. 넣을 때는 되는데 고칠 때는 안 되는(또는 그 반대인)
 * 속성이 생기고, 그 차이는 사용자가 부딪히기 전까지 아무도 모른다.
 */

import { DocError } from './doc.js';

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

export { assertPropsAllowed, assertInsideDeck, PROPS_DENY, IMAGE_PROPS };
