# SNU — 브랜드 계약서

- 테마 이름: `snu`
- 상태: 쓰는 중
- 파생물: `tokens.css` (`node tools/design/index.js snu` 가 만든다. 손으로 고치지 않는다)

## 이 문서의 지위

**이것이 원본이다.** 색·글꼴·간격을 바꾸려면 여기를 고치고 다시 만든다. `tokens.css` 를 직접 고치면 다음에 다시 만들 때 사라진다.

이 문서가 정하지 **않는** 것이 하나 있다 — `mapping.json`. "어떤 클래스가 카드인가" 는 기계 계약이고 산문에서 나오지 않는다. 그것은 손으로 쓴다.

## 무엇을 보고 만들었나

서울대 네이비를 앵커로 삼는다. 주간 연구 보고는 발표 자료이면서 기록이므로, 화면에서 읽히고 인쇄해도 뭉개지지 않아야 한다. 그래서 **채도는 낮게, 대비는 높게** 간다. 강조색은 하나로 충분하고, 두 번째 색은 강조의 두 번째 층(표지 밑줄·머리말)에만 쓴다.

숫자와 단위는 본문 글꼴로 쓰면 자릿수가 흔들린다. 고정폭을 따로 둔 이유가 그것이다.

## 글꼴

| 토큰 | 값 | 설명 |
|---|---|---|
| `--font-sans` | `'Pretendard', 'Pretendard Variable', -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', sans-serif` | 본문·제목 |
| `--font-mono` | `'IBM Plex Mono', 'SFMono-Regular', 'D2Coding', ui-monospace, monospace` | 숫자·단위·날짜·코드 |

## 글자 크기

발표 대상 연배를 고려해 최소 크기를 올려 잡았다. 캡션 14 → 16, 머리말 13 → 14 는 실제 발표에서 안 읽힌다는 지적을 받고 올린 값이다.

| 토큰 | 값 | 설명 |
|---|---|---|
| `--text-hero` | `64px` | 표지 제목 |
| `--text-display` | `44px` | 슬라이드 제목 |
| `--text-title` | `30px` | 구역·블록 제목 |
| `--text-lead` | `22px` | 도입 문단 |
| `--text-body` | `19px` | 본문 |
| `--text-small` | `16px` | 보조 |
| `--text-caption` | `14px` | 캡션·각주 |
| `--text-kicker` | `13px` | 머리말 |
| `--text-metric` | `52px` | 큰 수치 (KPI) |

## 글자 굵기·행간·자간

| 토큰 | 값 | 설명 |
|---|---|---|
| `--weight-regular` | `400` | |
| `--weight-medium` | `500` | |
| `--weight-semibold` | `600` | |
| `--weight-bold` | `700` | |
| `--weight-extrabold` | `800` | 표지 제목 |
| `--leading-tight` | `1.12` | 큰 제목 |
| `--leading-snug` | `1.28` | 제목 |
| `--leading-normal` | `1.5` | 본문 |
| `--leading-relaxed` | `1.65` | 긴 문단·코드 |
| `--tracking-kicker` | `0.14em` | 머리말은 벌려 쓴다 |
| `--tracking-tight` | `-0.01em` | 큰 글자는 좁혀야 뭉치지 않는다 |
| `--tracking-normal` | `0` | |

## 색 — 브랜드

| 토큰 | 값 | 설명 |
|---|---|---|
| `--navy-900` | `#001b3a` | 가장 어두운 바탕 |
| `--navy-800` | `#002a5c` | 어두운 바탕 위 카드 |
| `--navy-700` | `#003876` | 브랜드 앵커 |
| `--navy-600` | `#0a4a8f` | |
| `--navy-500` | `#1f63ad` | |
| `--navy-400` | `#4d84c4` | |
| `--navy-300` | `#8bb0dc` | 어두운 바탕의 흐린 글자 |
| `--navy-200` | `#c2d8ee` | |
| `--navy-100` | `#e6eff8` | 연한 강조 배경 |
| `--navy-50` | `#f4f8fc` | |

## 색 — 중립

| 토큰 | 값 | 설명 |
|---|---|---|
| `--slate-900` | `#14181f` | 가장 진한 글자 |
| `--slate-800` | `#1f2530` | |
| `--slate-700` | `#333b48` | 본문 글자 |
| `--slate-600` | `#4b5563` | |
| `--slate-500` | `#6b7280` | 흐린 글자 |
| `--slate-400` | `#9aa3b0` | 더 흐린 글자 |
| `--slate-300` | `#c9cfd8` | 기본 선 |
| `--slate-200` | `#e2e6ec` | 옅은 선 |
| `--slate-100` | `#eef1f5` | |
| `--slate-50` | `#f7f8fa` | 옅은 바탕 |
| `--white` | `#ffffff` | |

