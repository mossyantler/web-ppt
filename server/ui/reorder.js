/**
 * 순서 바꾸기 — 요소는 위·아래 버튼으로, 슬라이드는 레일에서 끌어서 (결정 3·6). M3-5.
 *
 * ## 자리는 좌표가 아니라 순번이다
 *
 * 우리 슬라이드는 머리·본문·꼬리로 나뉘고 그 안에서 요소가 위에서 아래로 쌓인다.
 * 그래서 옮기는 일은 "아무 데나 놓기" 가 아니라 **"몇 번째 자리에 끼우기"** 다
 * (자유 배치는 6 번 단계이고 이번이 아니다). 명령도 그 모양이다 —
 * `moveElement(target, { newParentId, index })`.
 *
 * ## 순번을 어디서 세는가 — 목차가 아니라 DOM 이다
 *
 * 서버는 **부모의 요소 자식**을 센다(`elementChildrenOf`). 이름표가 붙은 것만 세는 게
 * 아니다. 그래서 화면도 DOM 의 `children` 을 그대로 세야 한다 — 이름표 붙은 형제만
 * 세면 그 사이에 낀 장식 요소만큼 순번이 밀리고, **사용자가 고른 것과 다른 자리에 꽂힌다.**
 *
 * 부모도 목차에서 얻지 않는다. 목차는 이름표 없는 껍데기를 **건너뛰고** 그 안의 노드를
 * 위로 올린다 — 고르기에는 그게 맞지만(껍데기는 고를 것이 아니다) 옮기기에는 틀리다.
 * 실측 — 이름표를 갓 붙인 W31 의 문단들은 `<article>` 같은 이름표 없는 껍데기 안에 있고,
 * 목차만 보면 부모가 영역인데 진짜 부모는 그 껍데기다. 그 순번으로 명령을 만들면 엉뚱한
 * 자리에 꽂힌다.
 *
 * 그래서 **바로 위 DOM 부모에 이름표가 있을 때만 옮길 수 있다.** 없으면 명령이 그 부모를
 * 지목할 방법 자체가 없다 — 문법이 아직 그 껍데기를 모른다는 뜻이고, 그것은 잠금 사유다
 * (`outline` 의 `blockers`, M3-9).
 *
 * ## 옮긴 뒤에 무엇을 다시 받는가
 *
 * 요소 이동 — 아무것도 다시 받지 않는다. 화면의 DOM 을 서버가 한 것과 같게 옮기고
 * 지문만 갈아 끼운다 (재조정 정책의 델타 경로).
 * 슬라이드 이동 — 다시 받는다. `renumberPages` 가 자동으로 붙어 **문서 전 섹션**의
 * 페이지 번호를 건드리므로, 델타로 따라갈 수 있는 범위를 넘는다 (같은 정책의 예외 경로).
 */

export function createReorder({ stage, commit, index, onNotice, onMoved, onResync }) {
  /**
   * 고른 요소를 한 칸 위(-1) 또는 아래(+1)로.
   * @returns 옮겼으면 true
   */
  async function moveElement(nodeId, delta) {
    const spot = spotOf(nodeId, delta);
    if (!spot) return false;
    const { el, parent, siblings, to, parentId } = spot;

    const { ok } = await commit.send(
      [{ op: 'moveElement', target: nodeId, args: { newParentId: parentId, index: to } }],
      delta < 0 ? '위로 옮기기' : '아래로 옮기기',
    );
    if (!ok) return false;

    // 서버가 한 것과 같게 화면도 옮긴다. 다시 받지 않으므로 이 한 줄이 미러다.
    if (delta < 0) parent.insertBefore(el, siblings[to]);
    else parent.insertBefore(el, siblings[to].nextSibling);

    onNotice?.({ kind: 'saved', text: delta < 0 ? '위로 옮겼습니다' : '아래로 옮겼습니다' });
    onMoved?.();
    return true;
  }

  /** 이 요소를 위·아래로 옮길 수 있는가 — 버튼을 켜고 끄는 근거다. */
  const canMove = (nodeId, delta) => !!spotOf(nodeId, delta);

  /**
   * 옮길 자리 계산. 옮길 수 없으면 null 이고, 그 판정이 곧 버튼의 활성 여부다.
   *
   * 막는 경우 셋 — 부모에 이름표가 없다(명령이 지목할 수 없다) · 부모가 섹션이다
   * (영역은 자리가 정해진 슬롯이고 서버도 섹션을 새 부모로 받지 않는다) · 이미 끝이다.
   */
  function spotOf(nodeId, delta) {
    const doc = stage.contentDocument;
    const el = doc?.querySelector(`[data-node-id="${cssEscape(nodeId)}"]`);
    if (!el) return null;

    const parent = el.parentElement;
    const parentId = parent?.dataset?.nodeId;
    if (!parentId) return null;

    const info = index.get(parentId);
    if (!info || info.kind !== 'container') return null;

    const siblings = [...parent.children];
    const to = siblings.indexOf(el) + delta;
    if (to < 0 || to >= siblings.length) return null;

    return { el, parent, siblings, to, parentId };
  }

  /** 슬라이드 순서 바꾸기. 페이지 번호가 따라오므로 화면을 다시 받는다. */
  async function moveSection(sectionNodeId, toIndex, label) {
    const { ok } = await commit.send(
      [{ op: 'moveSection', target: sectionNodeId, args: { index: toIndex } }],
      label ?? '슬라이드 순서 바꾸기',
    );
    if (!ok) return false;
    onNotice?.({ kind: 'saved', text: '슬라이드 순서를 바꿨습니다' });
    onResync?.(toIndex);
    return true;
  }

  return { moveElement, canMove, moveSection };
}

function cssEscape(value) {
  return globalThis.CSS?.escape ? CSS.escape(value) : value.replace(/["\\]/g, '\\$&');
}
