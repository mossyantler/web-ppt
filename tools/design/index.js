#!/usr/bin/env node
/**
 * `DESIGN.md` → `tokens.css` — 새 디자인 시스템을 만드는 절차. 결정 7.
 *
 * [open-design](https://github.com/nexu-io/open-design) 의 절차를 따른다. 그쪽은 브랜드 계약서
 * `DESIGN.md` 를 원본으로 두고 나머지를 그것에서 파생시킨다. 대조해 보니 우리 구조는 그쪽과
 * 거의 같은 자리를 이미 갖고 있었고 — `themes/<이름>/` 이 패키지, `mapping.json` 이 기계 계약,
 * `templates/` 가 컴포넌트 — **사람이 읽는 계약서 한 칸만 비어 있었다.**
 *
 * ## 무엇이 원본이고 무엇이 파생인가
 *
 *   DESIGN.md      사람이 쓴다. 표 하나가 토큰 하나다. **원본**
 *        ↓ 이 도구
 *   tokens.css     기계가 만든다. 손으로 고치지 않는다. **파생**
 *   mapping.json   손으로 쓴다 — "어떤 클래스가 카드인가" 는 기계 계약이라 산문에서 나오지 않는다
 *
 * ## 왜 표인가
 *
 * 산문에서 값을 캐내려면 추측이 필요하고, 추측이 틀리면 색이 조용히 달라진다. 표는 사람이
 * 읽기에도 값 목록으로 읽히고 기계에는 애매함이 없다. 계약서의 나머지 산문은 도구가 무시한다 —
 * **그 산문이 이 파일보다 중요하다.** 왜 그 색인지는 표가 말해 주지 않는다.
 *
 *   node tools/design/index.js snu            # themes/snu/tokens.css 를 만든다
 *   node tools/design/index.js snu --check    # 만들 결과가 지금 파일과 같은지만 본다 (CI)
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const themeDir = (theme) => join(HERE, '..', '..', 'themes', theme);

/**
 * 슬라이드가 실제로 읽는 이름들. 이 중 하나라도 없으면 화면이 조용히 깨진다 —
 * 문법은 통과하고 색만 빠지는 실패다(§2.4 결론 3 과 같은 종류).
 *
 * **목록을 늘리는 것은 계약을 좁히는 일이다.** 여기 적힌 것은 `slides/slides.css` 가
 * `var(...)` 로 읽는 이름 중 테마마다 달라야 하는 것들이다.
 */
export const REQUIRED = [
  '--font-sans', '--font-mono',
  '--text-body', '--text-title', '--text-display',
  '--accent', '--accent-hover',
  '--text-strong', '--text-default', '--text-muted',
  '--surface-page', '--surface-subtle', '--surface-card',
  '--border-subtle', '--border-default',
];

/**
 * `DESIGN.md` 의 표에서 토큰을 읽는다.
 *
 * 표의 모양은 `| 토큰 | 값 | 설명 |` 이고, 토큰 칸이 `--` 로 시작하는 줄만 본다.
 * 그래서 계약서 안의 다른 표(예: 쓰임새 설명)를 도구가 잘못 먹지 않는다.
 */
export function parseDesign(markdown) {
  const tokens = [];
  const seen = new Set();

  for (const line of markdown.split('\n')) {
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length < 4) continue;                    // `| a | b |` 는 앞뒤 빈 칸 포함 4칸이다

    // 표에서는 토큰 이름을 `` `--이름` `` 처럼 감싸 적는다. **먼저 벗기고 나서** 본다 —
    // 벗기기 전에 검사하면 백틱 때문에 하나도 안 걸린다.
    const clean = cells[1].replace(/`/g, '').trim();
    const val = cells[2].replace(/`/g, '').trim();

    // 표의 구분선(`|---|---|`)도 대시로 시작한다. 대시와 콜론뿐인 칸은 표의 뼈대다.
    if (/^[-:]+$/.test(clean)) continue;
    if (!clean.startsWith('--') || !val) continue;

    if (seen.has(clean)) {
      throw new Error(`같은 토큰이 두 번 선언됐다: ${clean} — 어느 쪽이 이기는지는 순서에 달린다`);
    }
    seen.add(clean);
    tokens.push({ name: clean, value: val, note: (cells[3] ?? '').replace(/`/g, '').trim() });
  }

  return tokens;
}

/** 계약을 지키는가. 어기면 **무엇이 빠졌는지 이름으로** 알려준다. */
export function assertContract(tokens) {
  const have = new Set(tokens.map((t) => t.name));
  const missing = REQUIRED.filter((name) => !have.has(name));
  if (missing.length) {
    throw new Error(`계약이 요구하는 토큰이 없다: ${missing.join(', ')}`);
  }
}

export function toCss(theme, tokens) {
  const rows = tokens.map((t) => `  ${t.name}: ${t.value};${t.note ? `  /* ${t.note} */` : ''}`);
  return [
    '/* 이 파일은 만들어진 것이다. 손으로 고치지 마세요.',
    ` * 원본: themes/${theme}/DESIGN.md`,
    ` * 다시 만들기: node tools/design/index.js ${theme}`,
    ' */',
    ':root {',
    ...rows,
    '}',
    '',
  ].join('\n');
}

export function build(theme) {
  const source = join(themeDir(theme), 'DESIGN.md');
  if (!existsSync(source)) throw new Error(`테마에 DESIGN.md 가 없다: ${theme}`);

  const tokens = parseDesign(readFileSync(source, 'utf8'));
  assertContract(tokens);
  return { css: toCss(theme, tokens), tokens, out: join(themeDir(theme), 'tokens.css') };
}

/* ------------------------------------------------------------------ CLI */

if (import.meta.url === `file://${process.argv[1]}`) {
  const [theme, ...flags] = process.argv.slice(2);
  if (!theme) {
    console.error('쓰임: node tools/design/index.js <테마> [--check]');
    process.exit(2);
  }

  try {
    const { css, tokens, out } = build(theme);

    if (flags.includes('--check')) {
      const current = existsSync(out) ? readFileSync(out, 'utf8') : '';
      if (current !== css) {
        console.error(`tokens.css 가 DESIGN.md 와 어긋난다: ${out}`);
        console.error('다시 만들려면: node tools/design/index.js ' + theme);
        process.exit(1);
      }
      console.log(`${theme}: DESIGN.md 와 tokens.css 가 일치한다 (토큰 ${tokens.length}개)`);
    } else {
      writeFileSync(out, css, 'utf8');
      console.log(`${out} — 토큰 ${tokens.length}개`);
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
