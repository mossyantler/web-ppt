/**
 * `adoptSlide` — 이름표가 없는 슬라이드에 이름표를 붙인다. M3-9 (결정 9).
 *
 * 이름표(`data-el`·`data-box`·`data-node-id`)가 없는 슬라이드는 명령이 지목할 수
 * 없어서 편집기가 잠근다. 잠그기만 하고 방법을 안 주면 나갈 문이 없으므로,
 * 화면의 "고치기" 버튼이 이 명령을 보낸다.
 *
 * **다른 명령과 똑같이 커밋 파이프라인을 지난다.** 마이그레이션이라고 옆문을 내지
 * 않는 이유가 전부다 —
 *   - 낙관적 락이 걸린다 (그 사이 파일이 바뀌었으면 409)
 *   - P2 가 검사된다 (이름표를 붙이면서 본문을 건드렸으면 쓰지 않고 죽는다)
 *   - 되돌리기 링에 들어간다 → **Ctrl+Z 로 원래대로 돌아간다** (결정 9 의 요구)
 *   - 멱등 키가 걸린다 (버튼을 두 번 눌러도 파일은 한 번만 바뀐다)
 * 옆문으로 파일을 쓰면 이 넷을 전부 다시 만들어야 하고, 그 사본은 조금씩 달라진다.
 *
 * 판정 자체는 `tools/adopt/core.js` 가 한다. 그 모듈은 `fs` 를 모른다 — 오프라인
 * CLI 와 이 명령이 **같은 판정**을 쓰고, 판정이 두 벌이 되지 않는다.
 */

import { adoptDocument } from '../tools/adopt/core.js';
import { registerCommand } from './commands.js';
import { DocError } from './doc.js';

/** 사람 판단이 필요한 곳을 몇 개까지 실을 것인가. 전부 실으면 응답이 진단 덤프가 된다. */
const MAX_FINDINGS = 20;

registerCommand('adoptSlide', (deck, command) => {
  const section = command.args?.section;

  // 장 번호는 1-based 다 — 화면이 보여 주는 번호와 같아야 사용자가 응답을 읽을 수 있다.
  if (section !== undefined) {
    if (!Number.isInteger(section) || section < 1 || section > deck.sections.length) {
      throw new DocError(400, `그런 장이 없다: ${section} (장 수: ${deck.sections.length})`, {
        code: 'adopt.no-such-section',
      });
    }
  }

  let out;
  try {
    out = adoptDocument(deck.raw, section === undefined ? {} : { section });
  } catch (err) {
    throw new DocError(422, `이름표를 붙이지 못했다: ${err.message}`, { code: 'adopt.failed' });
  }

  // 커밋 파이프라인은 같은 구간의 편집을 **마지막 것만 남기고 버린다** — 구조 명령이
  // 같은 섹션을 반복해서 재직렬화하기 때문이고, 거기서는 그것이 맞다. 하지만 adopt 는
  // 노드마다 삽입을 하나씩 내므로 같은 자리가 둘이면 그건 조용히 사라지는 이름표다.
  // 실측으로는 겹치지 않지만, 겹치지 않는다는 사실에 기대지 않고 여기서 막는다.
  const seen = new Set();
  for (const e of out.edits) {
    const key = `${e.start}:${e.end}`;
    if (seen.has(key)) {
      throw new DocError(500, `같은 구간에 이름표 편집이 둘이다 [${e.start},${e.end}) — 파일은 쓰지 않았다`, {
        code: 'adopt.overlapping-edits',
      });
    }
    seen.add(key);
  }

  return {
    edits: out.edits.map(({ start, end, text }) => ({ start, end, text })),
    // 자동으로 판단이 안 된 곳만 돌려준다 (결정 9). 이름표가 붙은 자리는 화면에 이미
    // 결과로 보이므로 다시 셀 필요가 없고, 남은 것만이 사용자가 할 일이다.
    diagnostics: out.findings
      .filter((f) => f.needsHuman)
      .slice(0, MAX_FINDINGS)
      .map((f) => ({
        code: f.code ?? `grammar.rule-${f.rule}`,
        line: f.location?.line ?? null,
        subject: f.subject ?? null,
        remedy: f.remedy ?? null,
      })),
  };
});
