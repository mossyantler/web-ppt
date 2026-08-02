/**
 * 명령 보내기 — 화면이 파일을 바꾸는 **유일한 통로**. M3-5.
 *
 * 글자 편집도, 순서 바꾸기도, 추가·삭제도 전부 여기를 지난다. 봉투를 만드는 곳이
 * 둘 이상이 되면 멱등 키·낙관적 락·재동기화 판정이 갈래마다 조금씩 달라지고, 그 차이는
 * 실패할 때만 드러난다.
 *
 * 파일 이름이 `commit.js` 가 아닌 이유 — 서버에도 `server/commit.js` 가 있고, 둘 다
 * 커밋을 다루므로 이름이 같으면 읽는 사람이 어느 쪽 이야기인지 매번 되짚어야 한다.
 * (경로 봉쇄 테스트가 `/../commit.js` 를 탐침으로 쓰기도 한다.)
 *
 * 계약 — 성공하면 `{ ok: true, body }`, 실패하면 `{ ok: false, body }`.
 * **되돌리는 일은 부르는 쪽이 한다.** 무엇을 되돌려야 하는지는 여기서 알 수 없다.
 */

/** 서버 코드 → 사람 말. 없는 코드는 서버가 준 문장을 그대로 보인다. */
const REASONS = {
  'commit.stale-hash': '파일이 밖에서 바뀌었습니다. 화면을 다시 받습니다',
  'commit.rejected-content': '넣을 수 없는 내용이 있어 되돌렸습니다',
  'commit.not-a-container': '이 자리는 요소를 담을 수 없습니다',
  'commit.index-out-of-range': '그 자리로는 옮길 수 없습니다',
  'commit.cyclic-move': '자기 안으로는 옮길 수 없습니다',
};

export function createCommitter({ deckId, docHash, onNotice, onResync, onRings }) {
  /**
   * @param {Array} commands  명령 배열. 한 봉투는 원자 단위다 — 전부 되거나 전부 안 된다
   * @param {string} label    히스토리에 남길 이름 (되돌리기 목록에 보인다)
   */
  async function send(commands, label) {
    onNotice?.({ kind: 'saving', text: '저장 중…' });

    const envelope = {
      // 멱등 키. 같은 저장이 두 번 도착해도 파일은 한 번만 바뀐다 (§3.3).
      commitId: crypto.randomUUID(),
      // 낙관적 락. 화면이 본 그 파일이 아직 그대로인지 서버가 대조한다.
      pre: { docHash: docHash.get() },
      label,
      commands,
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
      onNotice?.({ kind: 'error', text: `저장하지 못했습니다: ${err.message}` });
      return { ok: false, body: null };
    }

    if (!res.ok) {
      console.error('명령 거부', envelope.commands, body);
      onNotice?.({ kind: 'error', text: REASONS[body?.code] ?? body?.error ?? '저장하지 못했습니다' });
      // 낡은 지문이면 화면 전체를 다시 받는 것 말고 방법이 없다 (재조정 정책의 예외 경로).
      if (body?.code === 'commit.stale-hash') onResync?.();
      return { ok: false, body };
    }

    // `superseded` 는 성공이 아니라 **재동기화 신호**다 — 미러가 근거로 삼은 상태가
    // 이미 지나갔으므로 델타를 적용해서는 안 된다 (docs/m2-reconcile-policy.md).
    if (body.superseded) {
      onNotice?.({ kind: 'error', text: '다른 변경과 겹쳤습니다. 화면을 다시 받습니다' });
      onResync?.();
      return { ok: false, body };
    }

    // 기본 경로 — 프리뷰를 다시 받지 않는다. 갈아 끼우는 것은 지문 하나뿐이다.
    docHash.set(body.currentHash);
    // 되돌릴 것이 하나 늘었다. 그 사실이 버튼에 바로 보여야 한다 (결정 5).
    onRings?.(body.rings);
    return { ok: true, body };
  }

  return { send };
}
