import { readFileSync, writeFileSync } from 'node:fs';

// 편집기가 실제로 쓰는 것만. 2035개를 다 들이면 그중 스무 개만 화면에 뜬다.
const WANT = {
  // 자유 배치 토글 (로드맵 5단계) — 격자 밖으로 꺼내기 / 흐름으로 되돌리기
  free: 'move',
  flow: 'align-vertical-justify-start',
  back:      'arrow-left',
  undo:      'undo-2',
  redo:      'redo-2',
  light:     'sun',
  dark:      'moon',
  all:       'layers-2',
  logo:      'image-plus',
  present:   'play',
  newDeck:   'file-plus',
  up:        'arrow-up',
  down:      'arrow-down',
  add:       'plus',
  remove:    'trash-2',
  duplicate: 'copy',
  railUp:    'chevron-up',
  railDown:  'chevron-down',
  zoomIn:    'zoom-in',
  zoomOut:   'zoom-out',
  fit:       'maximize',
  close:     'x',

  // 리본·서식 창 (파워포인트식 UI). 탭 이름은 글자로 남고 아이콘은 버튼에만 붙는다.
  format:    'sliders-horizontal',
  palette:   'palette',
  slide:     'rectangle-horizontal',
  group:     'group',
  ungroup:   'ungroup',
  front:     'bring-to-front',
  behind:    'send-to-back',
  more:      'ellipsis-vertical',
  panelOpen: 'panel-right-open',
  panelShut: 'panel-right-close',

  // 삽입 탭이 어휘에 붙이는 그림. 어휘에 없는 종류는 아이콘도 없이 글자만 뜬다 —
  // 목록은 테마가 정하므로 여기서 종류를 늘리지 않는다.
  text:      'type',
  heading:   'heading',
  list:      'list',
  table:     'table',
  image:     'image',
  equation:  'sigma',
};

const out = [];
for (const [key, file] of Object.entries(WANT)) {
  const raw = readFileSync(`node_modules/lucide-static/icons/${file}.svg`, 'utf8');
  // 속성은 CSS 가 정한다 — 크기·굵기를 파일마다 박아 두면 한 곳에서 못 바꾼다.
  const body = raw
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<svg[\s\S]*?>/, '')
    .replace(/<\/svg>/, '')
    .split('\n').map((l) => l.trim()).filter(Boolean).join('');
  out.push(`  ${key}: '${body}',`);
}

const src = `/**
 * 아이콘 — Lucide (https://lucide.dev, ISC).
 *
 * 필요한 것만 골라 넣은 사본이다. 패키지째 들이지 않는 이유 둘 —
 * 2035 개 중 스무 개만 쓰고, 편집기는 빌드 도구 없이 파일을 그대로 내주므로
 * 나무흔들기(tree-shaking)를 해 줄 사람이 없다.
 *
 * 크기·굵기·색은 CSS 가 정한다(\`.ico\`). 그래서 여기엔 그리는 선만 남긴다 —
 * 파일마다 24px 이 박혀 있으면 버튼마다 다른 크기를 줄 수 없다.
 *
 * 새 아이콘이 필요하면 \`WANT\` 에 이름을 넣고 다시 생성한다:
 *   node tools/gen-icons.mjs
 */

const PATHS = {
${out.join('\n')}
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
 * 버튼 안을 아이콘으로 갈아 끼운다. 글자가 있던 자리는 \`title\` 로 옮긴다 —
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
`;

writeFileSync('server/ui/icons.js', src);
console.log(`icons.js 생성 — ${Object.keys(WANT).length}개`);
