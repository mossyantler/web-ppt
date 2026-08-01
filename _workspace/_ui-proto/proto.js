/* ── 편집 모드 UI/UX 프로토타입 엔진 ──────────────────────────────────
   4개 패러다임(floating / inspector / modes / outline)을 한 엔진으로
   구동한다. 선택·이동·복제·삭제·삽입·텍스트편집은 전부 진짜로 동작하고,
   저장만 가짜(토스트)다. 목적은 "어느 조작 방식이 손에 맞는가" 비교. */

const MODE = document.body.dataset.mode;

/* ── 삽입 가능한 정규 블록 (slides.css 기준 T1 컴포넌트) ── */
const BLOCKS = [
  ['카드', 'card', '<div class="card"><div class="card-head">카드 제목</div><p>본문을 입력합니다.</p></div>'],
  ['불릿 리스트', 'list', '<ul class="list"><li>항목 하나</li><li>항목 둘</li></ul>'],
  ['체크 리스트', 'list.check', '<ul class="list check"><li>완료한 일</li><li>완료한 일</li></ul>'],
  ['KPI 수치', 'kpi', '<div class="kpi"><div class="num">12<span class="unit">%</span></div><div class="lbl">지표 이름</div></div>'],
  ['표', 'tbl', '<table class="tbl"><tr><th>항목</th><th class="num">값</th></tr><tr><td>첫 행</td><td class="num">1.24</td></tr><tr><td>둘째 행</td><td class="num">0.87</td></tr></table>'],
  ['콜아웃', 'callout', '<div class="callout"><div class="q">논의가 필요한 지점</div><div class="a">교수님께 여쭐 내용을 적습니다.</div></div>'],
  ['상태 pill', 'pill', '<span class="pill done">완료</span>'],
  ['진행 바', 'prog-row', '<div class="prog-row"><div class="task">작업 이름</div><div class="prog-track"><div class="prog-fill" style="width:62%"></div></div><div class="pct">62%</div></div>'],
  ['타임라인', 'timeline', '<div class="timeline"><div class="tl-item"><div class="when">07.27</div><div class="dot"></div><div class="what"><b>할 일</b> 설명</div></div><div class="tl-item"><div class="when">07.31</div><div class="dot"></div><div class="what"><b>할 일</b> 설명</div></div></div>'],
  ['피규어 자리', 'figure', '<div class="figure"><div class="ic">▦</div><div class="cap">그래프 자리 — 이미지로 교체</div></div>'],
];

const GRIDS = ['(없음)', 'cols-2', 'cols-3', 'cols-5-7'];
const CLASS_TOGGLES = ['subtle', 'wide', 'muted', 'mono'];

/* ── 상태 ── */
let sel = null;        // 선택된 요소
let hov = null;        // 호버 중인 요소
let slideIdx = 0;
let undoStack = [];
let editMode = 'text'; // 모드 전환형 전용: text | struct | present

/* ── 셸 구성 ── */
const app = document.createElement('div'); app.id = 'app';
app.innerHTML = `
  <div id="topbar">
    <div class="modebar">
      <button data-em="text">✏︎ 텍스트</button>
      <button data-em="struct">▣ 구조</button>
      <button data-em="present">▶ 발표</button>
    </div>
    <span class="hint" id="modehint"></span>
    <div class="spacer"></div>
    <span class="hint">⌘Z 되돌리기 · ⌘S 저장</span>
  </div>
  <div id="body">
    <aside id="rail"></aside>
    <main id="canvas"><div id="fit"><div id="slidehost"></div></div></main>
    <aside id="side"></aside>
  </div>`;
document.body.append(app);

const overlay = document.createElement('div'); overlay.id = 'overlay';
const toast = document.createElement('div'); toast.id = 'toast';
const badge = document.createElement('div'); badge.id = 'badge';
badge.innerHTML = `프로토타입 · <a href="index.html">4안 비교로 돌아가기</a>`;
document.body.append(overlay, toast, badge);

const rail = document.getElementById('rail');
const host = document.getElementById('slidehost');
const fit = document.getElementById('fit');
const side = document.getElementById('side');
const canvas = document.getElementById('canvas');

