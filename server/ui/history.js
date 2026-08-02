/**
 * 되돌리기·다시하기 — Ctrl+Z 와 화면 버튼 둘 다 (결정 5). M3-6.
 *
 * **역연산을 만들지 않는다.** 서버가 커밋 직전 파일 바이트를 통째로 기록해 두었다가
 * 그대로 되쓴다 (§3.4). 화면이 할 일은 셋뿐이다 — 부르고, 다시 받고, 남은 횟수를 보이기.
 *
 * ## 왜 되돌린 뒤에는 화면을 통째로 다시 받는가
 *
 * 되돌리기는 파일 **전체**를 다른 바이트로 갈아 끼운다. 무엇이 어떻게 달라졌는지
 * 화면은 알지 못한다 — 명령을 근거로 미러를 고치는 델타 경로가 성립하려면 "내가 무엇을
 * 보냈는지" 를 알아야 하는데, 되돌리기의 내용은 그 시점 스냅샷이 정한다.
 * 그래서 문서 스코프 변경으로 다루고 다시 받는다 (`docs/m2-reconcile-policy.md`).
 *
 * ## 남은 횟수
 *
 * 서버가 커밋 응답과 목차에 두 링의 깊이를 함께 준다. 화면이 스스로 세지 않는 이유 —
 * 링은 파일 옆(`.history/`)에 남아 세션보다 오래 살고, 다른 편집기·AI 도 같은 링을 쓴다.
 * 화면이 센 숫자는 그 순간부터 거짓이 된다.
 */

export function createHistory({ deckId, buttons, onNotice, onResync }) {
  let rings = { undo: 0, redo: 0 };
  let busy = false;

  buttons.undo.addEventListener('click', () => run('undo'));
  buttons.redo.addEventListener('click', () => run('redo'));

  /** 서버가 알려준 잔량을 반영한다. 버튼의 켜짐·꺼짐이 곧 "여기가 끝" 이라는 표시다. */
  function update(next) {
    if (!next) return;
    rings = next;
    buttons.undo.disabled = !rings.undo;
    buttons.redo.disabled = !rings.redo;
  }

  async function run(which) {
    // 되돌리기를 연타하면 요청이 겹치고, 겹치면 두 번째가 첫 번째의 결과 위에서 돈다.
    // 링은 서버가 지키지만 화면이 보는 순서는 뒤집힐 수 있다.
    if (busy) return;
    if (which === 'undo' ? !rings.undo : !rings.redo) return;
    busy = true;

    try {
      const res = await fetch(`/deck/${encodeURIComponent(deckId())}/${which}`, { method: 'POST' });
      const body = await res.json().catch(() => null);

      if (!res.ok) {
        onNotice?.({
          kind: 'error',
          text: body?.code?.endsWith('-empty')
            ? (which === 'undo' ? '더 되돌릴 것이 없습니다' : '다시 할 것이 없습니다')
            : (body?.error ?? '되돌리지 못했습니다'),
        });
        // 개수가 틀렸다는 뜻이다. 다시 받아서 맞춘다.
        onResync?.();
        return;
      }

      update(body.rings);
      onNotice?.({ kind: 'saved', text: which === 'undo' ? '되돌렸습니다' : '다시 했습니다' });
      onResync?.();
    } finally {
      busy = false;
    }
  }

  /**
   * 단축키. 편집 중인 글 안에서는 **브라우저에게 맡긴다** — 타이핑 중의 Ctrl+Z 는
   * 글자 단위 되돌리기여야 하고, 그것을 파일 단위 되돌리기로 가로채면 방금 친 한 줄이
   * 통째로 사라진다.
   */
  function onKey(e, isEditing) {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod || e.key.toLowerCase() !== 'z') return false;
    if (isEditing) return false;

    e.preventDefault();
    run(e.shiftKey ? 'redo' : 'undo');
    return true;
  }

  return { update, onKey, run };
}
