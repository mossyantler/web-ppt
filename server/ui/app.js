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
import { createCommitter } from './committer.js';
import { createReorder } from './reorder.js';
import { createDrag } from './drag.js';
import { createHistory } from './history.js';
import { createStructure } from './structure.js';
import { createOpaque } from './opaque.js';
import { createBlocked } from './blocked.js';
import { createSetup } from './setup.js';
import { createLogo } from './logo.js';
import { createBackground } from './background.js';
import { createPresent } from './present.js';
import { createSlides } from './slides.js';
import { createAdopt } from './adopt.js';
import { createViewport } from './viewport.js';
import { createPicture } from './picture.js';
import { createTable } from './table.js';
import { createFree } from './free.js';
import { createResize } from './resize.js';
import { createTheme } from './theme.js';
import { createGroup } from './group.js';
import { createRibbon } from './ribbon.js';
import { createInspector } from './inspector.js';
import { createThumbs } from './thumbs.js';
import { createMenu } from './menu.js';
import { setIcon, setIconText } from './icons.js';

const views = {
  decks: document.getElementById('view-decks'),
  setup: document.getElementById('view-setup'),
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
const undoButton = document.getElementById('undo');
const redoButton = document.getElementById('redo');
const overlay = document.getElementById('overlay');
const lock = document.getElementById('lock');
const findings = document.getElementById('findings');
const canvasEl = document.getElementById('canvas');
const zoomVal = document.getElementById('zoom-val');
const zoomFit = document.getElementById('zoom-fit');

/** 목록을 화면 사이에서 재사용한다 — 편집 화면의 머리글도 여기서 이름을 얻는다. */
let decksCache = null;

/**
 * 새 리포트 설정 화면 (명세 `docs/specs/새-리포트-만들기.md`).
 *
 * 만든 뒤에는 **목록 캐시를 버린다** — 방금 만든 리포트가 목록에 없으면 편집 화면의
 * 머리글이 이름을 찾지 못한다.
 */
const setup = createSetup({
  view: document.getElementById('view-setup'),
  form: document.getElementById('setup-form'),
  error: document.getElementById('setup-error'),
  onCreated: (deckId) => {
    decksCache = null;
    location.hash = `#/deck/${encodeURIComponent(deckId)}`;
  },
});

/**
 * 지금 열어 둔 리포트와 그 문서 지문.
 *
 * **지문은 저장할 때마다 갈아 끼운다.** 낙관적 락의 근거이고, 낡은 채로 두면 두 번째
 * 저장이 409 를 받는다. 프리뷰를 다시 받지 않는 대신 이 값 하나만 따라간다
 * (docs/m2-reconcile-policy.md 의 델타 경로).
 */
const open = { deckId: null, docHash: null };

/** 지금 보이는 장. 화면을 다시 받을 때 보던 자리로 돌아오려고 들고 있다. */
let currentSlide = 0;

/**
 * 마지막으로 받은 목차. 장을 넘길 때마다 "이 장이 잠겼는가"(M3-9) 와
 * "이 장에 이름표가 있어 배경을 바꿀 수 있는가"(결정 4) 를 여기서 본다.
 */
let currentOutline = null;

/**
 * 선택 계층과 글자 편집기. 화면 하나에 하나씩이고 리포트를 옮겨 다녀도 살아 있다 —
 * 겹침 층과 이벤트 처리기를 리포트마다 새로 만들면 옛 iframe 에 붙은 처리기가 남는다.
 */
const history = createHistory({
  deckId: () => open.deckId,
  buttons: { undo: undoButton, redo: redoButton },
  onNotice: showNotice,
  // 되돌리기는 파일 전체를 갈아 끼운다. 무엇이 달라졌는지 화면은 모르므로 다시 받는다.
  onResync: () => showEditor(open.deckId, currentSlide),
});

const committer = createCommitter({
  deckId: () => open.deckId,
  docHash: { get: () => open.docHash, set: (h) => { open.docHash = h; } },
  onNotice: showNotice,
  // 근거를 잃은 미러는 되맞출 방법이 없다. 문서를 다시 받는다 (재조정 정책의 예외 경로).
  onResync: () => showEditor(open.deckId, currentSlide),
  // 커밋이 성공할 때마다 링 잔량이 바뀐다. 버튼이 그것을 그대로 보인다.
  onRings: (rings) => history.update(rings),
});

const editor = createEditor({
  stage,
  commit: committer,
  onStatus: showSelectionState,
  onNotice: showNotice,
  onReflow: () => reflow(),
});

const reorder = createReorder({
  stage,
  commit: committer,
  index: { get: (nodeId) => selection.infoOf(nodeId) },
  onNotice: showNotice,
  onMoved: () => selection.place(),
  // 슬라이드 순서가 바뀌면 페이지 번호가 문서 전체에서 다시 매겨진다. 델타로 못 따라간다.
  onResync: (slide) => showEditor(open.deckId, slide),
});

const blocked = createBlocked({
  stage,
  onNotice: showNotice,
});

const opaque = createOpaque({
  stage,
  layer: overlay,
  commit: committer,
  onNotice: showNotice,
  onDone: () => selection.refresh(),
});

const structure = createStructure({
  stage,
  commit: committer,
  index: { get: (nodeId) => selection.infoOf(nodeId) },
  onNotice: showNotice,
  // 새 요소의 마크업은 테마가 정한다. 화면이 그것을 흉내내면 두 번째 어휘 구현이 되므로
  // 다시 받고, 서버가 준 새 id 를 골라 둔다.
  onInserted: (nodeId) => showEditor(open.deckId, currentSlide, nodeId),
  onRemoved: () => selection.clear(),
});

/**
 * 복제 · 묶기 · 풀기. 서버에는 M2 부터 있었고 화면에 자리가 없어 못 부르던 셋이다 —
 * 리본이 생기면서 홈 탭과 배치 탭에 자리가 났다.
 */
const group = createGroup({
  commit: committer,
  index: { get: (nodeId) => selection.infoOf(nodeId) },
  structure,
  onNotice: showNotice,
  // 셋 다 노드가 생기거나 사라진다. 서버가 발급한 새 id 를 골라 둔 채로 다시 받는다.
  onResync: (nodeId) => showEditor(open.deckId, currentSlide, nodeId),
});

const picture = createPicture({
  stage,
  commit: committer,
  deckId: () => open.deckId,
  structure,
  index: { get: (nodeId) => selection.infoOf(nodeId) },
  onNotice: showNotice,
  // 새 그림의 마크업은 테마가 정한다 — 화면이 흉내내면 두 번째 어휘 구현이다.
  onInserted: (nodeId) => showEditor(open.deckId, currentSlide, nodeId),
  onResync: () => showEditor(open.deckId, currentSlide),
});

const free = createFree({
  stage,
  commit: committer,
  index: { get: (nodeId) => selection.infoOf(nodeId) },
  onNotice: showNotice,
  // 층이 생기거나 부모가 바뀌면 목차가 통째로 달라진다. 델타로 못 따라간다.
  onResync: (nodeId) => showEditor(open.deckId, currentSlide, nodeId),
});

const resize = createResize({
  stage,
  layer: overlay,
  free,
  onDone: () => selection.place(),
});

const table = createTable({
  stage,
  layer: overlay,
  commit: committer,
  editor,
  onNotice: showNotice,
  // 행·열을 바꾸면 표의 바이트가 통째로 달라진다. 화면이 마크업을 흉내내지 않고 다시
  // 받은 뒤, **그 표를 다시 연다** — 행을 셋 넣는 사람이 매번 표를 다시 찾게 하지 않는다.
  onResync: async (nodeId, info) => {
    await showEditor(open.deckId, currentSlide, nodeId);
    table.reopen(nodeId, info);
  },
});

/**
 * 테마 창 — 서식을 요소마다 예외로 만드는 대신 **정의**를 바꾼다.
 *
 * 파워포인트의 굵게·크게·색 도구가 여기 없는 것은 일부러다(`props.js` 가 `style` 을 열지
 * 않는다). 그 자리를 이것이 메운다: 제목이 크면 이 제목 하나가 아니라 `--text-display` 를
 * 줄이고, 그러면 열세 장이 함께 줄면서 일관성은 그대로 남는다.
 */
/**
 * 서식 칸 — 오른쪽 판. 지금 고른 것의 자리·크기와 리포트 테마가 여기 산다.
 *
 * 리본보다 먼저 만들어야 한다 — 테마가 이 판 안에 그려지고, 리본의 테마 버튼은 이 판을
 * 여는 버튼이 된다.
 */
const inspector = createInspector({
  pane: document.getElementById('inspector'),
  button: document.getElementById('pane-toggle'),
  stage,
  free,
  onNotice: showNotice,
  // 판이 열리고 닫히면 캔버스 폭이 달라진다. 겹쳐 그린 테두리가 따라와야 한다.
  // (맞춤 배율은 `viewport` 가 캔버스를 직접 지켜보며 스스로 다시 잰다.)
  onLayout: () => reflow(),
});

const theme = createTheme({
  stage,
  host: inspector.themeHost,
  commit: committer,
  onNotice: showNotice,
});

// 판이 열릴 때마다 테마가 지금 값을 다시 읽는다 — 리포트를 옮겨 다니면 값이 달라진다.
inspector.onOpen(() => theme.refresh());

const adopt = createAdopt({
  lock,
  findings,
  commit: committer,
  onNotice: showNotice,
  // 이름표가 붙으면 그 장은 고를 수 있는 장이 된다. 목차·지문·트리가 전부 달라지므로
  // 델타로 따라가지 않고 다시 받는다 (재조정 정책의 외부 편집과 같은 등급이다).
  //
  // 리포트 목록도 같이 버린다 — 첫 장을 고치는 순간 덱은 "문법 선언 있음" 이 되고,
  // 캐시를 두면 목록으로 나갔을 때 아직 "편집 불가" 라고 적혀 있다.
  onDone: () => { decksCache = null; showEditor(open.deckId, currentSlide); },
});

const background = createBackground({
  stage,
  commit: committer,
  buttons: {
    light: document.getElementById('bg-light'),
    dark: document.getElementById('bg-dark'),
    all: document.getElementById('bg-all'),
  },
  sections: () => currentOutline?.sections ?? [],
  currentSlide: () => currentSlide,
  onNotice: showNotice,
});

const present = createPresent({
  stage,
  canvas: canvasEl,
  overlay,
  onEnter: () => selection.clear(),
  onExit: () => reflow(),
});

const slides = createSlides({
  commit: committer,
  sections: () => currentOutline?.sections ?? [],
  onNotice: showNotice,
  // 장이 늘거나 줄거나 옮겨지면 페이지 번호가 문서 전체에서 다시 매겨진다.
  onResync: (slide) => showEditor(open.deckId, slide),
});

const logo = createLogo({
  stage,
  commit: committer,
  deckId: () => open.deckId,
  onNotice: showNotice,
  // 장마다 노드가 하나씩 늘었다. 목차가 통째로 달라지므로 다시 받는다.
  onResync: () => showEditor(open.deckId, currentSlide),
});

/**
 * 레일의 슬라이드 그림. 명령을 부르지 않고 **그리기만** 하므로 커밋 계층과 무관하다.
 */
const thumbs = createThumbs({ stage });

/**
 * 오른쪽 단추 메뉴. 레일에서도 슬라이드 위에서도 이 하나를 쓴다 — 두 벌이면 같은 명령이
 * 두 자리에서 다른 이름을 갖게 된다.
 */
const menu = createMenu();

const drag = createDrag({
  stage,
  layer: overlay,
  actions: reorder,
  // 자유 배치 안에서는 형제 사이의 틈이 아니라 좌표를 고른다.
  free,
  // 글자를 고치는 중인 상자 안에서 누른 것은 끌기가 아니라 커서 옮기기다.
  onPick: (el) => !editor.active()?.contains(el),
  onDrop: () => selection.place(),
});

const selection = createSelection({
  stage,
  layer: overlay,
  onStatus: showSelectionState,
  // 리프를 또 누른 것 = 고치겠다는 뜻이다 (결정 2). 무엇으로 고치는지는 종류가 정한다 —
  // 수식·진행바는 전용 편집기가 열리고(결정 8), 나머지는 커서가 들어간다.
  onActivate: (nodeId, info, point) => {
    // 표는 `edit` 가 `setContent` 라 그냥 두면 표 **전체**에 커서가 들어간다. 고칠 것은
    // 칸 하나이므로 표 도구가 먼저 받는다 (§3.6 L6.1 의 명령 넷을 쓴다).
    if (table.claims(info) && table.begin(nodeId, info, point)) return;
    if (info.edit === 'setContent') editor.begin(nodeId, info, point);
    // 그림도 `edit` 가 `setProps` 라 그냥 두면 수식 편집기로 샌다. 고칠 것이 파일이므로
    // 옆에 상자를 띄우는 대신 파일 고르개를 바로 연다.
    else if (info.value === 'image') picture.pick(nodeId);
    else opaque.begin(nodeId, info);
  },
  editing: editor,
  // 잠긴 자리를 눌렀는가. 그렇다면 선택을 만들지 않고 이유만 말한다 (결정 13).
  isBlocked: (target) => blocked.claim(target),
  // 버튼바가 부르는 것들 — 옮기기·넣기·지우기가 한 자리에 모인다.
  actions: {
    canMove: reorder.canMove,
    moveElement: reorder.moveElement,
    canInsert: structure.canInsert,
    canRemove: structure.canRemove,
    vocabulary: structure.vocabulary,
    insert: structure.insert,
    remove: structure.remove,
    // 자유 배치 (로드맵 5단계 · §2.2 canvas 규칙).
    isFree: free.isFree,
    canFree: free.canFree,
    toggleFree: (nodeId) => (free.isFree(nodeId) ? free.toFlow(nodeId) : free.toFree(nodeId)),
  },
});

function showSelectionState(state) {
  // 무엇이 골라졌는지 바뀔 때마다 크기 손잡이를 붙이거나 걷는다. 자유 배치가 아니면
  // 걷는 것이 맞다 — 흐름 배치의 크기는 컨테이너가 정한다(결정 3).
  resize.sync(state.kind === 'editing' ? null : selection.selected);

  // 편집이 끝났다는 신호다. 무엇이 골라져 있는지는 선택 계층만 아므로 되묻는다.
  if (state.kind === 'idle') return void selection.refresh();

  selState.textContent = state.text;
  selState.classList.toggle('locked', state.kind === 'locked');
  selState.classList.toggle('editing', state.kind === 'editing');
  syncRibbon();
  // 서식 칸은 **무엇이** 골라졌는지만 알면 된다. 이름은 선택 계층이 들고 있는 것을
  // 그대로 쓴다 — 두 벌이 되면 같은 것이 두 이름으로 불리는 날이 온다.
  inspector.show(
    state.kind === 'selected' ? state.nodeId : null,
    state.info ? (LABELS[state.info.value] ?? state.info.value) : '',
  );
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
  setup.close();
  stage.removeAttribute('src');       // 목록으로 나오면 슬라이드를 내려놓는다
  selection.clear();
  adopt.hide();
  adopt.close();
  currentOutline = null;

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

async function showEditor(deckId, startSlide = 0, selectId = null) {
  views.decks.hidden = true;
  views.editor.hidden = false;
  setup.close();

  const info = (await decks()).find((d) => d.deckId === deckId);
  deckName.textContent = deckId;
  deckSub.textContent = info?.label ?? '';

  // 열자마자 한 번 알린다 — 고치려다 막히는 것보다 못 고친다고 미리 말하는 편이 낫다.
  // 목록이 아는 것은 덱 수준(문법 선언 여부)까지다. 장별 실상은 목차가 와야 알고,
  // `mountStage` 가 그때 이 자리를 다시 쓴다.
  deckState.classList.toggle('locked', info ? !info.annotated : false);
  deckState.textContent = info && !info.annotated ? '편집 불가 — 문법 선언 없음' : '';

  rail.replaceChildren(note('여는 중…'));
  selection.clear();
  // 막은 걷되 **남은 것 목록은 그대로 둔다.** "고치기" 뒤의 다시 받기가 바로 이 경로를
  // 지나가고, 여기서 같이 지우면 사용자는 자기가 할 일을 못 본 채 화면만 깜빡인 게 된다.
  adopt.hide();
  open.deckId = deckId;
  open.docHash = null;

  // 목차를 슬라이드와 **함께** 받는다. 목차 없이 뜬 화면은 클릭이 먹지 않는 화면이고,
  // 사용자에게는 그것이 고장과 구별되지 않는다.
  const outline = fetch(`/deck/${encodeURIComponent(deckId)}/outline`)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);

  // 슬라이드는 원본 그대로 띄운다. 편집 표시는 이 바깥(부모 문서)이 얹는다.
  // 캐시가 남으면 방금 저장한 것이 화면에 안 나온다. 다시 받을 때는 주소를 달리한다.
  stage.src = `/deck/${encodeURIComponent(deckId)}/page?t=${performance.now()}`;

  // **화면이 실제로 선 뒤에** 끝난다. 예전에는 `onload` 를 걸어 두고 바로 돌아왔는데,
  // 그러면 `await showEditor(...)` 로 기다린 쪽이 **옛 문서**를 붙잡고 일한다 — 표 도구가
  // 행을 넣은 뒤 표를 다시 열려다 사라진 iframe 의 표를 잡았고, 칸 테두리가 폭 0 으로
  // 남았다(실측). 기다린 쪽에 그 사실을 숨기지 않는다.
  await new Promise((done) => {
    stage.onload = async () => {
      mountStage(await outline, startSlide, selectId);
      done();
    };
  });
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
function mountStage(outline, startSlide = 0, selectId = null) {
  const doc = stage.contentDocument;
  const sections = [...doc.querySelectorAll('section')];

  // 덱이 자기 원래 크기를 적어 두었다(`<deck-stage width= height=>`). 배율은 그 값을
  // 알아야 계산된다 — 1280×720 을 상수로 박으면 다른 크기의 덱에서 어긋난다.
  viewport.adoptDesign(doc);

  if (!sections.length) {
    rail.replaceChildren(note('슬라이드를 찾지 못했습니다.'));
    return;
  }

  const el = doc.querySelector('deck-stage');
  // 내장 레일 감추기. `no-rail` 은 그 요소가 지켜보는 속성이라 뜬 뒤에 붙여도 먹는다.
  if (el) el.setAttribute('no-rail', '');
  hideDeckChrome(el);

  // 그리기 재료를 한 번 읽어 둔다. 장마다 읽으면 그때마다 레이아웃이 강제된다.
  thumbs.load(doc);

  const items = sections.map((section, i) => {
    const b = document.createElement('div');
    b.setAttribute('role', 'button');
    b.tabIndex = 0;
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

    // 잠긴 장은 레일에서 미리 보인다 — 열어 봐야 아는 것과, 목록에서 아는 것은 다르다.
    if (outline && !outline.sections[i]?.annotated) b.classList.add('locked');

    b.append(n, thumbs.frameFor(section), t, moreButton(i));
    b.draggable = true;
    b.addEventListener('click', () => goTo(el, sections, i));
    // `<button>` 안에 `<button>` 을 넣을 수 없어 항목을 div 로 바꿨다. 키보드로 고르는
    // 길은 버튼이 공짜로 주던 것이므로 여기서 돌려준다.
    b.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      goTo(el, sections, i);
    });
    return b;
  });

  // 목차를 먼저 세운다 — 아래 `select` 가 잠금 여부를 이것으로 판정한다.
  currentOutline = outline;
  showDeckLock(outline);

  rail.replaceChildren(...items);
  bindRailDrag();
  select(startSlide);
  if (startSlide) goTo(el, sections, startSlide);

  // 클릭으로 요소를 고를 수 있게 만드는 자리. 목차를 못 받았으면 붙이지 않는다 —
  // 붙여 두면 클릭이 아무 일도 하지 않고, 사용자는 왜인지 알 방법이 없다.
  if (outline) {
    // 저장의 근거가 되는 지문이다. 목차와 슬라이드를 같은 파일에서 받았으므로 맞는다.
    open.docHash = outline.docHash;
    history.update(outline.rings);
    blocked.load(outline);
    selection.load(outline);
    // 끌기가 선택보다 **먼저** 붙는다 — 끌기 뒤에 오는 click 을 삼켜야 하기 때문이다.
    drag.bind(doc);
    selection.bind(doc);
    // 슬라이드 위로 파일을 끌어다 놓기. 안 걸면 브라우저가 그 창에서 파일을 열어
    // 슬라이드가 사진으로 바뀐다 — 되돌리기로도 못 고치는 종류의 사고다.
    picture.bind(doc);
    resize.watch(doc);
    // 슬라이드 위의 오른쪽 단추. 문서가 새로 뜰 때마다 건다 — iframe 안은 매번 다른
    // 문서다(레일과 반대다. 레일은 살아남으므로 한 번만 건다).
    bindSlideMenu(doc);
    // 붙여넣기는 초점이 있는 문서만 받는다. 슬라이드를 누른 뒤의 Ctrl+V 가 여기로 온다.
    doc.addEventListener('paste', onPaste);
    // 초점이 슬라이드 안에 있을 때의 Ctrl+Z. 부모 창에만 달면 슬라이드를 한 번 누른
    // 뒤에는 단축키가 안 듣는다 — 사용자에게는 그것이 고장으로 보인다.
    doc.addEventListener('keydown', (e) => history.onKey(e, !!editor.active()), true);
    selection.setSlide(startSlide);
    blocked.setSlide(startSlide);
    // 덱이 이제야 섰다. 테마 칸이 열려 있으면 **여기서** 값을 읽는다 — 화면이 뜨기 전에
    // 읽으면 빈 문서를 재게 되고, 그러면 멀쩡한 손잡이가 죽은 것으로 나온다.
    if (inspector.isOpen()) theme.refresh();
    // 방금 넣은 요소를 골라 둔다. 눈으로 찾게 하지 않는 것이 목적이다.
    if (selectId) selection.pick(selectId);
  } else {
    showSelectionState({ kind: 'locked', text: '목차를 받지 못했습니다 — 고르기가 꺼져 있습니다' });
  }

  // 캔버스 쪽에서 장이 바뀌어도(키보드 ←/→) 레일 표시가 따라간다.
  el?.addEventListener('slidechange', (e) => {
    select(e.detail.index);
    // 안 보이는 요소를 고른 채로 두면 다음 명령이 엉뚱한 장으로 간다.
    if (outline) {
      selection.setSlide(e.detail.index);
      blocked.setSlide(e.detail.index);
    }
  });
}

