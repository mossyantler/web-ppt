/**
 * `reserveSections` — 계획 §3.6. M2-5.
 *
 * M2 의 섹션 명령은 이것 하나다. 나머지(`insertSection`·`removeSection`·`moveSection`·
 * `duplicateSection`)는 M2 수용 기준에 없다. 이것만 만드는 이유는 기준 18 —
 * "`reserveSections(3)` 병렬 채움 → `data-node-id` 충돌 0건 (문서 락 검증)" — 때문이다.
 *
 * **이 명령의 목적은 병렬 AI 생성용 자리 예약이다** (§3.6). N 개 섹션을 먼저 만들어
 * 두고 각각을 따로 채운다. 그래서 id 발급이 경쟁 조건의 대상이 되고, 그것을 재는 것이
 * 기준 18 이다.
 *
 * 발급과 쓰기는 `applyCommit` 이 하나의 동기 구간에서 수행한다 — 그 사이에 `await` 가
 * 없다는 것이 문서 락의 실체다. `lock.js` 가 그 성질을 명시적으로 만들고 검사한다.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { IdAllocator } from '../tools/adopt/ids.js';
import { DocError } from './doc.js';
import { registerCommand } from './commands.js';

/**
 * 테마 템플릿 루트. 클라이언트가 경로를 정하지 못하게 `templateId` 는 파일명 하나다.
 *
 * `cwd` 가 아니라 **모듈 위치 기준**이다 — 덱 루트(`_workspace`)와 템플릿 루트는 다른
 * 곳에 있고, 서버를 어디서 띄우든 템플릿은 레포 안의 같은 자리에 있어야 한다.
 */
const TEMPLATE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'themes', 'snu', 'templates');

registerCommand('reserveSections', (deck, command) => {
  const { n, afterId = null, templateId } = command.args ?? {};

  if (!Number.isInteger(n) || n < 1 || n > 32) {
    throw new DocError(400, 'reserveSections 의 args.n 은 1~32 의 정수여야 한다');
  }
  if (typeof templateId !== 'string' || /[\\/\0]|\.\./.test(templateId)) {
    throw new DocError(403, 'templateId 는 경로 없는 템플릿 이름이어야 한다', { code: 'commit.bad-template' });
  }

  const path = join(TEMPLATE_ROOT, `${templateId}.html`);
  if (!existsSync(path)) {
    throw new DocError(404, `템플릿을 찾을 수 없다: ${templateId}`, { code: 'commit.unknown-template' });
  }

  const section = extractSection(readFileSync(path, 'utf8'), templateId);

  // 앵커 — 지정 섹션 뒤, 없으면 마지막 섹션 뒤.
  const anchor = afterId === null
    ? deck.sections[deck.sections.length - 1]
    : deck.sections.find((s) => s.root.nodeId === afterId);
  if (!anchor) {
    throw new DocError(404, `afterId 가 섹션이 아니다: ${afterId}`, { code: 'commit.unknown-target' });
  }

  // **발급은 소스 전체를 훑어 만든 사용 중 집합에서 나온다** (§4.1). 이 배열이 만들어지고
  // 소비되는 동안 `await` 가 없으므로, 같은 프로세스의 다른 커밋이 끼어들 수 없다.
  const ids = new IdAllocator(deck.raw);
  const nodeIds = {};
  const blocks = [];

  for (let i = 0; i < n; i++) {
    const copy = section.replace(/(\bdata-node-id\s*=\s*")([^"]*)(")/g, (_m, a, _old, z) => `${a}${ids.next()}${z}`);
    const withId = /\bdata-node-id=/.test(copy)
      ? copy
      : copy.replace(/^<section/, `<section data-node-id="${ids.next()}"`);
    const sectionId = /\bdata-node-id\s*=\s*"([^"]*)"/.exec(withId)[1];
    nodeIds[`reserved:${i}`] = sectionId;
    blocks.push(withId);
  }

  const at = anchor.root.end;
  return {
    edits: [{ start: at, end: at, text: `\n${blocks.join('\n')}` }],
    nodeIds,
  };
});

/** 템플릿 파일에서 `<section>` 요소 하나를 떠온다. */
function extractSection(html, templateId) {
  const start = html.indexOf('<section');
  const end = html.lastIndexOf('</section>');
  if (start < 0 || end < 0) {
    throw new DocError(422, `템플릿에 <section> 이 없다: ${templateId}`, { code: 'commit.bad-template' });
  }
  return html.slice(start, end + '</section>'.length);
}
