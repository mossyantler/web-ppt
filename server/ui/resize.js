/**
 * 크기 조절 손잡이 — 자유 배치된 요소의 모서리를 끌어 크기를 바꾼다. 2026-08-25.
 *
 * ## 자유 배치 안에서만 뜬다
 *
 * 흐름 배치의 크기는 컨테이너가 정한다(결정 3). 거기에 손잡이를 띄우면 사용자는 끌 수
 * 있다고 읽는데 서버는 422 를 낸다 — `setPosition` 은 부모가 canvas 일 때만 유효하다
 * (§2.2). **할 수 없는 일에 손잡이를 그리지 않는다.**
 *
 * ## 손잡이는 부모 문서에 있다
 *
 * 슬라이드 DOM 에 넣으면 그것이 문서의 일부가 되어 저장된다. 선택 테두리와 같은 자리,
 * 같은 이유다 — 화면에만 있는 것은 화면에만 둔다.
 *
 * 그래서 포인터 좌표도 부모 문서 것이고, 슬라이드 좌표로 바꾸려면 **배율로 나눈다.**
 * `deck-stage` 가 창 크기에 맞춰 `scale` 하므로 화면에서 100px 끈 것이 슬라이드에서는
 * 100px 이 아니다.
 *
 * ## 끄는 동안 슬라이드를 바꾸지 않는다
 *
 * 움직이는 것은 테두리와 손잡이뿐이고, 슬라이드는 커밋이 성공한 뒤에 그 값으로 맞춘다
 * (`free.place`). 미리 바꿔 두면 거부됐을 때 화면과 파일이 갈라진다 — `drag.js`·
 * `opaque.js` 와 같은 규칙이다.
 */

/** 이보다 작게는 줄이지 않는다. 0 이 되면 다시 잡을 수 없다. */
const MIN = 16;

/** 여덟 방향. 이름의 n·s·e·w 가 그대로 어느 변을 미는지를 뜻한다. */
const SIDES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export function createResize({ stage, layer, free, onDone }) {
  const box = document.createElement('div');
  box.className = 'resize-box';
  box.hidden = true;
  layer.append(box);

  const grips = new Map();
  for (const side of SIDES) {
    const g = document.createElement('div');
    g.className = `resize-grip grip-${side}`;
    g.dataset.side = side;
    g.addEventListener('pointerdown', (e) => start(e, side));
    box.append(g);
    grips.set(side, g);
  }

  /** { nodeId, side, origin, scale, next } — 끌고 있는 손잡이 하나. */
  let live = null;
  /** 지금 손잡이를 띄운 요소. 없으면 null. */
  let shown = null;

  /* ------------------------------------------------------------------ 붙이기 */

  /**
   * 이 요소에 손잡이를 띄울지 정한다. 자유 배치가 아니면 걷는다.
   *
   * 선택이 바뀔 때마다 불린다 — 무엇이 골라졌는지는 선택 계층만 안다.
   */
  function sync(nodeId) {
    shown = nodeId && free.isFree(nodeId) ? nodeId : null;
    if (!shown) return void (box.hidden = true);
    box.hidden = false;
    place();
  }

  function place() {
    if (!shown) return;
    const el = free.elementOf(shown);
    if (!el?.isConnected) return void (box.hidden = true);

    const f = stage.getBoundingClientRect();
    const host = layer.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    box.style.transform = `translate(${f.left + r.left - host.left}px, ${f.top + r.top - host.top}px)`;
    box.style.width = `${r.width}px`;
    box.style.height = `${r.height}px`;
  }

  /* ------------------------------------------------------------------- 끌기 */

  function start(e, side) {
    if (e.button !== 0 || !shown) return;
    e.preventDefault();
    e.stopPropagation();

    const el = free.elementOf(shown);
    const section = el?.closest('section');
    if (!section) return;

    live = {
      nodeId: shown,
      side,
      origin: free.boxIn(section, el),
      scale: free.scaleOf(section),
      start: { x: e.clientX, y: e.clientY },
      next: null,
    };
    // 손잡이를 벗어나도 계속 받도록 붙잡는다. 실패해도(포인터가 이미 놓였거나 합성
    // 이벤트라 id 가 없을 때) 끌기 자체는 window 의 처리기로 이어지므로 죽이지 않는다.
    try {
      e.target.setPointerCapture?.(e.pointerId);
    } catch { /* 붙잡지 못했을 뿐이다 */ }
  }

  function move(e) {
    if (!live) return;
    const dx = (e.clientX - live.start.x) / live.scale;
    const dy = (e.clientY - live.start.y) / live.scale;
    live.next = resized(live.origin, live.side, dx, dy);

    // 테두리만 움직인다. 슬라이드는 커밋이 성공한 뒤에 맞춘다.
    const f = stage.getBoundingClientRect();
    const host = layer.getBoundingClientRect();
    const s = free.elementOf(live.nodeId).closest('section').getBoundingClientRect();
    box.style.transform = `translate(${f.left + s.left - host.left + live.next.x * live.scale}px, `
      + `${f.top + s.top - host.top + live.next.y * live.scale}px)`;
    box.style.width = `${live.next.w * live.scale}px`;
    box.style.height = `${live.next.h * live.scale}px`;
  }

  async function up() {
    const d = live;
    live = null;
    if (!d?.next) return;

    const same = ['x', 'y', 'w', 'h'].every((k) => Math.round(d.next[k]) === d.origin[k]);
    if (same) return void place();

    await free.place(d.nodeId, d.next, '크기 바꾸기');
    place();
    onDone?.();
  }

  /**
   * 미는 변에 따라 상자를 다시 계산한다.
   *
   * 왼쪽·위를 밀 때는 좌표도 함께 움직인다 — 폭만 줄이면 상자가 오른쪽으로 자란다.
   * 최소 크기에 닿으면 **그 변만** 멈추고 반대편은 자리를 지킨다.
   */
  function resized(o, side, dx, dy) {
    let { x, y, w, h } = o;
    if (side.includes('e')) w = Math.max(MIN, o.w + dx);
    if (side.includes('s')) h = Math.max(MIN, o.h + dy);
    if (side.includes('w')) {
      w = Math.max(MIN, o.w - dx);
      x = o.x + (o.w - w);
    }
    if (side.includes('n')) {
      h = Math.max(MIN, o.h - dy);
      y = o.y + (o.h - h);
    }
    return { x, y, w, h };
  }

  addEventListener('pointermove', move);
  addEventListener('pointerup', up);
  addEventListener('pointercancel', () => { live = null; place(); });

  /**
   * 슬라이드가 다시 그려지는 것을 iframe **안에서** 지켜본다.
   *
   * 밖에서 신호를 받아 다시 그리면 그 순간 iframe 은 아직 새 크기를 반영하기 전이라
   * 직전 배율의 값을 쓰게 된다 — `select.js`·`opaque.js`·`table.js` 가 같은 장치를 쓴다.
   */
  let watched = null;
  function watch(doc) {
    if (!doc || watched === doc) return;
    watched = doc;
    new doc.defaultView.ResizeObserver(() => place()).observe(doc.documentElement);
    doc.defaultView.addEventListener('scroll', () => place(), true);
  }

  return { sync, place, watch, active: () => !!live };
}
