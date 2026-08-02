# 덱 서버 — M2

명령이 파일을 바꾸는 층. 계획 `.omc/plans/html-slide-editor.md` §3(명령)·§11 M2 의 구현이다.

```bash
npm run serve      # http://127.0.0.1:4321 (덱 루트: ./_workspace)
```

```bash
npm test
```

## 무엇이 진실인가

**서버 저작 트리가 편집 모델의 유일한 진실이다** (계획 §1.3 결정 Z2). 브라우저 라이브 DOM 은 렌더 전용이고 **저장 경로에 없다.** 명령이 지목하는 노드는 전부 서버가 파싱한 트리에서 나온다.

파서를 새로 쓰지 않는다. `tools/harness/tree.js` 가 M1 에서 어휘 판정·면제 규칙·구조 자식 깊이까지 구현했고 하네스가 그것으로 게이트를 잰다. 서버가 별도 구현을 가지면 **게이트가 재는 트리와 명령이 바꾸는 트리가 갈라진다** — M1 개정 기록 2 가 매핑에서 이미 한 번 고친 실패다.

## 불변식

| | 내용 | 어디서 상속되는가 |
|---|---|---|
| **P2** | 편집 구간 밖 바이트 동일 | `splicedMany`. 쓰기 **전에** `commit.js` 가 편집마다 직접 검사하고, 어긋나면 파일을 건드리지 않고 죽는다 |
| **규약 G1** | 어휘 밖 노드(주석·CDATA·`<pre>` 공백)의 개수·순서·바이트 보존 | 저작 트리가 그것들을 **자식으로 들고** 재직렬화가 원문 바이트를 낸다 |

구조 명령은 슬라이드 전체를 재직렬화하므로 섹션 **안**의 주석이 splice 구간 **안**에 들어온다. P2 의 보호를 받지 못하고 G1 이 유일한 방어선이다 (계획 3판 F-5ⓐ). `server/g1-adversarial.test.js` 가 `fixtures/adversarial/*` 로 이를 직접 잰다.

## 목차 — 화면이 어휘를 다시 구현하지 않게 하는 장치

`GET /deck/:id/outline` 은 섹션마다 **지목 가능한 노드**를 트리로 준다. 노드마다 종류(`kind`)·어휘 값(`value`)·내용 편집 명령(`edit`)이 붙는다.

편집 화면은 iframe 안 DOM 에서 `data-node-id` 하나만 읽고, 그 id 가 카드인지 진행바인지·고칠 수 있는지는 전부 이 응답에서 얻는다. **클래스 이름으로 종류를 알아내는 코드가 브라우저에 생기면 그것이 두 번째 어휘 구현**이고, `doc.js` 가 파서에 대해 막아 둔 실패(게이트가 재는 트리와 화면이 고르는 트리가 갈라진다)가 그대로 재현된다.

`annotated` 와 `blockers` 는 다른 것을 잰다 — 앞은 "섹션 자신을 명령이 지목할 수 있는가", 뒤는 "그 안에 어휘 밖 노드가 있는가"다. 둘을 하나의 `editable` 로 합치지 않는다: **어디까지 잠글지는 UX 정책(M3-9)**이고, 합치면 정책이 바뀔 때마다 응답의 뜻이 바뀐다. (이름표를 갓 붙인 W31 은 13 개 섹션 전부가 이름표를 갖고 그중 12 개가 어휘 밖 노드를 갖는다. "하나라도 있으면 잠근다" 로 합치면 편집 가능한 슬라이드가 1 장이 된다.)

## 신뢰 경계

| 경계 | 파일 | 규칙 |
|---|---|---|
| 경로 | `paths.js` | `_workspace/` 밖은 403. **문자열 필터가 아니라 실경로 비교** — `..` 필터 목록은 심볼릭 링크·유니코드 정규화·URL 인코딩으로 계속 열리고 결코 닫히지 않는다 |
| 바인딩 | `index.js` | `127.0.0.1` 만. 파일 쓰기 권한이 있고 인증이 없으므로, 외부에 열리면 브라우저의 아무 페이지나 그 권한을 쓴다 |
| 입력 | `normalize-inline.js` | 스크립트·이벤트 핸들러·`javascript:` 는 **거부**. 나머지는 언랩·제거로 통과 |
| 쓰기 | `atomic.js` | **유일한 파일 쓰기 지점** (계획 §10.1 이 CI grep 으로 감시하는 표면) |

## 쓰기 경로

