/**
 * 자유 배치 — 아무 데나 끌어다 놓기 (로드맵 5단계). 2026-08-25.
 *
 * ## 저장 형식은 바뀌지 않았다
 *
 * 이 단계를 맨 뒤로 미뤄 둔 이유가 "저장 형식을 바꾸는 유일한 작업" 이라서였는데, **그게
 * 틀렸다.** 문법이 처음부터 자리를 비워 두고 있었다 —
 *
 *   §2.2 7번   `canvas` · 절대 좌표 레이어 · 인라인 기하 **여기서만** · `.free-layer`
 *   §5 규칙 5  인라인 `left`/`top`/`width`/`height` 는 canvas 의 자식만
 *   §2.2       `setPosition(id, {x,y,w,h})` 은 부모가 canvas 일 때만 유효, 아니면 422
 *
 * 서버의 `setPosition` 은 이미 구현돼 있고 테스트도 있었다. 없던 것은 **화면**과
 * `.free-layer` 의 CSS 둘뿐이다. 흐름 배치(결정 3)와 부딪히지도 않는다 — 둘은 형제로
 * 공존한다. 흐름은 컨테이너가, 자유는 canvas 가 정한다.
 *
 * ## 층은 슬라이드 전체를 덮는다
 *
 * 좌표의 원점이 **슬라이드의 왼쪽 위 모서리**다(여백 안쪽이 아니라). 원점이 여백에 걸려
 * 있으면 테마의 여백 값이 바뀌는 날 이미 놓인 것이 전부 움직인다.
 *
 * ## 옮길 때 요소가 뛰지 않는다
 *
 * 흐름에서 자유로 바꾸는 순간, 지금 화면에 보이는 그 자리의 좌표를 그대로 준다. 좌표
 * 없이 옮기면 요소가 (0,0) 으로 튀고, 사용자는 자기가 무엇을 잃었는지 모른다.
 *
 * ## 첫 하나는 커밋이 둘이다
 *
 * 층이 없는 장에서는 층을 먼저 만들어야 하는데, **그 층의 id 는 만들어 봐야 안다.** 한
 * 커밋 안의 명령들은 전부 같은 스냅샷을 보므로(`commit.js`) 뒤 명령이 앞 명령이 만든
 * 노드를 지목할 수 없다. 그래서 장마다 처음 한 번은 `[층 만들기]`, `[옮기고 자리 주기]`
 * 로 나뉜다. 두 번째부터는 한 커밋이다. 나뉜다는 사실을 사용자에게 말한다.
 *
 * ## 흐름으로 되돌리는 것은 명령 하나다
 *
 * 좌표를 지우는 일은 **서버가 한다** (`structure-commands.js` 의 `clearGeometry`).
 * 규칙 5 는 인라인 기하를 canvas 의 자식에게만 허용하므로, 좌표를 단 채 흐름 자리로
 * 나가면 그 문서는 게이트를 통과하지 못한다. 화면이 명령 둘로 치우게 두면 그중 하나가
 * 실패했을 때 문법 밖 상태가 남는다.
 */

/** 자유 배치 층의 어휘 값. 클래스(`.free-layer`)는 테마가 정한다. */
const CANVAS = 'canvas';

