// node --test server/normalize-inline.test.js
//
// 계획 §11 M2 수용 기준 9·10:
//   9  — `<div>` 언랩 · `style` 제거 · bogus `<br>` 제거 · `&nbsp;` 런 축약 · `<script>` 거부
//   10 — `inlineClasses` 에 있는 클래스 보존 (F-5ⓒ)
//
// 순수 함수이므로 파일도 서버도 필요 없다 (§6.2 "마일스톤이 아니라 순수 함수다").

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadMapping } from '../tools/harness/mapping.js';
import { normalizeInline } from './normalize-inline.js';

const mapping = loadMapping();
const NBSP = ' ';

const norm = (html) => normalizeInline(html, mapping);
const out = (html) => {
  const r = norm(html);
  assert.ok(r.ok, `거부되었다: ${r.reason}`);
  return r.html;
};

/* ------------------------------------------------------------- 기준 9 (5규칙) */

test('규칙 — 허용 인라인 태그는 통과한다', () => {
  const src = '본문 <b>굵게</b> <i>기울임</i> <code>코드</code><sup>1</sup>';
  assert.equal(out(src), src);
});

test('규칙 — 허용목록 밖 요소는 언랩된다 (거부가 아니다)', () => {
  assert.equal(out('<div>본문</div>'), '본문');
  assert.equal(out('<p>가<b>나</b>다</p>'), '가<b>나</b>다');
  assert.equal(out('<font face="맑은고딕"><div>붙여넣기</div></font>'), '붙여넣기');
  assert.equal(out('<h1>제목처럼 붙여넣음</h1>'), '제목처럼 붙여넣음');
});

test('규칙 — style 속성은 제거된다 (디자인 토큰 우회 차단)', () => {
  assert.equal(out('<span style="color:#f00;font-size:32px">빨강</span>'), '<span>빨강</span>');
  assert.equal(out('<b style="font-weight:900">굵게</b>'), '<b>굵게</b>');
});

test('규칙 — 말미 bogus <br> 은 제거되고 중간 <br> 은 남는다', () => {
  assert.equal(out('첫줄<br>둘째줄<br>'), '첫줄<br>둘째줄');
  assert.equal(out('본문<br><br>'), '본문');
  assert.equal(out('첫줄<br>둘째줄'), '첫줄<br>둘째줄');
});

test('규칙 — &nbsp; 런은 공백 하나로 축약되고 단일 &nbsp; 는 보존된다', () => {
  assert.equal(out(`가${NBSP}${NBSP}${NBSP}나`), '가 나');
  assert.equal(out(`가${NBSP}나`), '가&nbsp;나');
  assert.equal(out(`가${NBSP}${NBSP}나${NBSP}다`), '가 나&nbsp;다');
});

test('규칙 — 스크립트는 거부한다 (언랩이 아니다)', () => {
  for (const src of [
    '<script>alert(1)</script>',
    '본문 <script src="x.js"></script> 뒤',
    '<div><script>alert(1)</script></div>',
    '<iframe src="//evil"></iframe>',
  ]) {
    const r = norm(src);
    assert.equal(r.ok, false, src);
    assert.match(r.reason, /스크립트성/);
  }
});

test('규칙 — 이벤트 핸들러와 javascript: href 는 거부한다', () => {
  assert.equal(norm('<b onclick="alert(1)">x</b>').ok, false);
  assert.equal(norm('<span onmouseover="x()">x</span>').ok, false);
  assert.equal(norm('<a href="javascript:alert(1)">링크</a>').ok, false);
});

/* --------------------------------------------------------- 기준 10 (F-5ⓒ) */

test('기준 10 — inlineClasses 에 있는 클래스는 보존된다', () => {
  // references.html:22 의 실제 패턴 — 저널명 서식이 조용히 사라지던 자리다.
  const src = '<span class="cite">Kim et al.</span> <span class="title">제목</span> <span class="src">저널</span>';
  assert.equal(out(src), src);
});

test('기준 10 — 허용목록 밖 클래스만 제거된다', () => {
  assert.equal(out('<span class="cite paste-junk">x</span>'), '<span class="cite">x</span>');
  assert.equal(out('<span class="MsoNormal">x</span>'), '<span>x</span>');
});

test('기준 10 — 허용목록이 mapping.json 에서 온다 (하드코딩 아님)', () => {
  for (const c of ['cite', 'title', 'src', 'mono', 'num', 'unit', 'lbl', 'delta']) {
    assert.ok(Object.values(mapping.json.inlineClasses).includes(c), `mapping.json 에 없다: ${c}`);
    assert.equal(out(`<span class="${c}">x</span>`), `<span class="${c}">x</span>`);
  }
});

/* ------------------------------------------------------------------ 그 밖 */

test('href 는 안전한 스킴만 남고 그 외 속성은 전부 제거된다', () => {
  assert.equal(out('<a href="https://a.b">링크</a>'), '<a href="https://a.b">링크</a>');
  assert.equal(out('<a href="mailto:a@b.c">메일</a>'), '<a href="mailto:a@b.c">메일</a>');
  assert.equal(out('<a href="../x.html">상대</a>'), '<a href="../x.html">상대</a>');
  assert.equal(out('<a href="ftp://x">에프티피</a>'), '<a>에프티피</a>');
  assert.equal(out('<b id="x" data-foo="y" title="z">굵게</b>'), '<b>굵게</b>');
});

test('쪼개진 텍스트 노드가 병합되고 특수문자가 이스케이프된다', () => {
  assert.equal(out('a<div></div>b'), 'ab');
  assert.equal(out('5 &lt; 7 &amp;&amp; 3 &gt; 1'), '5 &lt; 7 &amp;&amp; 3 &gt; 1');
  assert.equal(out('<div>가</div><div>나</div>'), '가나');
});

test('주석은 남지 않는다 — 편집 내용이 아니다', () => {
  assert.equal(out('본문<!-- 붙여넣기 잔여 -->뒤'), '본문뒤');
});

test('빈 입력과 공백만 있는 입력이 안전하다', () => {
  assert.equal(out(''), '');
  assert.equal(out('<br>'), '');
  assert.equal(out('<div><br></div>'), '');
});

test('워드 붙여넣기 형태가 거부되지 않고 통과한다 (§6.2 마지막 문단)', () => {
  const word = '<div style="mso-x:1"><span class="MsoNormal" style="font-family:Calibri">'
    + `실험${NBSP}${NBSP}결과는 <b style="mso-bidi:1">유의</b>했다.</span><br></div>`;
  const r = norm(word);
  assert.equal(r.ok, true, '붙여넣기를 거부하면 사용자는 편집기를 쓰지 않는다');
  // `<span>` 은 허용 태그이므로 태그 자체는 남고 `MsoNormal` 과 `style` 만 벗겨진다.
  // 클래스 없는 `<span>` 을 마저 언랩하는 것은 §6.3 닫힌 목록에 없는 변환이므로 하지 않는다.
  assert.equal(r.html, '<span>실험 결과는 <b>유의</b>했다.</span>');
});