/**
 * 레일 항목의 "더 보기" 하나.
 *
 * 예전에는 위·아래·복제·지우기 넷이 마우스를 올렸을 때 떴다. 넷이 서 있던 자리가 이제
 * **슬라이드 그림**이라 버튼이 그림을 가린다. 하나로 줄이고 나머지는 메뉴로 보낸다.
 *
 * 오른쪽 단추만 남기지 않는 이유 — 오른쪽 단추는 눈에 보이지 않는 문이다. 점 세 개는
 * "여기 더 있다" 를 자리를 거의 안 쓰고 말해 준다.
 */
function moreButton(index) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'rail-more';
  setIcon(b, 'more', '이 장으로 할 수 있는 일');
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    const r = b.getBoundingClientRect();
    openSlideMenu(index, r.left, r.bottom + 4);
  });
  return b;
}

/**
 * 이 장으로 할 수 있는 일.
 *
 * 할 수 없는 줄도 자리를 지킨다 — 첫 장에서 "위로" 가 사라지면 그 아래 줄들이 한 칸씩
 * 올라오고, 그러면 "지우기" 가 매번 다른 자리에 온다 (`menu.js` 에 같은 이야기).
 */
function openSlideMenu(index, x, y) {
  const total = currentOutline?.sections.length ?? 0;
  menu.open(x, y, [
    { label: '위로', name: 'railUp', hint: 'Alt+↑', on: index > 0, run: () => slides.move(index, -1) },
    { label: '아래로', name: 'railDown', hint: 'Alt+↓', on: index < total - 1, run: () => slides.move(index, +1) },
    null,
    { label: '복제', name: 'duplicate', hint: 'Ctrl+D', run: () => slides.duplicate(index) },
    { label: '지우기', name: 'remove', hint: 'Del', on: total > 1, danger: true, run: () => slides.remove(index) },
  ]);
}

