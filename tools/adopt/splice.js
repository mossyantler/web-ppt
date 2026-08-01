/**
 * 편집 적용 — 이 도구의 **유일한 문자열 쓰기 지점**.
 *
 * 계획 §10.1은 마이그레이터가 `writeSpliced` 원시 함수를 공유하고 "세 번째 splice 구현을
 * 만들지 않는다"고 규정한다. `writeSpliced`는 M2 산출물이므로 M1 시점에는 존재하지 않는다.
 * 그래서 이 모듈은 **구현을 늘리지 않고 접합면 하나만** 둔다:
 *
 * - `applyEdits`는 in-memory 문자열 치환만 한다. 파일 I/O·해시·히스토리를 모르며,
 *   덱 저장소를 알지 못한다. 즉 splice **정책**이 아니라 splice **연산**이다.
 * - M2가 오면 `index.js`의 파일 쓰기 한 줄이 `writeSpliced`로 바뀌고, 이 모듈은
 *   그대로 남거나 사라진다. 어느 쪽이든 쓰기 경로가 늘지 않는다.
 * - 계획 §10.1의 감시 지표("`tools/adopt`가 `writeSpliced` 외의 파일 쓰기 API를
 *   호출하는지 CI grep")가 겨냥하는 지점이 바로 여기다. 파일 쓰기는 `index.js`
 *   한 곳에만 있고, 코어(`core.js`)는 `fs`를 import하지 않는다.
 *
 * 편집은 전부 **여는 태그 안의 속성 삽입/치환**이다. 그래서 편집 구간 밖 바이트는
 * 정의상 동일하다 — 파서의 재직렬화를 쓰지 않기 때문이다(P2, 규약 G1).
 */

/**
 * @param {string} source
 * @param {Array<{start:number,end:number,text:string}>} edits
 * @returns {string}
 */
export function applyEdits(source, edits) {
  const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].start < sorted[i - 1].end) {
      throw new Error(
        `편집 구간이 겹칩니다: [${sorted[i - 1].start},${sorted[i - 1].end}) 와 ` +
        `[${sorted[i].start},${sorted[i].end}). 이것은 도구의 버그이며, 조용히 뭉개지 않습니다.`,
      );
    }
  }
  let out = '';
  let cursor = 0;
  for (const e of sorted) {
    out += source.slice(cursor, e.start) + e.text;
    cursor = e.end;
  }
  return out + source.slice(cursor);
}
