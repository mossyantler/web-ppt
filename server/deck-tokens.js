/**
 * 리포트 하나만의 토큰 재정의 — 설정 화면의 색·글꼴·글자 크기가 문서에 닿는 통로.
 * 명세 `docs/specs/새-리포트-만들기.md` 결정 2.
 *
 * ## 왜 덱 안에 두는가
 *
 * 리포트마다 다를 수 있어야 하므로(설정은 리포트를 만들 때 정한다) 테마 파일에 쓸 수 없다.
 * 덱의 `<head>` 안 `<style id="deck-tokens">` 한 블록이 그 자리이고, **섹션 밖이라 규칙 4
 * (섹션 안 `<style>` 금지)에 걸리지 않는다.**
 *
 * ## 이름을 지어내지 않는다
 *
 * 처음 판은 `--brand-main`·`--brand-sub` 라는 이름을 썼다. 그런 토큰은 **아무도 읽지 않아서**
 * 색을 골라도 화면이 그대로였다 — 설정이 먹은 것처럼 보이는데 아무 일도 안 하는, 가장 나쁜
 * 종류의 실패다. 그래서 여기 있는 이름은 전부 `tokens/*.css` 가 실제로 정의하고
 * `slides/slides.css` 가 실제로 읽는 것들이다.
 *
 *   메인 색   `--accent` 와 그 의미 형제들 (`--text-accent`·`--surface-accent`·`--border-accent`)
 *   서브 색   `--accent-2` — 표지 밑줄과 머리말(kicker) 이 읽는다 (테마가 연결한다)
 *   글꼴      `--font-sans`
 *   본문 크기 `--text-body`
 *   제목 크기 `--text-display` — `slides/slides.css` 의 `.slide-title` 이 읽는다
 *
 * 흐리게·눌렀을 때 색은 고르게 하지 않고 `color-mix` 로 만든다. 사람에게 색을 다섯 개
 * 고르게 하면 그중 하나는 반드시 어긋난다.
 */

import { DocError } from './doc.js';

/** 이 블록의 자리. 만들 때 껍데기가 비워 두고, 설정 화면이 여기만 다시 쓴다. */
export const TOKENS_OPEN = '<style id="deck-tokens">';
export const TOKENS_CLOSE = '</style>';

/**
 * 설정 → CSS 블록 본문. 아무것도 안 정했으면 빈 문자열이다(= 테마 기본).
 * @param {{mainColor?:string, subColor?:string, font?:string, bodySize?:string}} setup
 */
export function tokensBlock(setup = {}) {
  const rules = [];

  if (setup.mainColor) {
    const main = cssValue(setup.mainColor);
    rules.push(
      `  --accent: ${main};`,
      `  --text-accent: ${main};`,
      `  --surface-accent: ${main};`,
      `  --border-accent: ${main};`,
      // 눌렀을 때 색은 고르게 하지 않고 섞어 만든다 — 색을 다섯 개 고르게 하면
      // 그중 하나는 반드시 어긋난다. `--accent-soft` 는 넣지 않는다: 지금 테마에서
      // **아무도 읽지 않는 이름**이고, 안 읽히는 값을 쓰는 것은 먹은 척하는 설정이다.
      `  --accent-hover: color-mix(in srgb, ${main} 82%, black);`,
    );
  }
  if (setup.subColor) rules.push(`  --accent-2: ${cssValue(setup.subColor)};`);
  if (setup.font) rules.push(`  --font-sans: ${cssValue(setup.font)};`);
  if (setup.bodySize) rules.push(`  --text-body: ${cssValue(setup.bodySize)};`);
  if (setup.titleSize) rules.push(`  --text-display: ${cssValue(setup.titleSize)};`);

  return rules.length ? `\n:root {\n${rules.join('\n')}\n}\n` : '';
}

/**
 * 토큰 값에 들어갈 수 없는 문자를 막는다.
 *
 * 이 값은 `<style>` 안으로 그대로 들어간다. `}` 하나면 규칙을 닫고 새 규칙을 여는 것이 되고,
 * 그 순간 설정 화면이 문서 전체의 스타일을 쓰는 통로가 된다. `</style>` 로 블록을 빠져나가는
 * 것은 `<` 가 막는다.
 */
export function cssValue(value) {
  const text = String(value).trim();
  if (/[{}<>;@\\]/.test(text) || text.length > 120) {
    throw new DocError(422, `토큰 값에 쓸 수 없는 문자가 있다: ${text}`, { code: 'create.bad-token' });
  }
  return text;
}

/** 문서에서 이 블록의 **안쪽** 구간을 찾는다. 없으면 null (옛 덱). */
export function tokensSpan(raw) {
  const open = raw.indexOf(TOKENS_OPEN);
  if (open < 0) return null;
  const start = open + TOKENS_OPEN.length;
  const end = raw.indexOf(TOKENS_CLOSE, start);
  return end < 0 ? null : [start, end];
}