/**
 * 레일의 오른쪽 단추와 글쇠. **한 번만 건다.**
 *
 * 레일 요소는 리포트를 다시 받아도 살아 있고 항목만 갈린다. 장을 지을 때마다 걸면
 * 처리기가 쌓여서 세 번째 커밋 뒤에는 오른쪽 단추 한 번에 메뉴가 셋 열린다. 항목의
 * 번호는 이벤트에서 그때그때 읽으므로 다시 걸 이유도 없다.
 *
 * 손이 셋이다 — 오른쪽 단추 · 길게 누르기 · 글쇠. 셋이 같은 메뉴, 같은 명령으로 간다.
 * 글쇠에 `Alt` 를 붙이는 이유: 맨 ↑/↓ 는 목록에서 **고르는** 뜻으로 이미 예약되어
 * 있고, 옮기는 것과 고르는 것을 같은 글쇠에 얹으면 실수로 순서가 바뀐다.
 */
function bindRailMenu() {
  const indexOf = (target) => {
    const item = target?.closest?.('.rail-item');
    return item ? Number(item.dataset.index) : null;
  };

  rail.addEventListener('contextmenu', (e) => {
    const i = indexOf(e.target);
    if (i === null) return;
    e.preventDefault();
    openSlideMenu(i, e.clientX, e.clientY);
  });

  // 손가락·펜에는 오른쪽 단추가 없다. 길게 누르기가 그 자리를 대신한다.
  menu.longPress(rail, (e) => {
    const i = indexOf(e.target);
    if (i === null) return null;
    const total = currentOutline?.sections.length ?? 0;
    return [
      { label: '위로', name: 'railUp', on: i > 0, run: () => slides.move(i, -1) },
      { label: '아래로', name: 'railDown', on: i < total - 1, run: () => slides.move(i, +1) },
      null,
      { label: '복제', name: 'duplicate', run: () => slides.duplicate(i) },
      { label: '지우기', name: 'remove', on: total > 1, danger: true, run: () => slides.remove(i) },
    ];
  });

  rail.addEventListener('keydown', (e) => {
    const i = indexOf(e.target);
    if (i === null) return;

    // 메뉴 글쇠(⌨ Menu / Shift+F10) — 오른쪽 단추의 글쇠판 짝이다.
    if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault();
      const r = e.target.getBoundingClientRect();
      return openSlideMenu(i, r.left + 20, r.top + 20);
    }
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      return void slides.move(i, e.key === 'ArrowUp' ? -1 : +1);
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      return void slides.duplicate(i);
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      return void slides.remove(i);
    }
    // 맨 ↑/↓ 는 고르기다. 목록에서 늘 그런 뜻이라 여기서도 그래야 한다.
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const to = i + (e.key === 'ArrowUp' ? -1 : +1);
      const next = rail.children[to];
      if (!next?.dataset) return;
      e.preventDefault();
      next.focus();
      next.click();
    }
  });
}

