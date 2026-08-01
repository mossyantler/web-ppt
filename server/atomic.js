/**
 * 원자적 파일 쓰기 — M2 의 유일한 파일 쓰기 지점.
 *
 * 계획 §11 M2 수용 기준: "프로세스를 쓰기 도중 kill → 파일이 온전한 이전 버전 또는
 * 온전한 새 버전 (반쯤 쓰인 상태 없음)".
 *
 * **`writeFileSync` 를 직접 쓰면 이 기준을 만족할 수 없다.** 그 호출은 파일을 먼저
 * 비우고 채우므로, 도중에 죽으면 잘린 HTML 이 남는다. 잘린 HTML 은 파싱은 되지만
 * 슬라이드 절반이 사라진 상태이고, 사용자에게는 "저장했는데 내용이 날아갔다" 로 보인다.
 * 소스가 유일한 진실인 시스템에서 이것은 D1(조용한 손상) 위반이다.
 *
 * 같은 디렉터리에 임시 파일을 쓰고 `rename` 하면 POSIX 가 원자성을 보장한다.
 * 같은 디렉터리여야 하는 이유 — `rename` 은 파일시스템을 건너지 못한다. `/tmp` 에
 * 썼다가 옮기면 그것은 복사이고 원자적이지 않다.
 *
 * **쓰기 경로는 이 함수 하나다** (계획 §10.1 감시 지표). 다른 파일 쓰기 API 가
 * 서버 코드에 등장하면 P2 의 구조적 상속이 깨진다.
 */

import { writeFileSync, renameSync, openSync, fsyncSync, closeSync, unlinkSync, mkdirSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';

/**
 * `path` 에 `content` 를 원자적으로 쓴다.
 *
 * 순서가 중요하다 — 임시 파일을 fsync 한 **뒤에** rename 한다. 반대로 하면
 * rename 은 저널에 올라가고 데이터는 아직 페이지 캐시에 있어, 전원이 끊기면
 * 이름만 새것이고 내용은 0 바이트인 파일이 남는다.
 */
export function atomicWrite(path, content) {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });

  // 임시 이름에 pid 를 넣어 같은 덱에 대한 동시 쓰기가 서로의 임시 파일을 밟지 않게 한다.
  // 같은 프로세스 안의 동시성은 문서 락(§3.6)이 막으므로 pid 로 충분하다.
  const tmp = join(dir, `.${basename(path)}.${process.pid}.tmp`);

  try {
    writeFileSync(tmp, content, 'utf8');
    const fd = openSync(tmp, 'r+');
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, path);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      // 임시 파일이 없으면 지울 것도 없다. 원래 오류를 덮지 않는다.
    }
    throw err;
  }
}
