# `adoptSection` 마이그레이터 코어 — M1 오프라인 CLI

> **지위** — 계획 승인 항목 5(a)의 산출물. `.omc/plans/html-slide-editor.md`(3판, APPROVED) §10.1이 규정한 **오프라인 개발 도구**다.
> **문법 기준** — `core/grammar.md`(문법 v1, M1-1 산출물). 이 도구와 문법이 어긋나면 문법이 이긴다.
> **선행** — M0뿐이다. M2(서버)·M4a(검증기)를 요구하지 않는다.

문법 밖 HTML 덱을 읽어 `data-el`/`data-box`/`data-node-id`가 부여된 덱을 낸다. **확정되지 않는 것은 부여하지 않고 보고한다.**

---

## 1. P3와의 관계 — 이것은 예외가 아니라 파이프라인 밖이다

계획의 P3는 **"명령 하나, 호출자 둘. 예외 없음"**이다. 사람 UI와 AI가 같은 봉투를 같은 엔드포인트로 보내고, 그 둘이 편집기의 전부라는 원칙이다. §3.6이 `reserveSections`에 대해 방어한 것도 이것이다 — 임의 HTML을 받는 엔드포인트를 만들지 않는다.

**이 CLI는 세 번째 호출자가 아니다.** 저자가 VS Code로 HTML을 직접 고치는 것이 P3 위반이 아닌 것과 같은 이유로, 일회성 개발 도구는 런타임 명령 표면 **밖**에 있다. 그 규정을 §10.1과 같은 수준으로 여기에 다시 적는 이유는 하나다 — **명시하지 않으면 사용자는 자기가 무엇을 승인했는지 모른다.**

| 항목 | 규정 | 이 구현에서의 대응 |
|---|---|---|
| **형태** | CLI. 서버·HTTP·명령 봉투를 타지 않는다 | `node tools/adopt/index.js <file>`. `http`·서버 모듈을 import하지 않는다 |
| **런타임 명령 등록** | 하지 않는다 | `/commit`·Command 타입·엔드포인트를 참조하지 않는다. M8의 `adoptSection` **명령**은 이 코어를 봉투로 감싼 별개의 산출물이다 |
| **입력 범위** | `fixtures/` 하위와 인자로 명시한 파일만. `_workspace/` 런타임 쓰기 경로가 아니다 | 인자로 준 경로 하나만 읽는다. 디렉터리 순회·글롭 확장을 하지 않는다 |
| **쓰기 방식** | `writeSpliced` 원시 함수를 공유한다. 세 번째 splice 구현을 만들지 않는다 | `splice.js`는 in-memory 문자열 치환 **연산** 하나뿐이고 정책(해시·히스토리·저장소)을 모른다. 파일 쓰기는 `index.js` 한 곳에만 있다. M2가 오면 그 한 줄이 `writeSpliced` 호출로 바뀐다 |
| **기본 동작** | dry-run. `--write` 없이는 파일을 바꾸지 않는다 | 기본은 diff 출력. `--out=PATH`면 **새 파일**, 원본 덮어쓰기는 `--write`가 있을 때만 |
| **결과 검수** | 사람이 diff를 읽고 승인한다 | 사람 판단 항목이 남으면 종료 코드 **3**. 자동 파이프라인이 "다 됐다"로 오해할 수 없다 |
| **M8과의 관계** | M8의 `adoptSection` 명령은 이 코어를 `/commit` 봉투로 감싼 것 | 어휘 매핑 휴리스틱(`mapping.js`)·id 발급(`ids.js`)·분류(`core.js`의 `classify`)는 한 벌뿐이다. 잠금 UX·미리보기 diff·undo는 M8에서 얹힌다 |

**여기까지가 예외의 전부다.** 더 넓히려는 시도 — 예컨대 "편의상 마이그레이터를 서버에서도 호출하자" — 는 **계획 개정 사항**이다.

