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

/** 목록을 화면 사이에서 재사용한다 — 편집 화면의 머리글도 여기서 이름을 얻는다. */
let decksCache = null;

async function decks() {
  if (!decksCache) decksCache = (await (await fetch('/decks')).json()).decks;
  return decksCache;
}

/* ------------------------------------------------------------- 리포트 목록 */

async function showDeckList() {
  views.decks.hidden = false;
  views.editor.hidden = true;
  stage.removeAttribute('src');       // 목록으로 나오면 슬라이드를 내려놓는다

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

  // 슬라이드는 원본 그대로 띄운다. 편집 표시는 이 바깥(부모 문서)이 얹는다.
  stage.src = `/deck/${encodeURIComponent(deckId)}/page`;
  stage.onload = () => mountStage(deckId);
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
function mountStage(deckId) {
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

  // 캔버스 쪽에서 장이 바뀌어도(키보드 ←/→) 레일 표시가 따라간다.
  el?.addEventListener('slidechange', (e) => select(e.detail.index));
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
route();
