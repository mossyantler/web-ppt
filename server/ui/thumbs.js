/**
 * 레일의 슬라이드 그림 — 제목 대신 장을 보여준다. 2026-08-25.
 *
 * ## 왜 제목만으로는 모자란가
 *
 * 지금까지 레일은 `data-label` 이나 첫 제목을 글자로 적었다. 그것으로 "PTM 지배방정식"
 * 과 "SuWAT 지배방정식" 을 구별할 수는 있어도 **어느 장이 표가 있고 어느 장이 그림이
 * 두 개인지**는 알 수 없다. 매주 같은 틀로 만드는 리포트에서 장을 찾는 실마리는 대개
 * 제목이 아니라 모양이다.
 *
 * ## 그리는 법 — iframe 열세 개가 아니라 그림자 뿌리 열세 개
 *
 * 장마다 iframe 을 띄우면 같은 문서를 열세 번 파싱하고 덱 스크립트가 열세 번 돈다.
 * 대신 iframe **안의** `<section>` 을 복제해 부모 문서의 그림자 뿌리(shadow root)에
 * 넣는다. 그림자 경계가 iframe 경계와 같은 일을 해 준다 — 덱의 CSS 가 편집기 껍데기로
 * 새지 않는다. 덱이 자기 레일을 그릴 때 쓰는 방법과 같다(`deck-stage.js` 의 `_materialize`).
 *
 * 규율은 그대로다: **슬라이드 DOM 에는 아무것도 넣지 않는다.** 복제본은 부모 문서에
 * 살고, 원본은 손대지 않는다.
 *
 * ## 토큰을 손으로 옮겨 심는다
 *
 * 덱의 스타일시트는 `:root { --accent: … }` 로 토큰을 정의하는데, 그림자 뿌리 안에서
 * `:root` 는 **아무것도 가리키지 않는다**(문서 뿌리는 편집기 쪽이다). 그대로 두면
 * 슬라이드가 색도 크기도 없이 뜬다. 그래서 iframe 의 계산된 사용자 정의 속성 99 개를
 * 읽어 그림자 host 에 얹는다 — 계산된 값이므로 테마 기본이든 이 리포트가 덮은 값이든
 * **화면에 실제로 보이는 그것**이다 (`theme.js` 가 값을 읽을 때와 같은 이유다).
 *
 * ## 스타일시트는 `<link>` 로 넣는다
 *
 * 규칙 본문을 복사해 붙이면 그 안의 상대 경로(`url(...)`)가 편집기 문서 기준으로
 * 풀린다 — 글꼴이 60 군데, 그림이 5 군데다(실측). `<link>` 는 자기 URL 기준으로 풀고,
 * 같은 주소라 브라우저가 파싱 결과를 나눠 쓴다.
 *
 * ## 보이는 것만 만든다
 *
 * 열세 장이면 레일에 서너 장만 보인다. 스크롤해 다가올 때 만들고, 만든 것은 다시 만들지
 * 않는다 — 덱의 레일이 쓰는 것과 같은 장치다.
 */

/** 미리 만들어 둘 여유. 스크롤이 닿기 전에 준비되어 있어야 빈 칸이 안 보인다. */
const AHEAD = '300px';

