/**
 * 레일의 장 조작 — 위·아래·복제·지우기.
 *
 * 지금까지 레일에서 순서를 바꾸는 길은 **끌기 하나**였다. 끌기를 모르는 사람에게는 순서를
 * 바꾸는 방법이 아예 안 보인다 — 참고한 Slate Point 가 레일 항목마다 조작 버튼을 띄우는
 * 이유가 그것이고, 우리 명세도 "드래그와 버튼 둘 다" 를 요소에 대해 이미 정해 두었다
 * (M3 결정 3). 장에도 같은 규칙을 적용한다.
 *
 * ## 넷 다 문서 스코프다
 *
 * 장이 하나라도 늘거나 줄거나 자리를 옮기면 `renumberPages` 가 자동으로 붙어 **모든 장의**
 * 꼬리 번호를 다시 쓴다. 델타로 따라갈 수 있는 범위가 아니므로 넷 다 다시 받는다
 * (`docs/m2-reconcile-policy.md` 의 예외 경로).
 */

export function createSlides({ commit, sections, onNotice, onResync }) {
  /** 장을 한 칸 위(-1)·아래(+1)로. */
  async function move(index, delta) {
    const list = sections();
    const to = index + delta;
    if (to < 0 || to >= list.length) return false;

    const section = list[index];
    if (!section?.nodeId) return void blocked();

    const { ok } = await commit.send(
      [{ op: 'moveSection', target: section.nodeId, args: { index: to } }],
      delta < 0 ? '장을 위로' : '장을 아래로',
    );
    if (!ok) return false;
    onNotice?.({ kind: 'saved', text: `${index + 1}장을 ${to + 1}번째로 옮겼습니다` });
    onResync?.(to);
    return true;
  }

  async function duplicate(index) {
    const section = sections()[index];
    if (!section?.nodeId) return void blocked();

    const { ok } = await commit.send([{ op: 'duplicateSection', target: section.nodeId }], '장 복제');
    if (!ok) return false;
    onNotice?.({ kind: 'saved', text: `${index + 1}장을 복제했습니다` });
    // 복제본은 바로 뒤에 온다. 그 자리로 옮겨 두면 무엇이 생겼는지 눈으로 확인된다.
    onResync?.(index + 1);
    return true;
  }

  /**
   * 지우기. **되묻지 않는다** — 자동 저장이라 확인창이 잦으면 성가시고 되돌리기가 바로
   * 옆에 있다 (M3 명세 "물어보지 않고 정한 것"). 대신 알림이 되돌리는 방법을 말한다.
   */
  async function remove(index) {
    const list = sections();
    const section = list[index];
    if (!section?.nodeId) return void blocked();
    if (list.length === 1) {
      onNotice?.({ kind: 'blocked', text: '마지막 한 장은 지울 수 없습니다' });
      return false;
    }

    const { ok } = await commit.send([{ op: 'removeSection', target: section.nodeId }], '장 지우기');
    if (!ok) return false;
    onNotice?.({ kind: 'saved', text: `${index + 1}장을 지웠습니다 — 되돌리기로 돌아옵니다` });
    onResync?.(Math.max(0, index - 1));
    return true;
  }

  function blocked() {
    onNotice?.({ kind: 'blocked', text: '이 장은 이름표가 없어 명령이 지목할 수 없습니다' });
    return false;
  }

  return { move, duplicate, remove };
}
