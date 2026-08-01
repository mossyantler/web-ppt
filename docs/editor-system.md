# 슬라이드 편집 시스템 설계

레퍼런스 소스 분석 결과와 그로부터 도출한 우리 시스템 설계.
대상은 개별 슬라이드가 아니라 **슬라이드를 만드는 시스템**이다.

분석에 쓴 소스는 `reference/`에 클론되어 있다(gitignore 처리됨, 우리 코드 아님).

| 소스 | 라이선스 | 왜 가져왔나 |
|---|---|---|
| `reference/estradeck` | MIT (Syndicats eG) | HTML을 source of truth로 두는 유일한 실사용 편집기 |
| `reference/moveable` | MIT (Daybrush) | 드래그·리사이즈·회전·스냅 변형 엔진 |
| `reference/selecto` | MIT (Daybrush) | 드래그 영역 다중 선택 |

---

## 1. Estradeck 해부 — 검증된 사실

문서의 주장이 아니라 실제 코드에서 확인한 내용.

### 1.1 쓰기 파이프라인 (핵심)

편집 코어 전체가 **약 550줄**이다 (`server/src/deck/`: parse 152 + sections 178 + splice 216 + io 17).

```
HTML 원본
  → parse5(sourceCodeLocationInfo: true)      # 모든 노드의 정확한 바이트 오프셋
  → 슬라이드 모델 (startOffset, endOffset, openTagStart, openTagEnd)
  → 편집 대상 구간만 문자열 splice
  → 임시 파일 쓰기 + rename (원자적)
  → sha256 해시로 동시 편집 충돌 감지
```

핵심 코드 (`deck/splice.ts:63`):

```ts
export function writeSpliced(deckId, raw, start, end, text, label) {
  recordHistory(deckId, raw, label);
  const out = raw.slice(0, start) + text + raw.slice(end);
  atomicWrite(htmlPath(deckId), out);
  return hashContent(out);
}
```

`atomicWrite`는 `deck/io.ts:13` — temp 파일에 쓰고 `renameSync`. watcher가 반쯤 쓰인 파일을 보는 일이 없다.

충돌 가드 (`deck/splice.ts:20`): 클라이언트가 보낸 `expectedHash`와 디스크 해시가 다르면 `409 CONFLICT`. 편집기는 "reload" 배너를 띄운다.

**편집 구간 밖은 바이트 단위로 동일하다.** 포맷·주석·들여쓰기가 보존된다.

### 1.2 주소 체계 — data-node-id를 쓰지 않는다

이게 가장 중요한 발견이다. Estradeck은 요소마다 id를 박지 않는다.

- **슬라이드** — `<section>`의 `id` 속성, 없으면 `s0`, `s1`… 순번 (`deck/parse.ts:113`). 이 key로 바이트 오프셋을 조회한다.
- **슬라이드 내부 요소** — `path: number[]`, 즉 **자식 인덱스 경로** (`client/src/lib/previewHighlight.ts:163`).

그리고 결정적으로, **내부 요소 경로는 쓰기에 쓰이지 않는다.** ⌥-클릭으로 코드 에디터 커서를 그 요소 위치로 점프시키는 용도뿐이다.

**모든 쓰기는 슬라이드 단위이거나 여는 태그 단위다:**

| 함수 | 교체 구간 |
|---|---|
| `putSlide` | `<section>` 전체 소스 범위 |
| `patchSlideOpenTag` | 여는 태그만 (내부 HTML은 바이트 동일) |
| `addSlide` / `duplicateSlide` | 삽입 지점에 삽입 |
| `reorderSlides` | `.slides` 안쪽 전체를 재조립 |
| `deleteSlide` | 슬라이드 + 앞뒤 공백 |

**쓰기 단위를 슬라이드로 잡으면 요소 단위 앵커가 아예 필요 없다.**

> 앞서 내가 `data-node-id`를 "먼저 해야 할 필수 작업"이라고 했던 것은 과했다.
> 슬라이드 단위 쓰기가 그 문제를 통째로 우회한다. `data-node-id`는 아래 3.4에서
> 다른 이유로 다시 등장하지만, 저장 파이프라인의 전제 조건은 아니다.

### 1.3 우리와 결정적으로 다른 점 — 프리뷰가 읽기 전용이다

Estradeck의 편집 입력은 세 가지다: CodeMirror 코드 에디터, AI 어시스턴트, 속성 패널.
**iframe 프리뷰에서 직접 조작하지 않는다.** ⌥-클릭조차 "코드 에디터로 점프"일 뿐이다.

