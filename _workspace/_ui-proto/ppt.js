/* ── E안: PowerPoint형 편집 엔진 ──────────────────────────────────────
   핵심 매핑 — PPT의 "개체"를 DOM 중첩에 대응시킨다.
     · 개체        = 현재 스코프(그룹)의 직계 자식 요소
     · 그룹 진입   = 컨테이너 더블클릭 → 스코프가 그 안으로 내려감
     · 그룹 탈출   = Esc → 스코프가 부모로 올라감
     · 텍스트 편집 = 잎(텍스트) 개체 더블클릭
   배치 모드 두 가지를 켜고 끄며 비교한다.
     · 스냅 = 드래그하면 흐름 안에서 순서만 바뀜(디자인 시스템 유지)
     · 자유 = 절대좌표로 아무 데나 배치(진짜 PPT, 정렬 책임은 사용자) */

const OBJ_MIN = 8;          // 개체로 인정할 최소 크기(px)
const SNAP_TOL = 6;         // 자유 모드 정렬 스냅 허용 오차(슬라이드 좌표계)

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
  ['텍스트 상자', 'lead', '<div class="lead">문장을 입력합니다.</div>'],
  ['2단 그리드', 'cols-2', '<div class="cols-2"><div class="card"><div class="card-head">왼쪽</div><p>본문</p></div><div class="card"><div class="card-head">오른쪽</div><p>본문</p></div></div>'],
];
const GRIDS = ['(없음)', 'cols-2', 'cols-3', 'cols-5-7'];
const CLASSES = ['subtle', 'wide', 'muted', 'mono'];

/* ── 상태 ── */
let sel = null;         // 선택 개체
let hov = null;         // 호버 개체
let scope = null;       // 현재 그룹(스코프) 컨테이너
let slideIdx = 0;
let layout = 'snap';    // snap | free
let tab = 'home';
let present = false;
let scale = 1;
let undo = [];
let clipboard = null;

/* ── 셸 ── */
document.body.innerHTML = `
<div id="app">
  <div id="ribbon">
    <div class="rb-tabs">
      <button data-tab="home">홈</button>
      <button data-tab="insert">삽입</button>
      <button data-tab="format">서식</button>
      <span class="title">Weekly Report · 2026 W31 — PowerPoint형 프로토타입</span>
    </div>
    <div class="rb-body" id="rbbody"></div>
  </div>
  <div id="main">
    <aside id="rail"></aside>
    <main id="canvas"><div id="fit"><div id="slidehost"></div></div></main>
    <aside id="format"></aside>
  </div>
  <div id="status">
    <span id="st-obj">개체 없음</span>
    <span id="st-mode"></span>
    <span class="sp"></span>
    <span>더블클릭 = 그룹 진입 / 텍스트 편집 · Esc = 나가기 · Tab = 다음 개체</span>
    <span><a href="index.html" style="color:#7f8e9f">← 안 비교</a></span>
  </div>
</div>
<div id="chrome"></div>
<div id="ctx"></div>
<div id="gallery"></div>
<div id="toast"></div>`;

const host = document.getElementById('slidehost');
const fit = document.getElementById('fit');
const canvas = document.getElementById('canvas');
const layer = document.getElementById('chrome');
const rail = document.getElementById('rail');
const ctx = document.getElementById('ctx');
const gallery = document.getElementById('gallery');
const fmt = document.getElementById('format');
const toast = document.getElementById('toast');

/* ── 레일 ── */
const RAIL = ['표지', '저번 주 활동', '논문 개요', '연구 흐름', 'PTM 지배방정식', 'PTM vs WRF'];
function buildRail() {
  rail.innerHTML = '';
  RAIL.forEach((label, i) => {
    const real = i === 2 ? 0 : i === 5 ? 1 : -1;
    const t = document.createElement('div');
    t.className = 'thumb';
    if (real < 0) t.dataset.empty = '';
    if (real === slideIdx) t.dataset.active = '';
    t.innerHTML = `<span class="n">${String(i + 1).padStart(2, '0')}</span>${label}`;
    t.onclick = () => { if (real >= 0 && real !== slideIdx) { slideIdx = real; loadSlide(); } };
    rail.append(t);
  });
}

/* ── 슬라이드 ── */
function loadSlide() {
  host.innerHTML = window.PROTO_SLIDES[slideIdx];
  sel = hov = null;
  scope = host.querySelector('.slide');
  if (window.katex) host.querySelectorAll('[data-tex]').forEach((n) => {
    try { katex.render(n.dataset.tex, n, { throwOnError: false }); } catch (e) {}
  });
  buildRail(); fitCanvas(); render();
}
function fitCanvas() {
  scale = Math.min((canvas.clientWidth - 52) / 1280, (canvas.clientHeight - 52) / 720);
  fit.style.transform = `scale(${scale})`;
}
addEventListener('resize', () => { fitCanvas(); render(); });

