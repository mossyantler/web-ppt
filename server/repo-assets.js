/**
 * 슬라이드가 참조하는 **저장소 공용 파일** — 스타일시트·글꼴·수식 라이브러리.
 *
 * 덱은 자기 파일을 `../../styles.css` 처럼 저장소 루트 기준으로 가리킨다
 * (`_workspace/<덱>/index.html` 에서 두 칸 위). 편집기가 슬라이드를 `/deck/<id>/page`
 * 로 내주면 그 상대 경로들은 서버 루트(`/styles.css`, `/slides/...`)로 떨어진다.
 * 그래서 그 자리를 서버가 채워야 슬라이드가 제 모양으로 보인다.
 *
 * **덱 자산과 봉쇄 방식이 다르다.** 덱은 "이 디렉터리 안이면 무엇이든"이지만
 * 저장소 루트는 그럴 수 없다 — `server/`, `node_modules/`, `.git/` 이 같은 루트에 있다.
 * 그래서 여기는 **허용 목록**이다. 목록에 없는 첫 칸은 파일이 있어도 안 나간다.
 *
 * 읽기 전용이다. 이 경로로 나가는 파일은 편집 대상이 아니다 — 편집은 `_workspace/`
 * 안에서만 일어나고, 그 봉쇄는 `paths.js` 가 따로 한다.
 */

import { existsSync, statSync, realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';

/**
 * 저장소 루트에서 슬라이드에게 열어 주는 첫 칸.
 *
 * 실측으로 정했다 — 실제 덱이 참조하는 것은 `styles.css`·`slides/`·`assets/`·
 * `templates/` 넷이고, 테마를 갈면 `themes/`·`tokens/` 가 더해진다.
 * 새 테마가 다른 디렉터리를 쓰면 그 이름을 여기 적어야 한다. 적지 않으면
 * 조용히 무시되는 게 아니라 404 로 드러난다 — 그러라고 목록이다.
 */
const ALLOWED = new Set(['styles.css', 'slides', 'assets', 'templates', 'themes', 'tokens']);

/** 요청 경로(`/slides/slides.css`) → 저장소 안 절대 경로. 목록 밖이거나 없으면 null. */
export function repoAssetPath(pathname) {
  if (/\0/.test(pathname)) return null;

  const rel = decodeURIComponent(pathname).replace(/^\/+/, '');
  if (!rel) return null;

  // 허용 판정은 **요청 문자열의 첫 칸**이 아니라 **resolve 결과의 첫 칸**으로 한다.
  // 앞을 보면 `assets/../server/commit.js` 가 통과한다.
  const root = resolve(process.cwd());
  const abs = resolve(root, rel);
  if (!abs.startsWith(root + sep)) return null;

  const [head] = abs.slice(root.length + 1).split(sep);
  if (!ALLOWED.has(head)) return null;

  if (!existsSync(abs) || !statSync(abs).isFile()) return null;
  // 심볼릭 링크로 저장소 밖을 가리키는 것도 막는다 — resolve 만으로는 통과한다.
  return realpathSync(abs).startsWith(realpathSync(root) + sep) ? abs : null;
}
