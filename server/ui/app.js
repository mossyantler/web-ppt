/**
 * 편집기 화면 — 리포트 목록과 편집 화면(레일 + 캔버스). M3-2.
 *
 * **화면은 서버가 준 것을 그릴 뿐이고, 고치는 일은 전부 명령으로 나간다** (계획 Z2).
 * 이 파일에서 슬라이드 HTML 을 직접 조립하거나 iframe 안의 문서를 되읽어 저장하는
 * 코드가 생기면 그건 설계 위반이다. iframe 안 DOM 은 **보여주기 전용**이고,
 * 저장되는 문서는 언제나 서버가 들고 있는 파일이다.
 *
 * iframe 안을 건드리는 곳이 딱 두 군데 있다 (`mountStage`):
 *   - 덱이 자체 내장한 썸네일 레일을 감추기 — 우리 레일과 둘이 뜨면 안 된다
 *   - 장을 넘기기 (`goTo`) — 보이는 장을 바꿀 뿐 문서를 바꾸지 않는다
 * 둘 다 화면 상태이지 문서 상태가 아니다. 저장 경로와 만나지 않는다.
 */

import { createSelection } from './select.js';
import { createEditor } from './edit.js';

const views = {
  decks: document.getElementById('view-decks'),
  editor: document.getElementById('view-editor'),
};

const list = document.getElementById('deck-list');
const rail = document.getElementById('rail');
const stage = document.getElementById('stage');
const deckName = document.getElementById('deck-name');
const deckSub = document.getElementById('deck-sub');
const deckState = document.getElementById('deck-state');
const selState = document.getElementById('sel-state');
const notice = document.getElementById('notice');
const overlay = document.getElementById('overlay');

/** 목록을 화면 사이에서 재사용한다 — 편집 화면의 머리글도 여기서 이름을 얻는다. */
let decksCache = null;

/**
 * 지금 열어 둔 리포트와 그 문서 지문.
 *
 * **지문은 저장할 때마다 갈아 끼운다.** 낙관적 락의 근거이고, 낡은 채로 두면 두 번째
 * 저장이 409 를 받는다. 프리뷰를 다시 받지 않는 대신 이 값 하나만 따라간다
 * (docs/m2-reconcile-policy.md 의 델타 경로).
 */
const open = { deckId: null, docHash: null };

/**
 * 선택 계층과 글자 편집기. 화면 하나에 하나씩이고 리포트를 옮겨 다녀도 살아 있다 —
 * 겹침 층과 이벤트 처리기를 리포트마다 새로 만들면 옛 iframe 에 붙은 처리기가 남는다.
 */
const editor = createEditor({
  stage,
  deckId: () => open.deckId,
  docHash: { get: () => open.docHash, set: (h) => { open.docHash = h; } },
  onStatus: showSelectionState,
  onNotice: showNotice,
  // 근거를 잃은 미러는 되맞출 방법이 없다. 문서를 다시 받는다 (재조정 정책의 예외 경로).
  onResync: () => showEditor(open.deckId),
  onReflow: () => selection.place(),
});

const selection = createSelection({
  stage,
  layer: overlay,
  onStatus: showSelectionState,
  // 리프를 또 누른 것 = 글자를 고치겠다는 뜻이다 (결정 2).
  onActivate: (nodeId, info, point) => editor.begin(nodeId, info, point),
  editing: editor,
});

function showSelectionState(state) {
  // 편집이 끝났다는 신호다. 무엇이 골라져 있는지는 선택 계층만 아므로 되묻는다.
  if (state.kind === 'idle') return void selection.refresh();

  selState.textContent = state.text;
  selState.classList.toggle('locked', state.kind === 'locked');
  selState.classList.toggle('editing', state.kind === 'editing');
}

/**
 * 저장 결과·거부 사유.
 *
 * 성공은 잠시 뒤 스스로 사라지고 **실패는 남는다.** 실패가 조용히 사라지면 사용자는
 * 저장된 줄 알고 창을 닫는다.
 */
let noticeTimer = null;
function showNotice(state) {
  clearTimeout(noticeTimer);
  notice.textContent = state.text;
  notice.classList.toggle('bad', state.kind === 'error' || state.kind === 'blocked');
  if (state.kind === 'saved') noticeTimer = setTimeout(() => { notice.textContent = ''; }, 2500);
}

async function decks() {
  if (!decksCache) decksCache = (await (await fetch('/decks')).json()).decks;
  return decksCache;
}

