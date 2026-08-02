/**
 * 새 리포트 만들기 — `POST /decks`. 명세 `docs/specs/새-리포트-만들기.md`.
 *
 * **이것은 명령이 아니다.** 명령은 **있는 문서**를 고치고 낙관적 락으로 보호받는다.
 * 여기에는 고칠 문서가 아직 없다 — 만드는 것이 이 요청의 전부다. 그래서 `commit.js` 를
 * 지나지 않는다. 대신 그 파이프라인이 지키던 두 가지를 여기서도 지킨다.
 *
 *   경로  `paths.js` 봉쇄를 지난다. `_workspace/` 밖으로는 한 글자도 못 나간다
 *   쓰기  `atomicWrite` 하나만 쓴다 (계획 §10.1 — 쓰기 경로 단일화)
 *
 * **이미 있는 폴더는 덮지 않는다.** 만들기가 덮어쓰기를 겸하면 실수 한 번에 지난주
 * 리포트가 사라지고, 그건 되돌리기 링에도 안 남는다(링은 덱 안에 있으므로 함께 사라진다).
 *
 * ## 무엇으로 시작하는가
 *
 * 껍데기(`themes/<theme>/deck.html`) + 표지 한 장이다. 결정 6 은 "빈 문서에서 장을 하나씩
 * 늘려 가지 않는다" 이므로 여기서 목차를 짜지 않는다 — 나머지 장은 원고를 받은 AI 가
 * 이미 있는 명령(`reserveSections`·`insertElement`·`setContent`)으로 채운다(결정 8).
 * 표지 한 장을 두는 이유는 **마스터가 제대로 잡혔는지 눈으로 확인할 자리**가 필요해서다.
 */

import { readFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { IdAllocator } from '../tools/adopt/ids.js';
import { loadMapping } from '../tools/harness/mapping.js';
import { atomicWrite } from './atomic.js';
import { DocError } from './doc.js';
import { workspaceRoot, deckPath, assertInsideWorkspace } from './paths.js';
import { tokensBlock } from './deck-tokens.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const themeRoot = (theme) => join(HERE, '..', 'themes', theme);

/** 표지로 쓰는 템플릿. 결정 6 — 시작은 표지 한 장이다. */
const COVER = 'title-a';

/** 폴더 이름의 모양. `2026-08-03-001` — 지금 관행과 같다 (결정 6). */
const ID_SHAPE = /^\d{4}-\d{2}-\d{2}-\d{3}$/;

/**
 * @param {object} setup  설정 화면이 정한 것 (결정 3 의 네 가지 중 글자에 해당하는 것들)
 * @returns {{ deckId: string, path: string }}
 */
export function createDeck(setup = {}) {
  const theme = typeof setup.theme === 'string' && /^[a-z0-9-]+$/.test(setup.theme) ? setup.theme : 'snu';
  const deckId = setup.deckId ?? nextDeckId(setup.date);

  if (!ID_SHAPE.test(deckId)) {
    throw new DocError(400, `리포트 이름의 모양이 다르다 (예: 2026-08-03-001): ${deckId}`, {
      code: 'create.bad-id',
    });
  }

  const path = deckPath(deckId);          // 경로 봉쇄를 여기서 지난다
  if (existsSync(path)) {
    throw new DocError(409, `이미 있는 리포트다: ${deckId}`, { code: 'create.exists' });
  }

  const shell = readTheme(theme, 'deck.html');
  const cover = coverSection(theme, setup);

  // `title`·`description` 은 사용자 글자다 — 이스케이프해서 넣는다.
  // `tokens`·`sections` 는 우리가 만든 마크업이라 그대로 넣는다 (이스케이프하면 깨진다).
  const html = fill(shell, {
    title: escapeText(setup.title ?? `Weekly Report · ${setup.week ?? ''}`.trim()),
    description: escapeText(setup.description ?? setup.title ?? '주간 활동 보고'),
    tokens: tokensBlock(setup),
    sections: cover,
  });

  mkdirSync(assertInsideWorkspace(join(workspaceRoot(), deckId)), { recursive: true });
  atomicWrite(path, html);

  return { deckId, path };
}

/**
 * 오늘 날짜로 다음 이름을 짓는다. 같은 날 두 번째면 `-002` 다.
 *
 * 날짜를 **인자로 받는다** — 서버 시계로 고정하면 테스트가 오늘에 의존하고, 사용자가
 * 지난주 리포트를 뒤늦게 만드는 경우를 막는다.
 */
export function nextDeckId(date = new Date().toISOString().slice(0, 10)) {
  const root = workspaceRoot();
  const taken = existsSync(root)
    ? readdirSync(root).filter((name) => name.startsWith(`${date}-`))
    : [];

  for (let n = 1; n <= 999; n += 1) {
    const id = `${date}-${String(n).padStart(3, '0')}`;
    if (!taken.includes(id)) return id;
  }
  throw new DocError(409, `${date} 에 만들 수 있는 리포트를 다 썼다`, { code: 'create.exhausted' });
}

/* --------------------------------------------------------------------- 조각 */

function readTheme(theme, name) {
  const path = join(themeRoot(theme), name);
  if (!existsSync(path)) {
    throw new DocError(404, `테마에 ${name} 이 없다: ${theme}`, { code: 'create.no-theme' });
  }
  return readFileSync(path, 'utf8');
}

/**
 * 표지 한 장. 템플릿에서 `<section>` 만 떼어내고 이름표를 새로 발급한다.
 *
 * 템플릿의 id 를 그대로 쓰면 다음에 넣는 장과 충돌한다 — 문서 안 유일성은 §4 이고,
 * 어기면 `doc.js` 가 문서 전체를 409 로 거부한다.
 */
function coverSection(theme, setup) {
  const html = readTheme(theme, join('templates', `${COVER}.html`));
  const start = html.indexOf('<section');
  const end = html.lastIndexOf('</section>');
  if (start < 0 || end < 0) {
    throw new DocError(422, `표지 템플릿에 <section> 이 없다: ${COVER}`, { code: 'create.bad-template' });
  }

  const ids = new IdAllocator('');
  let section = html.slice(start, end + '</section>'.length)
    .replace(/(\bdata-node-id\s*=\s*")([^"]*)(")/g, (_m, a, _old, z) => `${a}${ids.next()}${z}`);

  if (setup.bg === 'dark' || setup.bg === 'light') {
    section = section.replace('<section', `<section data-bg="${setup.bg}"`);
  }
  return `  ${fillCover(section, setup)}\n`;
}

/**
 * 표지의 글자를 설정 값으로 채운다.
 *
 * **지목은 어휘로 한다** — `data-el`·`data-variant`, 그리고 역할 이름(`metaKey`·`metaValue`)이다.
 * 클래스 이름(`title-lab`·`k`·`v`)을 여기 적으면 서버가 테마를 알게 되고, 테마를 갈 때
 * 이 파일이 조용히 틀린다. 역할 → 클래스는 매핑이 갖고 있다 (§2.4.1).
 *
 * 안 준 값은 템플릿 그대로 둔다. 빈 문자열로 밀어 버리면 사용자가 "여기에 무엇이 들어가는
 * 자리인지" 를 잃는다 — 예시 문구가 남아 있는 편이 낫다.
 */
function fillCover(section, setup) {
  const mapping = loadMapping();
  const k = mapping.json.inlineClasses.metaKey;
  const v = mapping.json.inlineClasses.metaValue;

  // 속성 문자열을 그대로 찾는다. `\b` 를 붙이면 따옴표 뒤에서 경계가 성립하지 않아
  // 아무것도 매치되지 않는다 — 실제로 그렇게 써서 표지가 조용히 안 채워졌다.
  const inner = (attr, value) => {
    if (value === undefined || value === null) return;
    const re = new RegExp(`(<(\\w+)[^>]*${attr}[^>]*>)([\\s\\S]*?)(</\\2>)`);
    section = section.replace(re, (m, open, _tag, _body, close) => `${open}${escapeText(value)}${close}`);
  };

  // 랩 이름과 소속 — 소속은 템플릿에서 `<span>` 안에 있다 (테마의 조판이다).
  if (setup.lab || setup.department) {
    const re = new RegExp('(<div[^>]*\\bdata-variant="titleLab"[^>]*>)([\\s\\S]*?)(</div>)');
    section = section.replace(re, (m, open, body, close) => {
      const lab = setup.lab ? escapeText(setup.lab) : body.split('<span')[0].trim();
      const dept = setup.department ? `<span>· ${escapeText(setup.department)}</span>` : (body.match(/<span[\s\S]*<\/span>/)?.[0] ?? '');
      return `${open}${lab} ${dept}${close}`;
    });
  }

  inner('data-el="hero"', setup.title);
  inner('data-el="subtitle"', setup.subtitle);

  // 주차·날짜·발표자 — `<span class="k">라벨</span><span class="v">값</span>` 짝이다.
  for (const [label, value] of [['Week', setup.week], ['Date', setup.date], ['발표자', setup.presenter]]) {
    if (!value) continue;
    const re = new RegExp(`(<span class="${k}">${label}</span><span class="${v}">)([^<]*)(</span>)`);
    section = section.replace(re, (m, open, _old, close) => `${open}${escapeText(value)}${close}`);
  }

  return section;
}

function escapeText(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** `{{이름}}` 을 값으로 바꾼다. 값에 `{{` 가 있어도 두 번 치환되지 않게 한 번에 훑는다. */
function fill(template, values) {
  return template.replace(/\{\{(\w+)\}\}/g, (m, key) => (key in values ? String(values[key]) : m));
}
