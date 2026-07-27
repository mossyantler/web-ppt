# SNU Weekly Report — 디자인 시스템

서울대학교 건설환경도시공학부 **Flow Physics and Informatics Laboratory** (황진환 교수님 연구실)의 학부연구생이 매주 교수님께
드리는 **위클리 리서치 리포트(주간 연구 진행 보고)** 슬라이드를 빠르고 일관되게
만들기 위한 디자인 시스템입니다. 깔끔한 학술풍(미니멀·차분), 한국어+영어 혼용,
16:9 와이드 슬라이드를 기준으로 합니다.

> **제공된 소스:** 별도의 코드베이스·Figma·브랜드 가이드는 제공되지 않았습니다.
> 이 시스템은 요구사항(랩 위클리 리포트, 학술풍, SNU 네이비, 한/영 혼용)을 바탕으로
> from-scratch로 구성했습니다. 공식 로고·CI 파일이 있으면 반영해 드립니다.

---

## CONTENT FUNDAMENTALS — 카피 작성 원칙

- **언어:** 한국어를 기본으로, 학술 용어·고유명사·수치는 영어/원어 병기.
  제목은 `한글 주제 + English subtitle` 2단 구성 (예: "전체 진행 상황 / Overall progress").
- **인칭·어투:** 보고 대상은 교수님. 문어체·개조식(`~함`, `~완료`, `~검토 필요`)을 기본으로,
  본문 설명은 간결한 평서체(`~한다` / `~합니다`) 혼용. 1인칭 "저는"은 쓰지 않고 행위 중심으로 서술.
- **케이싱:** 영어 라벨(kicker)은 대문자+자간(`PROGRESS`, `NEXT STEPS`). 한글은 그대로.
- **톤:** 과장·마케팅 표현 없음. 사실·수치·근거 중심. "대박", 느낌표 남발 금지.
- **수치 표기:** 단위 병기(`112 mm`, `85 kPa`, `±6%`), 주차는 `W28`, 날짜는 `2026.07.13`.
  숫자·단위·날짜는 모노스페이스(IBM Plex Mono)로 조판해 스캔성을 높인다.
- **이모지:** 사용하지 않음. 상태는 색 pill(완료/진행 중/블로커/논의)로 표현.
  단, 데이터가 아직 없는 figure 자리표시자에는 `▦`, `📈` 같은 안내용 글리프를 임시로 둘 수 있음(실제 이미지로 교체).
- **예시 카피:** "지반 시료 3종 압밀시험 완료", "PLAXIS 2D 해석 모델 구축", "계측–해석 오차 ±6% 이내로 재현".

---

## VISUAL FOUNDATIONS — 비주얼 원칙

- **색:** 브랜드 앵커는 **SNU 네이비 `#003876` (`--navy-700`)**. 중립은 slate 스케일.
  상태색 4종(green=완료, amber=진행, red=블로커, teal=정보)만 절제해서 사용.
- **배경:** 기본 흰색(`--surface-page`). 표지 B는 네이비 풀블리드 1종만 허용.
  그라디언트·텍스처·이미지 배경은 쓰지 않음(학술풍 유지). 데이터 이미지·그래프는 흰 카드/피규어 영역 안에.
- **타이포:** 본문·제목 **Pretendard**(sans), 수치·단위·날짜 **IBM Plex Mono**.
  표지 Hero 64→56px ExtraBold, 슬라이드 제목 44px Bold, 본문 19px Regular, 캡션 14px.
- **레이아웃:** 1280×720 캔버스, 좌우 72px·상하 56px 여백. 상단 헤더(연구실명 + 주차/날짜)와
  하단 푸터(리포트명 + 페이지)가 모든 콘텐츠 슬라이드에 고정. 2단·3단·5:7 그리드를 `gap` 기반으로 구성.
- **카드:** 흰 배경 + 1px hairline 보더(`--slate-200`) + 아주 옅은 `--shadow-sm`.
  라운딩은 `--radius-lg (12px)`. subtle 변형은 `--slate-50` 배경 + 보더 없이.
- **보더/룰:** 헤더 하단 hairline, 제목 하단 accent 3px 룰, callout 좌측 3px accent 룰.
- **코너 라디우스:** pill=999px, 카드=12px, 작은 요소=5–8px, 태그=3px.
- **그림자:** 3단(sm/md/lg). 슬라이드에서는 sm만 주로 사용 — 무게감보다 평면적·차분함 우선.
- **애니메이션:** 정적 문서가 기본. deck 네비게이션은 기본 페이드/즉시 전환. 바운스·무한 루프 없음.
  전환은 `--ease-out`, 140–240ms. 인쇄/PDF에서 애니메이션 없이 최종 상태가 보이도록 설계.
