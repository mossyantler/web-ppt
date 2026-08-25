/**
 * 오른쪽 단추 메뉴 — 지금 가리킨 것에 걸리는 명령들. 2026-08-25.
 *
 * ## 왜 늘 떠 있는 버튼을 걷어내는가
 *
 * 레일 항목마다 버튼 넷을 마우스 올릴 때만 띄우고 있었다. 그 방식의 문제는 **버튼이
 * 그림을 가린다**는 것이다 — 장을 글자로 적던 시절에는 오른쪽 끝이 빈자리였지만, 이제
 * 거기에 슬라이드가 있다. 파워포인트가 같은 자리에 버튼을 두지 않고 오른쪽 단추로
 * 미루는 이유도 그것이다.
 *
 * 그리고 넷은 시작이다. 장에 걸 수 있는 명령은 계속 는다(건너뛰기·배경·복사…). 버튼을
 * 늘리면 그림이 사라지고, 메뉴는 줄이 하나 늘 뿐이다.
 *
 * ## 손이 셋이다
 *
 * 오른쪽 단추 · 길게 누르기 · 글쇠. 셋 다 같은 메뉴를 열고 같은 명령을 부른다 —
 * 마우스가 없는 사람, 오른쪽 단추를 모르는 사람, 손이 빠른 사람이 각자의 길로 같은 곳에
 * 닿아야 한다. 끌어서 순서 바꾸기는 이미 있고 그대로 둔다.
 *
 * ## 메뉴는 문서에 붙는다
 *
 * 겹침 층(`#overlay`)은 슬라이드 위에 그리는 자리이고 캔버스 안쪽에서 잘린다. 메뉴는
 * 레일에서도 열리므로 화면 좌표를 그대로 쓴다 (테마 창이 같은 이유로 옮겨 갔다).
 */

import { icon } from './icons.js';

/** 화면 가장자리에서 이만큼은 떨어진다. 붙어 뜨면 마지막 줄이 잘린다. */
const EDGE = 8;

export function createMenu() {
  let el = null;
  let onShut = null;

  /**
   * @param x,y  화면 좌표 (오른쪽 단추를 누른 자리)
   * @param rows [{ label, name, run, on, danger }] · `null` 은 구분선
   */
  function open(x, y, rows) {
    close();
    el = document.createElement('div');
    el.className = 'ctx-menu';
    el.setAttribute('role', 'menu');

    for (const row of rows) {
      if (!row) {
        const hr = document.createElement('hr');
        el.append(hr);
        continue;
      }
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      // **할 수 없는 줄은 지우지 않고 끈다.** 지우면 메뉴의 줄 수가 매번 달라져서 같은
      // 명령이 매번 다른 자리에 오고, 그러면 손이 자리를 외울 수 없다.
      b.disabled = row.on === false;
      if (row.danger) b.className = 'danger';
      if (row.name) b.append(icon(row.name));
      const text = document.createElement('span');
      text.textContent = row.label;
      b.append(text);
      if (row.hint) {
        const hint = document.createElement('kbd');
        hint.textContent = row.hint;
        b.append(hint);
      }
      b.addEventListener('click', () => { close(); row.run?.(); });
      el.append(b);
    }

    document.body.append(el);
    place(x, y);
    // 첫 줄에 초점을 준다 — 글쇠로 연 사람이 곧바로 ↓ 로 훑을 수 있어야 한다.
    el.querySelector('button:not(:disabled)')?.focus();

    // 이 누르기가 그대로 닫기로 이어지지 않게 한 박자 뒤에 건다.
    setTimeout(() => {
      addEventListener('pointerdown', maybeShut, true);
      addEventListener('keydown', onKey, true);
      addEventListener('resize', close);
      addEventListener('wheel', close, { passive: true });
    });
  }

  /**
   * 눌린 자리에 편다. 오른쪽·아래로 넘치면 안으로 당긴다.
   *
   * 파워포인트처럼 "왼쪽 위 모서리가 커서" 를 기본으로 삼되, 넘칠 때만 뒤집는 대신
   * 당긴다 — 뒤집으면 메뉴가 커서 위로 올라와서 방금 누른 자리를 덮는다.
   */
  function place(x, y) {
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    el.style.left = `${Math.max(EDGE, Math.min(x, innerWidth - w - EDGE))}px`;
    el.style.top = `${Math.max(EDGE, Math.min(y, innerHeight - h - EDGE))}px`;
  }

  function maybeShut(e) {
    if (el?.contains(e.target)) return;
    close();
  }

  function onKey(e) {
    if (e.key === 'Escape') return close();
    const items = [...el.querySelectorAll('button:not(:disabled)')];
    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (!step || !items.length) return;
    e.preventDefault();
    const i = items.indexOf(document.activeElement);
    items[(i + step + items.length) % items.length].focus();
  }

  function close() {
    if (!el) return;
    el.remove();
    el = null;
    removeEventListener('pointerdown', maybeShut, true);
    removeEventListener('keydown', onKey, true);
    removeEventListener('resize', close);
    removeEventListener('wheel', close);
    onShut?.();
    onShut = null;
  }

  /**
   * 길게 누르기로도 열린다 (손가락·펜).
   *
   * 오른쪽 단추가 없는 입력에서 이것이 유일한 길이다. 손이 조금 흔들리는 것은 봐 주되
   * (`SLOP`) 끌기가 시작되면 메뉴를 포기한다 — 끌기는 순서 바꾸기이고, 그 둘이 겹치면
   * 옮기려다 메뉴가 뜬다.
   */
  function longPress(host, rowsFor) {
    const SLOP = 10;
    const HOLD = 500;
    let timer = null;
    let from = null;

    host.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      const rows = rowsFor(e);
      if (!rows) return;
      from = { x: e.clientX, y: e.clientY };
      timer = setTimeout(() => {
        timer = null;
        open(e.clientX, e.clientY, rows);
      }, HOLD);
    });

    const give = (e) => {
      if (!timer) return;
      if (e && from && Math.hypot(e.clientX - from.x, e.clientY - from.y) < SLOP) return;
      clearTimeout(timer);
      timer = null;
    };
    host.addEventListener('pointermove', give);
    host.addEventListener('pointerup', () => give());
    host.addEventListener('pointercancel', () => give());
  }

  return { open, close, longPress, active: () => !!el };
}
