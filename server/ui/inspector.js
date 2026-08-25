/**
 * 서식 칸 — 오른쪽에 붙는 세로 판 (파워포인트의 "도형 서식"). 2026-08-25.
 *
 * ## 왜 뜨는 창이 아니라 칸인가
 *
 * 테마 창은 원래 버튼에 매달린 뜨는 창이었다. 뜨는 창은 정의상 무언가를 덮는데, 여기서
 * 덮이는 것이 하필 **그 색이 칠해지는 자리**였다 — 색을 보면서 고르라고 만든 미리보기를
 * 창이 가린 것이다. 오른쪽에 자리를 내주면 슬라이드는 좁아질 뿐 가려지지 않는다.
 *
 * 파워포인트가 서식을 오른쪽 판으로 옮긴 이유도 같다. 리본은 **무엇을 할지**를 고르는
 * 자리이고, 이 판은 **얼마나** 를 정하는 자리다. 색을 3 도 어둡게 하는 일은 리본의
 * 버튼 하나로 표현할 수 없다.
 *
 * ## 구획은 지금 고른 것을 따라간다
 *
 * "고른 것" 구획은 선택이 바뀔 때마다 다시 그려지고, 자유 배치가 아닌 요소에는 자리·크기
 * 칸을 아예 내지 않는다. 흐름 배치의 자리는 담는 상자가 정하므로(결정 3) 입력칸을 내면
 * 사용자는 고칠 수 있다고 읽고 서버는 422 를 낸다 — 크기 손잡이를 자유 배치에만 띄우는
 * 것과 같은 규율이다(`resize.js`).
 *
 * ## 숫자로도 옮길 수 있어야 한다
 *
 * 끌기는 빠르지만 정확하지 않다. 두 장의 그림을 같은 x 에 맞추는 일은 눈으로 못 하고,
 * 지금 이 편집기에는 정렬 안내선도 없다. 숫자 칸 넷이 그 자리를 메운다 — 끌기와 같은
 * 명령(`setPosition`)으로 나가므로 되돌리기도 같다.
 *
 * ## 열고 닫은 것은 기억한다
 *
 * 문서가 아니라 이 사람의 화면 습관이므로 파일이 아니라 `localStorage` 에 남는다
 * (리본 탭과 같다).
 */

const REMEMBER = 'weekly.inspector.open';