**감시 지표(계획 §10.1).** M2 이후 CI가 `tools/adopt`에서 `writeSpliced` 외의 파일 쓰기 API 호출을 grep으로 검사한다. 그 표면을 좁혀 두기 위해 **`fs`를 import하는 파일은 `index.js` 하나뿐이다.** 코어·매핑·id·splice·report 다섯 모듈은 파일 시스템을 모른다. 다음 명령이 한 줄만 내놓아야 한다:

```
grep -rln "node:fs" tools/adopt --include='*.js' | grep -v '\.test\.js$'   # → tools/adopt/index.js (한 줄)
```

(테스트는 픽스처를 **읽기** 위해 `fs`를 쓴다. 감시 대상은 도구의 쓰기 경로이므로 테스트는 제외한다.)

**금지 목록 (이 도구가 하지 않는 것).** 런타임 명령 등록 · 서버 연동 · UI · `data-track-id` 부여 · 원본 자동 덮어쓰기 · 잠금 UX · 미리보기 diff 이상의 편집 제안.

---

## 2. 사용법

```bash
node tools/adopt/index.js <file> [옵션]
# 또는
npm run adopt -- <file> [옵션]
```

| 옵션 | 뜻 |
|---|---|
| *(없음)* | **dry-run.** diff와 사람 판단 목록만 출력하고 파일을 만들지 않는다 |
| `--section=N` | N번째 섹션만 주석한다 (1-based). 잠금 단위가 덱이 아니라 섹션이므로(§5) 도구도 섹션 단위로 돈다 |
| `--out=PATH` | 결과를 **새 파일**로 쓴다. 원본은 그대로다 |
| `--write` | **원본을 덮어쓴다.** 이 플래그가 있을 때만 원본이 바뀐다. `--out`과 함께 쓸 수 없다 |
| `--json` | 기계 판독용 리포트를 stdout으로 낸다 (부여 내역 + findings 전체) |
| `--report=PATH` | 같은 리포트를 파일로 쓴다 |
| `--info` | `info` 등급 항목(어휘에 걸리지 않는 잔여 클래스 등)도 보고에 포함한다 |
| `--context=N` | diff 컨텍스트 행 수 (기본 2) |

**종료 코드** — `0` 사람 판단 없음 · `3` 사람 판단 항목 있음 · `1` 실행 실패 · `2` 인자 오류.

예:

```bash
node tools/adopt/index.js fixtures/templates/progress.html                    # 미리보기
node tools/adopt/index.js fixtures/templates/progress.html --out=/tmp/p.html  # 새 파일
node tools/adopt/index.js fixtures/templates/progress.html --write            # 원본 갱신
node tools/adopt/index.js fixtures/legacy/w31-2026-07-27-001.html --json --section=3
```

---

## 3. 무엇을 자동으로 부여하는가

| 대상 | 부여 | 근거 |
|---|---|---|
| `<section class="slide…">` | `data-slide`, `data-variant`, `data-node-id`, (확정될 때만) `data-slide-kind` | §2.3 |
| 어휘 클래스가 **하나로** 걸리는 요소 | `data-el` 또는 `data-box` + `data-variant` + `data-node-id` | §2.1·§2.2의 SNU 클래스 열 |
| `data-box="region"` | `data-region` (`head｜body｜foot｜side｜main`) | §2.2 |
| `data-box="grid"` | `data-cols` (`.cols-2`→2, `.cols-3`→3) | §2.2 |
| `[data-tex]` | `data-el="equation"` | §3.2 런타임 렌더 리프 |
| `.prog-row` | `data-el="progress"`, `data-value`, `data-label`, `style="--pct:N"` + 스캐폴딩의 인라인 `width:N%` 제거 | §3.4 L4, 계획 §10.1 "`--pct` 치환" |
| `<html>` | `data-deck-grammar="v1"` | §5 문서 수준 전제 |