그래서 Estradeck은 **라이브 DOM을 직렬화할 일이 없다.** 새 HTML은 항상 사람이 타이핑했거나 AI가 생성한 텍스트다.

우리가 원하는 건 PPT식 직접 조작이다. 즉 **라이브 DOM → HTML 직렬화 경로가 반드시 필요하고, 이건 Estradeck에 없는 부품이다.** 우리가 만들어야 한다.

여기서 앞서 확인한 문제가 걸린다 — `deck-stage.js`는 런타임에 슬라이드에 `data-deck-active`, `data-deck-slide`, `data-screen-label`, `data-deck-last-visible`, `data-om-validate`를 붙인다(deck-stage.js:1212-1281). 직렬화 전에 정화(sanitize)하지 않으면 이 쓰레기가 소스에 박힌다.

### 1.4 그 밖에 가져올 것

- **history 스냅샷** — 쓰기 직전 원본 바이트를 저장(`decks/history.ts`). 파일 단위 undo.
- **chokidar + WebSocket** — 누가 파일을 바꾸든(사람, AI, 외부 에디터) 프리뷰가 동기화된다.
- **슬롯 예약** (`reserveSlides`, `splice.ts:142`) — 병렬 AI 작업 전에 빈 슬라이드를 먼저 삽입해 자리를 잡아둔다. 어느 에이전트가 먼저 끝나든 순서가 보장된다. 여러 슬라이드를 동시 생성할 때 쓸 패턴.
- **id 충돌 회피** — 문서 전체에서 `id="..."`를 정규식으로 수집해 중복을 피한다(`splice.ts:125`).

---

## 2. Moveable / Selecto — 자유 배치 담당

자유 배치 변형 로직을 직접 짜지 않기로 한 결정에 따른 외부 의존.

- **Moveable** — Draggable, Resizable, Scalable, Rotatable, Warpable, Pinchable, **Groupable**, **Snappable**. 프레임워크 없는 바닐라 패키지(`packages/moveable`)가 있어 우리 정적 HTML에 바로 붙는다.
  - `packages/snappable`이 따로 있다 — 요소 간 정렬 가이드, 스냅 임계값, 격자 스냅. 내가 프로토타입에서 직접 짠 `alignSnap()`을 대체한다.
  - **Groupable**은 우리 "그룹 진입" 개념과 직접 맞물린다.
- **Selecto** — 드래그 영역으로 여러 요소 선택. 다중 선택 후 일괄 이동/정렬에 필요.

둘 다 캔버스 스케일 변환(우리는 1280×720을 `transform: scale()`로 축소)을 지원하는지가 도입 전 확인 사항이다. Moveable에는 `zoom` 옵션이 있으므로 가능성이 높지만 **미검증**이다.

---

## 3. 우리 시스템 설계

### 3.1 원칙

1. **HTML이 source of truth.** JSON scene graph로 전환하지 않는다. 이유는 이미 정리됨 — 디자인 시스템(`slides/slides.css`)과 런타임(`templates/weekly-report/deck-stage.js`)이 이미 자산이고, 스키마는 고정 어휘를 전제하는데 이 시스템은 어휘가 계속 늘어난다.
2. **편집 구간 밖은 바이트 동일.** git diff가 실제 변경분만 보여줘야 한다.
3. **쓰기 단위는 슬라이드.** 요소 단위 바이트 패치를 시도하지 않는다.
4. **직접 조작은 프리뷰에서, 저장은 서버에서.** 둘 사이를 잇는 건 정화된 직렬화 하나뿐이다.

### 3.2 아키텍처

```
                   ┌──────────────── 브라우저 ────────────────┐
                   │                                          │
  index.html ──────┼─→ deck-stage (렌더링·fit·레일)            │
   (source of      │        ↕                                 │
    truth)         │   편집 레이어 (?edit=1)                   │
                   │    · 개체 선택 / 그룹 진입                 │
                   │    · Moveable (변형) · Selecto (다중선택)  │
                   │    · 블록 팔레트 · 텍스트 편집             │
                   │        ↓                                 │
                   │   직렬화 + 정화 (sanitize)                │
                   └──────────────┬───────────────────────────┘
                                  │ PUT /slide/:key  { html, expectedHash }
                   ┌──────────────┴───────────────────────────┐
                   │            dev 서버 (localhost)           │
                   │  parse5 오프셋 → splice → atomicWrite     │
                   │  sha256 가드(409) · history 스냅샷        │
                   │  chokidar → WS 브로드캐스트               │
                   └──────────────────────────────────────────┘
```

