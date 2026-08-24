/**
 * 표 고치기 — 칸 안 글자와 행·열 (로드맵 4단계). 2026-08-24.
 *
 * ## 서버는 이미 다 갖고 있었다
 *
 * 표의 `<tr>`·`<td>` 는 L6 구조 자식이라 이름표를 갖지 않는다(§3.6). 표 하나에 id 24 개가
 * 붙으면 손편집이 불가능해지므로 그 면제는 옳다. 대가로 명령이 그것들을 지목할 수 없어서
 * §3.6 L6.1 이 **순번으로 지목하는 명령 넷**을 따로 냈다 — `setChildContent` ·
 * `insertChild` · `removeChild` · `reorderChildren`. 이 파일은 그 넷을 화면에 잇는다.
 * 서버에 새로 만든 것은 없다.
 *
 * ## 칸 주소는 좌표가 아니라 순번이다
 *
 * `(parentPath, index)` 다. 표는 `table > tbody > tr > td` 로 깊이가 2 이므로
 * `parentPath` 는 `[그룹 순번, 행 순번]` 이고 `index` 가 칸이다. **이 셈은 DOM 과 서버
 * 트리가 같다** — 둘 다 요소 자식을 문서 순서로 세기 때문이고, 그래서 화면이 잰 순번을
 * 서버가 그대로 쓸 수 있다.
 *
 * ## 열은 행 하나에 살지 않는다
 *
 * 행은 명령 하나면 된다. 열은 **모든 행에 걸쳐 있어서** `<tr>` 마다 하나씩, 거기에
 * `<colgroup>` 의 `<col>` 까지 명령이 나간다. 그것을 **한 커밋**으로 보낸다 — 나누면
 * 표가 잠깐 들쭉날쭉한 상태로 저장되고 되돌리기가 행 수만큼 걸린다.
 *
 * 한 커밋 안의 명령들은 전부 같은 스냅샷을 보므로 뒤 명령이 앞 명령의 결과를 보지 못한다
 * (`commit.js`). 여기서는 그것이 문제가 아니다 — 각 `<tr>` 의 내부 구간은 서로 겹치지
 * 않으므로 편집이 서로를 밀지 않는다. `child-commands.test.js` 가 그 사실을 잰다.
 *
 * ## 글자 편집기를 복제하지 않는다
 *
 * 칸에 커서를 넣는 일은 `edit.js` 가 한다. 커서·붙여넣기·Enter·수식 자리표 처리는 문단이든
 * 표의 칸이든 똑같고, 두 벌로 두면 한쪽만 고치는 날이 온다. 이 파일이 하는 것은 **어느
 * 칸인지 정해서 넘기는 것**과 **행·열 도구를 띄우는 것** 둘뿐이다.
 *
 * ## 구조를 바꾼 뒤에는 다시 받는다
 *
 * 행을 넣으면 표의 바이트가 통째로 달라진다. 화면이 그 마크업을 흉내내 DOM 을 기워 넣으면
 * **두 번째 어휘 구현**이 된다 (`structure.js` 가 같은 이유로 다시 받는다). 다시 받고,
 * 받은 뒤에 이 표를 다시 연다 — 행을 셋 넣는 사람이 매번 표를 다시 찾게 하지 않는다.
 */

/** 새 칸은 비워 둔다. 무엇을 채울지는 사용자가 안다. */
const EMPTY = '';

