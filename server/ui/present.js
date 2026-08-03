/**
 * 발표 모드 — 결정 9.
 *
 * **만드는 것이 거의 없다.** 발표 기능은 덱의 `<deck-stage>` 에 이미 있다. 편집기가 그것을
 * 감춰 뒀을 뿐이다(M3-2 에서 내장 레일과 조작막대를 껐다). 되살리는 방법도 덱이 정해 두었다 —
 * 호스트가 `{__omelette_presenting: true}` 를 `postMessage` 로 보내면 덱이 조작 UI 를 전부
 * 접고 슬라이드만 남긴다.
 *
 * 그래서 이 파일이 하는 일은 셋뿐이다.
 *   1. 캔버스를 전체화면으로
 *   2. 덱에 "지금 발표 중" 이라고 알리기
 *   3. **우리 편집 표시를 감추기** — 선택 테두리가 화면에 같이 뜨면 그건 발표가 아니다
 *
 * 나가는 길은 브라우저가 준다(Esc). 우리가 따로 만들지 않는 이유 — 전체화면에서 나가는
 * 방법은 사용자가 이미 알고 있고, 두 개면 어느 쪽이 진짜인지 헷갈린다.
 */

export function createPresent({ stage, canvas, overlay, onEnter, onExit }) {
  let on = false;

  async function start() {
    if (on) return;
    onEnter?.();                       // 선택 해제 — 발표 화면에 테두리를 남기지 않는다
    overlay.hidden = true;

    try {
      await canvas.requestFullscreen();
    } catch {
      // 전체화면이 거부되는 자리(권한·정책)가 있다. 그래도 발표 모드로는 들어간다 —
      // 조작 UI 가 사라지는 것만으로도 화면이 깨끗해진다.
    }
    tell(true);
    on = true;
  }

  function stop() {
    if (!on) return;
    tell(false);
    overlay.hidden = false;
    on = false;
    onExit?.();
  }

  /** 덱에 알린다. 덱이 없거나 옛 덱이면 아무 일도 일어나지 않는다. */
  function tell(presenting) {
    stage.contentWindow?.postMessage({ __omelette_presenting: presenting }, '*');
  }

  // 전체화면에서 빠져나오는 길은 여러 개다(Esc·F11·창 전환). 어디로 나가든 한 곳에서 받는다.
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) stop();
  });

  return { start, stop, get active() { return on; } };
}
