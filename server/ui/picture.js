/**
 * 그림 넣기 — 3단계. 끌어다 놓기 · 붙여넣기 · 바꾸기.
 *
 * **만드는 것이 거의 없다.** 필요한 조각은 로고 작업(`logo.js`)이 이미 다 뚫어 놓았다 —
 * 파일을 덱 폴더에 넣는 길(`POST /deck/:id/asset`), 그림을 가리키는 명령(`setProps` 의
 * `src`·`alt`, 문법 §3.5 L5.1), 넣으면서 속성까지 정하는 길(`insertElement` 의 `props`).
 * 그래서 이 파일이 하는 일은 **파일을 어디서 받아 어느 자리에 넣을지**뿐이다.
 *
 * ## 두 단계인데 되돌리기는 한 번이다
 *
 * 파일을 폴더에 넣는 일은 문서를 바꾸지 않으므로 명령이 아니다. 그것을 **가리키는** 일만
 * 명령이고, 넣기와 가리키기를 한 명령에 담으므로 되돌리기 한 번이면 그림이 문서에서
 * 빠진다. 파일은 폴더에 남지만 아무 데서도 가리키지 않으니 화면에 나타나지 않는다.
 *
 * ## 받는 길이 셋인 이유
 *
 * 하나로는 부족하다. 화면에 있는 그림은 **붙여넣기**(캡처·다른 문서에서 복사)가 빠르고,
 * 파일로 가진 그림은 **끌어다 놓기**가 빠르다. 그리고 이미 넣은 그림을 **바꾸는** 것은
 * 지우고 다시 넣기와 다르다 — 자리와 순서를 지켜야 한다.
 */

/** 서버가 받는 형식(`upload.js` 의 ALLOWED)과 같아야 한다. 다르면 올린 뒤에 거절당한다. */
const ACCEPT = ['image/png', 'image/jpeg', 'image/webp'];

/** `upload.js` 의 MAX_ASSET_BYTES 와 같은 값. 여기서 먼저 걸러 헛걸음을 줄인다. */
const MAX_BYTES = 2 * 1024 * 1024;

