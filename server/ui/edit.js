/**
 * 글자 고치기 — 고른 리프를 또 누르면 커서가 들어간다 (M3 결정 2·4). M3-4.
 *
 * **저장하는 것은 리프 하나의 안쪽뿐이다.** 문서를 통째로 직렬화해 보내지 않는다(Z2).
 * 화면이 서버에 보내는 것은 `setContent` 명령 한 건이고, 서버는 그 리프의 내부 구간만
 * splice 한다. 그래서 손대지 않은 슬라이드·형제·주석은 바이트가 그대로다.
 *
 * ## 문단 안의 수식
 *
 * 이 문단들에는 인라인 수식이 들어 있다(실측 — W31 의 수식 53 개 중 18 개). 화면에
 * 보이는 것은 KaTeX 가 그린 결과이고 파일에 있는 것은 빈 `<span data-tex="...">` 하나다.
 * **보이는 것을 그대로 되돌려 보내면 파일에 렌더 결과가 박힌다.**
 *
 * 그래서 둘로 다룬다.
 *   - 편집 중  — 수식은 `contenteditable="false"` 덩어리다. 커서가 안으로 들어가지
 *                않고, 통째로 지우는 것은 된다 (지울 방법이 없으면 편집기가 아니다)
 *   - 보낼 때  — 그 자리를 **빈 자리표** `<span data-node-id="...">` 로 바꾼다.
 *                서버가 원문 바이트를 되돌려 놓는다 (`normalize-inline.js`)
 *
 * 수식 **자체**를 고치는 것은 이 파일의 일이 아니다 — 두 번 클릭하면 입력칸이 열리고
 * 아래에 실시간 미리보기가 뜨는 전용 편집기가 결정 8 이고 M3-8 이다.
 */

/** 저장 실패를 사용자에게 알릴 때 쓰는 최소한의 사람 말. 코드는 콘솔에 남긴다. */
const REASONS = {
  'commit.stale-hash': '파일이 밖에서 바뀌었습니다. 화면을 다시 받습니다',
  'commit.rejected-content': '넣을 수 없는 내용이 있어 되돌렸습니다',
};

