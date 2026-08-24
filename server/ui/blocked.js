/**
 * 고칠 수 있는 장 **안에** 섞인, 문법이 모르는 자리 (결정 13). M3-9.
 *
 * ## `adopt.js` 와 무엇이 다른가
 *
 * `adopt.js` 는 **이름표가 아예 없는 장**을 막으로 덮고 "고치기" 를 준다. 이 파일은
 * 그 반대편 — 이름표가 붙어 편집되는 장 안에 남은 어휘 밖 노드 하나하나다.
 *
 * 그 둘을 갈라 둔 것이 이번 결정의 핵심이다. 계획서 문구는 "그런 요소가 있는 섹션을
 * 잠근다" 였지만, 실측하면 이름표를 갓 붙인 W31 은 **13 장 중 12 장**이 그 상태다.
 * 그대로 하면 편집 가능한 슬라이드가 1 장이 된다(계획서 §14 가 미리 경고한 실패다).
 * 그래서 사용자가 정한 것 — **문법이 모르는 요소만** 수정 불가로 두고 화면은 평소처럼
 * 보인다. 회색 막은 없다. "볼 수는 있지만 수정은 안 된다" 가 그 자리에서 읽혀야 한다.
 *
 * 누르면 **이유와 소스 줄 번호**를 준다. 잠그기만 하고 방법을 안 주면 나갈 문이 없다
 * (결정 9). 줄 번호가 그 문이다 — 손으로 고치거나 adopt 를 돌릴 자리를 가리킨다.
 *
 * ## DOM 에서 그 노드를 어떻게 찾는가
 *
 * 이름표가 없으니 id 로는 못 찾는다. 목차가 **섹션 루트부터의 요소 자식 순번**을 주고
 * (`blocker.path`), 화면은 그것을 따라 내려간다. 줄 번호는 사람에게 보여주는 용도다.
 */

/** 사유 코드 → 사람 말. */
const REASONS = {
  'grammar.unknown-element': '문법에 없는 요소',
  'grammar.unknown-value': '어휘에 없는 값',
  'grammar.missing-id': '이름표가 없음',
};

export function createBlocked({ stage, layer, onNotice }) {
  const boxes = document.createElement('div');
  boxes.className = 'lock-marks';
  layer.append(boxes);

  let marks = [];      // { el, blocker } — 이유를 물을 수 있는 전부
  let drawn = [];      // 그중 점선을 그리는 바깥쪽만 (+ box)
  let sections = [];

  function load(outline) {
    sections = outline?.sections ?? [];
  }

  /**
   * 슬라이드가 다시 그려지는 것을 iframe **안에서** 지켜본다.
   *
   * 점선은 막힌 요소를 정확히 덮어야 뜻이 통한다 — 어느 자리가 막혔는지 말해 주는 것이
   * 그 테두리뿐이기 때문이다. 그런데 밖에서 "배율이 바뀌었다" 는 신호를 받아 다시 그리면
   * 그 순간 iframe 은 아직 새 크기를 반영하기 전이고, 잰 값은 **직전 배율의 것**이라
   * 점선이 한 박자 뒤처진 크기로 남는다(실측: 103% 인데 120% 때의 폭 1420px).
   * `select.js` 의 테두리와 `opaque.js` 의 패널이 같은 이유로 같은 장치를 쓴다.
   */
  let watched = null;
  function watch(doc) {
    if (!doc || watched === doc) return;
    watched = doc;
    new doc.defaultView.ResizeObserver(() => place()).observe(doc.documentElement);
  }

  /** 장이 바뀔 때마다 그 장의 막힌 자리를 다시 찾는다. */
  function setSlide(i) {
    const doc = stage.contentDocument;
    watch(doc);
    const section = sections[i];
    const root = doc?.querySelectorAll('section')[i];

    marks = [];
    drawn = [];
    boxes.replaceChildren();
    // 이름표가 아예 없는 장은 `adopt.js` 의 막이 통째로 맡는다. 여기서 또 표시하면
    // 막 위에 점선이 겹쳐 보이고, 사용자는 둘이 다른 문제라고 읽는다.
    if (!section?.annotated || !root) return;

    const found = [];
    for (const blocker of section.blockers ?? []) {
      const el = resolvePath(root, blocker.path);
      if (el) found.push({ el, blocker });
    }

    // 이유를 물을 수 있는 것은 **전부**다. 하지만 **그리는 것은 바깥쪽 하나뿐**이다 —
    // 문법이 모르는 껍데기 안의 자식들도 대개 함께 걸리므로, 전부 그리면 점선이 서너 겹으로
    // 겹쳐 무엇이 문제인지 오히려 안 보인다. 고칠 자리도 바깥쪽이다: 그 껍데기가 어휘에
    // 들어오면 안쪽은 따라 풀린다.
    marks = found;
    drawn = found.filter((m) => !found.some((other) => other !== m && other.el.contains(m.el)));
    place();
  }

  /** 목차가 준 순번 길을 DOM 에서 따라간다. */
  function resolvePath(root, path) {
    if (!path?.length) return null;
    let node = root;
    for (const i of path) {
      node = node?.children?.[i];
      if (!node) return null;
    }
    return node;
  }

  /**
   * 클릭이 막힌 자리에서 일어났는가. 그렇다면 이유를 말하고 선택을 막는다.
   *
   * **정확히 그 요소를 눌렀을 때만** 낸다. 문법이 모르는 껍데기 **안**에 이름표 붙은
   * 문단이 사는 경우가 흔하고(실측 — W31 의 문단 다수가 `<article>` 안에 있다), 껍데기가
   * 품고 있다는 이유로 그 문단까지 막으면 결정 13 이 열어 둔 것을 도로 닫는다.
   */
  function claim(target) {
    const hit = marks.find((m) => m.el === target);
    if (!hit) return false;

    const { blocker } = hit;
    const what = REASONS[blocker.code] ?? blocker.code;
    const where = blocker.line ? `${blocker.line}줄` : '위치 미상';
    onNotice?.({ kind: 'blocked', text: `${where} <${blocker.tag}> — ${what}이라 수정할 수 없습니다` });
    return true;
  }

  function place() {
    const f = stage.getBoundingClientRect();
    const host = layer.getBoundingClientRect();

    for (const mark of drawn) {
      if (!mark.box) {
        mark.box = document.createElement('div');
        mark.box.className = 'lock-mark';
        boxes.append(mark.box);
      }
      const r = mark.el.getBoundingClientRect();
      mark.box.style.transform = `translate(${f.left + r.left - host.left}px, ${f.top + r.top - host.top}px)`;
      mark.box.style.width = `${r.width}px`;
      mark.box.style.height = `${r.height}px`;
    }
  }

  return { load, setSlide, place, claim };
}