/* ── 개체 해석 ── */
// slide-body 같은 껍데기는 "투명 컨테이너" — 개체로 잡히지 않고 그 안의 블록이 최상위 개체가 된다.
// 이게 PPT 느낌의 핵심: 사용자는 레이아웃 래퍼를 볼 일이 없어야 한다.
const TRANSPARENT = new Set(['slide-body', 'free-layer']);
function isTransparent(el) {
  return el && el !== scope && el.classList && [...el.classList].some((c) => TRANSPARENT.has(c));
}
function sized(el) {
  if (el.hasAttribute('data-spacer')) return false;   // 자리표시자는 개체가 아니다
  const r = el.getBoundingClientRect();
  return r.width >= OBJ_MIN && r.height >= OBJ_MIN;
}
// 클릭 지점에서 현재 스코프 기준의 개체를 찾는다
function objAt(target) {
  let n = target.nodeType === 1 ? target : target.parentElement;
  if (!n || !scope.contains(n) || n === scope) return null;
  while (n && n !== scope) {
    const p = n.parentElement;
    if (p === scope || isTransparent(p)) break;
    n = p;
  }
  if (!n || n === scope || isTransparent(n)) return null;
  return sized(n) ? n : null;
}
// 스코프 안의 개체 목록 (Tab 순회용) — 투명 컨테이너는 뚫고 내려간다
function objectsInScope() {
  const out = [];
  const walk = (c) => Array.from(c.children).forEach((ch) => {
    if (isTransparent(ch)) walk(ch); else out.push(ch);
  });
  walk(scope);
  return out.filter(sized);
}
function isGroup(el) { return el && el.children.length > 0; }
function name(el) {
  if (!el) return '';
  const c = String(el.className || '').trim().split(/\s+/).filter(Boolean)[0];
  return c ? '.' + c : el.tagName.toLowerCase();
}
function enterGroup(el) { if (isGroup(el)) { scope = el; sel = null; render(); } }
function exitGroup() {
  if (sel) { sel = null; return render(); }
  if (scope && !scope.classList.contains('slide')) {
    const prev = scope;
    scope = scope.parentElement;
    // 투명 컨테이너(slide-body)는 스코프가 될 수 없으므로 한 칸 더 올라간다
    while (scope && !scope.classList.contains('slide') && TRANSPARENT.has(scope.classList[0])) {
      scope = scope.parentElement;
    }
    sel = prev;
    render();
  }
}

/* ── 편집 조작 ── */
function snap() { undo.push(host.innerHTML); if (undo.length > 60) undo.shift(); }
function doUndo() {
  if (!undo.length) return say('되돌릴 내용 없음');
  host.innerHTML = undo.pop();
  sel = hov = null; scope = host.querySelector('.slide');
  render(); say('실행 취소');
}
function order(dir) {
  if (!sel) return;
  const sib = dir < 0 ? sel.previousElementSibling : sel.nextElementSibling;
  if (!sib) return say('더 옮길 곳 없음');
  snap();
  if (dir < 0) sel.parentElement.insertBefore(sel, sib);
  else sel.parentElement.insertBefore(sib, sel);
  render();
}
function dup() {
  if (!sel) return;
  snap();
  const c = sel.cloneNode(true);
  sel.after(c); sel = c; render();
  say('복제 — 덱 전용 블록도 이 방식이면 안전하게 늘어남');
}
function del() {
  if (!sel) return;
  snap();
  sel.remove(); sel = null; render();
}
function insertBlock(html) {
  snap();
  const tmp = document.createElement('div');
  tmp.innerHTML = html.trim();
  const node = tmp.firstElementChild;
  if (sel) sel.after(node);
  else (scope.querySelector('.slide-body') || scope).append(node);
  sel = node;
  gallery.removeAttribute('data-on');
  render();
}
function setGrid(v) {
  if (!sel) return;
  snap();
  GRIDS.slice(1).forEach((g) => sel.classList.remove(g));
  if (v !== GRIDS[0]) sel.classList.add(v);
  render();
}
function toggleCls(c) {
  if (!sel) return;
  snap(); sel.classList.toggle(c); render();
}
function editText(el) {
  if (!el) return;
  snap();
  el.contentEditable = 'true';
  el.focus();
  const r = document.createRange(); r.selectNodeContents(el);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  el.addEventListener('blur', () => { el.contentEditable = 'false'; render(); }, { once: true });
  render();
}
function resetFree() {
  if (!sel || !sel.hasAttribute('data-free')) return say('자유 배치 개체가 아님');
  snap();
  backToFlow(sel);
  render(); say('흐름 배치로 되돌림 — 자리표시자 자리에 복귀');
}

