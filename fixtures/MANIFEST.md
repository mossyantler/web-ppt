# 픽스처 코퍼스 MANIFEST — M1-2

단일 진실 원천 `.omc/plans/html-slide-editor.md` (3판, APPROVED) — §6.6 픽스처 표, §11 M1 수용 기준·커버리지 게이트.

**총 15개**[f1] = 템플릿 10 + 레거시 1 + 악성 4.
**게이트 분모는 템플릿 10개 섹션뿐이다.** 레거시(W31)와 악성 4개는 하네스가 돌지만 커버리지 게이트의 분모가 아니다(§6.6 "픽스처 코퍼스 ≠ 커버리지 분모").

> **실측 규율.** 이 문서의 모든 수치에는 각주로 재현 명령이 달려 있다. 명령 없는 숫자는 쓰지 않는다. 명령은 모두 repo 루트에서 실행한다.

---

## 1. 템플릿 (10) — 어휘의 시험 대상 · 게이트 분모 **포함**

`slides/*.html`를 **바이트 동일하게 복사**한 것이다[f2]. 원본은 수정하지 않았다.
커버리지 게이트 기준은 **10/10 = 100%**이고, 분자는 섹션마다 (1) `adoptSection` 없이 문법 v1 통과 (2) 각 리프의 텍스트 편집·순서 이동 성공 + 편집 구간 밖 바이트 동일 (3) 섹션에 나타나는 각 블록 종류마다 `insertElement`로 같은 종류 추가 가능 — 셋 전부다(§11 M1).

| 파일 | 섹션[f3] | 줄[f4] | 바이트[f4] | 분모 | 이 픽스처가 시험하는 것 |
|---|---|---|---|---|---|
| `templates/blockers.html` | 1 | 51 | 2698 | ✓ | `callout`·`pill`·`list.check` 어휘. 위험/차단 항목의 상태 뱃지 variant |
| `templates/method.html` | 1 | 47 | 2108 | ✓ | `region` 5:7 분할(`.cols-5-7`), `table` 리프, **`<tbody>` 없는 표 1개**[f5] → 라이브 DOM 직렬화 금지 근거(결정 Z2). `.card-head`의 인라인 `style="font-size:var(--text-lead)"` → `design.token-escape` 판정 경계 |
| `templates/next-steps.html` | 1 | 43 | 2479 | ✓ | `sequence`(=`.timeline`) 컨테이너 + `step`(=`.tl-item`) 리프. 2판 어휘에 대응 값이 없던 패턴 |
| `templates/progress.html` | 1 | 39 | 2689 | ✓ | **불투명 리프 `progress` 5개**[f6]와 데이터 채널(§2.1 L2~L4). `.prog-track`/`.prog-fill` 스캐폴딩 바이트 보존, `style="width:N%"` → `--pct` 치환. §11 M3의 대표 수용 기준 |
| `templates/references.html` | 1 | 32 | 2240 | ✓ | `citation` 리프 + `sequence` variant `refs`. 리프 **안**의 인라인 클래스 `.cite`/`.title`/`.src` 보존(§8.6 `inlineClasses`, F-5ⓒ) |
| `templates/results.html` | 1 | 49 | 2376 | ✓ | `figure`·`caption`·`metric` 리프, `grid` 컨테이너 |
| `templates/summary-plan.html` | 1 | 41 | 2000 | ✓ | `heading`·`text`·`list` 기본 어휘의 최소 조합 |
| `templates/title-a.html` | 1 | 23 | 1114 | ✓ | 섹션 variant `title`, `hero`·`meta`·`rule` 리프 |
| `templates/title-b.html` | 1 | 23 | 1127 | ✓ | 같은 `title` 종류의 두 번째 조판 — variant가 새 어휘 값이 아님을 확인(§2.1 L5) |
| `templates/title-c.html` | 1 | 42 | 2045 | ✓ | 섹션 variant `split` + `region` 열거 확장(`side`/`main`), `brand` → `meta` 매핑 |

템플릿 10종 합계 섹션 수 **10** = 게이트 분모.

---

## 2. 레거시 (1) — `legacyEditableRatio` 기록용 · 게이트 분모 **제외**

| 파일 | 섹션[f3] | 줄[f4] | 바이트[f4] | 분모 | 이 픽스처가 시험하는 것 |
|---|---|---|---|---|---|
| `legacy/w31-2026-07-27-001.html` | **13** | 1211 | 46427 | ✗ | 실제 산출 덱. 문법 이전에 생성된 레거시. **비게이팅 지표 `legacyEditableRatio`(13섹션 중 문법 v1 통과 비율, 현재 실측 0/13)의 측정 대상.** `data-tex` **53곳**[f7] → 런타임 렌더 리프(KaTeX)의 자식 교체. 덱 로컬 셀렉터 → `setTheme` 부분 적용 보고(§11 M5) |