- **hover/press:** (인터랙티브 요소 한정) hover는 accent → `--accent-hover(navy-800)` 어둡게,
  press는 색만 진하게(스케일 변형 없음). 링크는 accent 색, hover 시 navy-800.
- **투명도·블러:** 사용하지 않음. 반투명 오버레이·글래스 효과 없음(학술 문서 톤).
- **상태 표현:** 진척은 progress 바(색으로 완료/진행/블로커), 상태는 pill, 논의는 callout.

---

## ICONOGRAPHY — 아이콘 원칙

- **현재 방침:** 아이콘 세트 의존도를 낮춘 **타이포·색·형태 중심** 시스템입니다.
  상태는 pill의 색점(●)과 색으로, 리스트 불릿은 CSS(사각 점 / `✓` 체크)로 표현합니다.
- **SVG/PNG 아이콘:** 제공된 소스에 아이콘 자산이 없어 임의로 그리지 않았습니다.
  아이콘이 필요하면 **Lucide**(https://lucide.dev, 1.5px 스트로크·라운드) 계열이 이 시스템의
  얇은 hairline·차분한 톤과 잘 맞습니다. 필요 시 CDN 링크로 도입하고 여기에 문서화하세요.
- **글리프 자리표시자:** 그래프·모델 이미지가 아직 없는 figure 영역에 `▦`, `📈` 유니코드
  글리프를 임시 안내로 둡니다 — **실제 그래프/이미지로 교체**가 전제입니다.
- **이모지:** 콘텐츠 본문에는 사용하지 않습니다.
- **로고:** 공식 로고 파일 미제공. 마크 자리에는 텍스트 워드마크("Flow Physics and Informatics Laboratory · 건설환경도시공학부")를
  사용합니다. 로고를 그리거나 재구성하지 않습니다 — 파일을 주시면 교체합니다.

---

## INDEX — 파일 안내 (매니페스트)

**루트**
- `styles.css` — 전역 진입점(@import만). 소비자는 이 파일 하나만 링크.
- `readme.md` — 본 문서. `SKILL.md` — 에이전트 스킬 정의.

**tokens/** — CSS 커스텀 프로퍼티
- `colors.css` · `typography.css` · `spacing.css` · `effects.css` · `fonts.css`(webfont @import)

**cards/** — 파운데이션 스펙 카드 (Design System 탭)
- Colors: `colors-primary` · `colors-neutral` · `colors-semantic`
- Type: `type-display` · `type-body` · `type-mono`
- Spacing: `spacing` · Brand: `status` · `wordmark`

**slides/** — 슬라이드 타입별 템플릿 (개별 HTML, 편집·인쇄 가능)
- 표지 3안: `title-a`(라이트) · `title-b`(네이비) · `title-c`(사이드바)
- `summary-plan` · `progress` · `method` · `results` · `blockers` · `next-steps` · `references`
- `slides.css` — 슬라이드 공용 레이아웃 시스템

**templates/weekly-report/**
- `index.html` — **매주 사용하는 전체 네비게이션 덱** (←/→ 이동, 썸네일 레일, Cmd+P로 PDF 저장)
- `deck-stage.js` — 덱 구동 컴포넌트

### 사용법
1. `templates/weekly-report/index.html`을 열어 텍스트를 이번 주 내용으로 수정.
2. figure 영역에 그래프/모델 이미지 삽입.
3. 발표는 브라우저 전체화면, 배포는 Cmd/Ctrl+P → PDF로 저장.
4. 표지 스타일은 `slides/title-a|b|c.html`에서 원하는 안을 골라 첫 슬라이드에 반영.

### CAVEATS
- **폰트 대체:** Pretendard·IBM Plex Mono를 CDN에서 로드합니다(바이너리 미포함). 랩 지정 폰트가 있으면 교체하세요.
- **로고 없음:** 텍스트 워드마크로 대체. 공식 로고 파일 필요.
- **예시 콘텐츠:** 지반공학(연약지반 압밀) 가정으로 채운 더미 데이터입니다. 실제 연구 주제로 교체하세요.