let toastT;
function say(m) {
  toast.textContent = m; toast.dataset.on = '';
  clearTimeout(toastT); toastT = setTimeout(() => delete toast.dataset.on, 1700);
}

/* ── 좌표 변환 (화면 px ↔ 슬라이드 1280×720 좌표) ── */
function slideRect() { return host.getBoundingClientRect(); }
function toSlide(clientX, clientY) {
  const r = slideRect();
  return { x: (clientX - r.left) / scale, y: (clientY - r.top) / scale };
}

/* ── 드래그: 이동 ── */
let drag = null;
host.addEventListener('mousedown', (e) => {
  if (present || e.button !== 0) return;
  if (e.target.isContentEditable) return;
  const o = objAt(e.target);
  if (!o) return;
  sel = o; render();
  const start = toSlide(e.clientX, e.clientY);
  const r0 = o.getBoundingClientRect();
  const sr = slideRect();
  drag = {
    el: o, moved: false, mode: 'move', start,
    baseLeft: (r0.left - sr.left) / scale,
    baseTop: (r0.top - sr.top) / scale,
    w: r0.width / scale, h: r0.height / scale,
  };
  e.preventDefault();
});

/* ── 드래그: 리사이즈 (핸들에서 시작) ── */
function startResize(e, dir) {
  if (!sel) return;
  const r0 = sel.getBoundingClientRect();
  const sr = slideRect();
  drag = {
    el: sel, moved: false, mode: 'resize', dir,
    start: toSlide(e.clientX, e.clientY),
    baseLeft: (r0.left - sr.left) / scale,
    baseTop: (r0.top - sr.top) / scale,
    w: r0.width / scale, h: r0.height / scale,
    parentW: sel.parentElement.getBoundingClientRect().width / scale,
  };
  e.preventDefault(); e.stopPropagation();
}

addEventListener('mousemove', (e) => {
  if (!drag) {
    if (present) return;
    const o = host.contains(e.target) ? objAt(e.target) : null;
    if (o !== hov) { hov = o; render(); }
    return;
  }
  const p = toSlide(e.clientX, e.clientY);
  const dx = p.x - drag.start.x, dy = p.y - drag.start.y;
  if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
  if (!drag.moved) { drag.moved = true; snap(); }

  if (drag.mode === 'move') {
    if (layout === 'free') {
      goFree(drag.el, drag.baseLeft, drag.baseTop, drag.w, drag.h);
      let nx = drag.baseLeft + dx, ny = drag.baseTop + dy;
      const g = alignSnap(drag.el, nx, ny, drag.w, drag.h);
      nx = g.x; ny = g.y;
      drag.el.style.left = nx + 'px';
      drag.el.style.top = ny + 'px';
      drag.guides = g.guides;
    } else {
      drag.dropTarget = findDrop(e.clientX, e.clientY, drag.el);
    }
  } else {
    if (layout === 'free') {
      goFree(drag.el, drag.baseLeft, drag.baseTop, drag.w, drag.h);
      const d = drag.dir;
      let { baseLeft: l, baseTop: t, w, h } = drag;
      if (d.includes('e')) w = Math.max(24, drag.w + dx);
      if (d.includes('s')) h = Math.max(20, drag.h + dy);
      if (d.includes('w')) { w = Math.max(24, drag.w - dx); l = drag.baseLeft + dx; }
      if (d.includes('n')) { h = Math.max(20, drag.h - dy); t = drag.baseTop + dy; }
      Object.assign(drag.el.style, { left: l + 'px', top: t + 'px', width: w + 'px', height: h + 'px' });
    } else {
      // 스냅 모드: 좌우 핸들만 — 부모 폭 대비 % 로 5% 단위 스냅
      if (!drag.dir.includes('e') && !drag.dir.includes('w')) return;
      const sign = drag.dir.includes('e') ? 1 : -1;
      const pct = Math.round(((drag.w + sign * dx) / drag.parentW) * 100 / 5) * 5;
      drag.el.style.width = Math.min(100, Math.max(10, pct)) + '%';
    }
  }
  render();
});