/* ── 레일 ── */
const RAIL_LABELS = ['표지', '저번 주 활동', '논문 개요', '연구 흐름', 'PTM 지배방정식', 'PTM vs WRF'];
function buildRail() {
  rail.innerHTML = '<div class="railcap">Slides</div>';
  RAIL_LABELS.forEach((label, i) => {
    // 2·3번만 실제 슬라이드와 연결, 나머지는 자리표시자
    const real = i === 2 ? 0 : i === 5 ? 1 : -1;
    const t = document.createElement('div');
    t.className = 'thumb';
    if (real < 0) t.dataset.empty = '';
    t.innerHTML = `<span class="n">${String(i + 1).padStart(2, '0')}</span>${label}`;
    if (real === slideIdx) t.dataset.active = '';
    t.onclick = () => { if (real >= 0) { slideIdx = real; loadSlide(); } };
    rail.append(t);
  });
}

/* ── 슬라이드 로드 ── */
function loadSlide() {
  host.innerHTML = window.PROTO_SLIDES[slideIdx];
  sel = null; hov = null;
  renderKatex();
  buildRail();
  applyMode();
  refresh();
}

function renderKatex() {
  if (!window.katex) return;
  host.querySelectorAll('[data-tex]').forEach((n) => {
    try { katex.render(n.dataset.tex, n, { throwOnError: false }); } catch (e) { /* noop */ }
  });
}

/* ── 캔버스 스케일 맞춤 ── */
function fitCanvas() {
  const pad = 56;
  const s = Math.min((canvas.clientWidth - pad) / 1280, (canvas.clientHeight - pad) / 720);
  fit.style.transform = `scale(${s})`;
}
addEventListener('resize', () => { fitCanvas(); refresh(); });

/* ── 선택 헬퍼 ── */
function pickable(el) {
  if (!el || !host.contains(el)) return null;
  if (el.nodeType !== 1) el = el.parentElement;
  if (el.closest('.slide') === null) return null;
  if (el.classList.contains('slide')) return null;
  return el;
}
function label(el) {
  if (!el) return '';
  const c = el.className && typeof el.className === 'string'
    ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
  return el.tagName.toLowerCase() + c;
}
function chain(el) {
  const out = [];
  let n = el;
  while (n && !n.classList.contains('slide')) { out.unshift(n); n = n.parentElement; }
  return out;
}

function select(el) { sel = el; refresh(); }

/* ── 편집 조작 ── */
function snapshot() {
  undoStack.push(host.innerHTML);
  if (undoStack.length > 50) undoStack.shift();
}
function undo() {
  if (!undoStack.length) return say('되돌릴 내용 없음');
  host.innerHTML = undoStack.pop();
  sel = null; renderKatex(); applyMode(); refresh();
  say('되돌림');
}
function move(dir) {
  if (!sel) return;
  const sib = dir < 0 ? sel.previousElementSibling : sel.nextElementSibling;
  if (!sib) return say('더 이동할 곳 없음');
  snapshot();
  if (dir < 0) sel.parentElement.insertBefore(sel, sib);
  else sel.parentElement.insertBefore(sib, sel);
  refresh();
}
function duplicate() {
  if (!sel) return;
  snapshot();
  const c = sel.cloneNode(true);
  sel.after(c);
  sel = c;
  refresh();
  say('복제됨 — 형제 복제는 덱 전용 블록도 안전하게 늘림');
}
function remove() {
  if (!sel) return;
  snapshot();
  const p = sel.parentElement;
  sel.remove();
  sel = p.classList.contains('slide') ? null : p;
  refresh();
}
function selectParent() {
  if (!sel) return;
  const p = sel.parentElement;
  if (p && !p.classList.contains('slide')) select(p);
}
function insertBlock(html, where) {
  if (!sel) return;
  snapshot();
  const tmp = document.createElement('div');
  tmp.innerHTML = html.trim();
  const node = tmp.firstElementChild;
  if (where === 'before') sel.before(node); else sel.after(node);
  sel = node;
  closePop();
  applyMode();
  refresh();
}
function setGrid(v) {
  if (!sel) return;
  snapshot();
  GRIDS.slice(1).forEach((g) => sel.classList.remove(g));
  if (v !== GRIDS[0]) sel.classList.add(v);
  refresh();
}
function toggleClass(c, on) {
  if (!sel) return;
  snapshot();
  sel.classList.toggle(c, on);
  refresh();
}

/* ── 텍스트 편집 ── */
function beginEdit(el) {
  if (!el) return;
  snapshot();
  el.contentEditable = 'true';
  el.focus();
  const r = document.createRange();
  r.selectNodeContents(el);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  el.addEventListener('blur', () => { el.contentEditable = 'false'; refresh(); }, { once: true });
}

/* ── 토스트 ── */
let toastTimer;
function say(msg) {
  toast.textContent = msg;
  toast.dataset.on = '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => delete toast.dataset.on, 1800);
}

