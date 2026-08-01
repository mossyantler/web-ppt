// 메모리 전용 splice. reference/estradeck/server/src/deck/splice.ts 의 writeSpliced 와
// 같은 발상이되 파일에 쓰지 않는다 — 파일 쓰기는 M2 범위다.

import { createHash } from 'node:crypto';

export function hashOf(s) {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

/** raw.slice(0,start) + text + raw.slice(end). 부작용 없음. */
export function spliced(raw, start, end, text) {
  if (!(Number.isInteger(start) && Number.isInteger(end) && start <= end && start >= 0 && end <= raw.length)) {
    throw new Error(`splice 구간이 유효하지 않다: [${start}, ${end}) / len=${raw.length}`);
  }
  return raw.slice(0, start) + text + raw.slice(end);
}

/**
 * P2 검증 — 편집 구간 밖 바이트 동일.
 *
 * 편집 후 소스에서 [start, start+text.length) 를 도려낸 것이 편집 전 소스에서
 * [start, end) 를 도려낸 것과 같아야 한다. 이것이 "구간 밖 불변" 의 정의다.
 */
export function outsideIdentical(before, after, start, end, text) {
  const beforeOutside = before.slice(0, start) + before.slice(end);
  const afterOutside = after.slice(0, start) + after.slice(start + text.length);
  return {
    ok: beforeOutside === afterOutside,
    prefixOk: before.slice(0, start) === after.slice(0, start),
    suffixOk: before.slice(end) === after.slice(start + text.length),
  };
}

/** 여러 구간을 한 번에 splice 한다 (겹치지 않아야 한다). 뒤에서부터 적용. */
export function splicedMany(raw, edits) {
  const sorted = [...edits].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start < sorted[i - 1].end) {
      throw new Error(`splice 구간이 겹친다: [${sorted[i - 1].start},${sorted[i - 1].end}) / [${sorted[i].start},${sorted[i].end})`);
    }
  }
  let out = raw;
  for (const e of [...sorted].reverse()) out = spliced(out, e.start, e.end, e.text);
  return out;
}