addEventListener('mouseup', () => {
  if (!drag) return;
  if (drag.moved && drag.mode === 'move' && layout === 'snap' && drag.dropTarget) {
    const { node, after } = drag.dropTarget;
    if (node !== drag.el) {
      if (after) node.after(drag.el); else node.before(drag.el);
    }
  }
  if (!drag.moved && drag.mode === 'move') undo.pop === undefined; // 이동 없었으면 스냅샷도 없음
  drag = null;
  render();
});

let freeSeq = 0;
// 흐름 → 자유 배치 승격.
//  ① 개체를 슬라이드 전체를 덮는 .free-layer 로 옮겨 좌표계를 슬라이드 기준으로 통일하고
//  ② 원래 자리에는 같은 크기의 자리표시자를 남겨 형제 레이아웃이 무너지지 않게 한다.
function goFree(el, l, t, w, h) {
  if (el.hasAttribute('data-free')) return;
  const slide = host.querySelector('.slide');
  let flayer = slide.querySelector('.free-layer');
  if (!flayer) {
    flayer = document.createElement('div');
    flayer.className = 'free-layer';
    slide.append(flayer);
  }
  const id = 'f' + (++freeSeq);
  const sp = document.createElement('div');
  sp.setAttribute('data-spacer', id);
  sp.style.cssText = `width:${w}px;height:${h}px`;
  el.after(sp);
  flayer.append(el);
  el.setAttribute('data-free', id);
  Object.assign(el.style, { left: l + 'px', top: t + 'px', width: w + 'px', height: h + 'px' });
}
// 자유 → 흐름 복귀: 자리표시자 자리로 되돌려 넣는다.
function backToFlow(el) {
  const id = el.getAttribute('data-free');
  const sp = id && host.querySelector(`[data-spacer="${id}"]`);
  if (sp) sp.replaceWith(el); else (host.querySelector('.slide-body') || host).append(el);
  el.removeAttribute('data-free');
  el.style.left = el.style.top = el.style.width = el.style.height = '';
  const flayer = host.querySelector('.free-layer');
  if (flayer && !flayer.children.length) flayer.remove();
}

// 자유 모드 정렬 스냅: 슬라이드 중앙 · 형제 개체의 좌/우/상/하 모서리
function alignSnap(el, x, y, w, h) {
  const guides = [];
  const cands = { v: [640], h: [360] };
  Array.from(el.parentElement.children).forEach((s) => {
    if (s === el) return;
    const r = s.getBoundingClientRect(); const sr = slideRect();
    const l = (r.left - sr.left) / scale, t = (r.top - sr.top) / scale;
    cands.v.push(l, l + r.width / scale);
    cands.h.push(t, t + r.height / scale);
  });
  for (const cx of cands.v) {
    if (Math.abs(x - cx) < SNAP_TOL) { x = cx; guides.push(['v', cx]); break; }
    if (Math.abs(x + w - cx) < SNAP_TOL) { x = cx - w; guides.push(['v', cx]); break; }
    if (Math.abs(x + w / 2 - cx) < SNAP_TOL) { x = cx - w / 2; guides.push(['v', cx]); break; }
  }
  for (const cy of cands.h) {
    if (Math.abs(y - cy) < SNAP_TOL) { y = cy; guides.push(['h', cy]); break; }
    if (Math.abs(y + h - cy) < SNAP_TOL) { y = cy - h; guides.push(['h', cy]); break; }
    if (Math.abs(y + h / 2 - cy) < SNAP_TOL) { y = cy - h / 2; guides.push(['h', cy]); break; }
  }
  return { x, y, guides };
}

// 스냅 모드 드롭 위치: 같은 부모의 형제 중 커서에 가장 가까운 경계
function findDrop(cx, cy, el) {
  const sibs = Array.from(el.parentElement.children);
  let best = null, bestD = Infinity;
  sibs.forEach((s) => {
    const r = s.getBoundingClientRect();
    [[r.top, false], [r.bottom, true]].forEach(([edgeY, after]) => {
      const d = Math.abs(cy - edgeY) + Math.abs(cx - (r.left + r.width / 2)) * 0.15;
      if (d < bestD) { bestD = d; best = { node: s, after, rect: r }; }
    });
  });
  return best;
}

