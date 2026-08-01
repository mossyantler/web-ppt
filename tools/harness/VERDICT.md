# M1 게이트 판정 — 2026-07-31 (2판, G-2 반영 후)

> 산출 명령 — `node tools/harness/index.js --diagnose` (repo 루트). 이 문서의 모든 수치는 그 출력에서 나온다.
> 테스트 — `node --test tools/harness/harness.test.js` · **39/39 통과**.
> 1판(2026-07-28)은 게이트 0/10 FAIL 이었고, 남은 차단 요인 5종(G-1~G-5)을 지목했다. 이 2판은 그 다섯이 닫힌 뒤의 재판정이다.

---

## 0. 한 줄

**게이트 PASS. 커버리지 10/10 = 100% (기준 100%).** 기준별 (1) 10/10 · (2) 10/10 · (3) 10/10, 전 섹션 1차 원인 `none`.
**어휘 값은 하나도 늘지 않았다** — 리프 21 · 컨테이너 8 · 불투명 리프 2 그대로다. 닫힌 것은 전부 **테마 `mapping` 의 값**이며, 계획 개정 없이 §7("값은 테마가 정한다")의 범위 안이다.

---

## 1. G-2 — `region` 의 두 축 (권고안 채택)

1판이 지목한 핵심 차단 요인은 이것이었다. 10종 템플릿 전부가 `slide-body` 에 레이아웃 클래스를 함께 얹는데, 문법 v1 은 "한 요소는 `data-el`/`data-box` 중 정확히 하나" 이므로 슬롯(region)과 조판(grid/stack)을 동시에 표현할 자리가 없었다.

**채택한 해법 — `region` 은 두 축을 진다.**

| 축 | 속성 | 성질 | 값 |
|---|---|---|---|
| **슬롯** | `data-region` | 닫힌 열거 (§2.2) | `head｜body｜foot｜side｜main` |
| **조판** | `data-variant` | 테마가 선언한 닫힌 열거 (L7) | `default｜cols2｜cols57｜stackGap6` |

실효 클래스 = `regionSlots[슬롯]` + `blocks["box:region"][variant]` 의 결합이다.

```html
<div data-box="region" data-variant="cols2" data-region="body" data-node-id="n8" class="slide-body cols-2">
```

```jsonc
"regionSlots": { "head": "slide-head", "body": "slide-body", "foot": "slide-foot",
                 "side": "split-side",  "main": "split-main" },
"blocks": { "box:region": { "default": "", "cols2": "cols-2", "cols57": "cols-5-7", "stackGap6": "stack gap-6" } }
```

**하네스가 함께 바뀐 곳 셋.**

- `mapping.js` — `classFor(key, variant, regionSlot)` 가 region 만 두 축을 곱해 실효 클래스를 낸다. 역방향 조회 키도 슬롯 × variant 의 곱집합으로 만든다.
- `tree.js` — region 노드는 `variant`(조판)와 `regionSlot`(슬롯)을 **따로** 들고 있다. 1판은 `variant` 를 `data-region` 에서 읽었고, 그것이 조판 축을 통째로 잃게 만든 원인이었다.
- `probes.js` — 블록 종류의 키가 `(값, variant, 슬롯)` 이다. **같은 `region` 이라도 슬롯이 다르면 다른 블록 종류다** — 분자 (3)이 `insertElement(region, head)` 와 `(region, body)` 를 각각 요구한다. 회귀 테스트가 이것을 고정한다.

L7 조항 3("같은 값의 두 variant 는 같은 명령 집합을 받아야 한다")은 유지된다 — `cols2` 와 `cols57` 은 `insertElement`/`moveElement`/`removeElement` 를 같은 방식으로 받는다.

---

## 2. G-1 · G-3 · G-4 · G-5 의 처리