export function createTable({ stage, layer, commit, editor, onNotice, onResync }) {
  const ring = document.createElement('div');
  ring.className = 'cell-ring';
  ring.hidden = true;

  const bar = makeBar();
  layer.append(ring, bar);

  /** { nodeId, info, table, cell, addr } — 열려 있는 표 하나. */
  let current = null;

  /* ------------------------------------------------------------------ 열고 닫기 */

  /**
   * 이 노드가 표인가 — app.js 가 어디로 보낼지 정하는 근거다.
   *
   * 어휘 값으로 묻는다. 태그로 물으면 테마가 표를 `<div>` 로 짜는 날 조용히 어긋난다.
   */
  const claims = (info) => info?.value === 'table';

  function begin(nodeId, info, point) {
    const doc = stage.contentDocument;
    const table = doc?.querySelector(`[data-node-id="${cssEscape(nodeId)}"]`);
    if (!table) return false;
    watch(doc);

    const cell = cellAt(doc, table, point) ?? table.querySelector('th, td');
    if (!cell) {
      onNotice?.({ kind: 'blocked', text: '칸이 하나도 없는 표입니다' });
      return false;
    }

    const addr = addressOf(table, cell);
    if (!addr) {
      // `<tr>` 이 `<tbody>` 없이 놓인 표 등. 서버 트리에는 파서가 끼운 `<tbody>` 가 있고
      // 그것은 소스 바이트를 갖지 않아 명령이 닿지 못한다. 조용히 어긋나느니 말한다.
      onNotice?.({ kind: 'blocked', text: '이 표의 짜임을 읽지 못했습니다 — 소스를 손으로 고쳐야 합니다' });
      return false;
    }

    current = { nodeId, info, table, cell, addr };
    editor.begin(nodeId, info, point, { el: cell, parentPath: addr.parentPath, index: addr.index });
    show();
    return true;
  }

  /** 다시 받은 화면에서 같은 표를 다시 연다. 첫 칸에 커서가 들어간다. */
  function reopen(nodeId, info) {
    if (!nodeId || !info) return;
    begin(nodeId, info, null);
  }

  function end() {
    if (!current) return;
    current = null;
    ring.hidden = true;
    bar.hidden = true;
  }

  /* -------------------------------------------------------------- 칸 주소 읽기 */

  /** 누른 자리의 칸. iframe 안 좌표다 (`select.js` 가 그 창의 clientX/Y 를 준다). */
  function cellAt(doc, table, point) {
    if (!point) return null;
    const hit = doc.elementFromPoint(point.x, point.y);
    const cell = hit?.closest?.('th, td');
    return cell && table.contains(cell) ? cell : null;
  }

  /**
   * `(parentPath, index)`.
   *
   * DOM 의 요소 자식 순번이 곧 서버 트리의 순번이다 — 둘 다 문서 순서로 세고, 구조 자식은
   * 태그가 전부 살아 있다. 그래서 여기서 잰 수를 서버가 그대로 쓴다.
   */
  function addressOf(table, cell) {
    const row = cell.parentElement;
    if (row?.tagName !== 'TR') return null;
    const group = row.parentElement;
    if (!group || group === table) return null;   // <table> 직속 <tr> — 파서가 끼운 자리다

    const gi = [...table.children].indexOf(group);
    const ri = [...group.children].indexOf(row);
    const ci = [...row.children].indexOf(cell);
    if (gi < 0 || ri < 0 || ci < 0) return null;

    return { parentPath: [gi, ri], index: ci, gi, ri, ci };
  }

  /* ------------------------------------------------------------------- 행 */

  /** @param delta 0 = 위에, 1 = 아래에 */
  async function insertRow(delta) {
    const { nodeId, table, addr } = current;
    const group = table.children[addr.gi];
    const tag = headerRow(group.children[addr.ri]) ? 'th' : 'td';
    const width = columnCount(table);

    await run([{
      op: 'insertChild',
      target: nodeId,
      args: {
        parentPath: [addr.gi],
        index: addr.ri + delta,
        tag: 'tr',
        // 칸까지 한 명령에 담는다. `<tr>` 만 만들고 칸을 따로 넣으면 그 칸들은 **다음
        // 커밋**이 되고(같은 스냅샷을 보므로 새 행이 아직 없다) 되돌리기가 두 번 걸린다.
        html: `<${tag}>${EMPTY}</${tag}>`.repeat(width),
      },
    }], '행 넣기');
  }

  async function removeRow() {
    const { nodeId, table, addr } = current;
    const group = table.children[addr.gi];
    if (group.children.length <= 1) {
      return void onNotice?.({ kind: 'blocked', text: '마지막 행은 지울 수 없습니다 — 표째로 지우려면 표를 고르세요' });
    }
    await run([{ op: 'removeChild', target: nodeId, args: { parentPath: [addr.gi], index: addr.ri } }], '행 지우기');
  }

  /* ------------------------------------------------------------------- 열 */

  /** @param delta 0 = 왼쪽에, 1 = 오른쪽에 */
  async function insertColumn(delta) {
    const { nodeId, table, addr } = current;
    const at = addr.ci + delta;
    const cmds = [];

    for (const [gi, group] of [...table.children].entries()) {
      if (group.tagName === 'COLGROUP') {
        cmds.push({
          op: 'insertChild',
          target: nodeId,
          args: { parentPath: [gi], index: Math.min(at, group.children.length), tag: 'col', style: newShare(group) },
        });
        continue;
      }
      for (const [ri, row] of [...group.children].entries()) {
        if (row.tagName !== 'TR') continue;
        cmds.push({
          op: 'insertChild',
          target: nodeId,
          args: {
            parentPath: [gi, ri],
            index: Math.min(at, row.children.length),
            tag: headerRow(row) ? 'th' : 'td',
            html: EMPTY,
          },
        });
      }
    }
    await run(cmds, '열 넣기');
  }

  async function removeColumn() {
    const { nodeId, table, addr } = current;
    if (columnCount(table) <= 1) {
      return void onNotice?.({ kind: 'blocked', text: '마지막 열은 지울 수 없습니다 — 표째로 지우려면 표를 고르세요' });
    }

    const at = addr.ci;
    const cmds = [];
    for (const [gi, group] of [...table.children].entries()) {
      if (group.tagName === 'COLGROUP') {
        if (at < group.children.length) cmds.push({ op: 'removeChild', target: nodeId, args: { parentPath: [gi], index: at } });
        continue;
      }
      for (const [ri, row] of [...group.children].entries()) {
        if (row.tagName !== 'TR' || at >= row.children.length) continue;
        cmds.push({ op: 'removeChild', target: nodeId, args: { parentPath: [gi, ri], index: at } });
      }
    }
    await run(cmds, '열 지우기');
  }

  /* --------------------------------------------------------------- 보내기 */

  async function run(cmds, label) {
    if (!current || !cmds.length) return;
    const { nodeId, info } = current;

    // 커서를 먼저 거둔다. 칸에 쓰던 글이 있으면 그 저장이 이 커밋보다 **먼저** 나가야
    // 한다 — 순서가 뒤집히면 구조가 바뀐 뒤의 순번으로 옛 글을 쓰게 된다.
    await editor.end();

    const { ok } = await commit.send(cmds, label);
    if (!ok) return;

    onNotice?.({ kind: 'saved', text: `${label} — 되돌리기 한 번으로 돌아옵니다` });
    end();
    // 표의 바이트가 통째로 달라졌다. 화면이 마크업을 흉내내지 않고 다시 받는다.
    await onResync?.(nodeId, info);
  }

  /* ------------------------------------------------------------------ 그리기 */

  function show() {
    bar.hidden = false;
    ring.hidden = false;
    place();
    // 다시 받은 직후에는 iframe 이 아직 새 배치를 반영하기 전이라 잰 값이 전부 0 에
    // 가깝다 — 실측에서 도구 막대가 표 위가 아니라 **화면 맨 위**에 붙었다. 한 프레임
    // 뒤에 다시 잰다. (`watch` 의 ResizeObserver 도 결국 부르지만, 크기가 안 바뀌면
    // 그것은 오지 않는다.)
    requestAnimationFrame(() => place());
  }

  /**
   * 칸 테두리와 도구 막대를 슬라이드 위에 올린다.
   *
   * 좌표는 iframe 안에서 재고 밖에 그린다 — `select.js` 의 테두리와 같은 셈이다.
   */
  function place() {
    if (!current) return;
    const cell = editor.activeCell()?.el ?? current.cell;
    if (!cell?.isConnected) return void end();

    const f = stage.getBoundingClientRect();
    const host = layer.getBoundingClientRect();
    const r = cell.getBoundingClientRect();
    ring.style.transform = `translate(${f.left + r.left - host.left}px, ${f.top + r.top - host.top}px)`;
    ring.style.width = `${r.width}px`;
    ring.style.height = `${r.height}px`;

    const t = current.table.getBoundingClientRect();
    const top = f.top + t.top - host.top - bar.offsetHeight - 6;
    bar.style.transform = `translate(${f.left + t.left - host.left}px, ${Math.max(0, top)}px)`;
  }

  /**
   * 슬라이드가 다시 그려지는 것을 iframe **안에서** 지켜본다.
   *
   * 밖에서 "배율이 바뀌었다" 는 신호를 받아 다시 그리면 그 순간 iframe 은 아직 새 크기를
   * 반영하기 전이라 직전 배율의 값을 쓰게 된다 — `select.js`·`opaque.js` 가 같은 장치를
   * 쓰는 이유가 그것이다.
   */
  let watched = null;
  function watch(doc) {
    if (!doc || watched === doc) return;
    watched = doc;
    new doc.defaultView.ResizeObserver(() => place()).observe(doc.documentElement);
    // 표 밖을 누르면 닫는다. 캡처 단계로 받아 `select.js` 와 순서를 다투지 않는다.
    doc.addEventListener('click', (e) => {
      if (current && !current.table.contains(e.target)) end();
    }, true);
    doc.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && current && !editor.active()) end();
    }, true);
  }

  /* ------------------------------------------------------------------- 도구 막대 */

  function makeBar() {
    const el = document.createElement('div');
    el.className = 'sel-bar table-bar';
    el.hidden = true;

    const group = (label, buttons) => {
      const tag = document.createElement('span');
      tag.className = 'tb-label';
      tag.textContent = label;
      el.append(tag);
      for (const [text, title, run] of buttons) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = text;
        b.title = title;
        // 누르는 순간 칸에서 커서가 빠지면 방금 쓴 글이 저장 경로를 잃는다.
        b.addEventListener('mousedown', (e) => e.preventDefault());
        b.addEventListener('click', run);
        el.append(b);
      }
    };

    group('행', [
      ['위', '고른 칸의 행 위에 빈 행을 넣습니다', () => insertRow(0)],
      ['아래', '고른 칸의 행 아래에 빈 행을 넣습니다', () => insertRow(1)],
      ['지우기', '고른 칸이 있는 행을 지웁니다 (되돌리기로 돌아옵니다)', () => removeRow()],
    ]);

    const div = document.createElement('span');
    div.className = 'tb-div';
    el.append(div);

    group('열', [
      ['왼쪽', '고른 칸의 왼쪽에 빈 열을 넣습니다', () => insertColumn(0)],
      ['오른쪽', '고른 칸의 오른쪽에 빈 열을 넣습니다', () => insertColumn(1)],
      ['지우기', '고른 칸이 있는 열을 지웁니다 (되돌리기로 돌아옵니다)', () => removeColumn()],
    ]);

    return el;
  }

  return { claims, begin, reopen, end, place, active: () => current?.table ?? null };
}