/**
 * 레일에서 끌어 슬라이드 순서 바꾸기 (결정 6).
 *
 * **놓을 자리를 선으로 보인다.** 흐름 배치에서 끌기는 "아무 데나 놓기" 가 아니라
 * "몇 번째에 끼우기" 이므로, 어디에 들어갈지가 보이지 않으면 사용자는 결과를 예측할 수
 * 없다 (결정 3 의 같은 이유다).
 *
 * 순서가 바뀌면 페이지 번호가 문서 전체에서 다시 매겨지므로 화면을 다시 받는다.
 */
function bindRailDrag() {
  let from = null;

  const clearMarks = () => {
    for (const item of rail.children) item.classList?.remove('drop-before', 'drop-after');
  };

  rail.ondragstart = (e) => {
    const item = e.target.closest?.('.rail-item');
    if (!item) return;
    from = Number(item.dataset.index);
    e.dataTransfer.effectAllowed = 'move';
    // 파이어폭스는 데이터가 없으면 끌기를 시작조차 하지 않는다.
    e.dataTransfer.setData('text/plain', String(from));
  };

  rail.ondragover = (e) => {
    const item = e.target.closest?.('.rail-item');
    if (from === null || !item) return;
    e.preventDefault();
    const r = item.getBoundingClientRect();
    const after = e.clientY > r.top + r.height / 2;
    clearMarks();
    item.classList.add(after ? 'drop-after' : 'drop-before');
  };

  rail.ondragleave = (e) => {
    if (!rail.contains(e.relatedTarget)) clearMarks();
  };

  rail.ondrop = async (e) => {
    const item = e.target.closest?.('.rail-item');
    clearMarks();
    if (from === null || !item) return;
    e.preventDefault();

    const over = Number(item.dataset.index);
    const r = item.getBoundingClientRect();
    const after = e.clientY > r.top + r.height / 2;
    // 자기 자신을 뗀 뒤의 자리로 센다 — 서버의 `moveSection` 도 같은 셈법이다.
    let to = after ? over + 1 : over;
    if (from < to) to -= 1;
    const source = from;
    from = null;
    if (to === source) return;

    const section = selection.sectionAt(source);
    if (!section?.nodeId) {
      return showNotice({ kind: 'blocked', text: '이 슬라이드는 이름표가 없어 옮길 수 없습니다' });
    }
    await reorder.moveSection(section.nodeId, to, `${source + 1}장을 ${to + 1}번째로`);
  };

  rail.ondragend = () => { from = null; clearMarks(); };
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
  blocked.setSlide(i);
}

