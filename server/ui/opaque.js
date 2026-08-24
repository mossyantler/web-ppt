/**
 * 수식과 진행바 고치기 (결정 8). M3-8.
 *
 * 이 둘은 **트리에게만 불투명**하다. 겉모습은 기계가 그리므로 글자를 직접 고칠 수
 * 없지만, 진짜 고칠 것은 각각 문자열 하나와 0~100 숫자 하나뿐이다. 그래서 사용자에게는
 * **다른 어떤 요소보다 쉬워야 한다** — W31 한 편에 수식이 53 군데 들어갔고, 자주 하는
 * 일이 어려우면 편집기를 쓰지 않는다.
 *
 *   수식    두 번 클릭 → 그 자리에 입력칸, 고치는 동안 아래에 그려진 모양이 실시간으로
 *   진행바  막대 끝을 끌어 대충 맞추고, 옆의 숫자로 정확히 넣는다
 *
 * ## 미리보기는 부모 문서에서 그린다
 *
 * 슬라이드 안에도 KaTeX 가 있지만 그것은 iframe 안이다. 입력칸 **바로 아래**에 붙이려면
 * 편집기 쪽에서 그려야 하고, 그래서 편집기 화면도 KaTeX 를 따로 받는다.
 *
 * ## 화면을 먼저 바꾸지 않는다
 *
 * 끌거나 타이핑하는 동안 바뀌는 것은 미리보기뿐이다. 슬라이드 DOM 은 **커밋이 성공한
 * 뒤에** 같은 값으로 맞춘다 — 미리 바꿔 두면 거부됐을 때 화면과 파일이 갈라진다.
 * (진행바만 예외적으로 끌 때 슬라이드가 같이 움직인다. 막대를 끄는데 막대가 안 움직이면
 *  무엇을 하고 있는지 알 수 없기 때문이고, 놓았을 때 커밋이 실패하면 되돌린다.)
 */

/** 진행바 값의 범위. 테마 매핑의 `dataProps` 와 같은 값이고, 서버가 최종 판정한다. */
const MIN = 0;
const MAX = 100;