```
POST /deck/:id/commit
  ↓ paths.js          _workspace 밖 → 403
  ↓ commit.js         봉투 검증 → 400
  ↓ idempotency.js    commitId 리플레이 → {applied:false, superseded}
  ↓ doc.js            적재·파싱·nodeId 인덱스 → 404 / 중복 id 409
  ↓ commit.js         pre.docHash 대조 → 409          ← 파일은 아직 열리지 않았다
  ↓ commands.js       명령 적용 (메모리) → 422         ← 전부 성공 아니면 전부 롤백
  ↓ commit.js         P2 검사 → 500                   ← 어긋나면 쓰지 않는다
  ↓ history.js        edit 링에 스냅샷, redo 링 비움
  ↓ atomic.js         임시 파일 + fsync + rename
```

멱등 조회가 **낙관적 락보다 앞**이다. 순서가 뒤바뀌면 재시도가 409 를 받고 사용자에게 가짜 충돌 배너가 뜬다 — 멱등이 막으려던 바로 그 실패다 (§3.3).

## 명령 (13)

| 종류 | op | 쓰기 단위 |
|---|---|---|
| **속성** | `setProps` `setSectionProps` `setTex` `setValue` `setPosition` | 여는 태그. 대상의 내부 HTML 은 정의상 바이트 동일 |
| **구조** | `insertElement` `removeElement` `moveElement` `duplicateElement` `wrapElements` `unwrapElement` | 슬라이드 전체 (재직렬화) |
| **내용** | `setContent` | 리프의 내부 구간 `[innerStart, innerEnd)` |
| **구조 자식** | `reorderChildren` `insertChild` `removeChild` `setChildContent` | 부모의 내부 구간 (`setChildContent` 는 자식 하나의 내부) |
| **섹션** | `reserveSections` | 앵커 섹션 뒤 삽입 |

구조 자식(`<li>`·`<td>`)은 L6 면제로 `data-node-id` 를 갖지 않아 `moveElement` 로 지목할 수 없다. **순번으로 지목한다** — `reorderChildren(target, order)`. `reorderChildren` 과 `removeChild` 는 HTML 을 받지 않으므로 정화기를 지나지 않고, 그래서 순서를 바꾸는 일이 내용을 바꾸지 않는다 (§3.6 L6.1).

속성 명령은 여는 태그를 **통째로 다시 쓰지 않는다.** 속성 하나만 splice 한다 — 다시 쓰면 손대지 않은 속성의 인용 부호·공백이 정규화되고, 사용자가 바꾼 건 하나인데 diff 는 줄 전체로 뜬다.

**거부는 전부 방향을 함께 준다.** 불투명 리프에 `setContent` 를 걸면 422 와 함께 `use: "setTex"` 가 온다. `wrapElements` 가 부모 불일치로 거부되면 그것을 가능하게 만드는 `moveElement` 명령 배열이 진단에 실린다 (§3.5).

## Undo

**역연산을 만들지 않는다** (§3.4). `unwrapElement` 의 역연산은 원래 컨테이너의 모든 속성을 알아야 하고, 역연산 버그는 조용히 소스를 망가뜨린다 (D1). 대신 커밋 직전 파일 바이트를 통째로 기록한다.

링은 둘이고 각각 200 칸이다. Estradeck 의 `writeSpliced` 는 모든 쓰기에 히스토리를 기록하므로, 링이 하나면 undo 마다 슬롯을 먹어 **편집 100 + undo 100 이 산술적으로 불가능**하다 (Architect A2).

```
_workspace/<deck>/.history/edit/   사용자·AI 커밋 직전 (200)
_workspace/<deck>/.history/redo/   undo 가 되돌리기 전 (200)
```

새 편집은 redo 링을 비운다 — 남겨 두면 이어지지 않는 두 역사가 생긴다.

## 파일

| 파일 | 역할 |
|---|---|
| `index.js` | HTTP. `POST /deck/:id/commit`·`/undo`·`/redo`, `GET /deck/:id`·`/outline`·`/page`, `GET /decks`, 편집기 화면 |
| `outline.js` | `GET /deck/:id/outline` — 화면이 "무엇을 고를 수 있는가" 를 묻는 읽기 전용 목차 |
| `commit.js` | 파이프라인. 순서가 계약이다 |
| `commands.js` | 레지스트리. 미등록 op 는 422 — 조용한 무시 없음 |
| `doc.js` | 저작 트리 적재 + `nodeId` 인덱스 |
| `paths.js` `atomic.js` | 신뢰 경계 둘 |
| `attrs.js` `attr-commands.js` | 속성 명령 |
| `structure.js` `structure-commands.js` | 구조 명령 + 트리 변형 |
| `normalize-inline.js` `content-commands.js` | `setContent` |
| `history.js` `idempotency.js` | undo/redo 링, `commitId` LRU |
| `section-commands.js` | `reserveSections` |

## 범위 밖

`adoptSection`(M8) · 섹션 명령 나머지 · `setTheme`(M5) · `renumberPages` · 검증기 19종(M4). `server.test.js` 의 경계 테스트가 이 목록을 고정한다.