/* ---------------------------------------------------------------------- 도구 */

/**
 * 새 열이 가져갈 지분.
 *
 * 실측한 표 10 개가 전부 `table-layout: fixed` 이고 기존 `<col>` 들의 지분 합이 이미
 * 100% 다. 지분을 안 주면 새 열은 **폭이 0** 이 되고, 사용자에게는 버튼이 아무 일도 하지
 * 않은 것으로 보인다(실측으로 그랬다).
 *
 * `100/(n+1)` 을 준다. 합이 100% 를 넘지만 `table-layout: fixed` 는 백분율이 넘치면
 * **비례로 줄여** 배분하므로, 기존 열들의 상대 비율은 그대로 유지된 채 새 열이 자기 몫을
 * 받는다. 기존 지분을 다시 쓰지 않는 이유 — 그것은 `<col>` 마다 명령이 하나씩 더 나가는
 * 일이고, 같은 부모의 편집 둘은 한 커밋에서 서로를 덮는다 (`commit.js` 의 byRange).
 */
function newShare(colgroup) {
  const n = colgroup.children.length;
  return `width:${Math.round(100 / (n + 1))}%`;
}

/** 이 행이 머리글 행인가 — 새 칸을 `<th>` 로 만들지 `<td>` 로 만들지의 근거다. */
const headerRow = (row) => !!row && row.children.length > 0
  && [...row.children].every((c) => c.tagName === 'TH');

/** 표의 열 수. 가장 넓은 행을 기준으로 센다 — 병합된 칸이 있으면 그것이 안전한 쪽이다. */
function columnCount(table) {
  let max = 0;
  for (const row of table.querySelectorAll('tr')) max = Math.max(max, row.children.length);
  return max;
}

function cssEscape(value) {
  return globalThis.CSS?.escape ? CSS.escape(value) : value.replace(/["\\]/g, '\\$&');
}