**출처와 상태.** `_workspace/2026-07-27-001/index.html`의 **작업 트리 현재 상태**를 복사했다. 원본은 이 작업 착수 시점에 이미 커밋되지 않은 수정(12+/12−)을 갖고 있었고[f8], 그 상태를 그대로 떠 왔다. 사본과 원본의 sha256이 동일하다[f9].
W31 패턴(`flow-step`·`symbol-row`·`equation-row`·`equation-box`·`study-paper`·`result-note`·`setup-item`·`data-table`)의 어휘 편입은 **어휘 v1의 범위 밖**이며 후속 과제 4(어휘 v1.1)다(§2.1 "어휘 v1의 범위", 승인 항목 3).

---

## 3. 악성 (4) — P2·규약 G1의 시험 대상 · 게이트 분모 **제외**

> **이 4개는 어휘의 시험 대상이 아니다.** 정의상 문법 밖 노드를 일부러 담고 있으므로, 커버리지 분모에 넣으면 영구히 감점된다(§6.6). 시험하는 것은 **P2(편집 구간 밖 바이트 보존)**와 **규약 G1(어휘 밖 노드의 불투명 보존)**이다.
>
> 악성 노드는 전부 `<section>` **안**에 있다. 섹션 밖에 두면 A3의 구조 명령(슬라이드 전체 재직렬화)이 그 구간을 지나가지 않아 G1이 시험되지 않는다(§2.0). 하네스는 각 픽스처에 `moveElement`를 걸고 그 노드들의 바이트 동일성을 본다(§6.6 단계 2b).

| 파일 | 섹션[f3] | 줄[f4] | 바이트[f4] | 분모 | 이 픽스처가 시험하는 것 |
|---|---|---|---|---|---|
| `adversarial/adv-01-comment-cdata.html` | 1 | 40 | 1965 | ✗ | 섹션 안 1행·다행 주석, 형제 사이에 끼인 주석, 태그·속성처럼 보이는 문자열을 담은 주석, `<![CDATA[...]]>`(HTML 파서는 bogus comment로 처리), 조건부 주석. **주석의 위치와 바이트가 재직렬화 후에도 보존되는가** |
| `adversarial/adv-02-pre-whitespace.html` | 1 | 52 | 1710 | ✗ | `<pre>` 안 유의미한 공백 — 여는 태그 직후 개행(파서가 버리지만 소스에는 있음), 스페이스 4/8개, **탭 문자**, 탭·스페이스 혼합 행, **행 말미 스페이스 3개**[f10], 닫는 태그 앞 개행 없음, 선행 빈 줄 2개. 더해서 `<tbody>` 없는 표. **재들여쓰기·공백 축약이 일어나면 실패** |
| `adversarial/adv-03-syntax-mix.html` | 1 | 47 | 1960 | ✗ | 대문자 태그·대문자 속성명(`<SECTION>`, `<DIV CLASS=>`), **홑따옴표 속성**, 따옴표 없는 속성, 자기닫힘 표기 4종(`<br/>`·`<HR />`·`<hr>`·`<img ... />`), 인용부호 중첩(홑 안의 쌍, 쌍 안의 `&apos;`), 엔티티 혼용, 대문자 표 + 소문자 행 혼재. **속성 재인용·태그명 소문자화·`/` 소거가 일어나면 실패** |
| `adversarial/adv-04-unicode-control.html` | 1 | 68 | 3514 | ✗ | 이모지 결합 시퀀스(ZWJ 가족·피부색 수정자·변이 선택자·국기·키캡)와 서로게이트 쌍, 보이지 않는 서식 문자(U+200B·200C·200D·2060·00AD·00A0·202F·FEFF)와 텍스트 노드 안 탭, **정규화 함정**(한글 NFC/NFD 쌍, `é` 결합 분음, 반각·전각, 호환 문자), 양방향 텍스트(아랍어 + U+202B/202C, U+2066/2069), 리터럴 vs 수치 vs 16진 문자 참조. **NFC 정규화나 이스케이프 재작성이 일어나면 실패**[f11] |

**§6.6 표와의 대응.** 계획 §6.6은 악성 4개를 ①주석+CDATA ②유니코드+중첩 인용부호 ③`<pre>` 공백+자기닫힘 혼용 ④`<tbody>` 없는 표+대문자 태그로 묶었다. 이 코퍼스는 묶음만 다르게 갈랐고(①→adv-01, ③의 공백→adv-02, ③의 자기닫힘+④→adv-03, ②→adv-04), **§6.6이 열거한 특질은 하나도 빠지지 않았다** — 중첩 인용부호는 adv-03, `<tbody>` 없는 표는 adv-02와 adv-03 양쪽에 들어 있다.

