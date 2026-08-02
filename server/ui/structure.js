/**
 * 요소 추가·삭제 (결정 7). M3-7.
 *
 * ## 넣는 것은 목록에서 고른다
 *
 * `+` 를 누르면 넣을 수 있는 종류가 뜨고 거기서 고른다. 같은 종류를 자동으로 붙이지
 * 않는 이유 — 그러면 다른 종류를 넣을 방법이 없다 (결정 7). 목록은 **테마 매핑**에서
 * 온다(`GET /vocabulary`); 화면이 종류를 들고 있으면 테마를 갈았을 때 목록에는 있는데
 * 넣으면 422 인 항목이 생긴다.
 *
 * ## 넣은 뒤에는 다시 받고, 지운 뒤에는 안 받는다
 *
 * 지우기는 화면에서 그 노드를 떼면 끝이다 — 무엇이 사라지는지 화면이 이미 안다.
 * 넣기는 다르다. 새 요소의 마크업은 테마가 정하고(`synthesize`), 그것을 화면이 흉내내면
 * **두 번째 어휘 구현**이 된다. 그래서 넣은 뒤에는 슬라이드를 다시 받고, 서버가 알려준
 * 새 id 로 그것을 곧바로 고른 상태로 만든다.
 *
 * ## 지울 때 되묻지 않는다
 *
 * 자동 저장이라 확인창이 잦으면 성가시고, 되돌리기가 바로 옆에 있다 (명세 "물어보지
 * 않고 정한 것").
 */

export function createStructure({ stage, commit, index, onNotice, onInserted, onRemoved }) {
  /** 넣을 수 있는 종류. 한 번 받아 두고 화면이 사는 동안 재사용한다. */
  let types = null;

  async function vocabulary() {
    if (!types) {
      types = await fetch('/vocabulary')
        .then((r) => (r.ok ? r.json() : { types: [] }))
        .then((v) => v.types)
        .catch(() => []);
    }
    return types;
  }

  /** 고른 요소 **바로 아래**에 새 요소를 넣는다. */
  async function insert(nodeId, type, variant = 'default') {
    const spot = spotOf(nodeId);
    if (!spot) return false;

    const { ok, body } = await commit.send(
      [{ op: 'insertElement', args: { parentId: spot.parentId, index: spot.at + 1, type, variant, slot: 'new' } }],
      `${type} 넣기`,
    );
    if (!ok) return false;

    onNotice?.({ kind: 'saved', text: '넣었습니다' });
    // 서버가 발급한 id. 다시 받은 화면에서 이것을 골라 두면 사용자가 방금 넣은 것을
    // 눈으로 찾지 않아도 된다.
    onInserted?.(body.nodeIds?.new ?? null);
    return true;
  }

  async function remove(nodeId) {
    const doc = stage.contentDocument;
    const el = doc.querySelector(`[data-node-id="${cssEscape(nodeId)}"]`);
    if (!el) return false;

    const { ok } = await commit.send([{ op: 'removeElement', target: nodeId }], '지우기');
    if (!ok) return false;

    el.remove();
    onNotice?.({ kind: 'saved', text: '지웠습니다 — 되돌리기로 돌아옵니다' });
    onRemoved?.();
    return true;
  }

  /**
   * 넣을 자리 — 고른 요소의 부모와 그 안에서의 순번.
   *
   * 부모는 DOM 에서 얻는다. 목차는 이름표 없는 껍데기를 건너뛰므로 순번의 기준이
   * 되지 못한다 (`reorder.js` 에 같은 이야기가 적혀 있다).
   */
  function spotOf(nodeId) {
    const doc = stage.contentDocument;
    const el = doc?.querySelector(`[data-node-id="${cssEscape(nodeId)}"]`);
    const parent = el?.parentElement;
    const parentId = parent?.dataset?.nodeId;
    if (!parentId || index.get(parentId)?.kind !== 'container') return null;

    return { parentId, at: [...parent.children].indexOf(el) };
  }

  /** 이 요소 옆에 무언가를 넣을 수 있는가 — `+` 버튼을 띄우는 근거다. */
  const canInsert = (nodeId) => !!spotOf(nodeId);

  /** 이 요소를 지울 수 있는가. 영역은 슬라이드의 뼈대이므로 지우지 않는다. */
  function canRemove(nodeId) {
    const info = index.get(nodeId);
    if (!info || info.value === 'region') return false;
    const doc = stage.contentDocument;
    const el = doc?.querySelector(`[data-node-id="${cssEscape(nodeId)}"]`);
    return !!el;
  }

  return { vocabulary, insert, remove, canInsert, canRemove };
}

function cssEscape(value) {
  return globalThis.CSS?.escape ? CSS.escape(value) : value.replace(/["\\]/g, '\\$&');
}
