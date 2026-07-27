[1] 연구 과제는 연구계획서(멀티모달 CNN-GRU-MLP 기반 폭풍해일 잔차수위 예측) 단계이며 이번 주는 자격·어학 준비와 이론 학습용 논문 리뷰를 병행했다.
[2] 한계·접목 지점 정리 중 — FNO 구현 확인은 미착수
[3] 연구계획서의 대리모델(surrogate) 개념 — 물리 수치모형을 데이터 기반 모델로 대체하는 근거를 이론 수준에서 이해
[4] 현 구조의 ERA5 2D field 처리부(CNN encoder)를 더 나은 연산자로 바꿀 수 있는지 검토
[5] ERA5 재분석 자료로 학습한 전역 기상 대리모델. 핵심 연산자가 AFNO(Adaptive Fourier Neural Operator) — Neural Operator 계열
[6] 같은 자료에서 검증된 계열이라면 기존 CNN 인코더보다 나은 결과를 낼 수 있지 않을까 — 가설 확인차 원 논문으로 거슬러 올라감
[7] 요약. 신경망을 유한차원 벡터 사이의 사상이 아니라 무한차원 함수공간 사이의 연산자를 학습하도록 일반화한 프레임워크. 선형 적분 연산자와 비선형 활성함수의 합성으로 구성되며 연속 연산자를 보편근사함을 증명한다. 커널을 Fourier 공간에서 매개화한 FNO가 대표 구현이며 Navier–Stokes 등에서 수치 솔버 대비 수 자릿수 빠른 추론을 보인다.
[8] 논문이 다루는 setting(정규 격자·풍부한 solver 학습자료·field 출력)과 본 연구의 setting(불규칙 연안·제한된 태풍 사례·관측소 지점 시계열 출력) 사이의 간극을 정리했다.
[9] FNO는 FFT 기반이라 정규 격자·주기 경계를 전제 — 복잡한 해안선에 그대로 적용하기 어렵다
[10] 고품질 solver 결과가 풍부한 상황을 가정. 태풍 사례가 적은 setting은 다루지 않는다
[11] 보편근사는 근사 능력의 존재만 말한다. 학습 분포 밖 극한 태풍의 외삽 성능은 별개
[12] 불확실성 정량화가 없어 peak 예측의 신뢰구간을 낼 수 없다
[13] Geo-FNO · GNO 등 좌표 변환/그래프 변형으로 연안 경계를 처리
[14] 논문은 field → field. 본 연구는 관측소 지점의 24h residual 시퀀스가 목표 — 연산자 출력을 station mask로 샘플링해 시계열 head에 넘기는 구조 필요
[15] FNO 과적합 위험. leave-one-typhoon-out 검증을 그대로 유지해 확인
[16] RMSE/MAE만으로는 부족. peak magnitude · timing error를 함께 봐야 개선 여부를 판단
[17] 연구계획서의 CNN-GRU-MLP에서 ERA5 2D field를 처리하는 CNN encoder만 Neural Operator(FNO/AFNO)로 치환. 나머지 branch와 fusion head는 유지한다.
[18] 태풍 중심이 관측소에서 멀 때의 원거리 forcing을 한 층에서 포착
[19] ERA5 0.25°로 학습 후 고해상도 격자에 재학습 없이 적용
[20] Earth-2 / FourCastNet이 동일 ERA5 자료에서 성능을 보인 연산자
[21] 연구계획서 표5에 FNO-GRU-MLP 행을 넣어 CNN encoder와 직접 대조
[22] 데이터가 적으면 FNO가 CNN보다 오히려 과적합할 수 있음
[23] 고정 사각 도메인은 FFT에 유리하나 육지/해양 마스크 처리 방식 확인 필요
[24] Neural Operator (JMLR 2023) 1차 정독 완료, 한계·접목 지점 정리 중
[25] CNN encoder → FNO/AFNO encoder 치환, 비교 실험에 한 행 추가
[26] 토목기사 실기 · TEPS 학습 진행 중
[27] Earth-2가 ERA5 위에서 쓴 Neural Operator를 같은 ERA5를 입력으로 쓰는 본 연구 폭풍해일 모델의 CNN encoder 자리에 넣어볼 만하다.
[28] 공개 구현체로 Navier–Stokes 예제 재현 — 해상도 불변성 실제 동작 확인
[29] AFNO가 ERA5 격자·마스크를 어떻게 처리하는지 확인
[30] 연구계획서 표5에 FNO-GRU-MLP 행 추가안 작성
[31] 연산자 학습 — 격자 위 벡터가 아닌 함수 → 함수 사상을 직접 학습. 입력 forcing field 전체를 하나의 함수로 취급
[32] 이산화 불변성 — 한 해상도로 학습해 다른 해상도에서 재학습 없이 추론. 격자에 종속되지 않음
[33] 전역 수용영역 — spectral convolution이 한 층에서 도메인 전역 상호작용을 포착 (CNN의 국소 커널과 대비)
[34] 보편근사 정리 — 연속 연산자를 임의 정밀도로 근사 가능함을 증명
[35] 추론 속도 — 학습 후에는 solver를 다시 돌리지 않고 forward pass 한 번으로 해를 근사
[36] 왜 이 논문을 읽는가 · NVIDIA Earth-2에서 출발
[37] 본 연구에 적용할 때 걸리는 지점
[38] 자격·어학 준비 · 논문 리뷰 진행 현황

