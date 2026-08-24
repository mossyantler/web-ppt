/**
 * 잠긴 슬라이드와 "고치기" — M3-9 (결정 9).
 *
 * 이름표(`data-el`·`data-box`·`data-node-id`)가 없는 장은 명령이 지목할 수 없어서
 * 어떤 편집도 받지 못한다. 그런 장에서 클릭이 조용히 아무 일도 안 하면 사용자는
 * 그것을 고장과 구별할 수 없다. 그래서 **막을 덮어 못 고친다고 먼저 말한다.**
 *
 * 잠그기만 하면 나갈 문이 없으므로 같은 자리에 "고치기" 를 둔다. 그 버튼은 문서를
 * 몰래 바꾸지 않는다 — 누르는 순간 커밋 하나가 나가고, 그 커밋은 되돌리기 링에
 * 들어간다. 마음에 안 들면 Ctrl+Z 로 그대로 돌아온다.
 *
 * **이름표를 붙이는 판정은 서버가 한다.** 여기서 클래스 이름을 보고 "이건 카드겠지"
 * 를 흉내내면 게이트가 재는 트리와 화면이 만드는 트리가 갈라진다 — `outline.js` 가
 * 어휘 판정을 브라우저로 복제하지 않는 것과 같은 이유다.
 */

import { setIcon } from './icons.js';

export function createAdopt({ lock, findings, commit, onNotice, onDone }) {
  let busy = false;

  /**
   * 잠금 막을 띄운다. `section` 은 목차가 준 그 장의 정보다.
   *
   * 이유(잠근 노드 수)를 함께 보인다. "편집할 수 없습니다" 만으로는 사용자가 무엇을
   * 마주한 것인지 알 수 없고, 고치기를 누를지 말지도 정할 수 없다.
   */
  function show(section, slideIndex) {
    const card = document.createElement('div');
    card.className = 'lock-card';

    const h = document.createElement('h2');
    h.textContent = `${slideIndex + 1}장은 아직 편집할 수 없습니다`;

    const p = document.createElement('p');
    p.textContent = '이 장에는 요소를 지목할 이름표가 없습니다. 고치기를 누르면 이름표를 붙입니다.';

    const why = document.createElement('p');
    why.className = 'why';
    why.textContent = section?.blockerCount
      ? `이름표가 필요한 자리 ${section.blockerCount}곳`
      : '';

    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = '고치기';
    button.addEventListener('click', () => run(button, slideIndex));

    const undoHint = document.createElement('p');
    undoHint.className = 'why';
    // 되돌릴 수 있다는 사실이 버튼을 누를 수 있게 만든다. 안 적으면 사용자는
    // "파일이 어떻게 바뀔지 모르겠다" 에서 멈춘다.
    undoHint.textContent = '마음에 안 들면 Ctrl+Z 로 되돌릴 수 있습니다.';

    card.append(h, p, ...(why.textContent ? [why] : []), button, undoHint);
    lock.replaceChildren(card);
    lock.hidden = false;

    // 막이 다시 떴다는 것은 이 장이 아직 안 고쳐졌다는 뜻이다 — 되돌리기를 눌렀거나,
    // 아직 안 고친 다른 장으로 넘어왔거나. 어느 쪽이든 "고친 뒤 남은 것" 목록은
    // 지금 화면과 맞지 않는다. 맞지 않는 목록은 없느니만 못하다.
    close();
  }

  function hide() {
    lock.hidden = true;
    lock.replaceChildren();
  }

  async function run(button, slideIndex) {
    if (busy) return;
    busy = true;
    button.disabled = true;
    button.textContent = '붙이는 중…';

    // 장 번호는 1-based 다 — 서버도 화면도 사용자가 보는 번호를 쓴다.
    const { ok, body } = await commit.send(
      [{ op: 'adoptSlide', args: { section: slideIndex + 1 } }],
      `${slideIndex + 1}장에 이름표 붙이기`,
    );

    busy = false;
    if (!ok) {
      button.disabled = false;
      button.textContent = '고치기';
      return;
    }

    // 아무것도 바뀌지 않았다면 붙일 이름표가 없었다는 뜻이다. 그 사실을 말해야
    // 사용자가 "버튼이 고장났나" 로 가지 않는다.
    if (!body.applied) {
      onNotice?.({ kind: 'blocked', text: '붙일 이름표가 없습니다 — 자동으로는 여기까지입니다' });
    } else {
      onNotice?.({ kind: 'saved', text: '이름표를 붙였습니다' });
    }

    // 남은 것을 먼저 그리고 화면을 다시 받는다. 순서가 반대면 다시 받는 사이에
    // 목록이 지워진다 — 사용자에게는 아무 설명 없이 화면만 깜빡인 것으로 보인다.
    report(body.diagnostics ?? []);
    onDone?.();
  }

  /**
   * 자동으로 판단이 안 된 자리들.
   *
   * **실패 목록이 아니라 할 일 목록이다.** 그래서 화면을 덮지 않고 구석에 뜨며,
   * 닫을 수 있다. 줄 번호를 주는 이유 — 여기서부터는 손편집이고, 손편집으로 나갈
   * 문은 줄 번호뿐이다.
   */
  function report(items) {
    if (!items.length) return void close();

    const head = document.createElement('div');
    head.className = 'find-head';

    const title = document.createElement('strong');
    title.textContent = '사람이 봐야 할 곳';

    const count = document.createElement('span');
    count.textContent = `${items.length}곳 · 소스를 직접 고쳐야 합니다`;

    const x = document.createElement('button');
    x.type = 'button';
    setIcon(x, 'close', '닫기');
    x.addEventListener('click', close);

    head.append(title, count, x);

    const list = document.createElement('ul');
    list.className = 'find-list';
    for (const f of items) {
      const li = document.createElement('li');

      const at = document.createElement('span');
      at.className = 'at';
      at.textContent = f.line ? `${f.line}번째 줄` : f.code;

      const subject = document.createElement('code');
      subject.className = 'subject';
      subject.textContent = f.subject ?? '';

      const remedy = document.createElement('span');
      remedy.className = 'remedy';
      remedy.textContent = f.remedy ?? '';

      li.append(at, ...(subject.textContent ? [subject] : []), remedy);
      list.append(li);
    }

    findings.replaceChildren(head, list);
    findings.hidden = false;
  }

  function close() {
    findings.hidden = true;
    findings.replaceChildren();
  }

  return { show, hide, close };
}