**부여하지 않는 것 (면제 ⓐⓑⓒ, §5 규칙 2·3)** — 허용 인라인 태그, 불투명 리프의 자식 서브트리(`.prog-track`/`.prog-fill`, KaTeX 렌더 결과), 선언된 구조 자식(`<li>`, `<tr>/<td>/<thead>/<tbody>`, `div.ic`/`div.cap`, `div.q`/`div.a`).

**`data-track-id`는 부여하지 않는다.** 문서 간 안정 id는 수명과 유일성 요구가 다른 별도 사양이고(§4.2), 값에 의미를 부여하는 주체는 사람이다. 도구가 그것을 만들어내면 추적이 조용히 무의미해진다.

### id 발급 (§4.1)

- 형식 `n<base36>`. 실행 시작 시 **소스 전체를 훑어** 사용 중인 `data-node-id` 집합을 먼저 만들고(`reference/estradeck/server/src/deck/splice.ts:125`의 `usedIds` 패턴), 그 집합과 충돌하지 않는 값만 내준다.
- **기존 id는 재발급하지 않는다.** 손편집으로 붙은 id를 존중한다.
- **서브트리 복제 시 재발급** — 문서에 중복 `data-node-id`가 있으면(`grammar.duplicate-id`) 뒤에 나온 서브트리의 id를 **전부** 재발급하고, 서브트리 **안**에서 id를 참조하는 `data-flow-after`를 매핑을 따라 갱신한다. 서브트리 밖을 가리키던 참조는 그대로 둔다. 어느 쪽이 원본인지는 문법이 알 수 없으므로 기본값은 선착순이고, **그 사실을 반드시 보고한다.**

---

## 4. 무엇을 보고하는가 — 추측하지 않는다

자동 부여가 불가능한 것은 **값을 만들어내지 않고** 목록으로 낸다. 각 항목은 `core/grammar.md` §5.2가 요구하는 다섯 필드를 갖춘다: `rule` · `code` · `location`(파일:라인:열 + 바이트 구간) · `subject`(원문 여는 태그, 정규화 없이) · `remedy`(**비어 있지 않다**).

| 코드 | 언제 | 왜 사람 판단인가 |
|---|---|---|
| `grammar.unknown-element` | 클래스가 어휘에 걸리지 않는 비인라인 요소 | 어떤 `data-el`로 매핑할지는 사람 판단이다(§5.2 "수정 후보 없음"의 닫힌 목록 4번째 범주) |
| `adopt.ambiguous-mapping` | 클래스가 어휘 값 **둘 이상**에 걸림 (예: `class="slide-body cols-2"` → `region`이면서 `grid`) | 한 요소는 `data-el`과 `data-box` 중 **정확히 하나**를 갖는다(§2). 도구가 고르면 그건 문법 결정을 도구가 하는 것이다 |
| `adopt.section-kind-undecided` | `data-slide-kind`가 클래스로 확정되지 않음 | 열거는 `title｜content｜break｜closing`인데 클래스는 `title`만 말해 준다 |
| `adopt.section-variant-unknown` | 섹션 조판 variant 판정 불가 | 테마 열거 밖이다 |
| `grammar.illegal-child` | `[data-tex]`에 소스 자식이 있음 / 리프 안의 선언되지 않은 비인라인 자식 | 자식이 저작물인지 렌더 산출물인지는 사람이 안다. **도구는 지우지 않는다** |
| `grammar.data-prop-desync` | `.prog-fill`의 폭과 `.pct` 표시 텍스트가 다름 | 어느 쪽이 사실인지는 사람이 확인한다 (도구는 폭을 채택하고 그 사실을 알린다) |
| `adopt.progress-value-unknown` | 인라인 `width:N%`를 읽을 수 없음 | `data-value`를 지어내지 않는다 |
| `grammar.duplicate-id` | 문서 안 `data-node-id` 중복 | 재발급은 했지만, 어느 쪽이 원본인지는 사람이 확인한다(§4.1) |
| `adopt.residual-class` (info) | 어휘에 걸리지 않는 클래스가 남음 | 그 클래스를 테마 `mapping.json`이 흡수할지는 M5의 판단이다. **`class` 속성은 건드리지 않는다** |