/* ── 클릭 / 더블클릭 / 우클릭 ── */
host.addEventListener('dblclick', (e) => {
  if (present) return;
  const o = objAt(e.target);
  if (!o) return;
  e.preventDefault();
  if (isGroup(o)) enterGroup(o); else editText(o);
});
canvas.addEventListener('mousedown', (e) => {
  if (e.target === canvas || e.target === fit) { sel = null; render(); }
});
host.addEventListener('contextmenu', (e) => {
  if (present) return;
  e.preventDefault();
  const o = objAt(e.target);
  if (o) { sel = o; render(); }
  openCtx(e.clientX, e.clientY);
});
addEventListener('mousedown', (e) => {
  if (!ctx.contains(e.target)) ctx.removeAttribute('data-on');
  if (!gallery.contains(e.target) && !e.target.closest('[data-gallery]')) gallery.removeAttribute('data-on');
});

function openCtx(x, y) {
  ctx.innerHTML = `
    <button data-c="cut">잘라내기<span class="k">⌘X</span></button>
    <button data-c="copy">복사<span class="k">⌘C</span></button>
    <button data-c="paste">붙여넣기<span class="k">⌘V</span></button>
    <hr>
    <button data-c="dup">복제<span class="k">⌘D</span></button>
    <button data-c="del">삭제<span class="k">Del</span></button>
    <hr>
    <button data-c="front">맨 앞으로 (순서 ↑)</button>
    <button data-c="back">맨 뒤로 (순서 ↓)</button>
    <hr>
    <button data-c="enter">그룹 진입<span class="k">더블클릭</span></button>
    <button data-c="text">텍스트 편집<span class="k">F2</span></button>
    <button data-c="reset">흐름 배치로 되돌리기</button>`;
  ctx.dataset.on = '';
  ctx.style.left = Math.min(x, innerWidth - 200) + 'px';
  ctx.style.top = Math.min(y, innerHeight - ctx.offsetHeight - 10) + 'px';
  ctx.querySelectorAll('[data-c]').forEach((b) => {
    b.onclick = () => {
      ctx.removeAttribute('data-on');
      ({
        cut: () => { clipboard = sel && sel.outerHTML; del(); },
        copy: () => { clipboard = sel && sel.outerHTML; say('복사됨'); },
        paste: () => clipboard && insertBlock(clipboard),
        dup, del,
        front: () => { while (sel && sel.previousElementSibling) order(-1); },
        back: () => { while (sel && sel.nextElementSibling) order(1); },
        enter: () => enterGroup(sel),
        text: () => editText(sel),
        reset: resetFree,
      }[b.dataset.c])();
    };
  });
}

/* ── 키보드 ── */
addEventListener('keydown', (e) => {
  const typing = document.activeElement && document.activeElement.isContentEditable;
  const meta = e.metaKey || e.ctrlKey;
  if (meta && e.key === 's') { e.preventDefault(); return say('저장됨 (프로토타입 — 실제 파일은 안 건드림)'); }
  if (meta && e.key === 'z') { e.preventDefault(); return doUndo(); }
  if (typing) { if (e.key === 'Escape') document.activeElement.blur(); return; }
  if (e.key === 'Escape') { e.preventDefault(); return exitGroup(); }
  if (e.key === 'Tab') {
    e.preventDefault();
    const objs = objectsInScope();
    if (!objs.length) return;
    const i = sel ? objs.indexOf(sel) : -1;
    sel = objs[(i + (e.shiftKey ? -1 : 1) + objs.length) % objs.length];
    return render();
  }
  if (!sel) return;
  if (e.key === 'F2' || e.key === 'Enter') { e.preventDefault(); return editText(sel); }
  if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); return del(); }
  if (meta && e.key === 'd') { e.preventDefault(); return dup(); }
  if (meta && e.key === 'c') { clipboard = sel.outerHTML; return say('복사됨'); }
  if (meta && e.key === 'v') { e.preventDefault(); return clipboard && insertBlock(clipboard); }
  if (e.key.startsWith('Arrow')) {
    e.preventDefault();
    const d = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[e.key];
    if (layout === 'free') {
      const sr = slideRect(), r = sel.getBoundingClientRect();
      goFree(sel, (r.left - sr.left) / scale, (r.top - sr.top) / scale, r.width / scale, r.height / scale);
      const step = e.shiftKey ? 10 : 1;
      sel.style.left = parseFloat(sel.style.left) + d[0] * step + 'px';
      sel.style.top = parseFloat(sel.style.top) + d[1] * step + 'px';
      render();
    } else if (d[1]) order(d[1]);
  }
});

