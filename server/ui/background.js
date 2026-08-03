/**
 * 배경 고르기 — 이 장만, 또는 전부. 명세 결정 4·9.
 *
 * 배경은 장마다 정해진다(결정 4). 표지·구역 표지를 어둡게 하는 지금 관행이 그대로 살아야
 * 하기 때문이다. 그런데 장마다 고르게만 두면 "전부 어둡게" 가 열세 번 클릭이 된다.
 * 그래서 **전체 적용** 버튼을 하나 둔다 — 참고한 Slate Point 가 같은 구분(테마=전체 /
 * 배경=이 장)을 쓰면서 둔 탈출구이고, 우리에게도 같은 이유로 필요하다.
 *
 * ## 명령 하나로 끝난다
 *
 * `data-bg` 는 섹션의 속성이고 `setSectionProps` 는 `data-*` 를 이미 받는다. 그래서 배경을
 * 위해 새로 만든 명령이 없다 — 문법에 값을 더한 것이 전부다(§2.3.1).
 *
 * 전체 적용은 **한 봉투**다. 열세 장을 열세 커밋으로 보내면 되돌리기를 열세 번 눌러야 한다.
 */

/** 문법이 정한 닫힌 열거. 화면이 여기 없는 값을 보내면 게이트가 잡는다. */
const VALUES = ['light', 'dark'];

export function createBackground({ stage, commit, buttons, sections, currentSlide, onNotice }) {
  buttons.light.addEventListener('click', () => set('light', false));
  buttons.dark.addEventListener('click', () => set('dark', false));
  buttons.all.addEventListener('click', () => set(current() ?? 'light', true));

  /** 지금 장의 배경. 속성이 없으면 테마 기본이므로 밝은 쪽으로 읽는다. */
  function current() {
    const el = sectionElement(currentSlide());
    return el?.getAttribute('data-bg') ?? null;
  }

  function sectionElement(i) {
    return stage.contentDocument?.querySelectorAll('section')[i] ?? null;
  }

  /** 버튼이 지금 상태를 보이게 한다 — 어느 쪽인지 모르면 누를 수가 없다. */
  function refresh() {
    const now = current();
    buttons.light.setAttribute('aria-pressed', String(now !== 'dark'));
    buttons.dark.setAttribute('aria-pressed', String(now === 'dark'));

    // 이름표 없는 장은 명령이 지목할 수 없다. 버튼을 끄는 것이 이유를 말하는 첫 줄이다.
    const usable = !!sections()[currentSlide()]?.nodeId;
    for (const b of Object.values(buttons)) b.disabled = !usable;
  }

  async function set(value, everywhere) {
    if (!VALUES.includes(value)) return false;

    const targets = everywhere
      ? sections().filter((s) => s.nodeId)
      : [sections()[currentSlide()]].filter((s) => s?.nodeId);

    if (!targets.length) {
      onNotice?.({ kind: 'blocked', text: '이 장은 이름표가 없어 배경을 바꿀 수 없습니다' });
      return false;
    }

    const commands = targets.map((s) => ({
      op: 'setSectionProps',
      target: s.nodeId,
      args: { patch: { 'data-bg': value } },
    }));

    const { ok } = await commit.send(commands, everywhere ? '배경 전체 적용' : '배경 바꾸기');
    if (!ok) return false;

    // 서버가 한 것과 같게 화면도 바꾼다. 다시 받지 않으므로 이 줄이 미러다.
    for (const s of targets) sectionElement(s.index)?.setAttribute('data-bg', value);

    refresh();
    onNotice?.({
      kind: 'saved',
      text: everywhere ? `${targets.length}장을 ${label(value)}으로 바꿨습니다` : `${label(value)}으로 바꿨습니다`,
    });
    return true;
  }

  const label = (value) => (value === 'dark' ? '어두운 바탕' : '밝은 바탕');

  return { refresh, set };
}