| # | 1판의 지적 | 처리 | 어휘 증가 |
|---|---|---|---|
| **G-1** | 클래스 없는 `<div>` 래퍼 14곳에 갈 경로 없음 | `box:group` 에 `plain`(클래스 없음) variant, `box:row` 에 `default`(클래스 없음) 선언 | 없음 (variant 만) |
| **G-3** | 인라인 flex 래퍼 3곳 | `data-box="row"` 로 주석. 인라인 `display:flex; gap` 은 규칙 5 의 기하(`left/top/width/height`)가 아니므로 위반이 아니다 | 없음 |
| **G-4** | `div.foot-meta` | `box:stack` 에 `footMeta` variant | 없음 (variant 만) |
| **G-5** | `scaffolds[progress]` 조각 파일 부재 | `themes/snu/templates/progress-row.html` 생성. `{{nodeId}}`·`{{value}}`·`{{label}}` 치환 자리를 갖고, `--pct` 와 `data-value` 를 **같은 값으로** 낸다 (§3.4 동기 불변식) | — |

**어휘 크기 불변 확인** — `el:` 21 · `box:` 8 · `opaqueLeaves` 2. 테스트가 이 셋을 고정하므로 `mapping.json` 에 값을 몰래 늘리면 실패한다.

**G-3 의 잔여** — flex 래퍼의 조판이 여전히 인라인 `style` 에 있다. M1 게이트의 위반은 아니지만 테마 교체 시 따라오지 않는다. **M4a `design.token-escape` 의 판정 대상**으로 넘긴다(이 문서의 범위 밖).

---

## 3. 픽스처 × 섹션 판정

**게이트 분모는 `themes/snu/templates/*.html` 10섹션이다** — 계획 §11 M1 F-1 이 정한 그대로이며, 분모를 옮긴 것이 아니다. `fixtures/templates/*` 는 주석 이전 상태의 기록으로 남아 계속 판정된다.

| 픽스처 | § | (1) 문법 | (2) 편집·이동 | (3) 삽입 | 점수 | 1차 원인 |
|---|---|---|---|---|---|---|
| themes/snu/templates ×10 | 0 | ✔ ×10 | ✔ ×10 | ✔ ×10 | **10** | `none` |
| fixtures/templates ×10 (주석 전) | 0 | ✘ | ✘ | ✘ | 0 | `unannotated` |
| fixtures/legacy/w31 (13섹션) | 0–12 | ✘ ×13 | ✘ ×13 | ✘ ×13 | 0 | `unannotated` ×13 |
| fixtures/adversarial ×4 | 0 | ✘ | ✘ | ✘ | 0 | `unannotated` |

**게이트 요약 — 분모 10 · 분자 10 · 10/10 = 100% · 기준 100% · PASS.** 종료 코드 0.

**`legacyEditableRatio` (비게이팅)** — W31 13섹션 중 문법 v1 통과 **0/13**, (1)(2)(3) 전부 성립 **0/13**. 1판과 같다. 어휘 v1 은 W31 패턴을 의도적으로 배제했으므로(승인 항목 3) 변화 없음이 정상이다.

### 테마 템플릿이 `slides/*.html` 에 대해 무엇이 달라졌는가

`slides/*.html` 의 바이트에 **주석만** 얹었다. `data-*` 속성을 전부 걷어내고 비교하면 **9종은 차이 0줄**이다.

유일한 예외는 `progress.html` 5줄이며, `style="width:N%"` → `style="--pct:N"` 치환이다. 이것은 `grammar.md` §3.2 가 `adoptSection` 의 일로 명시한 마이그레이션이고, 1판이 지목한 그 다섯 곳[g6]이다. **조판 구조를 문법에 맞추려고 템플릿을 고친 곳은 없다** — G-2 를 "템플릿 재구성"(1판의 대안 2)이 아니라 "어휘 축 추가"(대안 1)로 푼 결과다.

---

## 4. 악성 픽스처 — P2 · 규약 G1 (어휘 커버리지 아님)

