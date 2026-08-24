/**
 * 캔버스에서 요소 끌어 옮기기 (결정 3 — 드래그가 기본, 버튼은 잡기 어려운 것용). M3-5b.
 *
 * ## 끄는 것은 그림자이지 요소가 아니다
 *
 * 끄는 동안 슬라이드 DOM 은 건드리지 않는다. 움직이는 것은 부모 문서에 그린 반투명
 * 상자와 **들어갈 자리를 보이는 선** 둘뿐이고, 슬라이드는 놓는 순간 서버가 옮겨 준
 * 결과로만 바뀐다. 끌면서 미리 옮겨 두면 커밋이 거부됐을 때 화면과 파일이 갈라진다.
 *
 * ## 어디에 놓을 수 있는가
 *
 * **같은 부모 안에서만** 옮긴다. 다른 상자로 옮기는 것은 `moveElement` 가 할 수 있지만
 * (`newParentId`), 이번 범위가 아니다 — 부모가 바뀌면 어휘가 허용하는 자식인지부터
 * 물어야 하고, 그 판정은 아직 화면에 없다. 형제 사이의 자리만 고른다.
 *
 * HTML5 끌기(`draggable`)를 쓰지 않는 이유 — iframe 경계를 넘는 드래그 이미지와
 * `dragover` 좌표가 브라우저마다 다르게 흔들린다. 포인터 이벤트는 좌표가 하나뿐이다.
 *
 * ## 자유 배치 안에서는 자리를 고르지 않는다 (2026-08-25)
 *
 * 부모가 `data-box="canvas"` 면 형제 사이의 **틈**이 아니라 **좌표**를 고른다. 끄는 방식은
 * 같고(그림자만 움직인다) 놓을 때 나가는 명령이 `moveElement` 대신 `setPosition` 이다.
 * 두 벌로 만들지 않은 이유 — 임계값·클릭 삼키기·미리 안 옮기기가 둘 다 똑같고, 그 셋이
 * 이 파일이 존재하는 이유의 전부다.
 */

/** 이만큼 움직이기 전에는 끌기가 아니라 클릭이다. 클릭이 끌기로 오인되면 선택이 안 된다. */
const THRESHOLD = 4;

