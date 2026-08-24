/**
 * 캔버스 배율 — 슬라이드를 얼마나 크게 볼 것인가.
 *
 * **덱이 이미 배율을 갖고 있다.** `deck-stage` 는 자기 창(iframe)의 크기를 재서
 * `scale()` 로 슬라이드를 맞춘다(`deck-stage.js` 의 `_fit`). 그래서 이 파일은 배율을
 * 새로 만들지 않는다 — **iframe 의 크기만 정한다.** 크기를 정하면 배율은 덱이 따라온다.
 *
 * 이 선택이 값진 이유는 좌표에 있다. 편집기는 슬라이드 위에 테두리와 이름표를 겹쳐
 * 그리고, 그 자리는 `getBoundingClientRect` 로 잰다. 우리가 iframe 에 `scale()` 을
 * 직접 걸면 iframe **안**의 좌표는 배율을 모르는 채로 남아, 네 파일에 흩어진 좌표 계산을
 * 전부 배율만큼 곱해 고쳐야 한다. iframe 의 크기를 바꾸면 그런 일이 없다 —
 * 덱이 안에서 줄여 그리므로 잰 값이 이미 화면에 보이는 크기다.
 *
 * 두 가지 상태로 움직인다.
 *   - `fit`    창에 맞춤. 기본값이고, 창 크기가 바뀌면 따라 바뀐다
 *   - `manual` 사용자가 고른 배율. 창을 줄여도 그대로 있고 넘치면 스크롤이 생긴다
 */

/** 파워포인트가 쓰는 단계와 같게. 두 배씩 뛰면 원하는 크기를 지나친다. */
const STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2];

const MIN = STEPS[0];
const MAX = STEPS[STEPS.length - 1];

export function createViewport({ canvas, stage, onChange }) {
  // 슬라이드 원래 크기. 덱이 뜨면 덱이 적어 둔 값으로 바뀐다.
  let design = { width: 1280, height: 720 };
  let mode = 'fit';
  let zoom = 1;

  /**
   * 덱이 뜬 뒤 원래 크기를 받아 온다. 1280×720 을 상수로 박지 않는 이유 —
   * 덱마다 `<deck-stage width= height=>` 로 자기 크기를 적어 두고, 언젠가 4K 덱이 온다.
   */
  function adoptDesign(doc) {
    const el = doc?.querySelector('deck-stage');
    const w = Number(el?.getAttribute('width'));
    const h = Number(el?.getAttribute('height'));
    if (w > 0 && h > 0) design = { width: w, height: h };
    apply();
  }

  /** 캔버스에서 슬라이드가 실제로 쓸 수 있는 안쪽 크기. 여백은 빼고 잰다. */
  function room() {
    const cs = getComputedStyle(canvas);
    const px = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const py = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    return {
      width: Math.max(0, canvas.clientWidth - px),
      height: Math.max(0, canvas.clientHeight - py),
    };
  }

  /** 창에 꽉 차게 들어가는 배율. 가로·세로 중 작은 쪽이 이긴다 — 넘치면 잘린다. */
  function fitZoom() {
    const r = room();
    if (!r.width || !r.height) return zoom;
    return Math.min(r.width / design.width, r.height / design.height);
  }

  function apply() {
    const z = mode === 'fit' ? fitZoom() : zoom;
    zoom = z;
    canvas.style.setProperty('--stage-w', `${Math.round(design.width * z)}px`);
    canvas.style.setProperty('--stage-h', `${Math.round(design.height * z)}px`);
    // 끝에 닿았는지 함께 알린다 — 눌러도 아무 일이 없는 버튼은 고장으로 보인다.
    // 꺼진 버튼은 "여기가 끝" 이라는 뜻이고, 그 말은 버튼만 할 수 있다.
    onChange?.({ zoom: z, mode, atMin: z <= MIN + 0.001, atMax: z >= MAX - 0.001 });
  }

  function fit() {
    mode = 'fit';
    apply();
  }

  function set(z) {
    mode = 'manual';
    zoom = Math.min(MAX, Math.max(MIN, z));
    apply();
  }

  /**
   * 한 단계 위·아래로. 지금이 맞춤 배율이면 단계 사이의 어중간한 값이므로,
   * 그 값을 넘어서는 첫 단계로 간다 — 그러지 않으면 한 번 눌러도 크기가 안 변한다.
   */
  function step(dir) {
    const z = zoom;
    const next = dir > 0
      ? STEPS.find((s) => s > z + 0.001)
      : [...STEPS].reverse().find((s) => s < z - 0.001);
    set(next ?? (dir > 0 ? MAX : MIN));
  }

  /** 1:1. 슬라이드가 인쇄될 크기 그대로 본다. */
  function actual() {
    set(1);
  }

  // 창 크기가 바뀌면 맞춤 배율도 바뀐다. 레일을 접거나 펴는 것도 여기로 들어온다 —
  // `resize` 이벤트만 듣고 있으면 창은 그대로인데 캔버스만 좁아지는 경우를 놓친다.
  const ro = new ResizeObserver(() => { if (mode === 'fit') apply(); });
  ro.observe(canvas);

  // 확대해서 스크롤이 생기면 슬라이드가 화면 안에서 움직인다. 겹쳐 그린 테두리는
  // 따라오지 않으므로 여기서 다시 그리라고 알린다.
  canvas.addEventListener('scroll', () => onChange?.({ zoom, mode, scrolled: true }), { passive: true });

  return {
    adoptDesign,
    fit,
    set,
    step,
    actual,
    apply,
    get zoom() { return zoom; },
    get mode() { return mode; },
  };
}