/* ── 이벤트 ── */
host.addEventListener('mousemove', (e) => {
  if (editMode === 'present') return;
  const el = pickable(e.target);
  if (el !== hov) { hov = el; refresh(); }
});
host.addEventListener('mouseleave', () => { hov = null; refresh(); });
host.addEventListener('click', (e) => {
  if (editMode === 'present') return;
  const el = pickable(e.target);
  if (!el) return;
  if (el.isContentEditable) return;
  e.preventDefault();
  // 모드 전환형의 텍스트 모드 = 한 번 클릭으로 바로 타이핑
  if (MODE === 'modes' && editMode === 'text') { select(el); beginEdit(el); return; }
  select(el);
});
host.addEventListener('dblclick', (e) => {
  const el = pickable(e.target);
  if (el) { select(el); beginEdit(el); }
});
addEventListener('keydown', (e) => {
  const typing = document.activeElement && document.activeElement.isContentEditable;
  if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); say('저장됨 (프로토타입 — 실제 파일은 안 건드림)'); return; }
  if ((e.metaKey || e.ctrlKey) && e.key === 'z') { e.preventDefault(); undo(); return; }
  if (typing) return;
  if (!sel) return;
  if (e.key === 'Escape') { sel = null; closePop(); refresh(); }
  if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); remove(); }
  if ((e.metaKey || e.ctrlKey) && e.key === 'd') { e.preventDefault(); duplicate(); }
  if (e.key === 'ArrowUp' && e.altKey) { e.preventDefault(); move(-1); }
  if (e.key === 'ArrowDown' && e.altKey) { e.preventDefault(); move(1); }
  if (e.key === 'Enter') { e.preventDefault(); beginEdit(sel); }
});

/* ── 팝오버 ── */
let pop = null;
function closePop() { if (pop) { pop.remove(); pop = null; } }
function openPop(anchorRect, html) {
  closePop();
  pop = document.createElement('div');
  pop.className = 'pop';
  pop.innerHTML = html;
  document.body.append(pop);
  pop.style.left = Math.min(anchorRect.left, innerWidth - 280) + 'px';
  pop.style.top = Math.min(anchorRect.bottom + 6, innerHeight - pop.offsetHeight - 10) + 'px';
}
addEventListener('mousedown', (e) => {
  if (pop && !pop.contains(e.target) && !e.target.closest('.tool')) closePop();
});

function paletteHTML(where) {
  return `<div class="panel-cap">블록 추가 (${where === 'before' ? '위' : '아래'})</div>
    <div class="palette">${BLOCKS.map((b, i) =>
      `<button data-block="${i}" data-where="${where}">${b[0]}<small>.${b[1]}</small></button>`).join('')}</div>`;
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-block]');
  if (b) insertBlock(BLOCKS[+b.dataset.block][2], b.dataset.where);
});

/* ── 오버레이 + 각 패러다임 크롬 렌더 ── */
function refresh() {
  overlay.innerHTML = '';
  document.querySelectorAll('.tool, .ins').forEach((n) => n.remove());
  if (editMode === 'present') { renderSide(); return; }

  if (hov && hov !== sel) addBox('ov-hov', hov);
  if (sel && document.contains(sel)) {
    addBox('ov-sel', sel);
    const tag = document.createElement('div');
    tag.className = 'ov-tag';
    const r = sel.getBoundingClientRect();
    tag.textContent = label(sel);
    tag.style.left = r.left + 'px';
    tag.style.top = r.top + 'px';
    overlay.append(tag);
  } else if (sel) { sel = null; }

  if (MODE === 'floating') renderFloating();
  renderSide();
  renderTopbar();
}
function addBox(cls, el) {
  const r = el.getBoundingClientRect();
  const d = document.createElement('div');
  d.className = cls;
  d.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
  overlay.append(d);
}

