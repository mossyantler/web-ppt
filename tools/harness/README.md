# 왕복 하네스 — M1-3

> **지위** — 계획 `.omc/plans/html-slide-editor.md`(3판, APPROVED) §11 M1 게이트의 **판정기**.
> **문법 기준** — `core/grammar.md`(문법 v1, M1-1). 하네스와 문법이 어긋나면 문법이 이긴다.
> **픽스처** — `fixtures/`(M1-2). 하네스는 픽스처를 **읽기만** 한다.
> **범위 밖** — 서버 엔드포인트, 파일 쓰기, 편집기 UI, 검증기 19종. 전부 M2 이후다.

```
node tools/harness/index.js                판정표 + 게이트 요약 + 악성 P2/G1 + 진단
node tools/harness/index.js --diagnose     비게이팅 Axis B (추정 분류) 까지
node tools/harness/index.js --verbose       진단 전부 (요약 절단 없음)
node tools/harness/index.js --json          기계 판독용
node tools/harness/index.js <경로…>          지정한 파일만 (절대 경로 가능)
node --test tools/harness/harness.test.js   39개 테스트
```

종료 코드 — 게이트 통과 0, 실패 1, 픽스처 없음 2.

---

## 1. 무엇을 판정하는가

계획 §11 M1 의 분자 셋을 섹션마다 판정한다. **셋 전부 성립할 때만 1점이다.**

| 판정 | 내용 | 구현 |
|---|---|---|
| **(1)** | `adoptSection` 없이 문법 v1 통과 | `gate.js` — 섹션 게이트 규칙 1~7 + 문서 레벨 게이트 §6 |
| **(2)** | 각 리프의 텍스트 편집·순서 이동 성공 + **편집 구간 밖 바이트 동일** | `probes.js` — `setContent`/`setValue`/`setTex`/`setProps` + `moveElement` |
| **(3)** | 섹션에 나타나는 **각 블록 종류**(`(data-el｜data-box, data-variant)` 쌍)마다 `insertElement` 로 같은 종류 추가 | `probes.js` — `mapping.blocks` 조회 → 소스 조각 합성 → 삽입 → 재파싱 후 종류 일치 확인 |

**미구현 항목은 SKIP 이 아니라 FAIL 이다.** 판정 상태는 `pass`/`fail` 둘뿐이며, 테스트가 그것을 강제한다
(`미구현은 SKIP 이 아니라 FAIL 로 분류된다`). 초록불은 M1 의 게이트가 아니다 — **판정 가능함**이 게이트다.

**분모는 템플릿 10섹션이다.** W31 13섹션은 `legacyEditableRatio` 로 분리 기록하고, 악성 4개는 P2·G1 전용 판정을 받는다(F-1, 승인 항목 3).

---

## 2. 어떻게 판정하는가 — 저작 트리와 바이트

```
raw(문자열) ─parse5(sourceCodeLocationInfo)─▶ 저작 트리 ─serialize─▶ raw 와 바이트 동일
                                                  │
                                    편집: raw.slice(0,start) + text + raw.slice(end)
```

- **라이브 DOM 을 직렬화하지 않는다**(결정 Z2). 트리의 모든 노드는 `[start, end)` 를 들고 있고, 재직렬화는 **원문 슬라이스만** 이어 붙인다. 이스케이프 재계산·공백 축약·속성 재인용이 코드 경로에 아예 없다.
- **편집 적용은 메모리에서만 한다.** `splice.js` 는 문자열 연산이고 `fs` 를 모른다. 파일 쓰기는 M2 범위다. 테스트가 픽스처 해시로 그것을 확인한다.
- 참고 구현은 `reference/estradeck/server/src/deck/parse.ts`·`splice.ts`(읽기 전용, 수정하지 않았다).

### 파서가 버린 바이트

parse5 는 소스에 있는 바이트를 노드로 만들지 않는 경우가 있다. 대표는 `<pre>` 여는 태그 직후의 개행이다(HTML 파싱 규칙이 버린다). `serialize.js` 는 자식 span 사이의 빈 구간을 **원문에서 메운다** — 그 바이트는 어휘 밖이므로 규약 G1 의 불투명 보존 대상이고, 저작 트리가 들고 있어야 한다. `droppedByteSpans()` 가 그 구간을 관측 가능하게 노출한다.

`adv-02-pre-whitespace.html` 이 정확히 이것을 잡았다. 초기 구현은 이 개행 1바이트를 잃었고, 픽스처가 그것을 즉시 빨간불로 만들었다.

### parse5 가 삽입한 요소

`slides/method.html:32` 은 `<tbody>` 가 없다[g7]. parse5 는 트리에 `<tbody>` 를 삽입하고 그 노드에는 `sourceCodeLocation` 이 없다. 하네스는 그 노드를 `kind='synthesized'` 로 두고 **태그 없이 자식만** 직렬화한다. 그래서 편집 0회 상태에서 왕복 프로브가 초록불이다 — `grammar.md` §5.1 이 1판 규칙 6을 삭제한 근거를 하네스가 그대로 구현한 것이다.

---

## 3. 빨간불의 원인을 가르는 두 축