function select(i) {
  currentSlide = i;
  background.refresh();
  syncRibbon();
  for (const b of rail.children) {
    if (b.dataset) b.setAttribute('aria-current', String(Number(b.dataset.index) === i));
  }
  syncLock(i);
}

/**
 * 머리글의 잠금 표시 — **몇 장이** 아직 못 고치는가.
 *
 * "편집 불가" 하나로 말하지 않는 이유 — 이름표를 붙이기 시작한 덱은 고친 장과 안 고친
 * 장이 섞여 있고, 그때 "편집 불가" 는 거짓이다. 사용자가 고치기를 누를 때마다 이 수가
 * 줄어드는 것이 진행 상황 그 자체다.
 */
function showDeckLock(outline) {
  if (!outline) {
    deckState.classList.add('locked');
    deckState.textContent = '목차를 받지 못했습니다';
    return;
  }
  const locked = outline.sections.filter((s) => !s.annotated).length;
  deckState.classList.toggle('locked', locked > 0);
  deckState.textContent = locked ? `${locked}장이 아직 편집 불가` : '';
}

/**
 * 이 장이 잠겼는가 — 막을 씌우거나 걷는다 (결정 9).
 *
 * 잠금은 **장마다** 다르다. 이름표를 갓 붙이기 시작한 덱은 고친 장과 안 고친 장이
 * 섞여 있고, 덱 전체를 하나로 잠그면 이미 고친 장까지 못 쓰게 된다 (`outline.js` 가
 * `annotated` 와 `blockers` 를 따로 재 둔 이유가 이것이다).
 */
function syncLock(i) {
  if (!currentOutline) return void adopt.hide();
  const section = currentOutline.sections[i];
  if (section && !section.annotated) adopt.show(section, i);
  else adopt.hide();
}

/* ------------------------------------------------------------------ 라우팅 */

function route() {
  const m = location.hash.match(/^#\/deck\/(.+)$/);
  if (m) return showEditor(decodeURIComponent(m[1]));
  if (location.hash === '#/new') return showSetup();
  showDeckList();
}

/** 새 리포트 설정 화면. 목록·편집기와 같은 자리(주소)를 쓰므로 뒤로 가기가 그대로 먹는다. */
function showSetup() {
  views.decks.hidden = true;
  views.editor.hidden = true;
  stage.removeAttribute('src');
  selection.clear();
  setup.open();
}

document.getElementById('new-deck').addEventListener('click', () => { location.hash = '#/new'; });

document.getElementById('present').addEventListener('click', () => present.start());

document.getElementById('logo-file').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  // 같은 파일을 다시 골라도 `change` 가 나도록 비워 둔다.
  e.target.value = '';
  if (file) await logo.apply(file);
});

