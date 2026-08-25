/**
 * `setDeckTokens` — 리포트 하나의 색·글꼴·글자 크기를 바꾼다. 결정 2.
 *
 * **문서 명령이다** (`renumberPages` 와 같은 부류). 대상이 노드가 아니라 문서의 한 구간
 * — `<head>` 안 `<style id="deck-tokens">` 의 안쪽 — 이기 때문이다.
 *
 * 명령으로 만드는 이유는 그래야 나머지를 공짜로 얻기 때문이다. 낙관적 락이 걸리고,
 * P2 가 쓰기 전에 검사되고, 되돌리기 링에 들어간다. 설정 화면이 파일을 직접 쓰면 그 셋이
 * 전부 사라지고, **색을 바꿨다가 마음에 안 들 때 돌아올 방법이 없다.**
 *
 * 블록이 없는 문서(껍데기가 생기기 전에 만들어진 옛 덱)는 422 다. 없는 자리를 만들려면
 * `<head>` 를 파싱해 끼워야 하고, 그것은 이 명령이 약속한 "구간 하나만 바꾼다" 를 깬다.
 */

import { DocError } from './doc.js';
import { registerCommand } from './commands.js';
import { parse } from 'parse5';

import { tokensBlock, tokensSpan, TOKENS_OPEN, TOKENS_CLOSE } from './deck-tokens.js';

registerCommand('setDeckTokens', (deck, command) => {
  // 자리가 없으면 만든다.
  //
  // 처음 판은 여기서 422 를 냈다 — "새 껍데기로 만든 리포트에만 있다". 실측하면 `_workspace`
  // 의 리포트 **다섯 개 전부** 그 자리가 없다. 그러면 테마 창은 열리는 족족 거부되고,
  // 사용자에게는 그것이 고장과 구별되지 않는다.
  //
  // 만드는 것이 이 명령의 약속을 깨지도 않는다. `</head>` **바로 앞**의 폭 0 짜리 구간
  // 하나에 끼우므로 여전히 "구간 하나만 바꾼다" 이고, 그 자리는 파서가 알려준다 —
  // `</head>` 를 문자열로 찾으면 주석이나 스크립트 안의 같은 글자를 집을 수 있다.
  const span = tokensSpan(deck.raw) ?? null;

  const args = command.args ?? {};
  const known = ['mainColor', 'subColor', 'font', 'bodySize', 'titleSize'];
  const unknown = Object.keys(args).filter((k) => !known.includes(k));
  if (unknown.length) {
    // 모르는 키를 조용히 버리면 사용자는 "글꼴을 골랐는데 왜 안 바뀌지" 를 알 수 없다.
    throw new DocError(400, `setDeckTokens 가 모르는 항목이다: ${unknown.join(', ')}`, {
      code: 'commit.unknown-arg',
      known,
    });
  }

  const block = tokensBlock(args);
  if (span) return { edits: [{ start: span[0], end: span[1], text: block }] };

  const at = headEnd(deck.raw);
  if (at === null) {
    throw new DocError(422, '이 리포트에는 <head> 가 없다 — 토큰 자리를 만들 수 없다', {
      code: 'commit.no-token-block',
    });
  }
  return { edits: [{ start: at, end: at, text: `${TOKENS_OPEN}${block}${TOKENS_CLOSE}\n` }] };
});

/**
 * `</head>` 바로 앞의 자리.
 *
 * **여기여야 한다.** 토큰 재정의는 테마의 `<link>` 와 덱 자신의 `<style>` 보다 **뒤**에
 * 와야 이긴다 — 둘 다 `:root` 에 쓰므로 나중 것이 남는다. 앞에 끼우면 값을 골라도 화면이
 * 그대로이고, 그것이 이 파일이 머리말에서 경계한 "먹은 척하는 설정" 이다.
 */
function headEnd(raw) {
  const doc = parse(raw, { sourceCodeLocationInfo: true });
  const html = doc.childNodes?.find((n) => n.tagName === 'html');
  const head = html?.childNodes?.find((n) => n.tagName === 'head');
  return head?.sourceCodeLocation?.endTag?.startOffset ?? null;
}