export function createDrag({ stage, layer, actions, free, onPick, onDrop }) {
  const ghost = make('drag-ghost');
  const line = make('drag-line');
  layer.append(ghost, line);

  let drag = null;      // { el, parent, siblings, from, to }
  let swallow = false;  // 끌기 뒤에 따라오는 click 한 번을 삼킨다

  /**
   * **선택 계층보다 먼저 붙어야 한다.** 끌기가 끝나면 브라우저가 click 을 마저 보내는데,
   * 그것이 선택 계층에 닿으면 방금 끌어 놓은 요소가 "또 눌린 것" 이 되어 글자 편집이 열린다.
   */
  function bind(doc) {
    doc.addEventListener('click', swallowClick, true);
    doc.addEventListener('pointerdown', onDown, true);
    doc.addEventListener('pointermove', onMove, true);
    doc.addEventListener('pointerup', onUp, true);
    doc.addEventListener('pointercancel', cancel, true);
  }

  function swallowClick(e) {
    if (!swallow) return;
    swallow = false;
    e.stopPropagation();
    e.preventDefault();
  }

  function onDown(e) {
    if (e.button !== 0) return;
    const el = e.target.closest?.('[data-node-id]');
    if (!el) return;

    // 글자를 고치는 중인 상자 안에서는 끌기가 아니라 글자 선택이다.
    if (onPick?.(el) === false) return;

    const parent = el.parentElement;
    if (!parent?.dataset?.nodeId) return;

    // 자유 배치 안이면 자리가 아니라 좌표를 고른다. 형제와 무관하므로 `canMove` 도 묻지
    // 않는다 — 층에 하나뿐인 요소도 옮길 수 있어야 한다.
    if (free?.isFree(el.dataset.nodeId)) {
      const section = el.closest('section');
      drag = {
        el,
        parent,
        free: true,
        section,
        origin: free.boxIn(section, el),
        scale: free.scaleOf(section),
        start: { x: e.clientX, y: e.clientY },
        live: false,
      };
      return;
    }

    if (!actions.canMove(el.dataset.nodeId, -1) && !actions.canMove(el.dataset.nodeId, +1)) return;

    const siblings = [...parent.children];
    drag = {
      el,
      parent,
      siblings,
      from: siblings.indexOf(el),
      to: null,
      start: { x: e.clientX, y: e.clientY },
      // 가로로 놓인 형제(격자·가로 묶음)는 좌우로 끈다. 세로 기준으로만 재면
      // 한 줄에 나란한 카드들이 전부 같은 자리로 판정된다.
      axis: axisOf(siblings),
      live: false,
    };
  }

  function onMove(e) {
    if (!drag) return;
    if (!drag.live) {
      if (Math.hypot(e.clientX - drag.start.x, e.clientY - drag.start.y) < THRESHOLD) return;
      drag.live = true;
      showGhost(drag.el);
    }
    // 끌기가 시작되면 글자 선택(파란 칠)이 따라붙는다. 그것부터 막는다.
    e.preventDefault();

    if (drag.free) {
      // 그림자만 움직인다. 슬라이드는 놓는 순간 서버가 준 결과로만 바뀐다.
      drag.moved = {
        x: drag.origin.x + (e.clientX - drag.start.x) / drag.scale,
        y: drag.origin.y + (e.clientY - drag.start.y) / drag.scale,
      };
      ghost.style.transform = ghostAt(drag);
      return;
    }

    drag.to = slotAt(drag.axis === 'x' ? e.clientX : e.clientY);
    showLine(drag);
  }

  /** 끄는 동안의 그림자 자리 — 원래 자리에 화면 위 이동량을 더한 값이다. */
  function ghostAt(d) {
    const host = layer.getBoundingClientRect();
    const r = d.el.getBoundingClientRect();
    const f = stage.getBoundingClientRect();
    return `translate(${f.left + r.left - host.left + (d.moved.x - d.origin.x) * d.scale}px, `
      + `${f.top + r.top - host.top + (d.moved.y - d.origin.y) * d.scale}px)`;
  }

  async function onUp() {
    const d = drag;
    drag = null;
    if (!d?.live) return;
    hide();
    swallow = true;

    if (d.free) {
      // 제자리에 도로 놓았다. 명령을 보내면 빈 커밋이 되고 되돌리기 한 칸만 먹는다.
      if (!d.moved || (Math.round(d.moved.x) === d.origin.x && Math.round(d.moved.y) === d.origin.y)) {
        return void onDrop?.(false);
      }
      const placed = await free.place(d.el.dataset.nodeId, { x: d.moved.x, y: d.moved.y });
      return void onDrop?.(placed);
    }

    // 자기 자리에 도로 놓았다. 명령을 보내면 빈 커밋이 되고 되돌리기 한 칸만 먹는다.
    if (d.to === null || d.to === d.from || d.to === d.from + 1) return void onDrop?.(false);

    // 뗀 뒤의 자리로 센다 — 서버의 `insertAtElementIndex` 와 같은 셈법이다.
    const index = d.to > d.from ? d.to - 1 : d.to;
    const moved = await actions.moveTo(d.el.dataset.nodeId, index);
    onDrop?.(moved);
  }

  function cancel() {
    drag = null;
    hide();
  }

  /** 포인터가 형제들 사이 **몇 번째 틈**에 있는가. */
  function slotAt(pos) {
    const mids = drag.siblings.map((el) => {
      const r = el.getBoundingClientRect();
      return drag.axis === 'x' ? r.left + r.width / 2 : r.top + r.height / 2;
    });
    let slot = 0;
    while (slot < mids.length && pos > mids[slot]) slot += 1;
    return slot;
  }

  /** 형제들이 가로로 놓였는가 — 첫 둘의 윗변이 거의 같으면 가로줄이다. */
  function axisOf(siblings) {
    if (siblings.length < 2) return 'y';
    const [a, b] = siblings.map((el) => el.getBoundingClientRect());
    return Math.abs(a.top - b.top) < Math.min(a.height, b.height) / 2 ? 'x' : 'y';
  }

  /* ------------------------------------------------------------------ 그리기 */

  function showGhost(el) {
    const r = rectOf(el);
    ghost.hidden = false;
    ghost.style.transform = `translate(${r.x}px, ${r.y}px)`;
    ghost.style.width = `${r.width}px`;
    ghost.style.height = `${r.height}px`;
  }

  /** 들어갈 자리에 선을 긋는다. 흐름 배치에서는 이 선이 결과의 전부다. */
  function showLine(d) {
    const at = d.siblings[d.to];
    const anchor = at ?? d.siblings[d.siblings.length - 1];
    const r = rectOf(anchor);
    const end = !at;   // 마지막 자리면 그 형제의 뒤에 긋는다
    line.hidden = false;
    line.classList.toggle('vertical', d.axis === 'x');
    if (d.axis === 'x') {
      line.style.transform = `translate(${end ? r.x + r.width : r.x}px, ${r.y}px)`;
      line.style.height = `${r.height}px`;
      line.style.width = '';
    } else {
      line.style.transform = `translate(${r.x}px, ${end ? r.y + r.height : r.y}px)`;
      line.style.width = `${r.width}px`;
      line.style.height = '';
    }
  }

  function hide() {
    ghost.hidden = true;
    line.hidden = true;
  }

  /** iframe 안 좌표를 부모 문서의 겹침 층 좌표로. `select.js` 와 같은 셈이다. */
  function rectOf(el) {
    const r = el.getBoundingClientRect();
    const f = stage.getBoundingClientRect();
    const host = layer.getBoundingClientRect();
    return { x: f.left + r.left - host.left, y: f.top + r.top - host.top, width: r.width, height: r.height };
  }

  return { bind, cancel };
}

function make(className) {
  const el = document.createElement('div');
  el.className = className;
  el.hidden = true;
  return el;
}
