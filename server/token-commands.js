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
import { tokensBlock, tokensSpan } from './deck-tokens.js';

registerCommand('setDeckTokens', (deck, command) => {
  const span = tokensSpan(deck.raw);
  if (!span) {
    throw new DocError(422, '이 리포트에는 토큰 자리가 없다 — 새 껍데기로 만든 리포트에만 있다', {
      code: 'commit.no-token-block',
    });
  }

  const args = command.args ?? {};
  const known = ['mainColor', 'subColor', 'font', 'bodySize'];
  const unknown = Object.keys(args).filter((k) => !known.includes(k));
  if (unknown.length) {
    // 모르는 키를 조용히 버리면 사용자는 "글꼴을 골랐는데 왜 안 바뀌지" 를 알 수 없다.
    throw new DocError(400, `setDeckTokens 가 모르는 항목이다: ${unknown.join(', ')}`, {
      code: 'commit.unknown-arg',
      known,
    });
  }

  return { edits: [{ start: span[0], end: span[1], text: tokensBlock(args) }] };
});
