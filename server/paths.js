/**
 * 덱 경로 해석과 봉쇄 — M2 의 유일한 경로 신뢰 경계.
 *
 * 계획 §11 M2 수용 기준: "`_workspace/` 밖 경로 요청 → 403".
 *
 * **이 모듈이 없으면 `deckId` 는 곧 임의 파일 읽기·쓰기다.** 서버가 로컬 전용이라는
 * 사실은 방어가 아니다 — 브라우저에 뜬 아무 페이지나 `fetch('http://localhost:PORT/...')`
 * 를 보낼 수 있고, 그 요청은 이 프로세스의 파일 권한을 그대로 쓴다.
 *
 * 봉쇄는 **문자열 검사가 아니라 실경로 비교**로 한다. `..` 을 필터링하는 방식은
 * 심볼릭 링크·유니코드 정규화·URL 인코딩으로 우회되고, 그 우회를 하나씩 막는 목록은
 * 결코 닫히지 않는다. resolve 후 접두사 비교는 닫힌다.
 */

import { resolve, sep } from 'node:path';
import { realpathSync, existsSync } from 'node:fs';

/**
 * 편집 가능한 유일한 루트. 이 밖은 전부 403 이다.
 *
 * 상수가 아니라 함수인 이유 — 모듈 로드 시점의 `cwd` 로 고정하면 테스트가 임시
 * 디렉터리로 루트를 옮길 수 없고, 그러면 봉쇄 검사 자체를 검사할 수 없다.
 */
export function workspaceRoot() {
  return resolve(process.cwd(), '_workspace');
}

export class PathError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * `deckId` → 덱 파일의 절대 경로.
 *
 * `deckId` 는 `_workspace/` 아래 디렉터리 이름이다 (예: `2026-07-27-001`).
 * 덱 파일은 그 안의 `index.html` 하나로 고정한다 — 파일명을 요청이 정하게 하면
 * 봉쇄 검사를 통과하는 임의 확장자 쓰기가 가능해진다.
 */
export function deckPath(deckId) {
  if (typeof deckId !== 'string' || !deckId.length) {
    throw new PathError(400, 'deckId 가 없다');
  }
  // 경로 구분자와 널 바이트는 여기서 자른다. 아래 봉쇄 검사가 최종 방어선이지만,
  // 이 검사는 "deckId 는 디렉터리 이름 하나" 라는 계약 자체를 지킨다.
  if (/[\\/\0]/.test(deckId)) {
    throw new PathError(403, `deckId 는 디렉터리 이름 하나여야 한다: ${JSON.stringify(deckId)}`);
  }

  return assertInsideWorkspace(resolve(workspaceRoot(), deckId, 'index.html'));
}

/**
 * 절대 경로가 `_workspace/` 안인지 확인한다. 아니면 403.
 *
 * 존재하는 경로는 realpath 로 심볼릭 링크를 풀어 **다시** 검사한다 — `_workspace/evil`
 * 이 `/etc` 를 가리키는 링크면 resolve 만으로는 통과한다.
 */
export function assertInsideWorkspace(absPath) {
  const declared = workspaceRoot();
  const root = existsSync(declared) ? realpathSync(declared) : declared;
  for (const p of candidatesFor(absPath)) {
    if (p !== root && !p.startsWith(root + sep)) {
      throw new PathError(403, `_workspace/ 밖의 경로는 편집할 수 없다: ${absPath}`);
    }
  }
  return resolve(absPath);
}

/** resolve 결과와, 존재한다면 realpath 결과 둘 다 검사 대상이다. */
function candidatesFor(absPath) {
  const abs = resolve(absPath);
  const out = [abs];
  if (existsSync(abs)) out.push(realpathSync(abs));
  return out;
}

/** 덱의 부속 디렉터리 (`.history/`, `.log/`). 계획 §3.4·§11 관측성. */
export function deckSubdir(deckId, name) {
  if (/[\\/\0]/.test(deckId) || /[\\/\0]/.test(name)) {
    throw new PathError(403, '덱 부속 디렉터리 이름에 경로 구분자를 쓸 수 없다');
  }
  return assertInsideWorkspace(resolve(workspaceRoot(), deckId, name));
}