### 3.3 직렬화 + 정화 — 우리가 새로 만들 유일한 핵심 부품

Estradeck에 없는 부분이라 참고할 코드가 없다. 규칙:

**제거할 런타임 속성** — `data-deck-active`, `data-deck-slide`, `data-deck-last-visible`, `data-om-validate`.

**복원할 속성** — `data-screen-label`은 저자가 쓴 값이 있는데 deck-stage가 `"02 저번 주 활동"` 형태로 덮어쓴다(deck-stage.js:1212). 편집 모드 진입 시점에 원본 스냅샷을 떠두고 저장 시 되돌린다.

**제거할 편집기 잔재** — `contenteditable` 속성, 선택 상태 클래스, Moveable이 주입하는 컨트롤 박스, 자유 배치 자리표시자(`data-spacer`)와 `.free-layer` 래퍼는 유지하되 편집 전용 표시는 제거.

**정규화** — 자유 배치 좌표를 8px 격자로 반올림. 인라인 `width: 146.203px` 같은 매직 넘버를 줄인다.

**검증** — 직렬화 결과를 parse5로 재파싱해 단일 `<section>`인지 확인(Estradeck의 `isSingleSection`, `parse.ts:144`과 동일 발상). 실패하면 저장 거부.

### 3.4 data-node-id — 필수 아님, 그러나 쓸모 있음

저장 파이프라인에는 필요 없다(1.2 참조). 다음 세 경우에만 값을 한다:

- **AI 편집 명령 타겟팅** — "이 그래프 크게" 같은 지시를 안정적으로 특정 노드에 걸 때.
- **자유 배치 좌표의 소유자 식별** — 자리표시자와 승격된 개체를 짝짓는 데 이미 임시 id를 쓰고 있다.
- **주차 간 추적** — 지난주 덱의 같은 블록을 이번 주로 이어붙일 때.

결론: **나중에 필요해지면 붙인다. 지금 선행 작업으로 하지 않는다.**

### 3.5 자유 배치 정책 (앞선 결론 유지)

- 기본은 스냅 배치 — 흐름 안 순서 변경. 디자인 시스템이 정렬을 보증한다.
- 자유 배치는 **화이트리스트**로 제한 — 피규어·이미지·주석. 텍스트 블록은 흐름 고정.
- 자유 배치 개체는 `.free-layer`(슬라이드 전체를 덮는 절대 위치 레이어)로 올리고 원래 자리에 같은 크기 자리표시자를 남긴다. 좌표계 통일 + 형제 붕괴 방지. 프로토타입에서 검증 완료(의도 `[80,30]` → 실제 `[80,30]`, 형제 이동 `0px`, 왕복 무손실).

### 3.6 마일스톤

| 단계 | 내용 | 선행 |
|---|---|---|
| M1 | dev 서버 — parse5 오프셋 파싱, `PUT /slide/:key`, sha256 가드, atomicWrite, history | 없음 |
| M2 | 직렬화 + 정화 + 재파싱 검증 | M1 |
| M3 | 편집 레이어 최소본 — 개체 선택, 그룹 진입, 텍스트 편집, 순서 이동, 복제/삭제 | M2 |
| M4 | chokidar + WS 라이브 동기화 | M1 |
| M5 | Moveable/Selecto 도입 — 자유 배치(화이트리스트), 다중 선택 | M3 |
| M6 | 블록 팔레트 — `slides/*.html`에서 스니펫 레지스트리 자동 추출 | M3 |
| M7 | 슬라이드 추가/삭제/재정렬 + 페이지 번호 자동 renumber | M1 |

M1~M3이 실사용 최소선이다. M4는 여러 창을 띄우거나 내가 파일을 동시에 편집할 때 필요해진다.

### 3.7 미해결 / 확인 필요

- Moveable의 `zoom` 옵션이 우리 `transform: scale()` 캔버스와 정확히 맞물리는지 **미검증**.
- 페이지 번호(`03 / 13`)가 현재 하드코딩이다. 슬라이드 추가/삭제 시 renumber 훅이 필요하다(M7).
- 오버플로 검증은 deck-stage에 `data-om-validate` 훅이 이미 있다. 저장 시 이걸 태울지 결정 필요.
- dev 서버의 쓰기 경로 제한 — localhost 바인딩 + `_workspace/` 하위로 한정.