/* ── 리본 ── */
const RIBBON = {
  home: () => `
    <div class="rb-group"><div class="rb-row">
      <button class="rb-btn" data-a="undo"><span class="ic">↺</span>실행 취소</button>
      <button class="rb-btn" data-a="paste"><span class="ic">📋</span>붙여넣기</button>
    </div><div class="rb-cap">실행 취소</div></div>
    <div class="rb-group"><div class="rb-row">
      <button class="rb-btn" data-a="up"><span class="ic">↑</span>앞으로</button>
      <button class="rb-btn" data-a="down"><span class="ic">↓</span>뒤로</button>
      <button class="rb-btn" data-a="dup"><span class="ic">⧉</span>복제</button>
      <button class="rb-btn" data-a="del"><span class="ic">✕</span>삭제</button>
    </div><div class="rb-cap">개체 정렬</div></div>
    <div class="rb-group"><div class="rb-row">
      <button class="rb-btn" data-a="text"><span class="ic">✏︎</span>텍스트 편집</button>
      <button class="rb-btn" data-a="enter"><span class="ic">⊞</span>그룹 진입</button>
      <button class="rb-btn" data-a="exit"><span class="ic">⊟</span>그룹 나가기</button>
    </div><div class="rb-cap">편집</div></div>
    <div class="rb-group"><div class="rb-row">
      <div class="rb-seg">
        <button data-layout="snap" ${layout === 'snap' ? 'data-on' : ''}>스냅 배치</button>
        <button data-layout="free" ${layout === 'free' ? 'data-on' : ''}>자유 배치</button>
      </div>
      <button class="rb-btn" data-a="reset"><span class="ic">⤺</span>흐름 복귀</button>
      <button class="rb-btn" data-a="spacer" ${document.body.hasAttribute('data-showspacer') ? 'data-on' : ''}><span class="ic">▨</span>자리표시자</button>
    </div><div class="rb-cap">배치 모드</div></div>
    <div class="rb-group"><div class="rb-row">
      <button class="rb-btn" data-a="format"><span class="ic">▤</span>서식 창</button>
      <button class="rb-btn" data-a="present"><span class="ic">▶</span>발표</button>
      <button class="rb-btn" data-a="save"><span class="ic">💾</span>저장</button>
    </div><div class="rb-cap">보기</div></div>`,
  insert: () => `
    <div class="rb-group"><div class="rb-row">
      ${BLOCKS.slice(0, 6).map((b, i) => `<button class="rb-btn" data-ins="${i}"><span class="ic">▢</span>${b[0]}</button>`).join('')}
    </div><div class="rb-cap">정규 블록 — slides.css</div></div>
    <div class="rb-group"><div class="rb-row">
      ${BLOCKS.slice(6).map((b, i) => `<button class="rb-btn" data-ins="${i + 6}"><span class="ic">▢</span>${b[0]}</button>`).join('')}
    </div><div class="rb-cap">추가 블록</div></div>
    <div class="rb-group"><div class="rb-row">
      <button class="rb-btn" data-gallery><span class="ic">▦</span>전체 갤러리</button>
    </div><div class="rb-cap">더 보기</div></div>`,
  format: () => `
    <div class="rb-group"><div class="rb-row">
      ${CLASSES.map((c) => `<button class="rb-btn" data-cls="${c}" ${sel && sel.classList.contains(c) ? 'data-on' : ''}><span class="ic">◍</span>.${c}</button>`).join('')}
    </div><div class="rb-cap">클래스</div></div>
    <div class="rb-group"><div class="rb-row">
      <div class="rb-seg">${GRIDS.map((g) => `<button data-grid="${g}" ${sel && (g === '(없음)' ? !GRIDS.slice(1).some((x) => sel.classList.contains(x)) : sel.classList.contains(g)) ? 'data-on' : ''}>${g}</button>`).join('')}</div>
    </div><div class="rb-cap">그리드</div></div>
    <div class="rb-group"><div class="rb-row">
      <button class="rb-btn" data-a="reset"><span class="ic">⤺</span>흐름 복귀</button>
      <button class="rb-btn" data-a="format"><span class="ic">▤</span>서식 창</button>
    </div><div class="rb-cap">배치</div></div>`,
};

