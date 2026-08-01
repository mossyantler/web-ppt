/**
 * 출력 — diff와 **사람 판단 목록**.
 *
 * grammar.md §5.2는 모든 게이트 실패가 다섯 필드(`rule`·`code`·`location`·`subject`·`remedy`)를
 * 갖출 것을 요구하고, **무정보 메시지를 명세 위반으로 규정한다.** 이 도구의 보고도 같은
 * 계약을 진다: 정확한 소스 라인, 원문 여는 태그, 그리고 비어 있지 않은 `remedy`.
 */

/** 행 단위 LCS diff (unified 형식, 컨텍스트 n행) */
export function unifiedDiff(before, after, { context = 2, pathA = 'a', pathB = 'b' } = {}) {
  const A = before.split('\n');
  const B = after.split('\n');
  const ops = diffLines(A, B);
  if (!ops.some((o) => o.type !== 'eq')) return '';

  const hunks = [];
  let cur = null;
  let ai = 0;
  let bi = 0;
  let pending = [];
  for (const op of ops) {
    if (op.type === 'eq') {
      if (cur) {
        cur.lines.push({ type: 'eq', text: op.text });
        cur.trail = (cur.trail || 0) + 1;
        if (cur.trail > context * 2) {
          cur.lines.length -= cur.trail - context;
          hunks.push(cur);
          cur = null;
          pending = [];
        }
      }
      if (!cur) {
        pending.push({ text: op.text, a: ai, b: bi });
        if (pending.length > context) pending.shift();
      }
      ai += 1; bi += 1;
    } else {
      if (!cur) {
        cur = { aStart: pending.length ? pending[0].a : ai, bStart: pending.length ? pending[0].b : bi, lines: [] };
        for (const p of pending) cur.lines.push({ type: 'eq', text: p.text });
        pending = [];
      }
      cur.trail = 0;
      cur.lines.push(op);
      if (op.type === 'del') ai += 1; else bi += 1;
    }
  }
  if (cur) {
    if (cur.trail > context) cur.lines.length -= cur.trail - context;
    hunks.push(cur);
  }

  const out = [`--- ${pathA}`, `+++ ${pathB}`];
  for (const h of hunks) {
    const aCount = h.lines.filter((l) => l.type !== 'add').length;
    const bCount = h.lines.filter((l) => l.type !== 'del').length;
    out.push(`@@ -${h.aStart + 1},${aCount} +${h.bStart + 1},${bCount} @@`);
    for (const l of h.lines) {
      out.push((l.type === 'eq' ? ' ' : l.type === 'del' ? '-' : '+') + l.text);
    }
  }
  return `${out.join('\n')}\n`;
}

function diffLines(A, B) {
  // 앞뒤 공통 구간을 먼저 잘라내면 LCS 표가 실측 규모(1,211행)에서도 작아진다
  let head = 0;
  while (head < A.length && head < B.length && A[head] === B[head]) head += 1;
  let tail = 0;
  while (tail < A.length - head && tail < B.length - head
    && A[A.length - 1 - tail] === B[B.length - 1 - tail]) tail += 1;

  const a = A.slice(head, A.length - tail);
  const b = B.slice(head, B.length - tail);

  const n = a.length;
  const m = b.length;
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const ops = A.slice(0, head).map((text) => ({ type: 'eq', text }));
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push({ type: 'eq', text: a[i] }); i += 1; j += 1; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) { ops.push({ type: 'del', text: a[i] }); i += 1; }
    else { ops.push({ type: 'add', text: b[j] }); j += 1; }
  }
  while (i < n) { ops.push({ type: 'del', text: a[i] }); i += 1; }
  while (j < m) { ops.push({ type: 'add', text: b[j] }); j += 1; }
  for (const text of A.slice(A.length - tail)) ops.push({ type: 'eq', text });
  return ops;
}

const SEVERITY_ORDER = { error: 0, warn: 1, info: 2 };

/** 사람 판단이 필요한 항목 목록 — §5.2의 다섯 필드를 그대로 낸다 */
export function renderFindings(findings, { file, showInfo = false } = {}) {
  const shown = findings
    .filter((f) => showInfo || f.severity !== 'info')
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
      || a.location.line - b.location.line);

  if (shown.length === 0) return '사람 판단이 필요한 항목 없음.\n';

  const needHuman = shown.filter((f) => f.needsHuman).length;
  const lines = [
    `사람 판단이 필요한 항목 ${needHuman}건 (보고 총 ${shown.length}건)`,
    '',
  ];
  for (const f of shown) {
    lines.push(`[${f.severity}] ${f.code}  (규칙 ${f.rule})`);
    lines.push(`  위치   ${file}:${f.location.line}:${f.location.col}  bytes [${f.location.start}, ${f.location.end})`);
    lines.push(`  대상   ${f.subject}`);
    if (f.candidates?.length) lines.push(`  후보   ${f.candidates.join(' | ')}`);
    lines.push(`  조치   ${f.remedy}`);
    lines.push('');
  }
  return `${lines.join('\n')}`;
}

/** 부여 내역 요약 */
export function renderAnnotations(annotations) {
  const counts = new Map();
  for (const a of annotations) {
    const key = `${a.kind === 'box' ? 'data-box' : a.kind === 'section' ? 'section' : 'data-el'}="${a.value}"${a.variant ? ` (${a.variant})` : ''}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const lines = [`부여 ${annotations.length}건`, ''];
  for (const [key, n] of rows) lines.push(`  ${String(n).padStart(4)}  ${key}`);
  return `${lines.join('\n')}\n`;
}
