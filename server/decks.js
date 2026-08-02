/**
 * 덱 목록 — M3 결정 12("편집기를 열면 리포트 목록이 먼저").
 *
 * `_workspace/` 아래에서 `index.html` 을 가진 디렉터리를 찾는다. 그것이 리포트 하나다.
 *
 * **읽기만 한다.** 목록 화면은 아직 리포트를 만들지도 지우지도 않는다(이번 범위 밖).
 * 나중에 "새 리포트 만들기" 가 붙어도 그 쓰기는 `atomicWrite` 를 지나야 한다 —
 * 쓰기 경로는 하나다(§10.1).
 */

import { readdirSync, existsSync, statSync, readFileSync, realpathSync } from 'node:fs';
import { join, sep } from 'node:path';

import { workspaceRoot, deckPath, assertInsideWorkspace } from './paths.js';

/** 화면에 보여줄 이름을 소스에서 뽑는다. 없으면 디렉터리 이름을 쓴다. */
function labelOf(html, deckId) {
  // 이름표가 붙은 덱은 어휘로 찾고, 아직 안 붙은 덱은 태그로 찾는다. 목록은 편집 가능
  // 여부와 무관하게 사람이 알아볼 이름을 보여줘야 한다 — 그러라고 만든 화면이다.
  const patterns = [
    /<[^>]*data-el="hero"[^>]*>([\s\S]*?)</,
    /<[^>]*data-el="title"[^>]*>([\s\S]*?)</,
    /<h1[^>]*>([\s\S]*?)</,
    /<h2[^>]*>([\s\S]*?)</,
    /<title[^>]*>([\s\S]*?)</,
  ];
  for (const re of patterns) {
    const text = (re.exec(html)?.[1] ?? '').replace(/<[^>]*>/g, '').trim();
    if (text) return text;
  }
  return deckId;
}

/** `_workspace/` 아래 리포트 목록. 최근 수정 순. */
export function listDecks() {
  const root = workspaceRoot();
  if (!existsSync(root)) return [];

  const out = [];
  for (const name of readdirSync(root)) {
    // `_ui-proto` 처럼 밑줄로 시작하는 것은 리포트가 아니다.
    if (name.startsWith('_') || name.startsWith('.')) continue;

    let path;
    try {
      path = deckPath(name);        // 경로 봉쇄를 여기서도 지난다 (심볼릭 링크 방어)
    } catch {
      continue;
    }
    if (!existsSync(path)) continue;

    const html = readFileSync(path, 'utf8');
    out.push({
      deckId: name,
      label: labelOf(html, name),
      // 이름표가 붙은 섹션만 세면 아직 주석 안 된 덱이 "0장" 으로 보인다. 사용자에게는
      // 13장짜리 리포트인데 0장이라고 말하면 목록을 믿을 수 없게 된다. `<section>` 을 센다.
      slideCount: (html.match(/<section[\s>]/g) ?? []).length,
      // 문법을 선언하지 않은 덱은 편집기가 열어도 잠긴 채다 (결정 9). 목록에서 미리 알린다.
      annotated: /<html[^>]*data-deck-grammar="v1"/.test(html),
      modifiedAt: statSync(path).mtime.toISOString(),
    });
  }

  return out.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

/**
 * 덱 안의 파일 경로를 돌려준다 — 슬라이드가 참조하는 그림·글꼴용. 없으면 null.
 *
 * 봉쇄는 `assertInsideWorkspace` 하나가 한다. 여기서 `..` 을 문자열로 거르지 않는 이유는
 * `paths.js` 에 적힌 그대로다 — 필터 목록은 닫히지 않고, resolve 후 실경로 비교는 닫힌다.
 */
export function deckAssetPath(deckId, relPath) {
  if (/\0/.test(deckId) || /\0/.test(relPath)) return null;

  let dir;
  let abs;
  try {
    // 봉쇄 기준은 워크스페이스가 아니라 **그 덱 디렉터리**다. 워크스페이스로 잡으면
    // `../다른덱/index.html` 이 통과한다 — 덱 A 의 화면이 덱 B 의 파일을 읽는다.
    dir = assertInsideWorkspace(join(workspaceRoot(), deckId));
    abs = assertInsideWorkspace(join(dir, relPath));
  } catch {
    return null;   // 봉쇄 밖 → 그런 파일은 없는 것으로 다룬다
  }
  if (abs !== dir && !abs.startsWith(dir + sep)) return null;

  if (!existsSync(abs) || !statSync(abs).isFile()) return null;
  // 심볼릭 링크로 덱 밖을 가리키는 것도 막는다 — resolve 만으로는 통과한다.
  return realpathSync(abs).startsWith(realpathSync(dir) + sep) ? abs : null;
}
