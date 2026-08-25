/**
 * 테마 창 — 색·글꼴·글자 크기를 리포트 하나에 대해 바꾼다. 2026-08-25.
 *
 * ## 왜 이것이 "서식" 의 답인가
 *
 * 파워포인트에는 고른 글자를 굵게·크게·다른 색으로 만드는 도구가 있다. 이 편집기에는
 * 없고, 없는 것이 **일부러**다 — `server/props.js` 가 `style` 을 열지 않는다:
 *
 *   > `style` 을 열지 않는 이유는 그대로다 — 인라인 기하는 규칙 5 위반이고 **토큰 우회**다.
 *
 * 조판 권한을 테마가 독점하게 두는 설계이고, 그것이 매주 리포트가 같은 모양으로 나오는
 * 이유다. 요소마다 예외를 허용하면 몇 주 뒤 제목 크기가 슬라이드마다 달라진다 — 이
 * 시스템이 없애려던 바로 그 문제다.
 *
 * 그래서 **예외를 만드는 대신 정의를 바꾼다.** 제목이 크다고 느끼면 이 제목 하나가 아니라
 * `--text-display` 를 줄인다. 그러면 열세 장이 함께 줄고, 일관성은 그대로다. 사용자가
 * 짚은 그대로다 — "테마가 독점하기 때문에 생기는 문제면, 테마를 고칠 창이 필요하다".
 *
 * ## 이름을 지어내지 않는다
 *
 * `deck-tokens.js` 머리말의 규율이다 — 아무도 안 읽는 이름을 내보내면 값을 골라도 화면이
 * 그대로이고, 그것이 가장 나쁜 실패다. 그 규율을 **믿지 않고 매번 잰다** (`moves`).
 * 실측에서 둘이 걸렸다: `--accent-2` 는 테마가 정의만 하고 아무도 안 읽었고, 리포트들은
 * 자기 `<style>` 에 `font-size: 40px` 처럼 크기를 박아 두어 크기 토큰이 안 먹었다.
 * 앞은 목록에서 뺐고, 뒤는 창이 열릴 때 재서 끈다 — 리포트마다 다르기 때문이다.
 *
 * ## 고르는 동안에는 화면만 바뀐다
 *
 * 색은 **보면서** 골라야 한다. 그래서 끄는 동안 슬라이드의 `:root` 에 값을 얹어 미리
 * 보이고, 파일은 손을 뗄 때(`change`) 한 번 쓴다. 진행바를 끌 때와 같은 예외이고 같은
 * 이유다 (`opaque.js`) — 다만 커밋이 거부되면 미리보기를 걷는다.
 */

/**
 * 항목. `probe` 는 "이 토큰이 정말 화면을 움직이는가" 를 잴 때 표본으로 삼을 CSS 속성이다.
 *
 * `--accent-2`(서브 색)는 넣지 않았다. 테마 파일이 정의는 하지만 **저장소 어디에서도 읽지
 * 않는다** — 값을 골라도 아무 일도 일어나지 않는 손잡이가 된다.
 */
const FIELDS = [
  { key: 'mainColor', label: '메인 색', type: 'color', token: '--accent', probe: ['color', 'borderTopColor', 'backgroundColor'], test: '#ff00ff' },
  { key: 'bodySize', label: '본문 크기', type: 'number', token: '--text-body', unit: 'px', min: 12, max: 32, probe: ['fontSize'], test: '99px' },
  { key: 'titleSize', label: '제목 크기', type: 'number', token: '--text-display', unit: 'px', min: 20, max: 72, probe: ['fontSize'], test: '99px' },
];

