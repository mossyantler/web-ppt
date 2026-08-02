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

/* --------------------------------------------------------------- moveSection */

/**
 * 슬라이드 순서 바꾸기 — M3 결정 6이 요구한 명령.
 *
 * 요소 재배열(`reorderChildren`)과 같은 발상이다. **자리를 고정하고 내용만 바꾼다** —
 * 섹션 사이의 공백과 주석은 원문 그대로 남고, 섹션 바이트만 순서를 바꿔 다시 붙인다.
 * 그래서 HTML 을 받지 않고 목표 위치만 받는다.
 */
registerCommand('moveSection', (deck, command) => {
  const secs = deck.sections.map((s) => s.root);
  const from = secs.findIndex((s) => s.nodeId === command.target);
  const to = command.args?.index;

  if (from < 0) {
    throw new DocError(404, `섹션을 찾을 수 없다: ${command.target}`, { code: 'commit.unknown-target' });
  }
  if (!Number.isInteger(to) || to < 0 || to >= secs.length) {
    throw new DocError(422, `index 가 범위를 벗어났다: ${to} ∉ [0, ${secs.length})`, {
      code: 'commit.index-out-of-range',
    });
  }
  if (from === to) return { edits: [] };

  const order = secs.map((_, i) => i);
  order.splice(to, 0, order.splice(from, 1)[0]);

  const raw = deck.raw;
  const lo = secs[0].start;
  const hi = secs[secs.length - 1].end;

  let out = '';
  let cursor = lo;
  for (const [slot, src] of order.entries()) {
    out += raw.slice(cursor, secs[slot].start);   // 섹션 사이의 공백·주석은 자리에 남는다
    out += raw.slice(secs[src].start, secs[src].end);
    cursor = secs[slot].end;
  }
  out += raw.slice(cursor, hi);

  return { edits: [{ start: lo, end: hi, text: out }] };
});

/* ------------------------------------------------------------ renumberPages */

/**
 * 페이지 번호 다시 매기기 — 파생·멱등 (계획 §3.2 문서 명령).
 *
 * 슬라이드 순서가 바뀌거나 수가 달라지면 꼬리의 "03 / 09" 가 틀어진다. 이 명령은
 * 그것을 현재 순서로 다시 계산할 뿐이므로 몇 번 걸어도 결과가 같다.
 *
 * **대상을 어휘로 찾지 못한다.** 실측 템플릿의 `<span class="page">` 는 주석되지 않은
 * 인라인이라 `data-el` 이 없다(§2.4 여섯 번째 표면). 그래서 테마의 `el:meta|page` 클래스로
 * 찾는다 — 클래스 이름 자체는 테마 소유이므로 테마를 갈아도 이 코드는 그대로다.
 */
registerCommand('renumberPages', (deck) => {
  const pageClass = deck.mapping.classFor('el:meta', 'page');
  if (!pageClass) {
    throw new DocError(422, '테마가 el:meta|page 를 선언하지 않았다 — 페이지 번호 자리를 찾을 수 없다', {
      code: 'commit.no-page-mapping',
    });
  }
  const want = pageClass.split(/\s+/).filter(Boolean);
  const total = deck.sections.length;
  const pad = (n) => String(n).padStart(2, '0');

  const edits = [];
  for (const [i, section] of deck.sections.entries()) {
    section.root.walk((n) => {
      if (!n.isElement || !want.every((c) => n.classes.includes(c))) return;
      const span = n.innerSpan();
      if (!span) return;
      const next = `${pad(i + 1)} / ${pad(total)}`;
      if (deck.raw.slice(span[0], span[1]) === next) return;   // 멱등 — 바뀔 게 없으면 편집하지 않는다
      edits.push({ start: span[0], end: span[1], text: next });
    });
  }
  return { edits };
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