export function createPicture({ stage, commit, deckId, structure, index, onNotice, onInserted, onResync }) {
  /* ------------------------------------------------------------ 파일 받기 */

  /**
   * 그림 파일 하나를 덱 폴더로 올린다. 문서는 건드리지 않는다.
   * @returns {Promise<string|null>} 문서에 그대로 쓰는 상대 경로 (`asset/…`)
   */
  async function upload(file) {
    if (!ACCEPT.includes(file.type)) {
      onNotice?.({ kind: 'blocked', text: `PNG · JPG · WEBP 만 넣을 수 있습니다 (받은 것: ${file.type || '알 수 없음'})` });
      return null;
    }
    if (file.size > MAX_BYTES) {
      const mb = (file.size / 1024 / 1024).toFixed(1);
      onNotice?.({ kind: 'blocked', text: `그림이 너무 큽니다 — ${mb}MB (최대 2MB)` });
      return null;
    }

    try {
      const res = await fetch(
        `/deck/${encodeURIComponent(deckId())}/asset?name=${encodeURIComponent(nameOf(file))}`,
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

  /**
   * 붙여넣은 그림에는 이름이 없다(`image.png` 로 온다). 그대로 쓰면 두 번째 붙여넣기가
   * 첫 번째를 덮어쓰므로, 앞 그림이 소리 없이 바뀐다. 시각을 붙여 서로 다른 이름을 준다.
   */
  function nameOf(file) {
    if (file.name && file.name !== 'image.png') return file.name;
    const ext = file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/webp' ? 'webp' : 'png';
    return `paste-${Date.now().toString(36)}.${ext}`;
  }

  /* -------------------------------------------------------------- 넣기 */

  /**
   * 고른 요소 **바로 아래**에 그림을 넣는다.
   *
   * 자리를 못 잡으면 넣지 않는다. 슬라이드 아무 데나 떨어뜨렸을 때 "어딘가에" 들어가는
   * 것보다, 어디에 들어갈지 정해지지 않았다고 말하는 편이 낫다 — 흐름 배치에서 그림은
   * 순서에 끼는 것이지 좌표에 놓이는 것이 아니다(M3 결정 3).
   */
  async function insert(file, anchorNodeId) {
    if (!anchorNodeId) {
      onNotice?.({ kind: 'blocked', text: '먼저 그림을 넣을 자리를 눌러 고르세요' });
      return false;
    }
    if (!structure.canInsert(anchorNodeId)) {
      onNotice?.({ kind: 'blocked', text: '이 자리에는 넣을 수 없습니다 — 다른 요소를 골라 보세요' });
      return false;
    }

    const src = await upload(file);
    if (!src) return false;

    // 대체 텍스트는 파일 이름으로 둔다. 빈 `alt` 는 "장식이라 읽지 않아도 된다" 는 뜻이라
    // 내용 그림에는 틀린 말이고, 사용자가 나중에 고칠 실마리도 남지 않는다.
    const ok = await structure.insert(anchorNodeId, 'image', 'default', { src, alt: baseName(file) });
    if (ok) warnIfOverflowing(anchorNodeId);
    return ok;
  }

  /**
   * 그림을 넣어 슬라이드가 넘쳤는지 보고 말해 준다.
   *
   * 슬라이드는 720px 고정이고 `.slide` 가 `overflow: hidden` 이다. 넘친 부분은 잘려서
   * **소리 없이 사라진다** — 사용자에게는 "넣었더니 아래 내용이 없어졌다" 로 보이고,
   * 사진은 크기가 커서 이 일이 흔하다. 막지는 않는다(무엇을 줄일지는 사용자가 정한다).
   * 넘침을 일반적으로 다루는 것은 4번 단계의 몫이고, 여기서는 **그림을 넣은 직후**만 본다.
   *
   * 다시 받은 화면에서 재야 하므로 한 박자 뒤에 본다 — `structure.insert` 가 부른
   * `onInserted` 가 슬라이드를 다시 받아 오고, 그 전에는 옛 화면의 높이가 잡힌다.
   */
  function warnIfOverflowing(anchorNodeId) {
    setTimeout(() => {
      const doc = stage.contentDocument;
      const el = doc?.querySelector(`[data-node-id="${cssEscape(anchorNodeId)}"]`);
      const slide = el?.closest('section');
      if (!slide) return;
      const over = slide.scrollHeight - slide.clientHeight;
      if (over > 4) {
        onNotice?.({
          kind: 'blocked',
          text: `그림을 넣었지만 슬라이드가 ${Math.round(over)}px 넘칩니다 — 아래 내용이 잘립니다`,
        });
      }
    }, 900);
  }

  /** 이미 있는 그림이 가리키는 곳을 바꾼다. 자리와 순서는 그대로 둔다. */
  async function replace(nodeId, file) {
    const src = await upload(file);
    if (!src) return false;

    const { ok } = await commit.send(
      [{ op: 'setProps', target: nodeId, args: { props: { src, alt: baseName(file) } } }],
      '그림 바꾸기',
    );
    if (!ok) return false;

    onNotice?.({ kind: 'saved', text: '그림을 바꿨습니다' });
    onResync?.();
    return true;
  }

  const baseName = (file) => (file.name || '그림').replace(/\.[^.]+$/, '');

  /* ---------------------------------------------------------- 받는 길 셋 */

  /**
   * 끌어다 놓기. iframe **안**에 건다 — 슬라이드 위에 떨어뜨리는 것이 자연스럽고,
   * 그 자리 아래 어느 요소가 있는지도 안에서만 알 수 있다.
   *
   * `dragover` 에서 `preventDefault` 를 하지 않으면 브라우저가 파일을 **그 창에서 열어**
   * 슬라이드가 사진으로 바뀐다. 되돌릴 수 없는 종류의 사고라 두 이벤트를 함께 막는다.
   */
  function bind(doc) {
    doc.addEventListener('dragover', (e) => {
      if (!hasImage(e.dataTransfer)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      mark(doc, e.target);
    }, true);

    doc.addEventListener('dragleave', () => unmark(doc), true);

    doc.addEventListener('drop', async (e) => {
      if (!hasImage(e.dataTransfer)) return;
      e.preventDefault();
      unmark(doc);

      const file = [...e.dataTransfer.files].find((f) => f.type.startsWith('image/'));
      if (!file) return;
      // 떨어뜨린 자리 아래의 요소가 기준점이다 — 그 **아래**에 들어간다.
      await insert(file, nodeIdAt(e.target));
    }, true);
  }

  /**
   * 붙여넣기. 이쪽은 부모 문서에 건다 — 초점이 레일이나 도구 모음에 있어도 Ctrl+V 는
   * 같은 뜻이어야 하고, iframe 에만 걸면 슬라이드를 한 번 누른 뒤에야 듣는다.
   *
   * 글자를 고치는 중에는 넘긴다. 그때 Ctrl+V 는 "이 자리에 글자를 넣어라" 이지
   * "그림을 넣어라" 가 아니다.
   */
  async function paste(e, { selectedId, editing }) {
    if (editing) return false;
    const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
    if (!file) return false;

    e.preventDefault();
    return insert(file, selectedId);
  }

  /* ------------------------------------------------------------ 도우미 */

  const hasImage = (dt) => [...(dt?.items ?? [])].some((i) => i.kind === 'file' && i.type.startsWith('image/'));

  /** 누른 자리에서 위로 올라가며 이름표가 붙은 첫 요소를 찾는다. */
  function nodeIdAt(target) {
    for (let el = target; el && el.nodeType === 1; el = el.parentElement) {
      const id = el.dataset?.nodeId;
      if (id && index.get(id)) return id;
    }
    return null;
  }

  /**
   * 떨어뜨릴 자리를 미리 보인다. 흐름 배치에서는 "어디에 놓든 거기" 가 아니라
   * "몇 번째에 끼우기" 이므로, 기준이 되는 요소가 보이지 않으면 결과를 예측할 수 없다.
   *
   * 표시는 슬라이드 DOM 을 건드리지 않고 `outline` 으로만 한다 — 자리를 차지하지 않아
   * 조판이 밀리지 않고, 저장되는 것은 문서이지 이 스타일이 아니다.
   */
  let marked = null;
  function mark(doc, target) {
    const id = nodeIdAt(target);
    const el = id ? doc.querySelector(`[data-node-id="${cssEscape(id)}"]`) : null;
    if (el === marked) return;
    unmark(doc);
    if (!el) return;
    marked = el;
    el.style.outline = '2px solid #3b82f6';
    el.style.outlineOffset = '2px';
  }

  function unmark() {
    if (!marked) return;
    marked.style.removeProperty('outline');
    marked.style.removeProperty('outline-offset');
    marked = null;
  }

  /**
   * 그림을 두 번 누르면 파일 고르개가 열린다 (M3 결정 2 — 또 누르는 것은 "고치겠다" 이다).
   *
   * 수식·진행바처럼 옆에 편집 상자를 띄우지 않는 이유 — 그 둘은 **고칠 값이 화면에**
   * 있지만(수식 문자열, 0~100 숫자) 그림이 고칠 것은 파일 자체다. 상자를 띄워 봐야 그 안에
   * 파일 고르기 버튼 하나가 들어갈 뿐이고, 그러면 누르는 횟수만 한 번 늘어난다.
   *
   * 고르개는 쓸 때마다 새로 만들고 버린다. 하나를 두고 재사용하면 같은 파일을 다시 고를 때
   * `change` 가 나지 않아 아무 일도 일어나지 않는다.
   */
  function pick(nodeId) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = ACCEPT.join(',');
    input.hidden = true;
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      input.remove();
      if (file) await replace(nodeId, file);
    }, { once: true });
    document.body.append(input);
    input.click();
    return true;
  }

  return { bind, paste, insert, replace, pick, upload };
}

function cssEscape(value) {
  return globalThis.CSS?.escape ? CSS.escape(value) : value.replace(/["\\]/g, '\\$&');
}