export function createTheme({ stage, layer, commit, onNotice, button }) {
  const panel = document.createElement('div');
  panel.className = 'op-panel theme-panel';
  panel.hidden = true;
  layer.append(panel);

  const inputs = new Map();
  /** 지금까지 고른 값들. 명령은 **매번 전부** 보낸다 — 블록을 통째로 다시 쓰기 때문이다. */
  let chosen = {};

  build();
  button?.addEventListener('click', () => (panel.hidden ? open() : close()));

  /* --------------------------------------------------------------- 열고 닫기 */

  /**
   * 지금 값을 **슬라이드에서** 읽어 채운다.
   *
   * 파일의 토큰 블록을 읽지 않는 이유 — 비어 있을 수도 있고(테마 기본을 쓰는 중), 그때
   * 입력칸을 비워 두면 사용자는 지금 색이 무엇인지 알 방법이 없다. 계산된 값은 테마가
   * 주었든 이 리포트가 덮었든 **화면에 실제로 보이는 그것**이다.
   */
  function open() {
    const doc = stage.contentDocument;
    const root = doc?.documentElement;
    if (!root) return;

    const now = doc.defaultView.getComputedStyle(root);
    for (const f of FIELDS) {
      const raw = now.getPropertyValue(f.token).trim();
      const input = inputs.get(f.key);
      if (f.type === 'color') input.value = hex(raw) ?? '#000000';
      else input.value = String(parseFloat(raw) || '');

      // **정말 먹는지 재 본다.** 실측: 리포트들이 자기 `<style>` 에 `font-size: 40px` 처럼
      // 크기를 박아 두어, 토큰을 바꿔도 화면이 그대로다. 그런 손잡이를 살려 두면 값을
      // 고르고 아무 일도 안 일어나는데 사용자는 이유를 알 수 없다 — `deck-tokens.js` 가
      // "가장 나쁜 종류의 실패" 라고 부르는 그것이다. 안 먹으면 끄고, 왜인지 적는다.
      const works = moves(doc, f);
      input.disabled = !works;
      input.closest('.theme-row').classList.toggle('dead', !works);
      input.closest('.theme-row').title = works ? ''
        : '이 리포트는 이 값을 자기 <style> 안에 직접 적어 두었습니다 — 테마로는 못 바꿉니다';
    }
    chosen = {};
    panel.hidden = false;
    button?.setAttribute('aria-pressed', 'true');
    place();
  }

  function close() {
    panel.hidden = true;
    button?.setAttribute('aria-pressed', 'false');
  }

  /** 도구 모음의 그 버튼 바로 아래에 붙는다. */
  function place() {
    if (panel.hidden || !button) return;
    const b = button.getBoundingClientRect();
    const host = layer.getBoundingClientRect();
    panel.style.transform = `translate(${Math.max(8, b.left - host.left)}px, ${b.bottom - host.top + 6}px)`;
  }

  /* ----------------------------------------------------------------- 만들기 */

  function build() {
    const head = document.createElement('div');
    head.className = 'menu-head';
    head.textContent = '이 리포트의 테마 — 열세 장이 함께 바뀝니다';
    panel.append(head);

    for (const f of FIELDS) {
      const row = document.createElement('label');
      row.className = 'theme-row';
      row.append(document.createTextNode(f.label));

      const input = document.createElement('input');
      input.type = f.type;
      if (f.min !== undefined) { input.min = String(f.min); input.max = String(f.max); }
      // 고르는 동안은 화면만, 손을 뗄 때 파일에 쓴다.
      input.addEventListener('input', () => preview(f, input.value));
      input.addEventListener('change', () => apply(f, input.value));
      row.append(input);
      panel.append(row);
      inputs.set(f.key, input);
    }

    const foot = document.createElement('div');
    foot.className = 'op-buttons';
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.textContent = '테마 기본으로';
    reset.addEventListener('click', () => revert());
    const done = document.createElement('button');
    done.type = 'button';
    done.textContent = '닫기';
    done.addEventListener('click', close);
    foot.append(reset, done);
    panel.append(foot);
  }

  /* ------------------------------------------------------------------ 재 보기 */

  /**
   * 이 토큰을 흔들면 화면이 움직이는가.
   *
   * 이름이 정의돼 있는지가 아니라 **테마가 그것을 읽는지**를 묻는다. 정의만 되어 있고
   * 아무도 안 읽는 이름이 실제로 있었다(`--accent-2`). 그리고 리포트가 자기 `<style>` 로
   * 덮어 버리면 읽히는 이름이어도 소용이 없다.
   *
   * 그래서 값을 잠깐 터무니없는 것으로 바꿔 보고, 지금 장의 요소들이 반응하는지 본다.
   * 잰 뒤에는 반드시 되돌린다.
   */
  function moves(doc, field) {
    const root = doc.documentElement;
    const scope = doc.querySelectorAll('section')[0] ? doc.querySelectorAll('section') : [doc.body];
    const sample = () => {
      const out = [];
      for (const section of scope) {
        for (const el of section.querySelectorAll('*')) {
          const cs = doc.defaultView.getComputedStyle(el);
          for (const prop of field.probe) out.push(cs[prop]);
          if (out.length > 900) return out.join('|');   // 충분히 봤다. 장이 열세 개다
        }
      }
      return out.join('|');
    };

    const had = root.style.getPropertyValue(field.token);
    const before = sample();
    root.style.setProperty(field.token, field.test);
    const after = sample();
    if (had) root.style.setProperty(field.token, had);
    else root.style.removeProperty(field.token);
    return before !== after;
  }

/* ------------------------------------------------------------- 미리보기·저장 */

  /** 슬라이드에만 얹는다. 파일은 아직 건드리지 않는다. */
  function preview(field, value) {
    const root = stage.contentDocument?.documentElement;
    if (!root || !value) return;
    root.style.setProperty(field.token, withUnit(field, value));
    // 메인 색은 형제 토큰까지 함께 움직여야 미리보기가 진짜와 같다.
    if (field.key === 'mainColor') {
      for (const t of ['--text-accent', '--surface-accent', '--border-accent']) root.style.setProperty(t, value);
    }
  }

  /** 미리보기를 걷는다 — 커밋이 거부됐거나 기본으로 되돌릴 때. */
  function clearPreview() {
    const root = stage.contentDocument?.documentElement;
    if (!root) return;
    for (const f of FIELDS) root.style.removeProperty(f.token);
    for (const t of ['--text-accent', '--surface-accent', '--border-accent']) root.style.removeProperty(t);
  }

  /**
   * 파일에 쓴다.
   *
   * **고른 것을 전부 다시 보낸다.** `setDeckTokens` 는 블록을 통째로 갈아 끼우므로
   * (`token-commands.js`), 마지막에 만진 하나만 보내면 앞서 고른 것들이 지워진다.
   */
  async function apply(field, value) {
    if (!value) return;
    chosen = { ...chosen, [field.key]: withUnit(field, value) };

    const { ok } = await commit.send([{ op: 'setDeckTokens', args: chosen }], '테마 바꾸기');
    if (!ok) {
      clearPreview();
      return;
    }
    onNotice?.({ kind: 'saved', text: `${field.label}을(를) 바꿨습니다 — 되돌리기로 돌아옵니다` });
  }

  /** 이 리포트의 재정의를 전부 지운다. 테마가 주는 값으로 돌아간다. */
  async function revert() {
    chosen = {};
    const { ok } = await commit.send([{ op: 'setDeckTokens', args: {} }], '테마 기본으로');
    if (!ok) return;
    clearPreview();
    onNotice?.({ kind: 'saved', text: '테마 기본으로 돌아갔습니다' });
    open();
  }

  return { open, close, place, active: () => !panel.hidden };
}

/* ---------------------------------------------------------------------- 도구 */

const withUnit = (f, v) => (f.unit ? `${parseFloat(v)}${f.unit}` : v);

/**
 * `<input type="color">` 는 `#rrggbb` 만 받는다. 계산된 값은 `rgb(...)` 로 오므로 옮긴다.
 * 옮기지 못하면 null — 그때는 검정으로 두고, 사용자가 고르면 그 값이 이긴다.
 */
function hex(value) {
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(value);
  if (!m) return null;
  return `#${m.slice(1, 4).map((n) => Math.round(Number(n)).toString(16).padStart(2, '0')).join('')}`;
}