| 픽스처 | 섹션 안 불투명 노드 | moveElement | G1 | P2 |
|---|---|---|---|---|
| adv-01-comment-cdata.html | 42 | ✔ | ✔ | ✔ |
| adv-02-pre-whitespace.html | 44 | ✔ | ✔ | ✔ |
| adv-03-syntax-mix.html | 50 | ✔ | ✔ | ✔ |
| adv-04-unicode-control.html | 86 | ✔ | ✔ | ✔ |

1판과 동일하다. `adv-02` 가 잡았던 결함(parse5 가 `<pre>` 직후 개행을 노드로 만들지 않아 1바이트 소실)의 회귀 테스트도 그대로 초록불이다.

---

## 5. Axis B — 비게이팅 진단

테마 템플릿 10종 전부 `(1*)`✔ `(2)`✔ `(3)`✔ · 미매핑 노드 **0**.

주석 전 `fixtures/templates` 도 추정 분류에서는 전부 `(1*)`✔ 다 — `mapping` 이 넓어져 클래스 역방향 조회가 전 노드를 덮는다. 유일한 예외는 `fixtures/templates/progress.html` 의 `(2)`✘ 이고, 이유는 `data-value`/`--pct` 가 아직 없다는 것(주석 전 상태)이다. **정확히 `adoptSection` 이 할 일이 남아 있다는 표시**이며, 같은 파일의 테마 판(`themes/snu/templates/progress.html`)은 ✔ 다.

---

## 6. 하네스가 판정기임을 어떻게 보장하는가

게이트가 초록불이 된 지금은 **반대 방향**의 보장이 중요하다 — "무엇이든 통과시키는 판정기" 가 아님을 보여야 한다. 테스트 39개 중 다음이 그것을 지킨다.

- **위반 탐지 대조 (음성 대조군)** — `data-prop-desync` · 단위 붙은 데이터 채널 · 규칙 5 인라인 기하 · 열거 밖 `data-variant` · **열거 밖이거나 없는 `data-region`** · 섹션 안 `<script>` · 중복 `data-node-id` 를 각각 심어 넣고 잡히는지 본다. 동시에 `--pct` 가 규칙 5 를 발화시키지 **않음**을 확인한다.
- **G-2 전용** — `region` 이 두 축을 진다 · 같은 `region` 값이라도 슬롯이 다르면 다른 블록 종류다.
- **어휘 크기 고정** — 리프 21 · 컨테이너 8 · 불투명 리프 2. `mapping.json` 에 값을 늘리면 실패한다.
- **바이트 불변식** — 픽스처 15개 + 테마 템플릿 10개 전 섹션의 왕복 바이트 동일, `<pre>` 개행 보존, `<tbody>` 삽입 처리, 주석 바이트·개수·순서 보존, 유니코드 무정규화.
- **판정 상태 집합** — `pass`/`fail` 외의 값이 나오면 실패한다 (SKIP 금지).
- **파일 미변경** — 판정 전후 픽스처 sha256 동일.

---

## 7. 다음 마일스톤에 넘기는 것

| 항목 | 받는 곳 |
|---|---|
| **`M1 하네스 전 항목 초록불`** ← 이제 분모 10섹션에 대해 성립 | **M2 의 게이트** (§11 M2). M1 의 게이트는 판정 가능함이었고, 그것은 1판에서 이미 충족됐다 |
| `themes/snu/mapping.json` 을 하네스·adopt 가 **같은 파일로** 읽는다 (1판의 전사 2벌 문제 해소) | 완료. M5 에서 테마 계약 문서화 |
| G-3 잔여 — flex 래퍼의 인라인 조판 | M4a `design.token-escape` |
| `legacyEditableRatio` 0/13 | 비게이팅 기록. 어휘 v1.1(후속 과제 4) 논의 시 근거 |
| W31 13섹션 · 악성 4개의 `unannotated` | 분모 밖. 악성은 P2·G1 로만 판정된다 |