export function createFree({ stage, commit, index, onNotice, onResync }) {
  /* --------------------------------------------------------------- 물어보기 */

  const elementOf = (nodeId) => stage.contentDocument
    ?.querySelector(`[data-node-id="${cssEscape(nodeId)}"]`) ?? null;

  /** 이 요소가 자유 배치 안에 있는가 — 끌기가 어느 쪽인지 정하는 근거다. */
  function isFree(nodeId) {
    const parentId = elementOf(nodeId)?.parentElement?.dataset?.nodeId;
    return !!parentId && index.get(parentId)?.value === CANVAS;
  }

  /**
   * 이 요소를 자유 배치로 바꿀 수 있는가.
   *
   * 층 자신과 영역은 안 된다 — 둘 다 투명 컨테이너라 사용자가 옮기는 대상이 아니다
   * (§2.2). 이미 자유 배치인 것도 아니다.
   */
  function canFree(nodeId) {
    const info = index.get(nodeId);
    if (!info || info.value === CANVAS || info.value === 'region') return false;
    return !!elementOf(nodeId) && !isFree(nodeId);
  }

  /** 이 장의 자유 배치 층. 없으면 null. */
  function canvasIn(section) {
    for (const el of section?.querySelectorAll('[data-node-id]') ?? []) {
      if (index.get(el.dataset.nodeId)?.value === CANVAS) return el;
    }
    return null;
  }

  /* ------------------------------------------------------------ 흐름 → 자유 */

  async function toFree(nodeId) {
    const el = elementOf(nodeId);
    const section = el?.closest('section');
    if (!el || !section) return false;

    // **지금 보이는 자리**를 먼저 잰다. 옮긴 뒤에 재면 이미 늦다.
    const box = boxIn(section, el);

    let canvas = canvasIn(section);
    if (!canvas) {
      const sectionId = section.dataset.nodeId;
      if (!sectionId) {
        onNotice?.({ kind: 'blocked', text: '이 장은 이름표가 없어 자유 배치를 놓을 수 없습니다' });
        return false;
      }
      const { ok, body } = await commit.send([{
        op: 'insertElement',
        args: { parentId: sectionId, index: section.children.length, type: CANVAS, variant: 'default', slot: 'canvas' },
      }], '자유 배치 층 만들기');
      if (!ok) return false;

      onNotice?.({ kind: 'saved', text: '자유 배치 층을 만들었습니다 — 되돌리기가 두 번 걸립니다' });
      // 층의 id 는 서버가 발급했다. 화면을 다시 받아야 그 노드를 지목할 수 있다.
      await onResync?.(nodeId);
      return finish(nodeId, body?.nodeIds?.canvas ?? null, box);
    }
    return finish(nodeId, canvas.dataset.nodeId, box);
  }

  /**
   * 옮기기와 자리 주기는 **명령 하나**다.
   *
   * 둘로 나눌 수 없다 — `moveElement` 는 장을 통째로 재직렬화해 한 구간을 splice 하고,
   * `setPosition` 의 여는 태그 편집은 그 구간 **안**이다. 한 커밋에 같이 넣으면 "splice
   * 구간이 겹친다" 로 죽는다(실측). 그래서 자리를 `moveElement` 의 인자로 넘긴다.
   */
  async function finish(nodeId, canvasId, box) {
    if (!canvasId) return false;
    const { ok } = await commit.send([
      { op: 'moveElement', target: nodeId, args: { newParentId: canvasId, index: 0, position: box } },
    ], '자유 배치로');
    if (!ok) return false;

    onNotice?.({ kind: 'saved', text: '자유 배치가 됐습니다 — 끌어서 옮기고 모서리로 크기를 바꿉니다' });
    await onResync?.(nodeId);
    return true;
  }

  /* ------------------------------------------------------------ 자유 → 흐름 */

  /**
   * 층에서 꺼내 장의 본문으로 되돌린다.
   *
   * 좌표를 지우는 것은 서버가 한다 — 명령 하나로 끝나는 이유가 그것이고, 그래야 실패해도
   * 문법 밖 상태가 남지 않는다.
   */
  async function toFlow(nodeId) {
    const el = elementOf(nodeId);
    const section = el?.closest('section');
    const body = bodyOf(section);
    if (!body) {
      onNotice?.({ kind: 'blocked', text: '되돌려 놓을 자리를 찾지 못했습니다' });
      return false;
    }

    const { ok } = await commit.send([{
      op: 'moveElement',
      target: nodeId,
      args: { newParentId: body.dataset.nodeId, index: body.children.length },
    }], '흐름 배치로');
    if (!ok) return false;

    onNotice?.({ kind: 'saved', text: '흐름 배치로 돌아왔습니다 — 다시 위에서 아래로 쌓입니다' });
    await onResync?.(nodeId);
    return true;
  }

  /** 되돌려 놓을 자리 — 이 장의 본문 영역. 없으면 이름표 붙은 아무 컨테이너나. */
  function bodyOf(section) {
    for (const el of section?.querySelectorAll('[data-node-id]') ?? []) {
      const info = index.get(el.dataset.nodeId);
      if (info?.value === 'region' && el.dataset.region === 'body') return el;
    }
    for (const el of section?.querySelectorAll('[data-node-id]') ?? []) {
      const info = index.get(el.dataset.nodeId);
      if (info?.kind === 'container' && info.value !== CANVAS) return el;
    }
    return null;
  }

  /* --------------------------------------------------------------- 옮기기 */

  /**
   * 끌어 놓은 자리. 슬라이드 좌표계의 정수 픽셀로 보낸다.
   *
   * **커밋이 성공한 뒤에 화면을 같은 값으로 맞춘다.** 미리 옮겨 두면 거부됐을 때 화면과
   * 파일이 갈라지고, 안 맞추면 파일에는 새 자리인데 화면은 옛 자리에 남는다(실측 —
   * 끌어 놓으면 저장은 되는데 요소가 도로 튀어 돌아왔다).
   *
   * 다시 받지 않는 이유 — 한 번 끌 때마다 슬라이드를 새로 읽으면 끌기가 끊긴다. 여기서
   * 맞추는 것은 방금 서버에 보낸 그 수 그대로이고, 테마의 마크업을 흉내내는 것이 아니다.
   */
  async function place(nodeId, box, label = '자리 옮기기') {
    const patch = round(box);
    const { ok } = await commit.send([{ op: 'setPosition', target: nodeId, args: patch }], label);
    if (!ok) return false;

    const el = elementOf(nodeId);
    for (const [key, prop] of [['x', 'left'], ['y', 'top'], ['w', 'width'], ['h', 'height']]) {
      if (patch[key] !== undefined) el?.style.setProperty(prop, `${patch[key]}px`);
    }
    onNotice?.({ kind: 'saved', text: label === '크기 바꾸기' ? '크기를 바꿨습니다' : '자리를 옮겼습니다' });
    return true;
  }

  /* ------------------------------------------------------------------ 좌표 */

  /**
   * 슬라이드 좌표계에서의 상자.
   *
   * 슬라이드는 배율이 걸려 있다(`deck-stage` 가 창 크기에 맞춰 `scale` 한다). 화면에서 잰
   * 픽셀을 그대로 쓰면 창 크기에 따라 다른 좌표가 저장된다. **장의 실제 폭(`offsetWidth`)과
   * 화면에 그려진 폭의 비**로 되돌린다 — 그 비가 곧 배율이다.
   */
  function boxIn(section, el) {
    const k = scaleOf(section);
    const s = section.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return round({
      x: (r.left - s.left) / k,
      y: (r.top - s.top) / k,
      w: r.width / k,
      h: r.height / k,
    });
  }

  /** 화면에 그려진 크기 ÷ 실제 크기. 1 이면 배율이 없는 것이다. */
  function scaleOf(section) {
    const drawn = section.getBoundingClientRect().width;
    const real = section.offsetWidth;
    return real > 0 && drawn > 0 ? drawn / real : 1;
  }

  const round = (b) => Object.fromEntries(
    Object.entries(b).filter(([, v]) => Number.isFinite(v)).map(([k, v]) => [k, Math.round(v)]),
  );

  return { isFree, canFree, canvasIn, toFree, toFlow, place, boxIn, scaleOf, elementOf };
}

function cssEscape(value) {
  return globalThis.CSS?.escape ? CSS.escape(value) : value.replace(/["\\]/g, '\\$&');
}