/* ── (A) 플로팅 툴바 ── */
function renderFloating() {
  if (!sel) return;
  const r = sel.getBoundingClientRect();

  const tool = document.createElement('div');
  tool.className = 'tool';
  tool.innerHTML = `
    <button title="부모 선택 (계층 위로)">⬈</button>
    <div class="div"></div>
    <button title="위로 이동 (⌥↑)">↑</button>
    <button title="아래로 이동 (⌥↓)">↓</button>
    <button title="복제 (⌘D)">⧉</button>
    <button title="삭제 (Delete)">✕</button>
    <div class="div"></div>
    <button title="텍스트 편집 (더블클릭)">✏︎</button>
    <button title="더보기 — 클래스·그리드">⋯</button>`;
  const [up, , mu, md, dup, del, , edit, more] = tool.children;
  up.onclick = selectParent;
  mu.onclick = () => move(-1);
  md.onclick = () => move(1);
  dup.onclick = duplicate;
  del.onclick = remove;
  edit.onclick = () => beginEdit(sel);
  more.onclick = (e) => openPop(e.target.getBoundingClientRect(), morePopHTML());
  document.body.append(tool);
  tool.style.left = Math.max(8, Math.min(r.left, innerWidth - tool.offsetWidth - 8)) + 'px';
  // 라벨(ov-tag)이 요소 상단에 붙으므로 툴바는 그 위로 한 칸 더 띄운다
  const top = r.top - tool.offsetHeight - 22;
  tool.style.top = (top < 8 ? r.bottom + 22 : top) + 'px';

  // 위/아래 삽입 라인
  [['before', r.top], ['after', r.bottom]].forEach(([where, y]) => {
    const ins = document.createElement('div');
    ins.className = 'ins';
    ins.style.cssText = `left:${r.left}px;top:${y}px;width:${r.width}px`;
    ins.innerHTML = `<button title="여기 블록 삽입">＋</button>`;
    ins.firstElementChild.onclick = (e) =>
      openPop(e.target.getBoundingClientRect(), paletteHTML(where));
    document.body.append(ins);
  });
}
function morePopHTML() {
  const grid = GRIDS.find((g) => g !== '(없음)' && sel.classList.contains(g)) || GRIDS[0];
  return `<div class="panel-cap">클래스</div>
    ${CLASS_TOGGLES.map((c) => `<label class="chk"><input type="checkbox" data-cls="${c}" ${sel.classList.contains(c) ? 'checked' : ''}> .${c}</label>`).join('')}
    <div class="panel-cap" style="margin-top:10px">그리드</div>
    <div class="selrow"><select data-grid>${GRIDS.map((g) => `<option ${g === grid ? 'selected' : ''}>${g}</option>`).join('')}</select></div>`;
}
document.addEventListener('change', (e) => {
  if (e.target.dataset.cls) toggleClass(e.target.dataset.cls, e.target.checked);
  if (e.target.hasAttribute('data-grid')) setGrid(e.target.value);
});

/* ── (B) 인스펙터 / (D) 아웃라인 사이드 패널 ── */
function renderSide() {
  if (MODE === 'inspector') renderInspector();
  else if (MODE === 'outline') renderOutline();
}

function renderInspector() {
  if (!sel) {
    side.innerHTML = `<div class="panel-sec"><div class="panel-cap">Inspector</div>
      <div style="color:#6b7a8c;line-height:1.6">슬라이드에서 요소를 클릭하면<br>계층·조작·클래스·블록 팔레트가<br>여기 나타납니다.</div></div>`;
    return;
  }
  const ch = chain(sel);
  const grid = GRIDS.find((g) => g !== '(없음)' && sel.classList.contains(g)) || GRIDS[0];
  side.innerHTML = `
    <div class="panel-sec">
      <div class="panel-cap">Inspector</div>
      <div class="crumb">${ch.map((n, i) =>
        `<button data-ci="${i}" ${n === sel ? 'data-cur' : ''}>${label(n)}</button>${i < ch.length - 1 ? '<span class="sep">›</span>' : ''}`).join('')}</div>
    </div>
    <div class="panel-sec">
      <div class="panel-cap">조작</div>
      <div class="actrow">
        <button data-a="up" title="⌥↑">↑ 위로</button>
        <button data-a="down" title="⌥↓">↓ 아래로</button>
        <button data-a="dup" title="⌘D">⧉ 복제</button>
        <button data-a="del" data-danger title="Delete">✕ 삭제</button>
      </div>
    </div>
    <div class="panel-sec">
      <div class="panel-cap">클래스</div>
      ${CLASS_TOGGLES.map((c) => `<label class="chk"><input type="checkbox" data-cls="${c}" ${sel.classList.contains(c) ? 'checked' : ''}> .${c}</label>`).join('')}
      <div class="selrow" style="margin-top:8px">그리드
        <select data-grid>${GRIDS.map((g) => `<option ${g === grid ? 'selected' : ''}>${g}</option>`).join('')}</select>
      </div>
    </div>
    <div class="panel-sec">
      <div class="panel-cap">블록 추가 — 선택 요소 아래</div>
      <div class="palette">${BLOCKS.map((b, i) =>
        `<button data-block="${i}" data-where="after">${b[0]}<small>.${b[1]}</small></button>`).join('')}</div>
    </div>`;
  side.querySelectorAll('[data-ci]').forEach((b) => { b.onclick = () => select(ch[+b.dataset.ci]); });
  side.querySelectorAll('[data-a]').forEach((b) => {
    b.onclick = () => ({ up: () => move(-1), down: () => move(1), dup: duplicate, del: remove }[b.dataset.a])();
  });
}