M1 의 요구는 "빨간불" 이 아니라 **"구현 전이라 빨간불"과 "픽스처·문법이 잘못돼서 빨간불"의 구별**이다. 하네스는 두 축으로 가른다.

### 축 1 — `primaryCause` (게이팅 판정에 붙는 라벨)

| 값 | 뜻 | 책임 |
|---|---|---|
| `unannotated` | 주석이 아예 없다. 코퍼스 주석 커버리지 0%[g4] 의 직접 결과 | M1-4 `adoptSection` / M8 |
| `vocabulary-gap` | 주석은 있는데(또는 부여가 확정되지 않아) 어휘·`mapping` 에 대응 값이 없다 | **M1 — 어휘를 넓혀서 끝낸다** |
| `round-trip-loss` | 재직렬화가 원문과 다르다 | 저작 트리·하네스 |
| `probe-failure` | 문법은 통과하는데 편집·이동·삽입이 깨진다 | 명령 계층(M2·M3) |
| `document-gate` | 문서 수준 전제(`data-deck-grammar` 등) 미충족 | adopt / 문서 선언 |
| `none` | 전부 통과 | — |

### 축 2 — `--diagnose` (Axis B, 비게이팅)

클래스 역방향 조회로 `(data-el｜data-box, variant)` 를 **추정**한 뒤 같은 세 판정을 돌린다. 추가로 `(1*)` 를 낸다 — `adoptSection` 이 치유하는 진단(id 발급·`data-el` 부여·`--pct` 치환)을 제외한 **잔여 진단이 0인가**.

- `(1*)`✔ = "주석만 붙이면 통과한다"
- `(1*)`✘ = "어휘·`mapping` 을 넓혀야 한다"

역방향 조회는 문법에 없는 연산이므로 **게이트에 절대 들어가지 않는다.** 진단 전용이다.

### 양성 대조군

`harness.test.js` 는 손으로 주석한 최소 섹션(`GREEN`)에 대해 (1)(2)(3) 이 **통과함**을 요구한다. 이것이 없으면 "전부 FAIL" 이 판정인지 고장인지 구별되지 않는다. 대조군에서 유일하게 FAIL 로 남는 것은 `insertElement(progress)` 이고, 이유는 테마 scaffold 조각 파일이 없다는 것이다 — SKIP 이 아니라 FAIL 로 남긴다.

---

## 4. 파일

| 파일 | 역할 |
|---|---|
| `index.js` | CLI. 픽스처 열거 → 판정 → 표·게이트 요약·`legacyEditableRatio`·악성 P2/G1·진단·Axis B |
| `tree.js` | parse5 → 저작 트리. 노드 분류(section·container·leaf-authored·leaf-opaque·leaf-void·structural-child·inline·opaque-subtree·opaque-node·synthesized·unknown-element) |
| `serialize.js` | 재직렬화 · 왕복 프로브(규칙 7) · 불투명 노드 목록(G1) · 버려진 바이트 관측 |
| `splice.js` | 메모리 splice · 구간 밖 동일성 검사 · 다중 구간 splice |
| `gate.js` | 섹션 게이트 규칙 1~7 · 문서 레벨 게이트 §6 · 진단 다섯 필드 |
| `probes.js` | 분자 (2)(3) 프로브 · 블록 종류 열거 · 삽입 조각 합성 |
| `mapping.js` | `themes/snu/mapping.json` 로더 + 정/역방향 조회 |
| `harness.test.js` | 39개. 양성 대조군 · 음성 대조군 · 바이트 불변식 · 규칙별 위반 탐지 · 판정 구별 능력 |

### 테마 매핑의 단일 진실 원천

값은 `themes/snu/mapping.json` 하나에만 있다. **하네스와 `tools/adopt`(M1-4)가 같은 파일을 읽는다** — 1판에서 전사 2벌이 `title-lab`/`title-meta` 처리에서 갈라졌던 문제의 해소다.

문법은 절의 **존재와 의미**를 정하고(§2.4), 값은 테마가 정한다(§7). 그래서 어휘 값 21+8 을 늘리지 않고 `(값, variant)` 쌍만 넓히는 것은 계획 개정 사항이 아니다. **다만 문법이 선언하지 않은 어휘 값을 여기에 넣어서는 안 된다** — 넣으면 하네스가 어휘 공백을 스스로 메워 판정을 조용히 통과시킨다(계획 §12 완화 3). 테스트가 리프 21 · 컨테이너 8 · 불투명 리프 2 를 고정해 그것을 막는다.

`region` 만 두 축이다 — `data-region`(슬롯, `regionSlots`)과 `data-variant`(조판, `blocks["box:region"]`). 실효 클래스는 둘의 결합이고, 블록 종류의 키도 `(값, variant, 슬롯)` 이다.

---

## 5. 현재 판정

`VERDICT.md`(2판, 2026-07-31)를 보라. 요약: **게이트 10/10 = 100% PASS**, 기준별 (1)(2)(3) 전부 10/10, 어휘 값 증가 0.
1판(2026-07-28)은 0/10 FAIL 이었고 차단 요인 5종(G-1~G-5)을 지목했다. 그 다섯은 전부 테마 `mapping` 값과 scaffold 조각으로 닫혔다.
