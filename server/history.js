/**
 * 파일 스냅샷 히스토리 — 계획 §3.4 "Undo — 스냅샷".
 *
 * **역연산을 만들지 않는다.** 이유는 셋이다 (§3.4):
 *   1. `unwrapElement` 의 역연산은 원래 컨테이너의 모든 속성을 알아야 한다
 *   2. `adoptSection` 은 역연산이 사실상 불가능하다
 *   3. 역연산 버그는 **조용히 소스를 망가뜨린다** — D1 위반
 *
 * 대신 커밋 직전 파일 원본 바이트를 통째로 기록한다. 프로토타입에서 이미 검증된
 * 발상이다 (`ppt.js:170` 의 `undo.push(host.innerHTML)`).
 *
 * ## 링을 둘로 나누는 이유 (Architect A2 — 1판 결함 수정)
 *
 * Estradeck 의 `writeSpliced` 는 **모든 쓰기에 대해** `recordHistory` 를 호출한다.
 * "undo = 새 커밋" 이면 undo 마다 스냅샷이 같은 링에 들어가고, 링 100 칸에서
 * **편집 100 + undo 100 은 산술적으로 불가능**하다 — 편집 스냅샷이 undo 스냅샷에
 * 밀려 나간다. 그래서 링을 둘로 나눈다.
 *
 *   edit — 사용자·AI 커밋 직전 스냅샷  (200)
 *   redo — undo 가 되돌리기 전의 상태   (200)
 */

import { readdirSync, readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { deckSubdir } from './paths.js';
import { atomicWrite } from './atomic.js';

/** 링 크기 — 계획 §3.4 표. 편집 100 + undo 100 을 여유 있게 담는다. */
export const RING_SIZE = 200;

const RINGS = ['edit', 'redo'];

function ringDir(deckId, ring) {
  if (!RINGS.includes(ring)) throw new Error(`알 수 없는 링: ${ring}`);
  const dir = join(deckSubdir(deckId, '.history'), ring);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function entries(deckId, ring) {
  const dir = ringDir(deckId, ring);
  return readdirSync(dir).filter((f) => f.endsWith('.html')).sort();
}

/** 스냅샷 하나를 링에 넣는다. 링이 가득 차면 **가장 오래된 것**을 버린다. */
export function push(deckId, ring, content, label = '') {
  const dir = ringDir(deckId, ring);
  const list = entries(deckId, ring);

  const lastSeq = list.length ? Number(list[list.length - 1].slice(0, 8)) : 0;
  const name = `${String(lastSeq + 1).padStart(8, '0')}-${safeLabel(label)}.html`;
  atomicWrite(join(dir, name), content);

  for (const stale of entries(deckId, ring).slice(0, -RING_SIZE)) {
    rmSync(join(dir, stale), { force: true });
  }
  return name;
}

/** 가장 최근 스냅샷을 꺼내 **제거하고** 내용을 돌려준다. 비었으면 null. */
export function pop(deckId, ring) {
  const dir = ringDir(deckId, ring);
  const list = entries(deckId, ring);
  if (!list.length) return null;

  const name = list[list.length - 1];
  const content = readFileSync(join(dir, name), 'utf8');
  rmSync(join(dir, name), { force: true });
  return { name, content };
}

export function depth(deckId, ring) {
  const dir = join(deckSubdir(deckId, '.history'), ring);
  if (!existsSync(dir)) return 0;
  return entries(deckId, ring).length;
}

/**
 * 링을 비운다.
 *
 * **새 편집이 들어오면 redo 링을 비운다** (§3.4 커서 모델). 되돌린 뒤 다른 편집을 하면
 * 그 시점부터 미래는 하나뿐이고, 남겨 두면 서로 이어지지 않는 두 역사가 생긴다.
 */
export function clear(deckId, ring) {
  const dir = ringDir(deckId, ring);
  for (const f of entries(deckId, ring)) rmSync(join(dir, f), { force: true });
}

/** 파일명에 들어갈 수 없는 문자를 자른다. 라벨은 사람이 읽는 용도일 뿐이다. */
function safeLabel(label) {
  return String(label).replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'commit';
}
