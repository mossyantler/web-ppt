/**
 * 고칠 수 있는 장 **안에** 섞인, 문법이 모르는 자리 (결정 13). M3-9.
 *
 * ## `adopt.js` 와 무엇이 다른가
 *
 * `adopt.js` 는 **이름표가 아예 없는 장**을 막으로 덮고 "고치기" 를 준다. 이 파일은
 * 그 반대편 — 이름표가 붙어 편집되는 장 안에 남은 어휘 밖 노드 하나하나다.
 *
 * ## 빗금을 그리지 않는다 (2026-08-24)
 *
 * 처음에는 막힌 자리마다 노란 빗금 테두리를 그렸다. 실측에서 그것이 뒤집혔다.
 *
 *   - **양이 틀렸다.** 리포트 한 장에 479 개가 나왔다. 그중 사람이 고치고 싶은 것은
 *     하나도 없었다 — 전부 `.equation-grid`·`.fig-band` 같은 조판 껍데기와 `<svg>`
 *     안쪽이다.
 *   - **자리가 틀렸다.** 빗금은 겹침을 피하려고 **바깥쪽** 하나에만 그린다. 그 바깥쪽이
 *     하필 본문 전체를 감싸는 격자라, 화면에서는 **글자가 다 고쳐지는 슬라이드가 통째로
 *     잠긴 것처럼** 보였다. 사용자의 말 — "요소랑 맞는 영역도 있는 거 같은데, 아닌 곳도
 *     있고, 의미하는 바가 별로 없으면 없애도 돼."
 *
 * 그래서 껍데기 쪽을 고쳤다. `tools/adopt` 가 이제 구조만으로 껍데기를 컨테이너로
 * 인정하고(§2.6), `<svg>` 는 그림 한 장으로 센다(§3.7). 네 리포트 실측에서 막힌 자리는
 * 479·435·368·213 개에서 **전부 0** 이 됐다. 0 개짜리를 위한 그림 장치는 남길 이유가 없다.
 *
 * **이유는 남긴다.** 아직 이름표가 없는 옛 리포트에서는 여전히 막힌 자리가 나올 수 있고,
 * 잠그기만 하고 방법을 안 주면 나갈 문이 없다 (결정 9). 그 문은 이제 **눌렀을 때만**
 * 열린다 — 그리고 `select.js` 는 고를 것이 하나도 없을 때에만 여기에 묻는다. 껍데기를
 * 눌렀는데 안에 고칠 것이 있으면, 막혔다고 말하는 대신 그것을 골라 준다.
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

export function createBlocked({ stage, onNotice }) {
  let marks = [];      // { el, blocker } — 이유를 물을 수 있는 전부
  let sections = [];

  function load(outline) {
    sections = outline?.sections ?? [];
  }

  /** 장이 바뀔 때마다 그 장의 막힌 자리를 다시 찾는다. */
  function setSlide(i) {
    const doc = stage.contentDocument;
    const section = sections[i];
    const root = doc?.querySelectorAll('section')[i];

    marks = [];
    // 이름표가 아예 없는 장은 `adopt.js` 의 막이 통째로 맡는다.
    if (!section?.annotated || !root) return;

    for (const blocker of section.blockers ?? []) {
      const el = resolvePath(root, blocker.path);
      if (el) marks.push({ el, blocker });
    }
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
   * 여기에 고칠 것이 없다면, 왜 없는지 말한다.
   *
   * 누른 자리부터 위로 훑는다. 예전에는 **정확히 그 요소**일 때만 냈는데, 그때는 이 함수가
   * 클릭을 가로채는 자리에 있었기 때문이다 — 어휘 밖 껍데기 안에 이름표 붙은 문단이 사는
   * 일이 흔해서, 껍데기가 품고 있다는 이유로 그 문단까지 막으면 결정 13 이 열어 둔 것을
   * 도로 닫았다. 이제는 `select.js` 가 **고를 것이 하나도 없을 때에만** 묻는다. 그러니
   * 조상까지 훑어도 문단을 막을 일이 없고, 대신 "누른 곳은 `<path>` 인데 이유는 그 위
   * `<svg>` 에 있다" 같은 경우에 답을 줄 수 있다.
   */
  function claim(target) {
    for (let el = target; el; el = el.parentElement) {
      const hit = marks.find((m) => m.el === el);
      if (!hit) continue;

      const { blocker } = hit;
      const what = REASONS[blocker.code] ?? blocker.code;
      const where = blocker.line ? `${blocker.line}줄` : '위치 미상';
      onNotice?.({ kind: 'blocked', text: `${where} <${blocker.tag}> — ${what}이라 수정할 수 없습니다` });
      return true;
    }
    return false;
  }

  return { load, setSlide, claim };
}
