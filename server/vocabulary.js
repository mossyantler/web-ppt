/**
 * 넣을 수 있는 것들 — `GET /vocabulary`. M3-7.
 *
 * 결정 7 이 "+ 를 누르면 무엇을 넣을지 목록이 뜬다" 로 정했고, 그 목록은 **테마가
 * 선언한 것** 이어야 한다. 화면이 종류를 하드코딩하면 테마를 갈았을 때 목록에는 있는데
 * 넣으면 422 인 항목이 생긴다 — 그것이 `insertElement` 가 이미 막고 있는 실패이고,
 * 사용자에게는 고장으로 보인다. 그래서 같은 매핑에서 목록을 만든다.
 *
 * **읽기만 한다.** 이 응답은 명령이 아니다.
 */

import { loadMapping } from '../tools/harness/mapping.js';

/**
 * 목록에서 빼는 것들.
 *
 *   region  — 슬라이드의 머리·본문·꼬리 슬롯이다. 흐름 안에 새로 만들 것이 아니다
 *   canvas  — 자유 배치(6 번 단계). 좌표계가 아직 없다
 */
const HIDDEN = new Set(['region', 'canvas']);

export function vocabulary() {
  const mapping = loadMapping();
  const types = [];

  for (const key of Object.keys(mapping.json.blocks)) {
    if (key === 'section') continue;
    const [kind, value] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
    if (HIDDEN.has(value)) continue;

    types.push({
      type: value,
      // 담는 것인가 내용을 갖는 것인가. 화면이 목록을 두 무리로 나눠 보인다.
      group: kind === 'box' ? 'container' : 'leaf',
      // 테마가 선언한 (값, variant) 쌍만 넣을 수 있다. 첫 항목이 기본이다.
      variants: mapping.variantsOf(key),
      // 값 하나만 고치면 되는 리프인가 (수식·진행바). 넣은 뒤 무엇을 해야 하는지가 다르다.
      opaque: !!mapping.opaqueLeafInfo(value),
    });
  }

  return { theme: mapping.json._provenance?.theme ?? null, types };
}
