/**
 * 로고 넣기 — 결정 5. 명세 `docs/specs/새-리포트-만들기.md`.
 *
 * **자리를 미리 비워 두지 않는다.** 로고를 넣으면 각 장 머리의 **맨 앞**에 끼어들고
 * 랩 이름이 오른쪽으로 밀린다. 미는 일은 CSS 가 아니라 문서 순서가 한다 — 머리 영역이
 * 이미 가로 배치(`display:flex`)이므로 첫 자식으로 들어가면 그대로 밀린다.
 *
 * ## 한 번에 전부, 커밋 하나로
 *
 * 머리는 장마다 하나씩 있다. 장이 열세 개면 열세 번 넣어야 하는데, 그것을 열세 개의
 * 커밋으로 보내면 되돌리기를 열세 번 눌러야 원래대로 돌아온다. 한 봉투에 담으면
 * **전부 되거나 전부 안 되고, 되돌리기도 한 번**이다 (§3.1 커밋은 원자 단위).
 *
 * ## 두 단계인 이유
 *
 * 그림 파일을 덱 폴더에 넣는 일(`POST /deck/:id/asset`)은 문서를 바꾸지 않으므로 명령이
 * 아니다. 그 파일을 **가리키는** 일(`insertElement` + `setProps`)만 명령이고, 그래서
 * 되돌리기는 "로고가 문서에서 빠지는 것" 까지다. 파일은 폴더에 남지만 아무 데서도
 * 가리키지 않으므로 화면에 나타나지 않는다.
 */

export function createLogo({ stage, commit, deckId, onNotice, onResync }) {
  /**
   * @param {File} file  사용자가 고른 그림
   * @returns 넣었으면 true
   */
  async function apply(file) {
    const heads = headRegions();
    if (!heads.length) {
      onNotice?.({ kind: 'blocked', text: '머리 영역이 있는 장이 없습니다 — 표지만 있는 리포트입니다' });
      return false;
    }

    const src = await upload(file);
    if (!src) return false;

    // 장마다 한 명령. **넣으면서 무엇을 가리킬지까지 정한다** — 나누면 같은 봉투 안에서
    // 방금 만든 노드를 지목할 수 없고(새 노드는 재직렬화 뒤에야 트리에 나타난다),
    // 두 커밋으로 나누면 되돌리기가 두 번 걸린다.
    const commands = heads.map((head) => ({
      op: 'insertElement',
      args: { parentId: head, index: 0, type: 'image', variant: 'logo', props: { src, alt: '로고' } },
    }));

    const { ok } = await commit.send(commands, '로고 넣기');
    if (!ok) return false;

    onNotice?.({ kind: 'saved', text: `${heads.length}장에 로고를 넣었습니다 — 되돌리기로 한 번에 빠집니다` });
    onResync?.();
    return true;
  }

  /** 지금 문서의 머리 영역들. 목차가 아니라 DOM 에서 찾는다 — 순번이 아니라 id 만 쓴다. */
  function headRegions() {
    const doc = stage.contentDocument;
    return [...(doc?.querySelectorAll('[data-region="head"][data-node-id]') ?? [])]
      .map((el) => el.dataset.nodeId);
  }

  async function upload(file) {
    try {
      const res = await fetch(
        `/deck/${encodeURIComponent(deckId())}/asset?name=${encodeURIComponent(file.name)}`,
        { method: 'POST', body: file },
      );
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        onNotice?.({ kind: 'error', text: body?.error ?? '그림을 넣지 못했습니다' });
        return null;
      }
      return body.src;
    } catch (err) {
      onNotice?.({ kind: 'error', text: `그림을 보내지 못했습니다: ${err.message}` });
      return null;
    }
  }

  return { apply };
}
