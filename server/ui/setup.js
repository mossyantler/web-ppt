/**
 * 새 리포트 설정 — 프레젠테이션 마스터를 정하는 화면. 명세 결정 3.
 *
 * **내용 슬라이드를 고르는 화면이 아니다.** 사용자는 디자인 시스템·레이아웃·내용을 먼저
 * 만들어 두고 문서를 만든다(결정 6). 그래서 여기서 정하는 것은 넷뿐이다 —
 * 색·글꼴·글자 크기 · 배경 · 머리글·꼬리글 내용 · 로고.
 *
 * 만들고 나면 표지 한 장짜리 리포트가 생기고 편집기가 열린다. 나머지 장은 원고를 받은
 * AI 가 이미 있는 명령으로 채운다(결정 8) — 이 화면이 목차를 짜지 않는 이유다.
 *
 * ## 이 화면은 명령을 보내지 않는다
 *
 * 고칠 문서가 아직 없기 때문이다. `POST /decks` 하나를 보내고, 그 뒤로는 전부 명령이다.
 */

export function createSetup({ view, form, error, onCreated }) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await make();
  });

  /** 열 때마다 오늘 날짜와 주차를 채워 둔다 (결정 6 — 미리 채운다). */
  function open() {
    view.hidden = false;
    const today = new Date();
    setIfEmpty('date', today.toISOString().slice(0, 10));
    setIfEmpty('week', `${today.getFullYear()} · W${isoWeek(today)}`);
    error.textContent = '';
    form.elements.title?.focus();
  }

  function close() {
    view.hidden = true;
  }

  function setIfEmpty(name, value) {
    const field = form.elements[name];
    if (field && !field.value) field.value = value;
  }

  async function make() {
    const setup = read();
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    error.textContent = '';

    try {
      const res = await fetch('/decks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(setup),
      });
      const body = await res.json().catch(() => null);

      if (!res.ok) {
        // 만들지 못한 이유를 그 자리에 남긴다. 목록으로 튕겨 보내면 사용자는 무엇이
        // 잘못됐는지 모른 채 처음부터 다시 적어야 한다.
        error.textContent = body?.error ?? '리포트를 만들지 못했습니다';
        return;
      }
      onCreated?.(body.deckId);
    } catch (err) {
      error.textContent = `서버에 닿지 못했습니다: ${err.message}`;
    } finally {
      button.disabled = false;
    }
  }

  /** 폼 → 서버가 받는 모양. 빈 칸은 **보내지 않는다** — 템플릿 예시 문구가 남는다. */
  function read() {
    const out = {};
    for (const field of form.elements) {
      if (!field.name || !field.value) continue;
      out[field.name] = field.value;
    }
    // 글자 크기는 숫자만 받아 놓고 단위를 여기서 붙인다. 사용자에게 `px` 를 적게 하면
    // 어떤 단위가 되는지를 사용자가 정하게 되고, 그러면 조판이 깨질 수 있다.
    if (out.bodySize) out.bodySize = `${out.bodySize}px`;
    return out;
  }

  return { open, close };
}

/** ISO 주차. 리포트 이름이 주차로 불리므로 기본값이 맞아야 쓸모가 있다. */
function isoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  // 목요일 기준 — ISO 8601 이 그렇게 센다. 연말·연초가 한 주씩 어긋나는 것을 막는다.
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return String(Math.ceil(((d - yearStart) / 86400000 + 1) / 7)).padStart(2, '0');
}
