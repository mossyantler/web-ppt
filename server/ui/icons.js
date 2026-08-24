/**
 * 아이콘 — Lucide (https://lucide.dev, ISC).
 *
 * 필요한 것만 골라 넣은 사본이다. 패키지째 들이지 않는 이유 둘 —
 * 2035 개 중 스무 개만 쓰고, 편집기는 빌드 도구 없이 파일을 그대로 내주므로
 * 나무흔들기(tree-shaking)를 해 줄 사람이 없다.
 *
 * 크기·굵기·색은 CSS 가 정한다(`.ico`). 그래서 여기엔 그리는 선만 남긴다 —
 * 파일마다 24px 이 박혀 있으면 버튼마다 다른 크기를 줄 수 없다.
 *
 * 새 아이콘이 필요하면 `WANT` 에 이름을 넣고 다시 생성한다:
 *   node tools/gen-icons.mjs
 */

const PATHS = {
  free: '<path d="M12 2v20" /><path d="m15 19-3 3-3-3" /><path d="m19 9 3 3-3 3" /><path d="M2 12h20" /><path d="m5 9-3 3 3 3" /><path d="m9 5 3-3 3 3" />',
  flow: '<rect width="14" height="6" x="5" y="16" rx="2" /><rect width="10" height="6" x="7" y="6" rx="2" /><path d="M2 2h20" />',
  back: '<path d="m12 19-7-7 7-7" /><path d="M19 12H5" />',
  undo: '<path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11" />',
  redo: '<path d="m15 14 5-5-5-5" /><path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13" />',
  light: '<circle cx="12" cy="12" r="4" /><path d="M12 2v2" /><path d="M12 20v2" /><path d="m4.93 4.93 1.41 1.41" /><path d="m17.66 17.66 1.41 1.41" /><path d="M2 12h2" /><path d="M20 12h2" /><path d="m6.34 17.66-1.41 1.41" /><path d="m19.07 4.93-1.41 1.41" />',
  dark: '<path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401" />',
  all: '<path d="M13 13.74a2 2 0 0 1-2 0L2.5 8.87a1 1 0 0 1 0-1.74L11 2.26a2 2 0 0 1 2 0l8.5 4.87a1 1 0 0 1 0 1.74z" /><path d="m20 14.285 1.5.845a1 1 0 0 1 0 1.74L13 21.74a2 2 0 0 1-2 0l-8.5-4.87a1 1 0 0 1 0-1.74l1.5-.845" />',
  logo: '<path d="M16 5h6" /><path d="M19 2v6" /><path d="M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5" /><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" /><circle cx="9" cy="9" r="2" />',
  present: '<path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z" />',
  newDeck: '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" /><path d="M14 2v5a1 1 0 0 0 1 1h5" /><path d="M9 15h6" /><path d="M12 18v-6" />',
  up: '<path d="m5 12 7-7 7 7" /><path d="M12 19V5" />',
  down: '<path d="M12 5v14" /><path d="m19 12-7 7-7-7" />',
  add: '<path d="M5 12h14" /><path d="M12 5v14" />',
  remove: '<path d="M10 11v6" /><path d="M14 11v6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />',
  duplicate: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />',
  railUp: '<path d="m18 15-6-6-6 6" />',
  railDown: '<path d="m6 9 6 6 6-6" />',
  zoomIn: '<circle cx="11" cy="11" r="8" /><line x1="21" x2="16.65" y1="21" y2="16.65" /><line x1="11" x2="11" y1="8" y2="14" /><line x1="8" x2="14" y1="11" y2="11" />',
  zoomOut: '<circle cx="11" cy="11" r="8" /><line x1="21" x2="16.65" y1="21" y2="16.65" /><line x1="8" x2="14" y1="11" y2="11" />',
  fit: '<path d="M8 3H5a2 2 0 0 0-2 2v3" /><path d="M21 8V5a2 2 0 0 0-2-2h-3" /><path d="M3 16v3a2 2 0 0 0 2 2h3" /><path d="M16 21h3a2 2 0 0 0 2-2v-3" />',
  close: '<path d="M18 6 6 18" /><path d="m6 6 12 12" />',
};

/** 이름으로 <svg> 하나를 만든다. 없는 이름은 빈 자리로 — 아이콘 하나 때문에 화면이 죽지 않는다. */
export function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'ico');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = PATHS[name] ?? '';
  return svg;
}

/**
 * 버튼 안을 아이콘으로 갈아 끼운다. 글자가 있던 자리는 `title` 로 옮긴다 —
 * 아이콘만 남으면 무엇인지 알 길이 화면에 없어진다.
 */
export function setIcon(el, name, label) {
  if (!el) return el;
  const text = label ?? el.title ?? el.textContent.trim();
  el.replaceChildren(icon(name));
  if (text) {
    el.title = text;
    el.setAttribute('aria-label', text);
  }
  return el;
}

/** 아이콘과 글자를 나란히. 발표처럼 이름이 같이 보여야 하는 버튼용. */
export function setIconText(el, name, text) {
  if (!el) return el;
  const span = document.createElement('span');
  span.textContent = text;
  el.replaceChildren(icon(name), span);
  return el;
}