/* ------------------------------------------------------------- 리포트 목록 */

async function showDeckList() {
  views.decks.hidden = false;
  views.editor.hidden = true;
  stage.removeAttribute('src');       // 목록으로 나오면 슬라이드를 내려놓는다
  selection.clear();

  const items = await decks();
  list.removeAttribute('aria-busy');

  if (!items.length) {
    list.replaceChildren(row('리포트가 없습니다'));
    return;
  }
  list.replaceChildren(...items.map(deckRow));
}

function row(text) {
  const li = document.createElement('li');
  li.className = 'locked';
  li.innerHTML = '<span class="label"></span>';
  li.firstChild.textContent = text;
  return li;
}

function deckRow(deck) {
  const li = document.createElement('li');
  if (!deck.annotated) li.className = 'locked';

  // 날짜(폴더 이름)를 앞세운다. 리포트 제목은 덱마다 "Weekly Report" 로 같아서
  // 그것만으로는 어느 주차인지 가려지지 않는다 — 실측으로 확인한 것이다.
  const id = document.createElement('span');
  id.className = 'label';
  id.textContent = deck.deckId;

  const label = document.createElement('span');
  label.className = 'sub';
  label.textContent = deck.label;

  const meta = document.createElement('span');
  meta.className = 'meta';
  meta.textContent = `${deck.slideCount}장`;

  li.append(id, label, meta);
  li.addEventListener('click', () => {
    location.hash = `#/deck/${encodeURIComponent(deck.deckId)}`;
  });
  return li;
}

/* ----------------------------------------------------------------- 편집기 */

async function showEditor(deckId) {
  views.decks.hidden = true;
  views.editor.hidden = false;

  const info = (await decks()).find((d) => d.deckId === deckId);
  deckName.textContent = deckId;
  deckSub.textContent = info?.label ?? '';

  // 문법을 선언하지 않은 덱은 열려도 고칠 수 없다 (결정 9). 열자마자 알린다 —
  // 고치려다 막히는 것보다 못 고친다고 미리 말하는 편이 낫다. 실제 잠금 UI 는 M3-9.
  deckState.classList.toggle('locked', info ? !info.annotated : false);
  deckState.textContent = info && !info.annotated ? '편집 불가 — 문법 선언 없음' : '';

  rail.replaceChildren(note('여는 중…'));
  selection.clear();
  open.deckId = deckId;
  open.docHash = null;

  // 목차를 슬라이드와 **함께** 받는다. 목차 없이 뜬 화면은 클릭이 먹지 않는 화면이고,
  // 사용자에게는 그것이 고장과 구별되지 않는다.
  const outline = fetch(`/deck/${encodeURIComponent(deckId)}/outline`)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);

  // 슬라이드는 원본 그대로 띄운다. 편집 표시는 이 바깥(부모 문서)이 얹는다.
  stage.src = `/deck/${encodeURIComponent(deckId)}/page`;
  stage.onload = async () => mountStage(await outline);
}

function note(text) {
  const p = document.createElement('p');
  p.className = 'rail-note';
  p.textContent = text;
  return p;
}

/**
 * iframe 이 다 뜬 뒤 레일을 짓고 캔버스와 묶는다.
 *
 * 덱은 `<deck-stage>` 라는 요소로 한 번에 한 장씩 보여주고 크기도 스스로 맞춘다.
 * 그것을 우리가 다시 만들지 않고 그대로 쓰되, **레일만 우리 것을 쓴다** —
 * 순서 바꾸기·추가·삭제가 앞으로 이 레일에 붙고, 그 조작들은 전부 서버 명령이라
 * 덱이 내장한 레일과 규칙이 다르다. 둘이 같이 뜨면 어느 쪽이 진짜인지 알 수 없다.
 */