<!-- HUMANIZE-SUMMARY v1.6.1
run_id: 2026-07-13-001
metrics:
  char_in: 1876
  char_out: 1860
  change_rate: 3.8%
  lines: 38 → 38 (1:1 대응 유지)
  max_line_growth: 0 (모든 줄 원문 이하 길이)
  self_check: 6/6
  grade: B
categories:  # before → after
  C-11 연결어미 뒤 쉼표(-며/-면/-나): 4 → 0
  A-1 "~에 대해": 1 → 0
  A-16/1인칭 복수 "우리": 1 → 0
  H-3 메타 진입 "이 가설을": 1 → 0
  D-1~D-7 결산 피벗·hype·결말 공식: 0 → 0
  C-5 이모지: 0 → 0
self_check:
  - 고유명사·수치·인용 100% 보존: OK (FNO/AFNO/ERA5/Earth-2/FourCastNet/JMLR 2023/0.25°/24h/표5/RMSE/MAE/leave-one-typhoon-out/station mask/residual 전부 원형)
  - 변경률 30% 이하: OK (3.8%)
  - 장르 이탈 없음: OK (개조식 슬라이드 카피 유지)
  - register 보존: OK (문어체·평서 종결, 겸양·수사 없음)
  - S1 잔존 0건: OK
  - 인공 표현 추가 없음: OK
  - 길이 제약: OK (38줄 모두 원문 길이 이하)
highlights:
  - id: C-11
    before: "[1] ... 단계이며, 이번 주는 ..."
    after: "[1] ... 단계이며 이번 주는 ..."
  - id: A-1 + C-11
    before: "[7] 합성으로 구성되며, 연속 연산자에 대해 보편근사가 됨을 증명한다."
    after: "[7] 합성으로 구성되며 연속 연산자를 보편근사함을 증명한다."
  - id: 1인칭 제거
    before: "[27] ... 우리 폭풍해일 모델의 CNN encoder 자리에 넣어볼 수 있다."
    after: "[27] ... 본 연구 폭풍해일 모델의 CNN encoder 자리에 넣어볼 만하다."
  - id: H-3
    before: "[6] ... 낼 수 있지 않을까 — 이 가설을 확인하려 원 논문으로 거슬러 올라감"
    after: "[6] ... 낼 수 있지 않을까 — 가설 확인차 원 논문으로 거슬러 올라감"
  - id: C-11
    before: "[23] 고정 사각 도메인은 FFT에 유리하나, 육지/해양 마스크 ..."
    after: "[23] 고정 사각 도메인은 FFT에 유리하나 육지/해양 마스크 ..."
residual_findings: 없음 (원문이 이미 개조식 슬라이드 카피라 AI 티 밀도 자체가 낮음. 길이 상한 제약으로 E-1 리듬 다양화는 의도적 미적용)
grade_reason: "B — S1 잔존 0건이나 길이 상한·1:1 줄 대응 제약으로 변경률이 3.8%에 그쳐 A 기준(10~25%) 미달. 원문 AI 티 밀도가 낮아 추가 윤문 여지 자체가 적음."
-->
