/**
 * 선택과 그룹 진입 — 파워포인트와 같은 방식 (M3 결정 2). M3-3.
 *
 * **표시는 전부 부모 문서에 그린다.** 테두리도 이름표도 iframe 안이 아니라 그 위에
 * 겹쳐 놓는 상자다. 슬라이드 DOM 에 클래스 하나라도 넣기 시작하면 편집기 CSS 와 덱
 * 테마가 한 문서에서 섞이고, iframe 경계를 세운 이유가 사라진다. 좌표만 안에서 얻고
 * (`getBoundingClientRect`) 그리는 것은 밖에서 한다.
 *
 * **어휘 판정도 하지 않는다.** 이 파일은 DOM 에서 `data-node-id` 만 읽고, 그 id 가
 * 카드인지 진행바인지·고칠 수 있는지는 서버 목차(`/deck/:id/outline`)가 준 것을 본다.
 * 클래스 이름으로 종류를 알아내려는 코드가 여기 생기면 그것이 두 번째 어휘 구현이다.
 *
 * 고르는 규칙 (결정 2)
 *   한 번 클릭    현재 스코프의 요소를 고른다 (테두리 + 이름표)
 *   또 클릭       누른 자리에 더 안쪽 요소가 있으면 그리로 들어간다 · 없으면 `onActivate`
 *   Esc           한 단계 나간다. 더 나갈 곳이 없으면 선택 해제
 *   바깥 클릭     선택 해제 + 스코프 초기화
 *
 * **진입 여부를 "컨테이너인가" 로 정하지 않는다.** 실측 — W31 의 수식 53 개 중 다수가
 * `data-el="text"` 문단 **안의** 인라인 수식이다. 컨테이너만 들어갈 수 있게 하면 그
 * 수식들은 영영 고를 수 없고, "수식은 다른 요소보다 더 쉽게 고쳐져야 한다" 는 결정 8 이
 * 정면으로 깨진다. 기준은 **누른 자리에 더 안쪽 노드가 있는가** 하나다.
 *
 * 텍스트 편집은 `onActivate` 뒤에 붙는다 (M3-4). 이 파일은 **아무것도 저장하지 않는다.**
 */

/** 어휘 값의 화면 이름. 여기 없는 값은 값 그대로 보인다 — 표시용이지 판정이 아니다. */
const LABELS = {
  title: '제목', subtitle: '부제', kicker: '머리말', hero: '표지 제목', heading: '소제목',
  meta: '정보', text: '문단', list: '목록', step: '단계', citation: '인용', caption: '설명',
  table: '표', image: '그림', figure: '그림틀', metric: '지표', pill: '꼬리표',
  callout: '강조', code: '코드', rule: '구분선', equation: '수식', progress: '진행바',
  stack: '세로 묶음', row: '가로 묶음', grid: '격자', group: '묶음', card: '카드',
  sequence: '흐름', canvas: '자유 배치', region: '영역',
};