function renderRibbon() {
  document.querySelectorAll('.rb-tabs [data-tab]').forEach((b) => {
    b.toggleAttribute('data-on', b.dataset.tab === tab);
    b.onclick = () => { tab = b.dataset.tab; render(); };
  });
  const body = document.getElementById('rbbody');
  body.innerHTML = RIBBON[tab]();
  body.querySelectorAll('[data-a]').forEach((b) => {
    if (['up', 'down', 'dup', 'del', 'text', 'enter', 'reset'].includes(b.dataset.a) && !sel) b.disabled = true;
    b.onclick = () => ({
      undo: doUndo, dup, del,
      up: () => order(-1), down: () => order(1),
      text: () => editText(sel), enter: () => enterGroup(sel), exit: exitGroup,
      paste: () => clipboard && insertBlock(clipboard),
      reset: resetFree,
      spacer: () => { document.body.toggleAttribute('data-showspacer'); render(); },
      format: () => { document.body.toggleAttribute('data-format'); render(); },
      present: () => { present = true; document.body.setAttribute('data-present', ''); render(); say('Esc로 편집 복귀'); },
      save: () => say('저장됨 (프로토타입 — 실제 파일은 안 건드림)'),
    }[b.dataset.a])();
  });
  body.querySelectorAll('[data-layout]').forEach((b) => {
    b.onclick = () => { layout = b.dataset.layout; render(); say(layout === 'free' ? '자유 배치 — 드래그하면 절대좌표로 고정됨' : '스냅 배치 — 드래그하면 흐름 안에서 순서만 바뀜'); };
  });
  body.querySelectorAll('[data-ins]').forEach((b) => { b.onclick = () => insertBlock(BLOCKS[+b.dataset.ins][2]); });
  body.querySelectorAll('[data-cls]').forEach((b) => { b.onclick = () => toggleCls(b.dataset.cls); });
  body.querySelectorAll('[data-grid]').forEach((b) => { b.onclick = () => setGrid(b.dataset.grid); });
  const gbtn = body.querySelector('[data-gallery]');
  if (gbtn) gbtn.onclick = (e) => {
    gallery.innerHTML = `<div class="fmt-cap">블록 갤러리</div><div class="gg">${BLOCKS.map((b, i) => `<button data-ins="${i}">${b[0]}<small>.${b[1]}</small></button>`).join('')}</div>`;
    gallery.dataset.on = '';
    const r = e.target.getBoundingClientRect();
    gallery.style.left = Math.min(r.left, innerWidth - 350) + 'px';
    gallery.style.top = r.bottom + 6 + 'px';
    gallery.querySelectorAll('[data-ins]').forEach((b) => { b.onclick = () => insertBlock(BLOCKS[+b.dataset.ins][2]); });
  };
}

/* ── 서식 창 ── */
function renderFormat() {
  if (!document.body.hasAttribute('data-format')) return;
  if (!sel) {
    fmt.innerHTML = `<div class="fmt-sec"><div class="fmt-cap">서식</div><div style="color:#97a3b2;line-height:1.7">개체를 선택하면<br>속성이 여기 나타납니다.</div></div>`;
    return;
  }
  const r = sel.getBoundingClientRect(), sr = slideRect();
  const free = sel.hasAttribute('data-free');
  fmt.innerHTML = `
    <div class="fmt-sec">
      <div class="fmt-cap">선택한 개체</div>
      <div class="objname">${sel.tagName.toLowerCase()}${name(sel)}</div>
      <div style="color:#97a3b2;margin-top:5px">그룹: ${scope.classList.contains('slide') ? '슬라이드(최상위)' : name(scope)}</div>
    </div>
    <div class="fmt-sec">
      <div class="fmt-cap">위치 · 크기 ${free ? '(자유 배치)' : '(흐름 배치 — 읽기 전용)'}</div>
      <div class="fmt-row">X <input type="number" value="${Math.round((r.left - sr.left) / scale)}" ${free ? '' : 'disabled'} data-p="left">
                       Y <input type="number" value="${Math.round((r.top - sr.top) / scale)}" ${free ? '' : 'disabled'} data-p="top"></div>
      <div class="fmt-row">W <input type="number" value="${Math.round(r.width / scale)}" ${free ? '' : 'disabled'} data-p="width">
                       H <input type="number" value="${Math.round(r.height / scale)}" ${free ? '' : 'disabled'} data-p="height"></div>
    </div>
    <div class="fmt-sec">
      <div class="fmt-cap">클래스</div>
      <div class="chip">${CLASSES.map((c) => `<button data-cls="${c}" ${sel.classList.contains(c) ? 'data-on' : ''}>.${c}</button>`).join('')}</div>
    </div>
    <div class="fmt-sec">
      <div class="fmt-cap">그리드</div>
      <div class="fmt-row"><select data-grid>${GRIDS.map((g) => `<option ${sel.classList.contains(g) ? 'selected' : ''}>${g}</option>`).join('')}</select></div>
    </div>
    <div class="fmt-sec">
      <div class="fmt-cap">상태 pill</div>
      <div class="chip">${['done', 'prog', 'block', 'note'].map((s) => `<button data-pill="${s}">.${s}</button>`).join('')}</div>
    </div>`;
  fmt.querySelectorAll('[data-cls]').forEach((b) => { b.onclick = () => toggleCls(b.dataset.cls); });
  fmt.querySelector('[data-grid]').onchange = (e) => setGrid(e.target.value);
  fmt.querySelectorAll('[data-pill]').forEach((b) => {
    b.onclick = () => insertBlock(`<span class="pill ${b.dataset.pill}">상태</span>`);
  });
  fmt.querySelectorAll('[data-p]').forEach((i) => {
    i.onchange = () => { snap(); sel.style[i.dataset.p] = i.value + 'px'; render(); };
  });
}

