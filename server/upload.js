/**
 * 리포트 폴더에 그림 넣기 — `POST /deck/:id/asset?name=logo.png`. 결정 5.
 *
 * **덱 폴더 안에만 쓴다.** 문법 §3.5 L5.1 이 `src` 를 덱 안 상대 경로로 못 박은 이유와 같다 —
 * 리포트 하나가 자기 폴더로 닫혀야 옮기든 압축하든 발표하든 그대로 산다.
 *
 * ## 왜 명령이 아닌가
 *
 * 명령은 문서의 바이트를 바꾸고 낙관적 락·되돌리기 링이 그것을 지킨다. 이건 문서가 아니라
 * **옆에 놓는 파일**이다. 그림을 되돌리기로 되살릴 수는 없지만, 그림을 *가리키는* 일은
 * `setProps` 명령이므로 그쪽은 되돌아간다. 파일이 남아 있는 것은 해가 되지 않는다.
 *
 * ## SVG 를 받지 않는다
 *
 * SVG 는 `<script>` 를 품을 수 있고, 이 서버는 그것을 같은 출처에서 내준다. `<img>` 로 그릴
 * 때는 스크립트가 돌지 않지만 주소창으로 직접 열면 돈다. 로고 하나를 위해 그 표면을 여는
 * 것은 값이 맞지 않는다.
 */

import { existsSync, mkdirSync } from 'node:fs';
import { join, extname } from 'node:path';

import { atomicWrite } from './atomic.js';
import { DocError } from './doc.js';
import { workspaceRoot, assertInsideWorkspace } from './paths.js';

/** 받는 그림 형식. 래스터만 받는다 (위 SVG 문단). */
const ALLOWED = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
]);

/** 그림 하나의 상한. 로고가 이보다 크면 그림이 아니라 사진이다. */
export const MAX_ASSET_BYTES = 2 * 1024 * 1024;

/** 덱 안에서 그림이 사는 자리. 문서는 `asset/logo.png` 로 가리킨다. */
const ASSET_DIR = 'asset';

/**
 * @param {string} deckId
 * @param {string} name    파일 이름 하나. 경로가 아니다
 * @param {Buffer} bytes
 * @returns {{ src: string, bytes: number }}  `src` 는 문서에 그대로 쓰는 상대 경로다
 */
export function saveAsset(deckId, name, bytes) {
  if (typeof name !== 'string' || !name || /[\\/\0]/.test(name) || name.startsWith('.')) {
    throw new DocError(400, `파일 이름 하나여야 한다 (경로 불가): ${name}`, { code: 'asset.bad-name' });
  }

  const ext = extname(name).toLowerCase();
  if (!ALLOWED.has(ext)) {
    throw new DocError(422, `받지 않는 형식이다: ${ext || '(확장자 없음)'}`, {
      code: 'asset.bad-type',
      allowed: [...ALLOWED.keys()],
    });
  }
  if (!bytes?.length) throw new DocError(400, '빈 파일이다', { code: 'asset.empty' });
  if (bytes.length > MAX_ASSET_BYTES) {
    throw new DocError(413, `그림이 상한(${MAX_ASSET_BYTES} bytes)을 넘었다`, { code: 'asset.too-large' });
  }
  assertLooksLikeImage(ext, bytes);

  // 봉쇄는 덱 디렉터리 기준이다 — 워크스페이스로 잡으면 `../다른덱/` 이 통과한다.
  const dir = assertInsideWorkspace(join(workspaceRoot(), deckId, ASSET_DIR));
  if (!existsSync(join(workspaceRoot(), deckId))) {
    throw new DocError(404, `덱을 찾을 수 없다: ${deckId}`, { code: 'asset.no-deck' });
  }

  mkdirSync(dir, { recursive: true });
  atomicWrite(assertInsideWorkspace(join(dir, name)), bytes);

  return { src: `${ASSET_DIR}/${name}`, bytes: bytes.length };
}

/**
 * 확장자와 내용이 맞는가.
 *
 * 확장자만 믿으면 `.png` 라고 이름 붙인 아무 파일이나 덱 폴더에 들어온다. 매직 넘버는
 * 형식 검사가 아니라 **거짓말 검사**다 — 맞으면 통과, 아니면 그 자리에서 거절한다.
 */
function assertLooksLikeImage(ext, bytes) {
  const head = bytes.subarray(0, 12);
  const ok = ext === '.png' ? head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    : ext === '.webp' ? head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP'
      : head[0] === 0xff && head[1] === 0xd8;   // jpeg

  if (!ok) {
    throw new DocError(422, `내용이 ${ext} 가 아니다`, { code: 'asset.content-mismatch' });
  }
}

export { ALLOWED as ASSET_TYPES };
