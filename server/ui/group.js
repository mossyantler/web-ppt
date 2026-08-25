/**
 * 복제 · 묶기 · 풀기 — 서버에 있었지만 화면이 부르지 않던 명령 셋. 2026-08-25.
 *
 * `duplicateElement` · `wrapElements` · `unwrapElement` 는 M2 때 등록되고 테스트까지
 * 붙었는데, 화면에 버튼이 없어 **사용자에게는 없는 기능**이었다. 리본이 생기면서 자리가
 * 났다 — 예전 도구 모음은 한 줄이라 여섯 개가 한계였고, 그래서 이 셋이 밀려 있었다.
 *
 * ## 왜 셋 다 다시 받는가
 *
 * 셋 다 **새 노드가 생기거나 사라진다.** 복제본의 id 는 서버가 발급하고, 묶기가 만드는
 * 상자도 그렇다. 화면이 그 마크업을 흉내내면 그것이 두 번째 어휘 구현이다
 * (`structure.js` 의 같은 이야기). 그래서 명령을 보낸 뒤 슬라이드를 다시 받고, 서버가
 * 알려준 id 를 곧바로 골라 둔다 — 방금 만든 것을 눈으로 찾게 하지 않는다.
 *
 * 풀기만은 새 id 가 없다. 안에 있던 것들이 밖으로 나올 뿐이므로 부모를 골라 둔다.
 *
 * ## 묶기는 왜 상자 종류를 묻는가
 *
 * `wrapElements` 는 `boxType` 을 받고, 어휘에 없는 값이면 422 다. 화면이 하나를 정해
 * 박아 두면 테마를 갈았을 때 그 종류가 없어지고 버튼이 조용히 죽는다. 그래서 넣기와
 * 같은 자리에서 온 목록(`GET /vocabulary`)의 컨테이너만 보여 주고 고르게 한다.
 *
 * ## 하나만 골라도 묶을 수 있다
 *
 * 파워포인트의 그룹은 둘 이상이라야 하지만, 여기서 묶기는 **상자를 씌우는 일**이다.
 * 하나를 씌워 두면 그 다음에 그 안으로 다른 것을 넣을 수 있다 — 여러 개 고르기가
 * 아직 없는 지금, 이것이 상자를 만드는 유일한 길이다. 서버의 연속성 검사도 원소가
 * 하나면 자명하게 지난다.
 */

export function createGroup({ commit, index, structure, onNotice, onResync }) {
  /* ------------------------------------------------------------------ 복제 */

  /**
   * 이 요소를 바로 뒤에 하나 더.
   *
   * 섹션과 영역은 안 된다 — 서버가 각각 `duplicateSection` 으로 보내고(§3.2), 영역은
   * 투명 컨테이너라 복제 대상이 아니다(§2.2). 여기서 미리 거르는 이유는 422 를 받고
   * 나서 알려 주는 것보다 **버튼이 꺼져 있는 편이 먼저 말해 주기 때문**이다.
   */
  function canDuplicate(nodeId) {
    const info = index.get(nodeId);
    return !!info && info.value !== 'region' && info.kind !== 'section';
  }

  async function duplicate(nodeId) {
    if (!canDuplicate(nodeId)) return false;
    const { ok, body } = await commit.send([{ op: 'duplicateElement', target: nodeId }], '복제');
    if (!ok) return false;

    onNotice?.({ kind: 'saved', text: '복제했습니다 — 되돌리기로 돌아옵니다' });
    // 서버는 **옛 id → 새 id** 표를 돌려준다(§4.1 서브트리 복제 시 재발급). 그중 우리가
    // 지목한 것의 새 이름이 복제본의 뿌리다 — 자식들의 새 이름도 같은 표에 함께 온다.
    await onResync?.(body?.nodeIds?.[nodeId] ?? nodeId);
    return true;
  }

  /* ------------------------------------------------------------------ 묶기 */

  /** 상자에 넣을 수 있는가. 영역은 슬라이드의 뼈대라 옮기지도 씌우지도 않는다. */
  function canWrap(nodeId) {
    const info = index.get(nodeId);
    if (!info || info.value === 'region' || info.kind === 'section') return false;
    // 부모에 이름표가 없으면 서버가 형제 순번을 셀 기준을 못 잡는다 (`reorder.js` 참고).
    return !!info.parentId && index.get(info.parentId)?.kind === 'container';
  }

  /** 씌울 수 있는 상자 종류. 넣기와 같은 목록에서 컨테이너만 걸러 온다. */
  async function boxes() {
    const types = await structure.vocabulary();
    return types.filter((t) => t.group === 'container');
  }

  async function wrap(nodeIds, boxType, variant = 'default') {
    const targets = [].concat(nodeIds).filter(Boolean);
    if (!targets.length) return false;

    const { ok, body } = await commit.send(
      [{ op: 'wrapElements', target: targets, args: { boxType, variant } }],
      '묶기',
    );
    if (!ok) return false;

    onNotice?.({ kind: 'saved', text: '상자 안에 넣었습니다 — 이제 이 상자로 함께 옮깁니다' });
    await onResync?.(body?.nodeIds?.wrapper ?? targets[0]);
    return true;
  }

  /* ------------------------------------------------------------------ 풀기 */

  /**
   * 상자를 벗기고 안의 것을 부모 자리로 꺼낸다.
   *
   * 컨테이너만 벗길 수 있고, 그중 영역과 자유 배치 층은 뺀다 — 둘은 슬라이드의 뼈대이지
   * 사용자가 만든 상자가 아니다(§2.2 의 투명 컨테이너). 서버도 같은 이유로 422 를 낸다.
   */
  function canUnwrap(nodeId) {
    const info = index.get(nodeId);
    if (!info || info.kind !== 'container') return false;
    return info.value !== 'region' && info.value !== 'canvas';
  }

  async function unwrap(nodeId) {
    if (!canUnwrap(nodeId)) return false;
    const parentId = index.get(nodeId)?.parentId ?? null;

    const { ok } = await commit.send([{ op: 'unwrapElement', target: nodeId }], '풀기');
    if (!ok) return false;

    onNotice?.({ kind: 'saved', text: '상자를 벗겼습니다 — 안의 것이 밖으로 나왔습니다' });
    // 벗긴 상자는 사라졌다. 고를 것이 없으므로 부모로 돌아간다.
    await onResync?.(parentId);
    return true;
  }

  return { canDuplicate, duplicate, canWrap, wrap, boxes, canUnwrap, unwrap };
}
