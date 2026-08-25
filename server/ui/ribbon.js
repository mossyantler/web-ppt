/**
 * 리본 — 탭으로 나눈 도구 모음 (파워포인트식). 2026-08-25.
 *
 * ## 예전 판단을 뒤집은 자리다
 *
 * 도구 모음 머리말에 이렇게 적혀 있었다 — "파워포인트의 리본은 따라가지 않는다. 리본은
 * 명령이 200 개일 때 자리값을 하고, 여기는 여섯 개다." 그때는 맞는 말이었다. 지금은
 * 서버에 등록된 명령이 스물셋이고 화면이 부르는 것만 열댓이다. 한 줄에 늘어놓으면
 * 창이 좁아질 때 오른쪽부터 잘려 나가고, 잘린 버튼은 **없는 기능과 구별되지 않는다.**
 *
 * ## 리본이 하는 일은 배치가 아니라 짝짓기다
 *
 * 탭과 묶음 이름이 없으면 "밝게·어둡게·모든 장에" 와 "되돌리기·다시하기" 가 똑같은
 * 간격으로 나란히 서고, 그러면 무엇이 무엇의 짝인지 눈으로 잡히지 않는다. 묶음마다
 * 아래에 이름을 다는 것이 파워포인트의 진짜 발명이다 — 아이콘은 하나하나가 무엇인지는
 * 말해도 "이 넷이 한 벌" 이라는 사실은 말하지 못한다.
 *
 * ## 꺼진 버튼은 말을 한다
 *
 * 고른 것이 없으면 요소 묶음이 통째로 꺼진다. 감추지 않는 이유 — 감추면 리본의 폭이
 * 매번 달라져서 같은 버튼이 매번 다른 자리에 있게 되고, 그러면 손이 자리를 기억할 수
 * 없다. 꺼진 회색 버튼은 "먼저 무언가를 고르세요" 라는 말을 자리를 지키면서 한다.
 *
 * ## 탭은 기억된다
 *
 * 배치 탭에서 일하다 리포트를 다시 받으면 홈으로 튀어 돌아가는 것은 일을 끊는다.
 * 고른 탭은 `localStorage` 에 남는다 — 문서가 아니라 이 사람의 화면 습관이므로 파일에
 * 쓰지 않는다.
 */

const REMEMBER = 'weekly.ribbon.tab';

export function createRibbon({ tabs, ribbon, onTab }) {
  const buttons = [...tabs.querySelectorAll('[data-tab]')];
  const panels = [...ribbon.querySelectorAll('.rb-panel')];

  for (const b of buttons) {
    b.addEventListener('click', () => show(b.dataset.tab));
    // ←/→ 로 탭 사이를 옮긴다. 마우스 없이도 리본을 다 쓸 수 있어야 한다.
    b.addEventListener('keydown', (e) => {
      const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      const i = buttons.indexOf(b);
      const next = buttons[(i + step + buttons.length) % buttons.length];
      next.focus();
      show(next.dataset.tab);
    });
  }

  // 만들 때는 **조용히** 연다. `onTab` 을 여기서 부르면 아직 평가되지 않은 모듈 윗줄의
  // `let`/`const` 를 건드리게 되고(실측 — "Cannot access 'insertFilled' before
  // initialization"), 그 실패는 리본 전체를 죽인다. 부를 준비가 됐는지는 부른 쪽이
  // 안다 — `start()` 로 알려 준다.
  show(remembered(), { quiet: true });

  function remembered() {
    try {
      const saved = localStorage.getItem(REMEMBER);
      if (saved && buttons.some((b) => b.dataset.tab === saved)) return saved;
    } catch { /* 사생활 보호 모드 등. 기본 탭으로 여는 것이 최악이다 */ }
    return buttons[0]?.dataset.tab;
  }

  function show(name, { quiet = false } = {}) {
    for (const b of buttons) b.setAttribute('aria-selected', String(b.dataset.tab === name));
    for (const p of panels) p.hidden = p.dataset.tab !== name;
    try { localStorage.setItem(REMEMBER, name); } catch { /* 기억 못 할 뿐이다 */ }
    if (!quiet) onTab?.(name);
  }

  /** 배선이 다 끝났다는 신호. 처음 열린 탭에 대해 그제서야 `onTab` 을 부른다. */
  const start = () => onTab?.(current());
  const current = () => buttons.find((b) => b.getAttribute('aria-selected') === 'true')?.dataset.tab;

  /**
   * 지금 무엇을 할 수 있는지에 맞춰 버튼을 켜고 끈다.
   *
   * **판정을 여기서 하지 않는다.** `can` 은 호출한 쪽이 준다 — 옮길 수 있는지·지울 수
   * 있는지는 목차와 DOM 을 함께 봐야 아는 것이고, 그 앎이 리본으로 복제되면 리본이
   * 켜 놓은 버튼을 눌렀는데 서버가 422 를 내는 날이 온다.
   */
  function sync(can) {
    for (const [id, on] of Object.entries(can)) {
      const el = ribbon.querySelector(`#${CSS.escape(id)}`);
      if (el) el.disabled = !on;
    }
    // 묶음 전체가 죽었으면 이름까지 흐리게 — 버튼 넷이 회색인데 이름만 또렷하면
    // 눈이 그 묶음을 계속 후보로 잡는다.
    for (const group of ribbon.querySelectorAll('.rb-group[data-needs]')) {
      const live = [...group.querySelectorAll('button, label')].some((b) => !b.disabled);
      group.classList.toggle('dead', !live);
    }
  }

  return { show, sync, start, current };
}