export function createThumbs({ stage }) {
  /** 지금 덱의 그리기 재료. 덱이 바뀌면 통째로 갈린다. */
  let kit = null;
  let io = null;
  /**
   * 자리 크기가 달라지면 배율을 다시 정한다.
   *
   * 한 번만 재면 안 된다 — 레일에 스크롤바가 생기거나 사라지는 순간 폭이 열몇 px 달라지고,
   * 그때 그린 배율로 굳은 그림은 흰 여백을 남기거나 넘친다(실측 — 오른쪽·아래에 흰 띠).
   * 창 크기·판 여닫기까지 전부 이 하나가 받는다.
   */
  let ro = null;

  /**
   * 덱이 떴다. 스타일시트 주소와 토큰과 원래 크기를 한 번만 읽어 둔다.
   *
   * 장마다 다시 읽지 않는 이유 — 열세 번 읽어도 답이 같고, 계산된 스타일을 읽는 일은
   * 그때마다 레이아웃을 강제한다.
   */
  function load(doc) {
    stop();
    if (!doc) return void (kit = null);

    const view = doc.defaultView;
    const cs = view.getComputedStyle(doc.documentElement);
    const tokens = [];
    for (let i = 0; i < cs.length; i += 1) {
      const name = cs[i];
      if (name.startsWith('--')) tokens.push(`${name}:${cs.getPropertyValue(name)}`);
    }

    const el = doc.querySelector('deck-stage');
    const first = doc.querySelector('section');
    kit = {
      // 절대 주소다(`link.href` 가 이미 풀어 준다). 상대 주소를 넘기면 편집기 문서
      // 기준으로 다시 풀려 엉뚱한 곳을 가리킨다.
      links: [...doc.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.href),
      // 덱이 자기 문서에 직접 적은 규칙들. `.slide-title { font-size: 40px }` 처럼
      // 테마를 덮는 것이 여기 있으므로 빠뜨리면 썸네일만 다른 모양이 된다.
      inline: [...doc.querySelectorAll('style')].map((s) => s.textContent),
      tokens: tokens.join(';'),
      // 덱이 자기 원래 크기를 적어 두었다. 없으면 첫 장의 실제 크기, 그것도 없으면 16:9.
      w: Number(el?.getAttribute('width')) || first?.offsetWidth || 1280,
      h: Number(el?.getAttribute('height')) || first?.offsetHeight || 720,
    };

    io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) materialize(e.target);
    }, { rootMargin: AHEAD });

    ro = new ResizeObserver((entries) => {
      for (const e of entries) rescale(e.target);
    });
  }

  function stop() {
    io?.disconnect();
    ro?.disconnect();
    io = null;
    ro = null;
  }

  /**
   * 이 장의 그림 자리. 아직 비어 있고, 눈에 들어올 때 채워진다.
   *
   * 비율을 여기서 못 박는 이유 — 채워지기 전에도 자리가 제 크기여야 레일이 나중에
   * 덜컹이지 않는다.
   */
  function frameFor(section) {
    const frame = document.createElement('div');
    frame.className = 'thumb-frame';
    if (kit) frame.style.aspectRatio = `${kit.w} / ${kit.h}`;
    frame.__section = section;
    io?.observe(frame);
    ro?.observe(frame);
    return frame;
  }

  /** 눈에 들어왔다. 이제 복제해 넣는다. */
  function materialize(frame) {
    io?.unobserve(frame);
    const section = frame.__section;
    if (!kit || !section?.isConnected || frame.firstChild) return;

    const clone = section.cloneNode(true);
    inertify(section, clone);

    // 원래 크기로 그린 뒤 자리에 맞춰 줄인다. 글자 크기를 줄이는 것이 아니라 판을
    // 줄이는 것이라, 실제 슬라이드와 **같은 줄바꿈**이 나온다.
    clone.style.cssText += ';position:absolute;top:0;left:0;transform-origin:0 0;'
      + `width:${kit.w}px;height:${kit.h}px;margin:0;`
      + 'box-sizing:border-box;overflow:hidden;visibility:visible;opacity:1;pointer-events:none;';

    const host = document.createElement('div');
    host.className = 'thumb-host';
    // 복제본은 보여주기 전용이다. 안의 링크·버튼이 탭 순서에 끼면 레일에서 Tab 을
    // 눌렀을 때 슬라이드 속으로 초점이 빨려 들어간다.
    host.inert = true;
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = kit.tokens;

    const sr = host.attachShadow({ mode: 'open' });
    for (const href of kit.links) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      sr.append(link);
    }
    for (const text of kit.inline) {
      const style = document.createElement('style');
      style.textContent = text;
      sr.append(style);
    }
    sr.append(clone);
    frame.append(host);
    rescale(frame);
  }

  /** 이 자리의 지금 폭에 맞춘다. 아직 안 만들어졌으면 할 일이 없다. */
  function rescale(frame) {
    const clone = frame.querySelector('.thumb-host')?.shadowRoot?.lastElementChild;
    const w = frame.clientWidth;
    if (!clone || !w || !kit) return;
    clone.style.transform = `scale(${w / kit.w})`;
  }

  /** 밖에서 배치가 바뀌었다고 알려 올 때. 크기 관찰자가 놓치는 경우를 위한 보험이다. */
  function relayout(rail) {
    for (const frame of rail.querySelectorAll('.thumb-frame')) rescale(frame);
  }

  /**
   * 복제본에서 스스로 움직이는 것을 걷어낸다.
   *
   * 그림은 **살아 있는 요소가 이미 푼 주소**를 옮겨 준다 — 복제는 속성을 그대로 베끼고,
   * 그 상대 주소는 편집기 문서 기준으로 다시 풀려 404 가 된다.
   *
   * 사용자 정의 요소는 붙이는 순간 `connectedCallback` 이 돈다. 열세 장이면 열세 번이다.
   * 이름에 `-` 가 든 것을 평범한 `<div>` 로 갈아 끼워 그 실행을 막되 **안의 내용은
   * 그대로 옮긴다** — 껍데기 노릇만 하는 요소가 대부분이라 내용이 곧 슬라이드다.
   */
  function inertify(live, clone) {
    const liveImgs = live.querySelectorAll('img');
    clone.querySelectorAll('img').forEach((img, i) => {
      const src = liveImgs[i]?.currentSrc || liveImgs[i]?.src;
      if (src) img.src = src;
      img.removeAttribute('srcset');
      img.loading = 'lazy';
      img.decoding = 'async';
    });

    for (const el of clone.querySelectorAll('script, iframe, audio, object, embed, [popover], dialog')) {
      el.remove();
    }
    for (const el of clone.querySelectorAll('video')) {
      const box = document.createElement('div');
      box.style.cssText = el.style.cssText;
      el.replaceWith(box);
    }

    clone.removeAttribute('id');
    clone.removeAttribute('data-deck-active');
    for (const el of clone.querySelectorAll('[id]')) el.removeAttribute('id');

    // 목록이 정적이므로, 갈아 끼우면서 옮겨 온 자손 중의 사용자 정의 요소도 이 순회에서
    // 다시 만난다 (`deck-stage.js` 가 같은 이유로 같은 순서를 쓴다).
    for (const el of clone.querySelectorAll('*')) {
      if (el.tagName.includes('-')) el.replaceWith(plain(el));
    }
  }

  function plain(el) {
    const box = document.createElement('div');
    for (const { name, value } of el.attributes) {
      try { box.setAttribute(name, value); } catch { /* 못 옮기는 이름 하나 때문에 죽지 않는다 */ }
    }
    box.append(...el.childNodes);
    return box;
  }

  return { load, stop, frameFor, relayout, ready: () => !!kit };
}
