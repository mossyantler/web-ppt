// node --test tools/design/design.test.js
//
// `DESIGN.md` → `tokens.css` (결정 7). 여기서 재는 것 셋이다.
//   ① 계약서에서 나온 값이 **지금 쓰는 토큰과 같은가** — 옮겨 적다가 틀리면 색이 조용히 달라진다
//   ② 계약이 요구하는 이름이 빠지면 잡히는가
//   ③ 파생물이 원본과 어긋나면 잡히는가 (`--check`)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseDesign, assertContract, toCss, build, REQUIRED } from './index.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const declarations = (css) => Object.fromEntries(
  [...css.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)].map((m) => [m[1], m[2].trim().replace(/\s+/g, ' ')]),
);

test('계약서에서 나온 값이 지금 쓰는 토큰과 한 글자도 다르지 않다', () => {
  const repo = ['colors', 'typography', 'spacing', 'effects'].reduce(
    (all, name) => ({ ...all, ...declarations(readFileSync(join(REPO, 'tokens', `${name}.css`), 'utf8')) }),
    {},
  );
  const made = declarations(build('snu').css);

  // 계약서가 저장소 토큰을 **전부** 옮겼는가. 빠진 이름이 있으면 그 값은 테마를 갈 때 남는다.
  const missing = Object.keys(repo).filter((name) => made[name] === undefined);
  assert.deepEqual(missing, [], `계약서에 안 옮긴 토큰: ${missing.join(', ')}`);

  // 옮긴 값이 같은가. 이것이 이 테스트의 본론이다 — 실제로 열두 개를 틀리게 적었다가 잡혔다.
  const wrong = Object.entries(made)
    .filter(([name, value]) => repo[name] !== undefined && repo[name] !== value)
    .map(([name, value]) => `${name}: 계약서 "${value}" ≠ 토큰 "${repo[name]}"`);
  assert.deepEqual(wrong, [], wrong.join('\n'));
});

test('파생물이 원본과 어긋나면 알아챈다', () => {
  const { css, out } = build('snu');
  assert.equal(readFileSync(out, 'utf8'), css,
    'themes/snu/tokens.css 가 DESIGN.md 와 다르다 — node tools/design/index.js snu 로 다시 만드세요');
});

test('계약이 요구하는 이름이 빠지면 이름으로 알려준다', () => {
  const tokens = parseDesign('| `--accent` | `#000` | |');
  assert.throws(() => assertContract(tokens), (err) => {
    assert.match(err.message, /--font-sans/);
    assert.match(err.message, /--text-body/);
    return true;
  });
});

test('표의 구분선과 백틱에 걸리지 않는다', () => {
  const tokens = parseDesign([
    '| 토큰 | 값 | 설명 |',
    '|---|---|---|',
    '| `--accent` | `#003876` | 강조 |',
    '| 설명만 있는 줄 | 값 | |',
  ].join('\n'));

  assert.deepEqual(tokens, [{ name: '--accent', value: '#003876', note: '강조' }]);
});

test('같은 토큰을 두 번 적으면 거부한다 — 어느 쪽이 이기는지가 순서에 달린다', () => {
  assert.throws(
    () => parseDesign('| `--accent` | `#111` | |\n| `--accent` | `#222` | |'),
    /두 번/,
  );
});

test('만들어진 파일은 손으로 고치지 말라고 스스로 밝힌다', () => {
  const css = toCss('snu', [{ name: '--accent', value: '#003876', note: '' }]);
  assert.match(css, /만들어진 것이다/);
  assert.match(css, /themes\/snu\/DESIGN\.md/);
});

test('계약 목록은 실제로 읽히는 이름만 담는다', () => {
  // 토큰을 읽는 곳은 CSS 만이 아니다 — 슬라이드 HTML 과 덱 껍데기의 `<style>` 도 읽는다.
  const sources = [
    join(REPO, 'slides', 'slides.css'),
    join(REPO, 'themes', 'snu', 'theme.css'),
    join(REPO, 'themes', 'snu', 'deck.html'),
    ...['colors', 'typography', 'spacing', 'effects'].map((n) => join(REPO, 'tokens', `${n}.css`)),
    ...readdirSync(join(REPO, 'slides')).filter((f) => f.endsWith('.html')).map((f) => join(REPO, 'slides', f)),
  ].map((path) => readFileSync(path, 'utf8')).join('\n');

  for (const name of REQUIRED) {
    assert.ok(sources.includes(`var(${name})`),
      `${name} 은 아무도 읽지 않는다 — 계약에 넣으면 새 테마가 쓸데없는 이름을 쓰게 된다`);
  }
});