/**
 * 붙여넣기로 그림 넣기.
 *
 * 두 군데에 건다. 초점이 슬라이드 안에 있을 때와 밖(레일·도구 모음)에 있을 때 Ctrl+V 는
 * 같은 뜻이어야 하는데, iframe 은 자기 안의 붙여넣기만 받는다. 글자를 고치는 중이면
 * 넘긴다 — 그때 Ctrl+V 는 "이 자리에 글자" 이지 "그림" 이 아니다.
 */
function onPaste(e) {
  if (views.editor.hidden) return;
  picture.paste(e, { selectedId: selection.selected, editing: !!editor.active() });
}
addEventListener('paste', onPaste);

addEventListener('hashchange', route);

// 초점이 iframe 밖(레일·머리글)에 있을 때도 Esc 는 같은 뜻이어야 한다. 안에서만 먹으면
// 레일을 누른 직후에 Esc 가 안 듣고, 그건 사용자에게 고장으로 보인다.
addEventListener('keydown', (e) => {
  if (views.editor.hidden) return;
  if (e.key === 'Escape') return void selection.escape();
  history.onKey(e, !!editor.active());
});

/**
 * 겹쳐 그린 것을 전부 제자리에 다시 놓는다.
 *
 * 슬라이드 위에 떠 있는 것이 셋이다 — 선택 테두리·불투명 편집 패널·표의 칸 테두리.
 * (잠금 빗금도 있었는데, 막힌 자리가 0 이 되면서 없앴다 — `blocked.js` 머리말.) 셋은
 * 열 때 좌표를 한 번 재고 그 자리에 머무르므로, 밑의 슬라이드가 움직이면(배율·창 크기·
 * 글이 늘어 줄바꿈이 바뀜) 따로 놀기 시작한다. **한 곳에서 같이 부르는 이유**가
 * 이것이다: 하나라도 빠뜨리면 그 하나만 엉뚱한 자리에 남고, 그 증상은 "가끔 어긋난다"
 * 라서 원인을 찾기 어렵다.
 */
function reflow() {
  selection.place();
  opaque.reposition();
  table.place();
  resize.place();
  // 끌거나 손잡이로 크기를 바꾸면 판의 숫자도 따라와야 한다 — 안 따라오면 판이
  // 방금 내가 한 일을 모르는 것처럼 보인다.
  inspector.refresh();
  // 레일 폭이 달라지면 그림의 배율도 달라진다. 이미 만든 것들만 다시 잰다.
  thumbs.relayout(rail);
}

// 창 크기가 바뀌면 슬라이드 배율이 바뀌고 테두리가 어긋난다.
// (맞춤 배율의 재계산은 `viewport` 가 캔버스를 직접 지켜보며 한다 — 창은 그대로인데
//  레일만 넓어지는 경우를 `resize` 는 알려주지 않는다.)
addEventListener('resize', reflow);

/* ------------------------------------------------------------------ 배율
 *
 * 슬라이드를 얼마나 크게 볼지. 배율이 바뀌면 겹쳐 그린 테두리가 어긋나므로
 * 한 번의 변화가 언제나 **다시 그리기**로 이어져야 한다 — 그 연결이 여기다.
 */
const zoomIn = document.getElementById('zoom-in');
const zoomOut = document.getElementById('zoom-out');

const viewport = createViewport({
  canvas: canvasEl,
  stage,
  onChange: ({ zoom, mode, atMin, atMax }) => {
    zoomVal.textContent = `${Math.round(zoom * 100)}%`;
    zoomFit.setAttribute('aria-pressed', String(mode === 'fit'));
    zoomIn.disabled = !!atMax;
    zoomOut.disabled = !!atMin;
    reflow();
  },
});

zoomIn.addEventListener('click', () => viewport.step(+1));
zoomOut.addEventListener('click', () => viewport.step(-1));
// 배율 숫자 자체가 "원래 크기로" 버튼이다. 파워포인트에서 백분율을 누르면 대화상자가
// 뜨지만, 우리는 고를 것이 아홉 개뿐이라 상자를 띄울 값이 없다.
zoomVal.addEventListener('click', () => viewport.actual());
zoomFit.addEventListener('click', () => viewport.fit());

/* ------------------------------------------------------------------ 리본
 *
 * 탭 넷(홈·삽입·디자인·배치)에 도구를 나눠 담는다. 배경·되돌리기·로고·테마는 자리를
 * 옮겼을 뿐 하는 일이 같아서 아래 배선이 손대지 않는다 — 그 버튼들은 `index.html` 에서
 * id 를 그대로 들고 갔고, 각자의 모듈이 id 로 찾는다.
 *
 * 여기서 새로 배선하는 것은 **리본이 처음 자리를 준 것들**이다: 지금 보는 장의 조작,
 * 고른 요소의 조작, 그리고 어휘에서 만들어 붙이는 삽입 목록.
 */
const ribbon = createRibbon({
  tabs: document.getElementById('tabs'),
  ribbon: document.getElementById('ribbon'),
  // 삽입 탭은 어휘를 받아야 채워진다. 열 때 채우면 첫 클릭이 빈 칸을 본다.
  onTab: (name) => { if (name === 'insert') fillInsertTypes(); },
});

/**
 * 리본의 테마 버튼은 이제 **판을 여는 버튼**이다.
 *
 * 색을 고르는 동안 슬라이드가 가려지면 안 된다 — 뜨는 창은 정의상 무언가를 덮고,
 * 여기서 덮이는 것이 하필 그 색이 칠해지는 자리였다.
 */
document.getElementById('theme').addEventListener('click', () => inspector.open('theme'));

/** 지금 보는 장에 걸리는 넷. 레일의 같은 넷과 달리 **보고 있는 장**이 대상이다. */
for (const [id, run] of [
  ['slide-up', () => slides.move(currentSlide, -1)],
  ['slide-down', () => slides.move(currentSlide, +1)],
  ['slide-dup', () => slides.duplicate(currentSlide)],
  ['slide-del', () => slides.remove(currentSlide)],
]) {
  document.getElementById(id).addEventListener('click', run);
}

/**
 * 고른 요소에 걸리는 것들.
 *
 * 고른 것이 없으면 **아무 일도 하지 않는다** — 버튼이 이미 꺼져 있으므로 여기 오지
 * 않지만, 키보드나 경합으로 새어 들어올 수 있는 길을 막아 둔다.
 */