export function createEditor({ stage, deckId, docHash, onStatus, onNotice, onResync, onReflow }) {
  /** { nodeId, el, payload, dom } — 편집 중인 리프 하나. 동시에 둘은 없다. */
  let current = null;

  function begin(nodeId, info, point) {
    const doc = stage.contentDocument;
    const el = doc.querySelector(`[data-node-id="${cssEscape(nodeId)}"]`);
    if (!el || current) return;

    // 불투명 리프(수식·진행바)는 보이는 것이 기계가 그린 결과다. 커서를 넣으면
    // 사용자가 그 결과를 고치게 되고, 그건 저장할 수 없는 편집이다 (§3.2 L2).
    if (info.edit !== 'setContent') {
      onNotice?.({ kind: 'blocked', text: '이 요소는 전용 편집기가 필요합니다 (수식·진행바는 M3-8)' });
      return;
    }

    current = { nodeId, el, payload: payloadOf(el), dom: el.innerHTML };

    for (const atom of atomsIn(el)) atom.setAttribute('contenteditable', 'false');
    el.setAttribute('contenteditable', 'true');
    el.addEventListener('keydown', onKey);
    el.addEventListener('paste', onPaste);
    // 글이 길어지면 상자가 커진다. 테두리가 따라가지 않으면 고칠수록 어긋난다.
    el.addEventListener('input', reflow);
    el.focus({ preventScroll: true });
    putCaret(doc, point);

    onStatus?.({ kind: 'editing', text: '고치는 중 — Enter 로 저장, Esc 로 나가기' });
  }

  /** 편집을 끝내고, 바뀐 게 있을 때만 저장한다 (결정 4 — 자동 저장). */
  async function end() {
    if (!current) return;
    const { nodeId, el, payload, dom } = current;
    current = null;

    el.removeEventListener('keydown', onKey);
    el.removeEventListener('paste', onPaste);
    el.removeEventListener('input', reflow);
    el.removeAttribute('contenteditable');
    for (const atom of atomsIn(el)) atom.removeAttribute('contenteditable');

    const html = payloadOf(el);
    try {
      // 커서만 들어갔다 나온 경우다. 빈 커밋은 undo 링만 먹는다 (§11 M2 100 회 기준).
      if (html !== payload) await save(nodeId, html, el, dom);
    } finally {
      // 저장이 어떻게 끝났든 "고치는 중" 표시는 지워야 한다. 남으면 커서가 없는데
      // 화면은 고치는 중이라고 말하고, 사용자는 자기가 어디 있는지 알 수 없다.
      onStatus?.({ kind: 'idle', text: '' });
    }
  }

  /* -------------------------------------------------------------- 저장 보내기 */

  async function save(nodeId, html, el, dom) {
    onNotice?.({ kind: 'saving', text: '저장 중…' });

    const envelope = {
      // 멱등 키. 같은 저장이 두 번 도착해도 파일은 한 번만 바뀐다 (§3.3).
      commitId: crypto.randomUUID(),
      // 낙관적 락. 화면이 본 그 파일이 아직 그대로인지 서버가 대조한다.
      pre: { docHash: docHash.get() },
      label: '글자 고치기',
      commands: [{ op: 'setContent', target: nodeId, args: { html } }],
    };

    let res;
    let body;
    try {
      res = await fetch(`/deck/${encodeURIComponent(deckId())}/commit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(envelope),
      });
      body = await res.json();
    } catch (err) {
      // 서버가 죽었거나 네트워크가 끊겼다. 화면을 되돌려 놓아야 사용자가 "저장된 줄"
      // 알고 창을 닫는 일이 없다.
      el.innerHTML = dom;
      onNotice?.({ kind: 'error', text: `저장하지 못했습니다: ${err.message}` });
      return;
    }

    if (!res.ok) {
      console.error('setContent 거부', body);
      // 되돌린다. 화면에 남겨 두면 파일에 없는 글이 보이고, 그게 가장 나쁜 상태다.
      el.innerHTML = dom;
      onNotice?.({ kind: 'error', text: REASONS[body?.code] ?? body?.error ?? '저장하지 못했습니다' });
      // 낡은 지문이면 화면 전체를 다시 받는 것 말고 방법이 없다 (재조정 정책의 예외 경로).
      if (body?.code === 'commit.stale-hash') onResync?.();
      return;
    }

    // `superseded` 는 성공이 아니라 **재동기화 신호**다 — 미러가 근거로 삼은 상태가
    // 이미 지나갔으므로 델타를 적용해서는 안 된다 (docs/m2-reconcile-policy.md).
    if (body.superseded) {
      onNotice?.({ kind: 'error', text: '다른 변경과 겹쳤습니다. 화면을 다시 받습니다' });
      onResync?.();
      return;
    }

    // 기본 경로 — 프리뷰를 다시 받지 않는다. 고친 글자는 이미 화면에 있고, 다시 받으면
    // 선택·스크롤·수식 렌더가 통째로 날아간다. 갈아 끼우는 것은 지문 하나뿐이다.
    docHash.set(body.currentHash);
    onNotice?.({ kind: 'saved', text: body.applied ? '저장됨' : '바뀐 내용이 없습니다' });
  }

  /* ---------------------------------------------------------------- 키·붙여넣기 */

  function onKey(e) {
    if (e.key !== 'Enter' || e.shiftKey) return;   // Shift+Enter 는 줄바꿈으로 둔다
    // Enter 로 문단이 쪼개지지 않게 한다 — 새 요소를 만드는 것은 구조 명령이고
    // 이번 범위가 아니다. Enter 는 "다 고쳤다" 로 읽는다 (사용자 결정).
    e.preventDefault();
    end();
  }

  /** 글 상자가 커지면 선택 테두리도 따라가야 한다. */
  function reflow() {
    onReflow?.();
  }

  /**
   * 붙여넣기는 평문으로 받는다.
   *
   * 서버 정화기는 워드·웹에서 온 마크업을 언랩해서 통과시키므로 거부되지는 않는다.
   * 그래도 평문으로 받는 이유 — 언랩된 결과는 사용자가 화면에서 본 것과 다르고,
   * 저장한 뒤에야 서식이 사라진 것을 알게 된다.
   */
  function onPaste(e) {
    e.preventDefault();
    const text = e.clipboardData?.getData('text/plain') ?? '';
    stage.contentDocument.execCommand('insertText', false, text);
  }

  /* -------------------------------------------------------------------- 도구 */

  /** 이 리프 안에 사는 이름표 붙은 노드들 — 인라인 수식이 대표다. */
  const atomsIn = (el) => el.querySelectorAll('[data-node-id]');

  /**
   * 서버로 보낼 형태. 편집 표시는 여기서 전부 떨어져 나간다.
   *
   * 이 함수가 이 파일의 계약이다 — **화면에서 자란 것 중 파일로 가는 것은 글자뿐**이다.
   */
  function payloadOf(el) {
    const clone = el.cloneNode(true);
    for (const atom of clone.querySelectorAll('[data-node-id]')) {
      const slot = clone.ownerDocument.createElement('span');
      slot.setAttribute('data-node-id', atom.getAttribute('data-node-id'));
      atom.replaceWith(slot);
    }
    // 자리표로 바뀌지 않은 곳에 남았을 수 있는 편집 표시. 새어 나가면 파일에 박힌다.
    for (const marked of clone.querySelectorAll('[contenteditable]')) marked.removeAttribute('contenteditable');
    return clone.innerHTML;
  }

  /** 누른 자리에 커서를 놓는다. 못 놓으면 브라우저 기본 위치에 둔다. */
  function putCaret(doc, point) {
    if (!point) return;
    const range = doc.caretRangeFromPoint?.(point.x, point.y);
    if (!range) return;
    const sel = doc.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  return {
    begin,
    end,
    /** 지금 편집 중인 요소 (없으면 null). 선택 계층이 클릭을 넘겨줄지 정하는 근거다. */
    active: () => current?.el ?? null,
  };
}

function cssEscape(value) {
  return globalThis.CSS?.escape ? CSS.escape(value) : value.replace(/["\\]/g, '\\$&');
}