export function createInspector({ pane, button, stage, free, index, onNotice, onLayout }) {
  const body = document.createElement('div');
  body.className = 'pane-body';
  pane.append(body);

  /* 구획 셋. 접히지 않는다 — 셋뿐이라 접기가 더 성가시다. */
  const pick = section('고른 것');
  const geom = section('자리와 크기');
  const themeBox = section('리포트 테마');

  /** 지금 그려 둔 선택. 같은 것이면 다시 그리지 않는다 — 끄는 중에 입력칸이 리셋된다. */
  let drawn = null;
  let onTheme = null;

  button?.addEventListener('click', () => (pane.hidden ? open() : close()));
  // 만들 때는 **조용히** 연다. `onLayout` 을 여기서 부르면 아직 평가되지 않은 모듈
  // 윗줄을 건드리게 되고, 그 실패는 판 전체를 죽인다 (`ribbon.js` 에 같은 이야기).
  // 배선이 끝났다는 신호는 부른 쪽이 준다 — `start()`.
  if (remembered()) open(null, { quiet: true }); else close({ quiet: true });

  /* --------------------------------------------------------------- 열고 닫기 */

  function remembered() {
    try { return localStorage.getItem(REMEMBER) === '1'; } catch { return false; }
  }

  function open(which = null, { quiet = false } = {}) {
    pane.hidden = false;
    button?.setAttribute('aria-pressed', 'true');
    try { localStorage.setItem(REMEMBER, '1'); } catch { /* 기억 못 할 뿐이다 */ }
    if (!quiet) onTheme?.();
    // 판이 생기면 캔버스가 좁아진다. 맞춤 배율과 겹쳐 그린 테두리가 따라와야 한다.
    if (!quiet) onLayout?.();
    if (which) {
      const el = { theme: themeBox, geom, pick }[which];
      el?.box.scrollIntoView({ block: 'nearest' });
      el?.box.classList.add('flash');
      setTimeout(() => el?.box.classList.remove('flash'), 700);
    }
  }

  function close({ quiet = false } = {}) {
    pane.hidden = true;
    button?.setAttribute('aria-pressed', 'false');
    try { localStorage.setItem(REMEMBER, '0'); } catch { /* 기억 못 할 뿐이다 */ }
    if (!quiet) onLayout?.();
  }

  /** 배선이 다 끝났다는 신호. 열린 채로 시작했다면 그제서야 테마가 값을 읽는다. */
  function start() {
    if (pane.hidden) return;
    onTheme?.();
    onLayout?.();
  }

  /* ------------------------------------------------------------------ 구획 */

  function section(title) {
    const box = document.createElement('section');
    box.className = 'pane-sec';
    const h = document.createElement('h2');
    h.textContent = title;
    const inner = document.createElement('div');
    inner.className = 'pane-rows';
    box.append(h, inner);
    body.append(box);
    return { box, inner };
  }

  /* ------------------------------------------------------------- 고른 것 */

  /**
   * 선택이 바뀌었다. 이름을 쓰고, 자유 배치면 자리·크기 칸을 낸다.
   *
   * `label` 은 밖에서 받는다 — 어휘 값의 한국어 이름은 `select.js` 가 들고 있고,
   * 두 벌이 되면 같은 것이 두 이름으로 불리는 날이 온다.
   */
  function show(nodeId, label) {
    // 값이 같으면 손대지 않는다. 다시 그리면 사용자가 치고 있던 숫자가 날아간다.
    const key = `${nodeId}|${label}|${nodeId ? free.isFree(nodeId) : ''}`;
    if (key === drawn) return;
    drawn = key;

    if (!nodeId) {
      pick.inner.replaceChildren(note('아무것도 고르지 않았습니다 — 슬라이드에서 하나 누르세요'));
      geom.box.hidden = true;
      return;
    }

    pick.inner.replaceChildren(row('종류', strong(label)));

    if (!free.isFree(nodeId)) {
      geom.box.hidden = false;
      geom.inner.replaceChildren(note(
        '이 요소의 자리는 담는 상자가 정합니다. 배치 탭에서 자유 배치로 바꾸면 직접 정할 수 있습니다.',
      ));
      return;
    }

    geom.box.hidden = false;
    geom.inner.replaceChildren(...boxFields(nodeId));
  }

  /**
   * 자리·크기 네 칸.
   *
   * 슬라이드 좌표계의 정수 픽셀이다 — 화면에서 잰 픽셀이 아니다(`free.boxIn` 이 배율로
   * 나눠 준다). 그래서 창 크기를 바꿔도 같은 수가 보인다.
   */
  function boxFields(nodeId) {
    const el = free.elementOf(nodeId);
    const section_ = el?.closest('section');
    if (!el || !section_) return [note('이 요소를 화면에서 찾지 못했습니다')];

    const now = free.boxIn(section_, el);
    const fields = [['x', '가로 자리'], ['y', '세로 자리'], ['w', '너비'], ['h', '높이']];

    return fields.map(([key, name]) => {
      const input = document.createElement('input');
      input.type = 'number';
      input.value = String(now[key] ?? 0);
      input.dataset.key = key;
      // 끌기와 **같은 명령**으로 나간다. 되돌리기도 같은 한 번이다.
      input.addEventListener('change', async () => {
        const el2 = free.elementOf(nodeId);
        const sec = el2?.closest('section');
        if (!el2 || !sec) return;
        const next = { ...free.boxIn(sec, el2), [key]: Math.round(Number(input.value) || 0) };
        const ok = await free.place(nodeId, next, key === 'w' || key === 'h' ? '크기 바꾸기' : '자리 옮기기');
        if (!ok) input.value = String(free.boxIn(sec, el2)[key]);
        onLayout?.();
      });
      return row(name, input, 'px');
    });
  }

  /** 밖에서 값이 바뀌었다(끌기·크기 손잡이). 숫자 칸을 따라 맞춘다. */
  function refresh() {
    const nodeId = drawn?.split('|')[0];
    if (!nodeId || geom.box.hidden) return;
    const el = free.elementOf(nodeId);
    const sec = el?.closest('section');
    if (!el || !sec) return;
    const now = free.boxIn(sec, el);
    for (const input of geom.inner.querySelectorAll('input[data-key]')) {
      // 지금 치고 있는 칸은 건드리지 않는다.
      if (document.activeElement === input) continue;
      input.value = String(now[input.dataset.key] ?? 0);
    }
  }

  /* ------------------------------------------------------------------ 도구 */

  function row(name, control, unit) {
    const el = document.createElement('label');
    el.className = 'pane-row';
    const n = document.createElement('span');
    n.textContent = name;
    el.append(n, control);
    if (unit) {
      const u = document.createElement('span');
      u.className = 'unit';
      u.textContent = unit;
      el.append(u);
    }
    return el;
  }

  function note(text) {
    const p = document.createElement('p');
    p.className = 'pane-note';
    p.textContent = text;
    return p;
  }

  function strong(text) {
    const el = document.createElement('b');
    el.textContent = text;
    return el;
  }

  return {
    open,
    close,
    start,
    show,
    refresh,
    /** 테마 구획이 자리 잡을 곳. `createTheme` 가 여기에 그린다. */
    themeHost: themeBox.inner,
    /** 판이 열릴 때마다 테마가 지금 값을 다시 읽게 한다. */
    onOpen: (fn) => { onTheme = fn; },
    isOpen: () => !pane.hidden,
  };
}