export function createSelection({ stage, layer, onStatus, onActivate, editing, actions }) {
  /** nodeId → { kind, value, edit, parentId, sectionIndex } */
  const index = new Map();
  /**
   * 섹션을 가리키는 스코프 키들 — 섹션의 **진짜 `data-node-id`** 를 쓴다.
   *
   * 화면 전용 이름(`sec:N`)을 쓰면 순서 바꾸기 명령이 요구하는 `newParentId` 를 화면이
   * 만들어낼 수 없다. 서버가 아는 이름과 화면이 쓰는 이름이 갈리는 순간 명령을 못 만든다.
   */
  const sectionKeys = new Set();
  let sections = [];
  let slide = 0;            // 지금 보이는 장
  let scope = null;
  let selected = null;
  let doc = null;

  const ring = make('sel-ring');
  const tag = make('sel-tag');
  const groupRing = make('sel-group');
  const bar = makeBar();
  const menu = makeMenu();
  layer.append(groupRing, ring, tag, bar, menu);

  /* ------------------------------------------------------------ 목차 적재 */

  function load(outline) {
    index.clear();
    sectionKeys.clear();
    sections = outline.sections;
    for (const section of sections) {
      const key = scopeKeyOf(section);
      sectionKeys.add(key);
      walk(section.children, key, section.index);
    }
    clear();
  }

  function walk(nodes, parentId, sectionIndex) {
    for (const node of nodes) {
      index.set(node.nodeId, {
        kind: node.kind,
        value: node.value,
        edit: node.edit,
        parentId,
        sectionIndex,
      });
      walk(node.children, node.nodeId, sectionIndex);
    }
  }

  /** 이름표 없는 섹션도 스코프는 있어야 한다 — 고를 것이 없을 뿐이다. */
  const scopeKeyOf = (section) => section?.nodeId ?? `sec:${section?.index ?? 0}`;
  const isSectionScope = (s) => sectionKeys.has(s) || (typeof s === 'string' && s.startsWith('sec:'));

  /* -------------------------------------------------------------- 이벤트 */

  function bind(iframeDoc) {
    doc = iframeDoc;
    // 캡처 단계로 받는다. 슬라이드 안의 링크나 덱이 붙인 처리기보다 먼저 봐야
    // 편집 중에 문서가 딴 데로 넘어가는 일이 없다.
    doc.addEventListener('click', onClick, true);
    doc.addEventListener('keydown', onKey, true);
    doc.defaultView.addEventListener('resize', place);
    doc.defaultView.addEventListener('scroll', place, true);

    // 슬라이드는 창 크기에 맞춰 배율이 바뀐다. 배율이 바뀌면 테두리가 어긋난다.
    new doc.defaultView.ResizeObserver(place).observe(doc.documentElement);
  }

  function onClick(e) {
    // 편집기 안에서 링크를 따라가면 캔버스가 슬라이드가 아닌 문서로 바뀐다.
    if (e.target.closest?.('a')) e.preventDefault();

    // 글자를 고치는 중이고 그 글 안을 눌렀다 — 커서만 움직인다. 여기서 선택을 다시
    // 계산하면 문장 가운데를 누를 때마다 편집이 끊긴다.
    const active = editing?.active();
    if (active?.contains(e.target)) return;
    if (active) editing.end();

    const hit = resolve(e.target);
    if (!hit) return clear();

    // 이미 고른 것을 또 눌렀다 — 더 안쪽이 있으면 들어가고, 없으면 편집 신호를 낸다.
    if (hit.nodeId === selected) {
      const inner = resolve(e.target, hit.nodeId);
      if (inner) return enter(hit.nodeId, inner.nodeId);
      // 누른 자리를 함께 넘긴다 — 커서가 문단 첫머리가 아니라 누른 글자에 놓인다.
      onActivate?.(hit.nodeId, index.get(hit.nodeId), { x: e.clientX, y: e.clientY });
      return;
    }

    scope = hit.scope;
    select(hit.nodeId);
  }

  function onKey(e) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    escape();
  }

  /**
   * Esc — 글자를 고치는 중이면 **한 단계만** 나간다.
   *
   * 편집을 끝내면서 선택까지 풀면 방금 고친 것이 어디였는지 사라진다. 파워포인트도
   * 첫 Esc 는 상자 선택 상태로 돌아온다 (결정 2).
   */
  function escape() {
    if (editing?.active()) return void editing.end();
    if (isSectionScope(scope)) return clear();
    const leaving = scope;
    scope = index.get(scope).parentId;
    select(leaving);
  }

  /* ------------------------------------------------------- 클릭 지점 해석 */

  /**
   * 클릭한 자리에서 **주어진 스코프의 직계 자식**을 찾는다.
   *
   * 스코프 안에서 못 찾으면 한 단계씩 나가며 다시 본다 — 그룹에 들어간 채로 바깥을
   * 누르면 파워포인트가 그룹을 빠져나오는 것과 같다. 나갈 곳이 없으면 배경 클릭이다.
   *
   * `from` 을 넘기면 그 스코프에서만 본다(= 더 안쪽이 있는지 묻는 용도). 이때는 밖으로
   * 나가지 않는다 — 나가면 "안쪽이 있는가" 라는 질문에 바깥을 답으로 주게 된다.
   */
  function resolve(target, from = null) {
    const chain = [];
    for (let el = target; el && el !== doc.documentElement; el = el.parentElement) {
      const id = el.dataset?.nodeId;
      if (id && index.has(id)) chain.push(id);
    }
    if (!chain.length) return null;

    if (from !== null) {
      const inner = chain.find((id) => index.get(id).parentId === from);
      return inner ? { nodeId: inner, scope: from } : null;
    }

    for (let s = scope; s; s = isSectionScope(s) ? null : index.get(s).parentId) {
      const hit = chain.find((id) => index.get(id).parentId === s);
      if (hit) return { nodeId: hit, scope: s };
    }
    return null;
  }

  /* ---------------------------------------------------------- 상태 바꾸기 */

  function select(nodeId) {
    closeMenu();
    selected = nodeId;
    place();
    report();
  }

  /** 한 단계 안으로 들어가고, 그 안에서 누른 것을 바로 고른다. */
  function enter(scopeId, nodeId) {
    scope = scopeId;
    select(nodeId);
  }

  function clear() {
    closeMenu();
    if (editing?.active()) editing.end();
    selected = null;
    scope = scopeKeyOf(sections[slide]);
    place();
    report();
  }

  /** 장이 바뀌면 선택을 푼다 — 안 보이는 요소를 고른 채로 두면 명령이 엉뚱한 데 간다. */
  function setSlide(i) {
    slide = i;
    clear();
  }

  /* ------------------------------------------------------------- 그리기 */

  function place() {
    box(ring, selected);
    box(groupRing, isSectionScope(scope) ? null : scope);
    placeTag();
    placeBar();
  }

  /**
   * 고른 요소의 버튼바 — 지금은 위·아래 둘이다 (결정 3).
   *
   * 글자를 고치는 중에는 감춘다. 커서가 들어간 상자 위에 버튼이 떠 있으면 누르려다
   * 편집이 끊기고, 끊기면서 저장까지 일어난다.
   */
  function placeBar() {
    const editingNow = !!editing?.active();
    if (!selected || ring.hidden || editingNow || !actions) return void (bar.hidden = true);

    const up = actions.canMove(selected, -1);
    const down = actions.canMove(selected, +1);
    // 옮길 수 없는 요소(영역처럼 자리가 정해진 것)에는 아예 바를 띄우지 않는다.
    // 언제나 회색 버튼만 떠 있으면 사용자는 그것이 고장인지 규칙인지 알 수 없다.
    if (!up && !down) return void (bar.hidden = true);

    const add = actions.canInsert?.(selected) ?? false;
    const del = actions.canRemove?.(selected) ?? false;
    // 아무것도 할 수 없는 요소(영역처럼 자리가 정해진 것)에는 바를 띄우지 않는다.
    // 언제나 회색 버튼만 떠 있으면 사용자는 그것이 고장인지 규칙인지 알 수 없다.
    if (!up && !down && !add && !del) return void (bar.hidden = true);

    bar.hidden = false;
    for (const [act, on] of [['up', up], ['down', down], ['add', add], ['remove', del]]) {
      bar.querySelector(`[data-act="${act}"]`).disabled = !on;
    }

    const r = ring.getBoundingClientRect();
    const host = layer.getBoundingClientRect();
    const above = r.top - host.top - 24;
    bar.style.transform = `translate(${r.right - host.left - bar.offsetWidth}px, ${Math.max(0, above)}px)`;
  }

  function makeBar() {
    const el = document.createElement('div');
    el.className = 'sel-bar';
    el.hidden = true;

    const buttons = [
      ['up', '↑', '위로', () => actions?.moveElement(selected, -1)],
      ['down', '↓', '아래로', () => actions?.moveElement(selected, +1)],
      ['add', '＋', '아래에 넣기', () => openMenu()],
      ['remove', '🗑', '지우기 (되돌리기로 돌아옵니다)', () => actions?.remove(selected)],
    ];

    for (const [act, glyph, title, run] of buttons) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.act = act;
      b.textContent = glyph;
      b.title = title;
      b.addEventListener('click', async () => {
        closeMenu();
        const done = await run();
        if (done !== false) place();
      });
      el.append(b);
    }
    return el;
  }

  /* --------------------------------------------------- 무엇을 넣을지 고르는 목록 */

  function makeMenu() {
    const el = document.createElement('div');
    el.className = 'sel-menu';
    el.hidden = true;
    return el;
  }

  /** `+` 를 누르면 뜨는 목록. 종류는 테마 매핑에서 오고 이름만 여기서 붙인다. */
  async function openMenu() {
    const types = (await actions?.vocabulary?.()) ?? [];
    if (!types.length) return false;

    const pick = async (type, variant) => {
      closeMenu();
      await actions.insert(selected, type, variant);
    };

    menu.replaceChildren();
    for (const group of ['leaf', 'container']) {
      const rows = types.filter((t) => t.group === group);
      if (!rows.length) continue;

      const head = document.createElement('div');
      head.className = 'menu-head';
      head.textContent = group === 'leaf' ? '내용' : '담는 상자';
      menu.append(head);

      for (const t of rows) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = LABELS[t.type] ?? t.type;
        b.addEventListener('click', () => pick(t.type, t.variants[0] ?? 'default'));
        menu.append(b);
      }
    }

    const r = ring.getBoundingClientRect();
    const host = layer.getBoundingClientRect();
    menu.hidden = false;
    menu.style.transform = `translate(${r.left - host.left}px, ${r.bottom - host.top + 4}px)`;
    return false;   // 목록을 띄웠을 뿐이고 아직 아무것도 넣지 않았다
  }

  function closeMenu() {
    menu.hidden = true;
  }

  function box(el, nodeId) {
    const target = nodeId && doc?.querySelector(`[data-node-id="${cssEscape(nodeId)}"]`);
    if (!target) return void (el.hidden = true);

    const r = rectOf(target);
    el.hidden = false;
    el.style.transform = `translate(${r.x}px, ${r.y}px)`;
    el.style.width = `${r.width}px`;
    el.style.height = `${r.height}px`;
  }

  function placeTag() {
    if (!selected || ring.hidden) return void (tag.hidden = true);
    const info = index.get(selected);
    tag.hidden = false;
    tag.textContent = LABELS[info.value] ?? info.value ?? info.kind;
    tag.classList.toggle('opaque', info.kind === 'leaf-opaque');

    const r = ring.getBoundingClientRect();
    const host = layer.getBoundingClientRect();
    // 위에 자리가 없으면 상자 안쪽 위에 붙인다 — 화면 밖으로 나가면 안 보인다.
    const above = r.top - host.top - 22;
    tag.style.transform = `translate(${r.left - host.left}px, ${Math.max(0, above)}px)`;
  }

  /** iframe 안의 좌표를 부모 문서의 겹침 층 좌표로 옮긴다. */
  function rectOf(el) {
    const r = el.getBoundingClientRect();      // iframe 창 기준
    const f = stage.getBoundingClientRect();   // 부모 창 기준
    const host = layer.getBoundingClientRect();
    return {
      x: f.left + r.left - host.left,
      y: f.top + r.top - host.top,
      width: r.width,
      height: r.height,
    };
  }

  /* ------------------------------------------------------------ 상태 알림 */

  function report() {
    const section = sections[slide];
    // 이름표가 없는 섹션은 명령이 지목할 수 없다 → 고를 것도 없다 (결정 9).
    // 어휘 밖 노드가 섞인 섹션을 어디까지 잠글지는 M3-9 의 정책이고 여기서 정하지 않는다.
    if (section && !section.annotated) {
      return onStatus?.({ kind: 'locked', section, text: '이 슬라이드는 아직 편집할 수 없습니다' });
    }
    if (!selected) return onStatus?.({ kind: 'none', section, text: '' });

    const info = index.get(selected);
    onStatus?.({
      kind: 'selected',
      section,
      nodeId: selected,
      info,
      text: `${LABELS[info.value] ?? info.value} 선택됨`,
    });
  }

  return {
    load, bind, setSlide, clear, escape, place,
    /**
     * 바깥에서 특정 노드를 골라 둔다 (막 넣은 요소로 돌아올 때).
     * 스코프는 그 노드의 부모로 맞춘다 — 안 맞추면 다음 클릭이 바깥으로 튄다.
     */
    pick: (nodeId) => {
      const info = index.get(nodeId);
      if (!info) return false;
      slide = info.sectionIndex;
      scope = info.parentId;
      select(nodeId);
      return true;
    },
    /** 노드 정보 조회 — 순서 바꾸기·추가·삭제가 부모와 종류를 알아야 한다. */
    infoOf: (nodeId) => index.get(nodeId) ?? null,
    /** 지금 보이는 장의 섹션 (레일 드래그가 대상 id 를 얻는 자리). */
    sectionAt: (i) => sections[i] ?? null,
    /** 상태 표시를 다시 낸다 — 편집이 끝나 "고치는 중" 이 지워졌을 때 쓴다. */
    refresh: report,
    get selected() { return selected; },
  };
}

function make(className) {
  const el = document.createElement('div');
  el.className = className;
  el.hidden = true;
  return el;
}

/** 선택자에 넣을 id 이스케이프. `CSS.escape` 가 없는 환경을 위한 최소 대체다. */
function cssEscape(value) {
  return globalThis.CSS?.escape ? CSS.escape(value) : value.replace(/["\\]/g, '\\$&');
}