for (const [id, run] of [
  ['el-up', (n) => reorder.moveElement(n, -1)],
  ['el-down', (n) => reorder.moveElement(n, +1)],
  ['el-dup', (n) => group.duplicate(n)],
  ['el-del', (n) => structure.remove(n)],
  ['el-free', (n) => (free.isFree(n) ? free.toFlow(n) : free.toFree(n))],
  ['el-wrap', (n) => openWrapMenu(n)],
  ['el-unwrap', (n) => group.unwrap(n)],
]) {
  document.getElementById(id).addEventListener('click', () => {
    const nodeId = selection.selected;
    if (nodeId) run(nodeId);
  });
}

/** 그림 넣기. 로고와 같은 모양이지만 **고른 것 옆에** 들어간다는 점이 다르다. */
document.getElementById('pic-file').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  if (!selection.selected) {
    return showNotice({ kind: 'blocked', text: '먼저 그림을 넣을 자리 옆의 요소를 고르세요' });
  }
  await picture.insert(file, selection.selected);
});

/**
 * 삽입 탭의 종류 목록 — **테마 매핑이 정한다** (`GET /vocabulary`).
 *
 * 한 번 채우고 그대로 둔다. 어휘는 덱이 아니라 테마에서 오므로 리포트를 옮겨 다녀도
 * 같다 (`structure.vocabulary` 가 이미 한 번만 받는다).
 */
let insertFilled = false;
async function fillInsertTypes() {
  if (insertFilled) return;
  const types = await structure.vocabulary();
  const leaf = document.getElementById('insert-leaf');
  const box = document.getElementById('insert-box');
  if (!types.length) {
    leaf.textContent = '넣을 수 있는 종류를 받지 못했습니다';
    return;
  }
  insertFilled = true;

  leaf.replaceChildren(...types.filter((t) => t.group !== 'container').map(chip));
  box.replaceChildren(...types.filter((t) => t.group === 'container').map(chip));
  syncRibbon();

  function chip(t) {
    const b = document.createElement('button');
    b.type = 'button';
    const name = LABELS[t.type] ?? t.type;
    // 아이콘이 있는 종류만 그림이 붙는다. 어휘는 테마가 늘리므로 여기서 이름을
    // 지어내지 않는다 — 그림이 없으면 글자만 뜬다.
    setIconText(b, t.type, name);
    b.title = `${name} 넣기`;
    b.addEventListener('click', () => {
      const nodeId = selection.selected;
      if (!nodeId) return showNotice({ kind: 'blocked', text: '먼저 어느 것 아래에 넣을지 고르세요' });
      structure.insert(nodeId, t.type, t.variants?.[0] ?? 'default');
    });
    return b;
  }
}

/** 어휘 값의 화면 이름. `select.js` 의 같은 표와 짝이다 — 사용자가 보는 말은 하나여야 한다. */
const LABELS = {
  title: '제목', subtitle: '부제', kicker: '머리말', hero: '표지 제목', heading: '소제목',
  meta: '정보', text: '문단', list: '목록', step: '단계', citation: '인용', caption: '설명',
  table: '표', image: '그림', figure: '그림틀', metric: '지표', pill: '꼬리표',
  callout: '강조', code: '코드', rule: '구분선', equation: '수식', progress: '진행바',
  stack: '세로 묶음', row: '가로 묶음', grid: '격자', group: '묶음', card: '카드',
  sequence: '흐름', canvas: '자유 배치', region: '영역',
};

/**
 * 묶기 — 어떤 상자에 넣을지 고른다.
 *
 * 하나를 박아 두지 않는 이유는 `group.js` 에 적혀 있다: 어휘에 없는 종류를 보내면 422 고,
 * 어휘는 테마가 정한다. 목록이 하나뿐이면 묻지 않고 바로 씌운다 — 고를 것이 없는 물음은
 * 물음이 아니다.
 */
async function openWrapMenu(nodeId, x = null, y = null) {
  const boxes = await group.boxes();
  if (!boxes.length) {
    return showNotice({ kind: 'blocked', text: '이 테마에는 씌울 수 있는 상자가 없습니다' });
  }
  if (boxes.length === 1) return void group.wrap(nodeId, boxes[0].type, boxes[0].variants?.[0] ?? 'default');

  let at = { x, y };
  if (x === null) {
    const r = document.getElementById('el-wrap').getBoundingClientRect();
    at = { x: r.left, y: r.bottom + 4 };
  }
  menu.open(at.x, at.y, boxes.map((t) => ({
    label: LABELS[t.type] ?? t.type,
    name: t.type,
    run: () => group.wrap(nodeId, t.type, t.variants?.[0] ?? 'default'),
  })));
}

/**
 * 슬라이드 위에서 오른쪽 단추.
 *
 * **먼저 고르고 나서 연다.** 파워포인트가 그렇게 하고, 그래야 메뉴의 각 줄이 무엇에
 * 걸리는지가 화면의 테두리로 보인다 — 안 고르고 열면 사용자는 자기가 가리킨 것과 메뉴가
 * 말하는 것이 같은지 확인할 방법이 없다.
 *
 * 판정은 전부 원래 주인에게 묻는다(`syncRibbon` 과 같은 규율). 여기서 스스로 판단하기
 * 시작하면 메뉴가 켜 놓은 줄을 눌렀는데 서버가 422 를 내는 날이 온다.
 */
function bindSlideMenu(doc) {
  doc.addEventListener('contextmenu', (e) => {
    // 글자를 고치는 중에는 브라우저의 것을 그대로 둔다 — 거기서 오른쪽 단추는
    // 맞춤법·붙여넣기이고, 그것을 뺏으면 편집이 오히려 불편해진다.
    if (editor.active()?.contains(e.target)) return;

    const nodeId = nodeUnder(e.target);
    if (!nodeId) return;
    e.preventDefault();

    // 화면 좌표로 옮긴다 — iframe 안의 좌표는 그 창 기준이다.
    const f = stage.getBoundingClientRect();
    const x = f.left + e.clientX;
    const y = f.top + e.clientY;

    if (selection.selected !== nodeId) selection.pick(nodeId);
    openElementMenu(nodeId, x, y);
  }, true);
}

/** 이 자리에서 고를 수 있는 가장 안쪽 노드. 목차가 모르는 것은 건너뛴다. */
function nodeUnder(target) {
  for (let el = target; el; el = el.parentElement) {
    const id = el.dataset?.nodeId;
    if (id && selection.infoOf(id)) return id;
  }
  return null;
}

