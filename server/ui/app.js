/**
 * 편집기 진입 — M3-1 은 덱 목록까지만 그린다. 레일·캔버스·편집은 M3-2 이후다.
 *
 * **화면은 서버가 준 것을 그릴 뿐이고, 고치는 일은 전부 명령으로 나간다** (계획 Z2).
 * 이 파일에서 슬라이드 HTML 을 직접 조립하는 코드가 생기면 그건 설계 위반이다.
 */

const list = document.getElementById('deck-list');

async function main() {
  const res = await fetch('/decks');
  const { decks } = await res.json();
  list.removeAttribute('aria-busy');

  if (!decks.length) {
    list.innerHTML = '<li class="locked"><span class="label">리포트가 없습니다</span></li>';
    return;
  }

  list.replaceChildren(...decks.map(deckRow));
}

function deckRow(deck) {
  const li = document.createElement('li');
  if (!deck.annotated) li.className = 'locked';

  // 날짜(폴더 이름)를 앞세운다. 리포트 제목은 덱마다 "Weekly Report" 로 같아서
  // 그것만으로는 어느 주차인지 가려지지 않는다 — 실측으로 확인한 것이다.
  const id = document.createElement('span');
  id.className = 'label';
  id.textContent = deck.deckId;

  const label = document.createElement('span');
  label.className = 'sub';
  label.textContent = deck.label;

  const meta = document.createElement('span');
  meta.className = 'meta';
  meta.textContent = `${deck.slideCount}장`;

  li.append(id, label, meta);
  li.addEventListener('click', () => {
    // M3-2 에서 편집 화면으로 넘어간다. 지금은 주소만 바꾼다.
    location.hash = `#/deck/${encodeURIComponent(deck.deckId)}`;
  });
  return li;
}

main();