## 색 — 상태

주간 보고의 상태 넷이다. 초록·주황·빨강은 진척, 청록은 정보다.

| 토큰 | 값 | 설명 |
|---|---|---|
| `--green` | `#1f8a5b` | 완료 · on track |
| `--green-soft` | `#e4f4ec` | |
| `--amber` | `#b5791a` | 진행 중 · at risk |
| `--amber-soft` | `#fbf1dc` | |
| `--red` | `#c0392b` | 블로커 · delayed |
| `--red-soft` | `#fbe7e4` | |
| `--teal` | `#0f7b8a` | 정보 |
| `--teal-soft` | `#e2f2f4` | |

## 색 — 역할

여기부터가 슬라이드가 실제로 읽는 이름이다. 위의 색표를 가리키기만 하므로, 팔레트를 갈면 역할이 따라온다.

| 토큰 | 값 | 설명 |
|---|---|---|
| `--text-strong` | `var(--slate-900)` | 제목 |
| `--text-default` | `var(--slate-700)` | 본문 |
| `--text-muted` | `var(--slate-500)` | 보조 |
| `--text-faint` | `var(--slate-400)` | 더 흐리게 |
| `--text-inverse` | `var(--white)` | 어두운 바탕 위 |
| `--text-accent` | `var(--navy-700)` | 강조 글자 |
| `--surface-page` | `var(--white)` | 슬라이드 바탕 |
| `--surface-subtle` | `var(--slate-50)` | 옅은 바탕 |
| `--surface-card` | `var(--white)` | 카드 바탕 |
| `--surface-accent` | `var(--navy-700)` | 강조 바탕 |
| `--surface-accent-soft` | `var(--navy-100)` | 연한 강조 바탕 |
| `--border-subtle` | `var(--slate-200)` | 옅은 선 |
| `--border-default` | `var(--slate-300)` | 기본 선 |
| `--border-accent` | `var(--navy-700)` | 강조 선 |
| `--accent` | `var(--navy-700)` | 강조 |
| `--accent-soft` | `var(--navy-100)` | 연한 강조 |
| `--accent-hover` | `var(--navy-800)` | 눌렀을 때 |

## 간격

4px 배수다. 눈으로 고르지 않고 배수로 고른다 — 그래야 슬라이드마다 여백이 같다.

| 토큰 | 값 | 설명 |
|---|---|---|
| `--space-1` | `4px` | |
| `--space-2` | `8px` | |
| `--space-3` | `12px` | |
| `--space-4` | `16px` | |
| `--space-6` | `24px` | |
| `--space-8` | `32px` | |
| `--space-10` | `40px` | |
| `--space-12` | `48px` | |
| `--space-5` | `20px` | |
| `--space-16` | `64px` | |
| `--space-20` | `80px` | |

## 슬라이드 판

발표는 1280×720 이다. 여백을 토큰으로 두는 이유 — 장마다 눈으로 맞추면 장마다 다르다.

| 토큰 | 값 | 설명 |
|---|---|---|
| `--slide-w` | `1280px` | |
| `--slide-h` | `720px` | |
| `--slide-pad-x` | `72px` | 좌우 여백 |
| `--slide-pad-y` | `56px` | 상하 여백 |

## 모서리·그림자

| 토큰 | 값 | 설명 |
|---|---|---|
| `--radius-xs` | `3px` | |
| `--radius-sm` | `5px` | |
| `--radius-md` | `8px` | |
| `--radius-lg` | `12px` | |
| `--radius-pill` | `999px` | 막대·알약 |
| `--shadow-card` | `0 2px 8px rgba(20, 24, 31, 0.07), 0 1px 2px rgba(20, 24, 31, 0.05)` | 카드 |
| `--border-hairline` | `1px solid var(--border-subtle)` | 머리·꼬리 구분선 |
| `--border-line` | `1px solid var(--border-default)` | 기본 선 |
| `--rule-accent` | `3px solid var(--accent)` | 표지 밑줄 |
| `--shadow-sm` | `0 1px 2px rgba(20, 24, 31, 0.06)` | |
| `--shadow-md` | `0 2px 8px rgba(20, 24, 31, 0.07), 0 1px 2px rgba(20, 24, 31, 0.05)` | |
| `--shadow-lg` | `0 8px 28px rgba(20, 24, 31, 0.10)` | |

## 움직임

발표 자료라 움직임은 최소다. 장 넘김 말고는 쓰지 않는다.

| 토큰 | 값 | 설명 |
|---|---|---|
| `--ease-standard` | `cubic-bezier(0.4, 0, 0.2, 1)` | |
| `--ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` | |
| `--dur-fast` | `140ms` | |
| `--dur-base` | `240ms` | |