function openElementMenu(nodeId, x, y) {
  const isFree = free.isFree(nodeId);
  menu.open(x, y, [
    { label: '위로', name: 'up', on: reorder.canMove(nodeId, -1), run: () => reorder.moveElement(nodeId, -1) },
    { label: '아래로', name: 'down', on: reorder.canMove(nodeId, +1), run: () => reorder.moveElement(nodeId, +1) },
    null,
    { label: '복제', name: 'duplicate', on: group.canDuplicate(nodeId), run: () => group.duplicate(nodeId) },
    {
      label: isFree ? '흐름 배치로' : '자유 배치로',
      name: isFree ? 'flow' : 'free',
      on: isFree || free.canFree(nodeId),
      run: () => (isFree ? free.toFlow(nodeId) : free.toFree(nodeId)),
    },
    { label: '묶기', name: 'group', on: group.canWrap(nodeId), run: () => openWrapMenu(nodeId, x, y) },
    { label: '풀기', name: 'ungroup', on: group.canUnwrap(nodeId), run: () => group.unwrap(nodeId) },
    null,
    { label: '서식 창 열기', name: 'format', run: () => inspector.open('geom') },
    {
      label: '지우기', name: 'remove', danger: true,
      on: structure.canRemove(nodeId), run: () => structure.remove(nodeId),
    },
  ]);
}

/**
 * 리본의 켜고 끔.
 *
 * **판정은 전부 원래 주인에게 묻는다.** 옮길 수 있는지는 `reorder` 가, 지울 수 있는지는
 * `structure` 가, 묶을 수 있는지는 `group` 이 안다. 리본이 스스로 판단하기 시작하면
 * 켜 놓은 버튼을 눌렀는데 서버가 422 를 내는 날이 온다.
 */
function syncRibbon() {
  const n = selection.selected;
  const total = currentOutline?.sections.length ?? 0;
  const isFree = n ? free.isFree(n) : false;

  ribbon.sync({
    'slide-up': currentSlide > 0,
    'slide-down': currentSlide < total - 1,
    'slide-dup': total > 0,
    'slide-del': total > 1,
    'el-up': !!n && reorder.canMove(n, -1),
    'el-down': !!n && reorder.canMove(n, +1),
    'el-dup': !!n && group.canDuplicate(n),
    'el-del': !!n && structure.canRemove(n),
    'el-free': !!n && (isFree || free.canFree(n)),
    'el-wrap': !!n && group.canWrap(n),
    'el-unwrap': !!n && group.canUnwrap(n),
  });

  // 이미 자유 배치인 것은 되돌리는 버튼이다 — 같은 자리에서 뜻만 뒤집는다
  // (선택 버튼바가 하는 것과 같다).
  setIconText(document.getElementById('el-free'), isFree ? 'flow' : 'free',
    isFree ? '흐름으로' : '자유 배치');
  document.getElementById('el-free').title = isFree
    ? '흐름 배치로 되돌리기 — 다시 위에서 아래로 쌓입니다'
    : '자유 배치 — 아무 데나 끌어다 놓기';

  // 삽입 탭은 고른 것 **아래에** 넣는다. 고른 것이 없으면 넣을 자리가 없다.
  const canPut = !!n && structure.canInsert(n);
  for (const b of document.querySelectorAll('#insert-leaf button, #insert-box button')) b.disabled = !canPut;
  document.getElementById('pic-pick').classList.toggle('off', !canPut);
  document.getElementById('pic-file').disabled = !canPut;
  for (const g of document.querySelectorAll('.rb-group[data-needs="insert"]')) g.classList.toggle('dead', !canPut);
}

// 배선이 다 끝났다. 이제 처음 열린 탭과 판이 자기 몫을 채울 수 있다
// (`ribbon.js`·`inspector.js` 의 `start`).
ribbon.start();
inspector.start();
bindRailMenu();

paintIcons();

/**
 * 글자로 된 버튼을 아이콘으로 갈아 끼운다 (Lucide).
 *
 * HTML 에는 글자를 남겨 두고 여기서 바꾸는 이유 — 스크립트가 실패해도 버튼에 이름이
 * 남는다. 아이콘만 박아 두면 그때 화면에 뜻 모를 빈 사각형만 줄지어 남는다.
 * 바꾸면서 원래 글자는 `title` 로 옮겨 간다(`setIcon`).
 */
function paintIcons() {
  // 리본의 큰 버튼 — 아이콘 **위에** 글자. 파워포인트가 자주 쓰는 것을 크게 두는 방식이고,
  // 이름이 같이 보여야 하는 것들이다(누른 뒤에야 무슨 일이 일어났는지 아는 종류).
  setIconText(undoButton, 'undo', '되돌리기');
  setIconText(redoButton, 'redo', '다시하기');
  setIconText(document.getElementById('theme'), 'palette', '테마');
  setIconText(document.getElementById('el-free'), 'free', '자유 배치');

  // 작은 버튼 — 아이콘만. 글자는 `title` 로 옮겨 간다(`setIcon`).
  for (const [id, name] of [
    ['bg-light', 'light'], ['bg-dark', 'dark'], ['bg-all', 'all'],
    ['slide-up', 'railUp'], ['slide-down', 'railDown'],
    ['slide-dup', 'duplicate'], ['slide-del', 'remove'],
    ['el-up', 'up'], ['el-down', 'down'], ['el-dup', 'duplicate'], ['el-del', 'remove'],
    ['el-wrap', 'group'], ['el-unwrap', 'ungroup'],
    ['zoom-in', 'zoomIn'], ['zoom-out', 'zoomOut'], ['zoom-fit', 'fit'],
  ]) {
    setIcon(document.getElementById(id), name);
  }

  setIconText(document.getElementById('present'), 'present', '발표');
  setIconText(document.getElementById('new-deck'), 'newDeck', '새 리포트');
  setIconText(document.querySelector('#topbar .back'), 'back', '목록');
  setIconText(document.getElementById('pane-toggle'), 'format', '서식');

  // 그림·로고는 이름표(label) 안에 파일 고르개를 품고 있다. 안을 갈아 끼우면 그것까지
  // 쓸려 나가고, 그러면 눌러도 파일 창이 안 열린다 — 빼 두었다가 도로 넣는다.
  for (const [id, name, text] of [['pic-pick', 'image', '그림'], ['logo-pick', 'logo', '로고']]) {
    const pick = document.getElementById(id);
    const input = pick.querySelector('input');
    setIconText(pick, name, text);
    pick.append(input);
  }
}

route();