function mountStage(outline) {
  const doc = stage.contentDocument;
  const sections = [...doc.querySelectorAll('section')];

  if (!sections.length) {
    rail.replaceChildren(note('슬라이드를 찾지 못했습니다.'));
    return;
  }

  const el = doc.querySelector('deck-stage');
  // 내장 레일 감추기. `no-rail` 은 그 요소가 지켜보는 속성이라 뜬 뒤에 붙여도 먹는다.
  if (el) el.setAttribute('no-rail', '');
  hideDeckChrome(el);

  const items = sections.map((section, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'rail-item';
    b.dataset.index = String(i);

    const n = document.createElement('span');
    n.className = 'n';
    n.textContent = String(i + 1);

    const t = document.createElement('span');
    t.className = 't';
    // 덱이 장마다 붙여 둔 이름을 쓴다. 없으면 첫 제목, 그것도 없으면 번호.
    t.textContent = section.getAttribute('data-label')
      || section.querySelector('h1, h2, h3')?.textContent.trim()
      || `${i + 1}장`;

    b.append(n, t);
    b.addEventListener('click', () => goTo(el, sections, i));
    return b;
  });

  rail.replaceChildren(...items);
  select(0);

  // 클릭으로 요소를 고를 수 있게 만드는 자리. 목차를 못 받았으면 붙이지 않는다 —
  // 붙여 두면 클릭이 아무 일도 하지 않고, 사용자는 왜인지 알 방법이 없다.
  if (outline) {
    // 저장의 근거가 되는 지문이다. 목차와 슬라이드를 같은 파일에서 받았으므로 맞는다.
    open.docHash = outline.docHash;
    selection.load(outline);
    selection.bind(doc);
    selection.setSlide(0);
  } else {
    showSelectionState({ kind: 'locked', text: '목차를 받지 못했습니다 — 고르기가 꺼져 있습니다' });
  }

  // 캔버스 쪽에서 장이 바뀌어도(키보드 ←/→) 레일 표시가 따라간다.
  el?.addEventListener('slidechange', (e) => {
    select(e.detail.index);
    // 안 보이는 요소를 고른 채로 두면 다음 명령이 엉뚱한 장으로 간다.
    if (outline) selection.setSlide(e.detail.index);
  });
}

/**
 * 덱이 발표용으로 띄우는 조작막대(장 번호·Reset)를 감춘다.
 *
 * 발표할 때는 쓸모 있지만 편집기에서는 슬라이드 아래쪽을 덮는다 — 거기 있는 글을
 * 누르려면 막대부터 치워야 한다. 이건 화면 문제이지 문서 문제가 아니다.
 *
 * 그 요소의 내부(shadow DOM)에 손을 넣는 유일한 자리다. 덱 요소는 우리가 만든 게
 * 아니라 갈아 끼워질 수 있고, 그때 이 선택자가 안 맞을 수 있다. 그래서 실패해도
 * 조용히 넘어간다 — 최악이 "막대가 다시 보인다" 이고, 편집이 막히지는 않는다.
 */
function hideDeckChrome(el) {
  try {
    const root = el?.shadowRoot;
    if (!root) return;
    // 스타일시트는 **iframe 쪽 생성자**로 만든다. 부모 문서에서 만든 것은 다른
    // 문서라 붙지 않는다 — 조용히 안 먹는 게 아니라 던진다.
    const sheet = new stage.contentWindow.CSSStyleSheet();
    sheet.replaceSync('[data-omelette-chrome]{display:none!important}');
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
  } catch {
    /* 발표용 막대가 남는 것뿐이다. 편집을 막을 이유가 못 된다. */
  }
}

function goTo(el, sections, i) {
  // `goTo` 는 덱 요소가 열어 둔 것이다. 없는 덱(요소를 안 쓰는 덱)에서는 스크롤로 간다.
  if (el?.goTo) el.goTo(i);
  else sections[i].scrollIntoView({ block: 'start' });
  select(i);
  // `slidechange` 를 내지 않는 덱도 있다. 두 번 불려도 하는 일은 같다(선택 해제).
  selection.setSlide(i);
}

function select(i) {
  for (const b of rail.children) {
    if (b.dataset) b.setAttribute('aria-current', String(Number(b.dataset.index) === i));
  }
}

/* ------------------------------------------------------------------ 라우팅 */

function route() {
  const m = location.hash.match(/^#\/deck\/(.+)$/);
  if (m) showEditor(decodeURIComponent(m[1]));
  else showDeckList();
}

addEventListener('hashchange', route);

// 초점이 iframe 밖(레일·머리글)에 있을 때도 Esc 는 같은 뜻이어야 한다. 안에서만 먹으면
// 레일을 누른 직후에 Esc 가 안 듣고, 그건 사용자에게 고장으로 보인다.
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !views.editor.hidden) selection.escape();
});

// 창 크기가 바뀌면 슬라이드 배율이 바뀌고 테두리가 어긋난다.
addEventListener('resize', () => selection.place());

route();