**의도적으로 넣지 않은 것 둘.**
- **NUL(U+0000)과 U+0001–U+0008.** HTML 파서가 U+FFFD로 치환하거나 파싱 오류를 낸다. 넣으면 이 픽스처의 시험 대상(바이트 보존)이 파싱 오류 처리 시험과 뒤섞인다. 서식 문자(Cf)와 탭만 쓴다.
- **주석 안의 연속 하이픈(`--`).** 같은 이유다. `<!-- -- -->`는 파서 오류이므로 보존 시험이 오류 복구 시험이 된다.
  둘 다 별도 픽스처가 필요하다면 어휘가 아니라 **파서 오류 복구** 항목으로 세워야 한다 — 이 코퍼스의 범위 밖이다.

---

## 4. 하네스가 각 그룹에 대해 산출해야 하는 판정

§11 M1: **미구현 항목은 SKIP이 아니라 FAIL이다.** 판정 가능함이 게이트이고, 초록불은 M2의 게이트다.

| 그룹 | 하네스 단계(§6.6) | 게이트 |
|---|---|---|
| 템플릿 10 | 1(편집 구간 밖 불변식) · 2(저작 트리 왕복) · 3(undo 왕복) + §11 M1 분자 (1)(2)(3) | **커버리지 100%** |
| 레거시 1 | 1 · 2 · 3 | 없음. `legacyEditableRatio` 기록만 |
| 악성 4 | 1 · **2b(어휘 밖 노드 보존)** · 3 | P2·G1 불변식. 어휘 커버리지 아님 |

---

## 각주 — 재현 명령

| 각주 | 명령 | 값 |
|---|---|---|
| **[f1]** | `find fixtures -name '*.html' \| wc -l` | 15 |
| **[f2]** | `for f in blockers method next-steps progress references results summary-plan title-a title-b title-c; do cmp slides/$f.html fixtures/templates/$f.html \|\| echo DIFF $f; done` | 출력 없음 = 전부 바이트 동일 |
| **[f3]** | `for f in fixtures/**/*.html; do printf '%s %s\n' "$(grep -oci '<section' $f)" "$f"; done` (zsh) | 템플릿 각 1, W31 13, 악성 각 1 |
| **[f4]** | `for f in fixtures/templates/*.html fixtures/legacy/*.html fixtures/adversarial/*.html; do printf '%s\t%s\t%s\n' "$f" "$(wc -l <$f)" "$(wc -c <$f)"; done` | 위 표의 줄·바이트 |
| **[f5]** | `grep -c '<table' fixtures/templates/method.html; grep -c '<tbody' fixtures/templates/method.html` | table 1 / tbody 0 |
| **[f6]** | `grep -o 'prog-row' fixtures/templates/progress.html \| wc -l` · `grep -o 'style="width:[0-9]*%"' fixtures/templates/progress.html \| wc -l` | 5 · 5 |
| **[f7]** | `grep -o 'data-tex="' fixtures/legacy/w31-2026-07-27-001.html \| wc -l` | 53 |
| **[f8]** | `git diff --stat _workspace/2026-07-27-001/index.html` | `12 insertions(+), 12 deletions(-)` (M1-2 착수 전부터 있던 미커밋 수정) |
| **[f9]** | `shasum -a 256 _workspace/2026-07-27-001/index.html fixtures/legacy/w31-2026-07-27-001.html` | 두 해시 동일 (`4021bbdd…f813ff`) |
| **[f10]** | `grep -n ' $' fixtures/adversarial/adv-02-pre-whitespace.html` | 1행 (`pre` 안 행 말미 스페이스) |
| **[f11]** | `python3 -c "import unicodedata as u,sys; s=open('fixtures/adversarial/adv-04-unicode-control.html',encoding='utf-8').read(); print('NFC-differs:', s!=u.normalize('NFC',s)); print({n:s.count(c) for c,n in {chr(0x200B):'ZWSP',chr(0x200C):'ZWNJ',chr(0x200D):'ZWJ',chr(0x2060):'WJ',chr(0xAD):'SHY',chr(0xA0):'NBSP',chr(0x202F):'NNBSP',chr(0xFEFF):'FEFF',chr(0xFE0F):'VS16',chr(0x1100):'JAMO',chr(0x301):'COMB'}.items()})"` | `NFC-differs: True` · ZWSP 1 · ZWNJ 1 · ZWJ 4 · WJ 1 · SHY 2 · NBSP 1 · NNBSP 1 · FEFF 1 · VS16 6 · JAMO 1 · COMB 1 |

**미조사로 남긴 것.** 템플릿 각 섹션의 블록 종류 수(§11 M1 분자 (3)의 분모)는 세지 않았다 — `mapping.json`의 `(값, variant)` 쌍이 아직 없어서 "블록 종류"의 경계가 확정되지 않았다. M1의 어휘 확정과 함께 이 MANIFEST에 열을 추가한다.