/* ── (D) 아웃라인 트리 ── */
let dragNode = null;
function renderOutline() {
  const root = host.querySelector('.slide');
  side.innerHTML = `<div class="panel-sec"><div class="panel-cap">Outline — 드래그로 재배치</div></div><div id="tree"></div>`;
  const tree = side.querySelector('#tree');
  if (!root) return;
  const walk = (el, depth) => {
    if (depth > 4) return;
    Array.from(el.children).forEach((c) => {
      const row = document.createElement('div');
      row.className = 'row';
      row.style.paddingLeft = 4 + depth * 12 + 'px';
      const txt = (c.textContent || '').trim().slice(0, 16);
      row.innerHTML = `<span class="tw">${c.children.length ? '▾' : '·'}</span>
        <span class="tag">${c.tagName.toLowerCase()}</span>
        <span class="cls">${c.className ? '.' + String(c.className).trim().split(/\s+/)[0] : ''}</span>
        <span class="txt">${txt ? '“' + txt + '”' : ''}</span>
        <span class="grip" draggable="true">⣿</span>`;
      if (c === sel) row.dataset.sel = '';
      row.onclick = (e) => { e.stopPropagation(); select(c); };
      row.onmouseenter = () => { hov = c; refreshBoxesOnly(); };
      const grip = row.querySelector('.grip');
      grip.ondragstart = (e) => { dragNode = c; e.dataTransfer.effectAllowed = 'move'; };
      row.ondragover = (e) => {
        if (!dragNode || dragNode.parentElement !== c.parentElement || dragNode === c) return;
        e.preventDefault(); row.dataset.drop = '';
      };
      row.ondragleave = () => delete row.dataset.drop;
      row.ondrop = (e) => {
        e.preventDefault();
        if (!dragNode || dragNode.parentElement !== c.parentElement) return;
        snapshot();
        c.after(dragNode);
        dragNode = null;
        refresh();
      };
      tree.append(row);
      walk(c, depth + 1);
    });
  };
  walk(root, 0);
}
function refreshBoxesOnly() {
  overlay.innerHTML = '';
  if (hov && hov !== sel) addBox('ov-hov', hov);
  if (sel && document.contains(sel)) addBox('ov-sel', sel);
}

/* ── (C) 모드 전환형 ── */
function renderTopbar() {
  if (MODE !== 'modes') return;
  document.querySelectorAll('.modebar button').forEach((b) => {
    b.toggleAttribute('data-on', b.dataset.em === editMode);
  });
  document.getElementById('modehint').textContent = {
    text: '클릭 한 번으로 바로 타이핑 — 구조는 잠겨 있음',
    struct: '모든 블록에 라벨·아웃라인 노출 — 이동/복제/삭제 가능',
    present: '크롬 전부 숨김 — 발표/PDF 상태 그대로',
  }[editMode];
}
if (MODE === 'modes') {
  document.querySelectorAll('.modebar button').forEach((b) => {
    b.onclick = () => { editMode = b.dataset.em; sel = null; applyMode(); refresh(); };
  });
}
function applyMode() {
  document.body.toggleAttribute('data-present', MODE === 'modes' && editMode === 'present');
  host.toggleAttribute('data-structure', MODE === 'modes' && editMode === 'struct');
  // 구조 모드일 때 얕은 depth 요소에만 라벨 부여
  host.querySelectorAll('[data-tag]').forEach((n) => n.removeAttribute('data-tag'));
  if (MODE === 'modes' && editMode === 'struct') {
    const body = host.querySelector('.slide-body');
    if (body) Array.from(body.children).forEach((c) => {
      c.dataset.tag = label(c);
      Array.from(c.children).forEach((g) => { if (g.className) g.dataset.tag = label(g); });
    });
  }
}

/* ── 부팅 ── */
loadSlide();
fitCanvas();
setTimeout(() => { fitCanvas(); refresh(); }, 120);
document.fonts && document.fonts.ready.then(() => { fitCanvas(); refresh(); });