/* ── 렌더 ── */
function render() {
  fitCanvas();   // 서식 창·레일 토글로 캔버스 폭이 바뀌므로 매번 재측정
  layer.innerHTML = '';
  renderRibbon();
  renderFormat();
  document.getElementById('st-obj').textContent = sel
    ? `선택: ${sel.tagName.toLowerCase()}${name(sel)}${sel.hasAttribute('data-free') ? ' · 자유 배치' : ''}`
    : '개체 없음';
  document.getElementById('st-mode').textContent =
    `${layout === 'free' ? '자유 배치' : '스냅 배치'} · 그룹: ${scope && scope.classList.contains('slide') ? '슬라이드' : name(scope)}`;
  if (present) return;

  // 스코프(그룹) 표시
  if (scope && !scope.classList.contains('slide')) {
    box('scope-box', scope);
    tag('scope-tag', scope, `그룹 안 — Esc로 나가기`);
  }
  if (hov && hov !== sel) box('hov-box', hov);
  if (sel && document.contains(sel)) {
    box('sel-box', sel);
    tag('obj-tag', sel, sel.tagName.toLowerCase() + name(sel));
    handles(sel);
  } else if (sel) sel = null;

  // 드롭 인디케이터
  if (drag && drag.moved && drag.mode === 'move' && layout === 'snap' && drag.dropTarget) {
    const r = drag.dropTarget.rect;
    const d = document.createElement('div');
    d.className = 'drop';
    d.style.cssText = `left:${r.left}px;top:${(drag.dropTarget.after ? r.bottom : r.top) - 1.5}px;width:${r.width}px;height:3px`;
    layer.append(d);
  }
  // 정렬 가이드
  if (drag && drag.guides) {
    const sr = slideRect();
    drag.guides.forEach(([axis, v]) => {
      const g = document.createElement('div');
      g.className = 'guide';
      if (axis === 'v') g.style.cssText = `left:${sr.left + v * scale}px;top:${sr.top}px;width:1px;height:${720 * scale}px`;
      else g.style.cssText = `left:${sr.left}px;top:${sr.top + v * scale}px;height:1px;width:${1280 * scale}px`;
      layer.append(g);
    });
  }
}
function box(cls, el) {
  const r = el.getBoundingClientRect();
  const d = document.createElement('div');
  d.className = cls;
  d.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
  layer.append(d);
}
function tag(cls, el, text) {
  const r = el.getBoundingClientRect();
  const d = document.createElement('div');
  d.className = cls; d.textContent = text;
  d.style.cssText = `left:${r.left}px;top:${r.top}px`;
  layer.append(d);
}
function handles(el) {
  const r = el.getBoundingClientRect();
  const pos = {
    nw: [r.left, r.top], n: [r.left + r.width / 2, r.top], ne: [r.right, r.top],
    e: [r.right, r.top + r.height / 2], se: [r.right, r.bottom],
    s: [r.left + r.width / 2, r.bottom], sw: [r.left, r.bottom],
    w: [r.left, r.top + r.height / 2],
  };
  Object.entries(pos).forEach(([d, [x, y]]) => {
    const h = document.createElement('div');
    h.className = 'h'; h.dataset.d = d;
    // 스냅 배치에서는 좌우 폭 조절만 허용 (세로/자유 크기는 흐름을 깬다)
    const off = layout === 'snap' && d !== 'e' && d !== 'w';
    if (off) h.dataset.off = '';
    h.style.cssText = `left:${x - 5.5}px;top:${y - 5.5}px`;
    if (!off) h.addEventListener('mousedown', (e) => startResize(e, d));
    layer.append(h);
  });
}

/* 발표 모드 탈출 */
addEventListener('keydown', (e) => {
  if (present && e.key === 'Escape') {
    present = false; document.body.removeAttribute('data-present'); render();
  }
}, true);

/* ── 부팅 ── */
loadSlide();
setTimeout(() => { fitCanvas(); render(); }, 120);
document.fonts && document.fonts.ready.then(() => { fitCanvas(); render(); });