export function createOpaque({ stage, layer, commit, onNotice, onDone }) {
  const panel = document.createElement('div');
  panel.className = 'op-panel';
  panel.hidden = true;
  layer.append(panel);

  /**
   * 열려 있는 편집기 하나. `onCancel` 은 **취소로 닫을 때만** 부른다 —
   * 저장한 뒤에도 부르면 방금 저장한 값을 화면이 옛 값으로 되돌린다(실제로 그랬다).
   */
  let open = null;   // { nodeId, el, onCancel }

  /**
   * 슬라이드가 다시 그려지는 것을 iframe **안에서** 지켜본다.
   *
   * 밖에서 "배율을 바꿨다" 는 신호를 받아 옮기는 것으로는 부족하다 — 그 순간 iframe 은
   * 아직 새 크기를 반영하기 전이고, 그때 잰 좌표는 한 박자 낡은 값이라 패널이 수식에서
   * 수십 픽셀 떨어진 자리에 앉는다(실측: 배율을 오갈 때 59px). 안쪽이 실제로 다시
   * 그려진 뒤에 옮겨야 맞는다. `select.js` 가 테두리에 대해 같은 일을 같은 방법으로 한다.
   */
  let watched = null;
  function watch(doc) {
    if (watched === doc) return;
    watched = doc;
    new doc.defaultView.ResizeObserver(() => reposition()).observe(doc.documentElement);
  }

  /** 불투명 리프를 두 번 눌렀을 때 열린다. 그 판정은 목차의 `edit` 가 한다. */
  function begin(nodeId, info) {
    const doc = stage.contentDocument;
    const el = doc.querySelector(`[data-node-id="${cssEscape(nodeId)}"]`);
    if (!el) return false;

    watch(doc);
    close();
    if (info.edit === 'setTex') open = openTex(nodeId, el);
    else if (info.edit === 'setValue') open = openValue(nodeId, el);
    else return false;

    place(el);
    return true;
  }

  /* ------------------------------------------------------------------- 수식 */

  function openTex(nodeId, el) {
    const before = el.getAttribute('data-tex') ?? '';

    const input = field('수식 (TeX)', before);
    const preview = document.createElement('div');
    preview.className = 'op-preview';

    const draw = (tex) => {
      try {
        globalThis.katex.render(tex, preview, { throwOnError: true, displayMode: el.dataset.display === 'true' });
        preview.classList.remove('bad');
      } catch (err) {
        // 틀린 수식을 쓰는 중일 뿐이다. 그 사실을 보이되 입력을 막지는 않는다.
        preview.textContent = err.message.replace(/^KaTeX parse error:\s*/, '');
        preview.classList.add('bad');
      }
    };

    input.control.addEventListener('input', () => draw(input.control.value));
    input.control.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); save(); }
      if (e.key === 'Escape') { e.preventDefault(); close(); }
    });

    const save = async () => {
      const tex = input.control.value;
      if (tex === before) return close();
      const { ok } = await commit.send([{ op: 'setTex', target: nodeId, args: { tex } }], '수식 고치기');
      if (!ok) return close();
      if (open) open.onCancel = null;

      // 화면의 수식을 같은 값으로 맞추고 다시 그린다. 덱의 KaTeX 로 그려야 슬라이드
      // 안에서의 모양이 실제와 같다.
      el.setAttribute('data-tex', tex);
      redrawInSlide(el, tex);
      onNotice?.({ kind: 'saved', text: '수식을 고쳤습니다' });
      close();
    };

    panel.replaceChildren(input.row, preview, buttons(save));
    draw(before);
    queueMicrotask(() => input.control.select());
    return { nodeId, el, onCancel: null };
  }

  /* ----------------------------------------------------------------- 진행바 */

  function openValue(nodeId, el) {
    const before = Number(el.getAttribute('data-value') ?? 0);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = String(MIN);
    slider.max = String(MAX);
    slider.value = String(before);

    const number = field('값 (%)', String(before), 'number');
    number.control.min = String(MIN);
    number.control.max = String(MAX);

    // 끄는 동안에는 슬라이드의 막대도 같이 움직인다 — 막대를 끄는데 막대가 가만히 있으면
    // 무엇을 하고 있는지 알 수 없다. 파일은 아직 그대로다.
    const preview = (v) => {
      slider.value = String(v);
      number.control.value = String(v);
      paint(el, v);
    };

    slider.addEventListener('input', () => preview(clamp(slider.value)));
    number.control.addEventListener('input', () => preview(clamp(number.control.value)));
    number.control.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); save(); }
      if (e.key === 'Escape') { e.preventDefault(); revert(); }
    });

    const save = async () => {
      const value = clamp(number.control.value);
      if (value === before) return close();
      const { ok } = await commit.send([{ op: 'setValue', target: nodeId, args: { value } }], '진행바 고치기');
      if (!ok) return revert();
      // 저장했으니 되돌릴 것이 없다. 이 줄이 없으면 `close()` 가 옛 값을 도로 칠한다.
      if (open) open.onCancel = null;
      paint(el, value);
      onNotice?.({ kind: 'saved', text: `진행바를 ${value}% 로 고쳤습니다` });
      close();
    };

    const revert = () => close();   // 되돌리는 일은 `onCancel` 이 한다

    panel.replaceChildren(slider, number.row, buttons(save, revert));
    queueMicrotask(() => number.control.select());
    return { nodeId, el, onCancel: () => paint(el, before) };
  }

  /**
   * 진행바의 겉모습을 값에 맞춘다 — `data-value` 와 `--pct` 를 **함께** 바꾼다.
   *
   * 한쪽만 바꾸면 `grammar.data-prop-desync` 로 잡히는 상태다. 서버 명령도 둘을 함께
   * 쓰므로(§3.4 동기 불변식), 미리보기도 같은 규칙을 지켜야 화면과 파일이 같은 뜻이 된다.
   */
  function paint(el, value) {
    el.setAttribute('data-value', String(value));
    el.style.setProperty('--pct', String(value));
    // 값을 글로도 보이는 테마가 있다. 있으면 같이 맞춘다 — 없으면 아무 일도 없다.
    const label = el.querySelector('.pct');
    if (label) label.textContent = `${value}%`;
  }

  /** 슬라이드 안의 수식을 덱의 KaTeX 로 다시 그린다. 없으면 그대로 둔다. */
  function redrawInSlide(el, tex) {
    try {
      stage.contentWindow.katex.render(tex, el, {
        throwOnError: false,
        displayMode: el.dataset.display === 'true',
      });
    } catch {
      /* 덱이 KaTeX 를 안 싣는 경우다. 파일은 이미 고쳐졌고 다음에 열면 제대로 보인다. */
    }
  }

  /* ------------------------------------------------------------------ 공통 */

  function close() {
    const it = open;
    open = null;
    panel.hidden = true;
    panel.replaceChildren();
    it?.onCancel?.();
    onDone?.();
  }

  function place(el) {
    const r = el.getBoundingClientRect();
    const f = stage.getBoundingClientRect();
    const host = layer.getBoundingClientRect();
    panel.hidden = false;
    panel.style.transform = `translate(${f.left + r.left - host.left}px, ${f.top + r.bottom - host.top + 6}px)`;
  }

  function field(label, value, type = 'text') {
    const row = document.createElement('label');
    row.className = 'op-field';
    const span = document.createElement('span');
    span.textContent = label;
    const control = document.createElement('input');
    control.type = type;
    control.value = value;
    row.append(span, control);
    return { row, control };
  }

  function buttons(save, cancel = close) {
    const row = document.createElement('div');
    row.className = 'op-buttons';
    for (const [text, run] of [['적용', save], ['취소', cancel]]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      b.addEventListener('click', run);
      row.append(b);
    }
    return row;
  }

  const clamp = (v) => Math.min(MAX, Math.max(MIN, Math.round(Number(v) || 0)));

  /**
   * 열려 있는 패널을 제자리에 다시 놓는다.
   *
   * 패널은 고른 요소 **바로 아래**에 붙어야 뜻이 통한다 — 어느 수식을 고치는 중인지
   * 말해 주는 것이 그 위치뿐이기 때문이다. 그런데 자리는 열 때 한 번 계산되므로,
   * 배율이나 창 크기가 바뀌면 요소만 움직이고 패널은 남는다. 그때 이것을 부른다.
   */
  function reposition() {
    if (open?.el && !panel.hidden) place(open.el);
  }

  return { begin, close, reposition, active: () => open?.el ?? null };
}

function cssEscape(value) {
  return globalThis.CSS?.escape ? CSS.escape(value) : value.replace(/["\\]/g, '\\$&');
}