---

## 5. 보존 계약 — 재직렬화하지 않는다

이 도구의 모든 편집은 **여는 태그 안의 속성 삽입/치환**이다. 파서(`parse5`)는 **위치를 읽기 위해서만** 쓰고, 트리를 다시 직렬화해 파일을 만들지 않는다. 그래서:

- 편집 구간 밖 바이트가 **정의상 동일**하다 (P2).
- 주석·CDATA·`<pre>`의 공백·탭·행 말미 공백·유니코드 결합 시퀀스·대문자 태그·홑따옴표 속성·자기닫힘 표기가 전부 살아남는다 (규약 G1).
- `class` 속성을 다시 쓰지 않는다. 어휘 부여는 **덧붙이기**이지 재작성이 아니다.
- 편집 구간이 겹치면 조용히 뭉개지 않고 **예외를 던진다**(`splice.js`).

회귀 테스트가 이 계약을 직접 시험한다:

```bash
node --test tools/adopt/          # 또는 npm test
```

- 부여한 속성만 지우면 원문과 **바이트 동일**해야 한다 (템플릿 9종 + 악성 3종)
- 모든 편집은 여는 태그 **안**이고, 치환 대상은 `style`/`data-node-id`/`data-flow-after` 셋뿐이다 (전 픽스처 15종)
- 주석 안의 `data-el="text" data-node-id="nFAKE"` 같은 미끼 문자열이 그대로 남는다 (adv-01)
- 같은 문서를 두 번 돌려도 두 번째 실행은 문서를 바꾸지 않는다 (멱등)
- `data-track-id`가 어떤 픽스처에서도 나타나지 않는다

---

## 6. 모듈 구성

| 파일 | 책임 | `fs` |
|---|---|---|
| `index.js` | CLI 인자·파일 I/O·출력. **파일 시스템을 만지는 유일한 곳** | ✓ |
| `core.js` | 순회·분류·부여·보고. 입력은 문자열, 출력은 편집 목록 | ✗ |
| `mapping.js` | SNU 역매핑 표 (grammar.md §2.1·§2.2의 사본). M5의 `themes/snu/mapping.json`이 생기면 이 파일은 그것을 읽는 로더로 교체된다 | ✗ |
| `ids.js` | `data-node-id` 발급기 + 서브트리 재발급 | ✗ |
| `splice.js` | 편집 적용(문자열 치환) 한 함수. M2 `writeSpliced`와의 접합면 | ✗ |
| `report.js` | unified diff + §5.2 다섯 필드 렌더링 | ✗ |
| `adopt.test.js` | 회귀 테스트 (픽스처 15종) | ✓(읽기) |

---

## 7. 알려진 한계 (정직하게 적는다)

- **`mapping.json`이 아직 없다.** 매핑 값을 `mapping.js`가 들고 있다. 문법 §2.4는 값의 소유권이 테마에 있다고 정하므로, M5에서 반드시 옮겨야 한다. 옮기지 않으면 두 번째 테마에서 이 도구가 틀린 답을 낸다.
- **`.slide-body cols-2`처럼 region과 layout을 한 요소에 겹쳐 쓴 실측 관행은 자동으로 풀리지 않는다.** 도구는 모호로 보고하고 멈춘다. 이것은 도구의 결함이 아니라 코퍼스가 문법의 "한 요소 = 값 하나"와 어긋나는 지점이며, 해소는 커버리지 게이트(§11 M1) 작업에 속한다.
- **`data-slide-kind`는 대부분 사람이 고른다.** 클래스가 `title`만 알려주기 때문이다.
- **`row`·`code`·`caption`(figure 밖) 같은 어휘 값은 실측 코퍼스에 대응 클래스가 없어 역매핑 항목이 비어 있다.** 그런 값이 필요한 문서를 만나면 `grammar.unknown-element`로 보고된다 — 조용히 다른 값으로 밀어 넣지 않는다.
