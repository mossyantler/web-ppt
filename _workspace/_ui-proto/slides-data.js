window.PROTO_SLIDES = [
`  <section class="slide" data-label="논문 개요" data-screen-label="논문 개요">
    <div class="slide-head"><div class="lab">Flow Physics &amp; Informatics Lab <span>· 건설환경도시공학부</span></div><div class="meta">W31 · 2026.07.27</div></div>
    <div class="title-block"><p class="kicker">Paper Review</p><h2 class="slide-title">논문 개요<span class="en">Jo et al. (2025), Impact of atmospheric forcing on storm surge prediction</span></h2></div>
    <div class="slide-body">
      <div class="paper-layout">
        <article class="paper-card">
          <div class="paper-title">Impact of atmospheric forcing on storm surge prediction between numerical weather model and parametric typhoon model</div>
          <div class="paper-author">Junbeom Jo, Sooyoul Kim, Masaya Toyada, Yu-Lin Tsai, Jungsoo Kim, Nobuhito Mori</div>
          <div class="paper-journal">Ocean Engineering (2025) · 대상 태풍 Hinnamnor (2022)</div>
        </article>
        <aside class="purpose-card">
          <div class="label">읽은 이유</div>
          <strong>대기 외력의 생성 방식이 폭풍해일 예측에 미치는 영향을 확인하기 위해.</strong>
          <p>지난주 추천해 주신 논문 두 편 중 한 편입니다.</p>
        </aside>
      </div>
      <div class="review-scope">
        <article class="scope-item"><div class="number">01</div><h3>대기 외력 생성 방법</h3><p>PTM과 WRF가 바람·기압장을 만드는 방식의 차이를 확인했습니다.</p></article>
        <article class="scope-item"><div class="number">02</div><h3>폭풍해일 지배방정식</h3><p>SuWAT이 사용하는 천수방정식의 외력 항을 확인했습니다.</p></article>
        <article class="scope-item"><div class="number">03</div><h3>예측 성능 비교</h3><p>세 setup과 경험식의 관측 대비 재현 성능을 확인했습니다.</p></article>
      </div>
    </div>
    <div class="slide-foot"><span>Weekly Report · 논문 개요</span><span class="page">03 / 13</span></div>
  </section>`,
`  <section class="slide" data-label="세 가지 실험 setup" data-screen-label="세 가지 실험 setup">
    <div class="slide-head"><div class="lab">Flow Physics &amp; Informatics Lab <span>· 건설환경도시공학부</span></div><div class="meta">W31 · 2026.07.27</div></div>
    <div class="title-block"><p class="kicker">Experimental Setups</p><h2 class="slide-title">세 가지 대기 외력 실험<span class="en">Three atmospheric forcing setups driving the same surge model</span></h2></div>
    <div class="slide-body">
      <div class="lead">같은 PTM이라도 태풍 자료가 달라지면 <span data-tex="R_{\\max}"></span>가 달라지고, 그 결과 강풍·저기압 영역의 크기가 달라집니다.</div>
      <div class="setup-grid">
        <article class="setup-item">
          <div class="tag">Setup 01</div>
          <h3>PTM–IBTrACS</h3>
          <p>데이터셋이 제공하는 <span data-tex="R_{\\max}"></span>를 그대로 사용합니다. 강풍이 태풍 중심 가까이에 좁게 집중됩니다.</p>
          <div class="metric">상륙 전후 <b>작은</b> <span data-tex="R_{\\max}"></span></div>
        </article>
        <article class="setup-item">
          <div class="tag">Setup 02</div>
          <h3>PTM–RSMC</h3>
          <p><span data-tex="17.5"></span> 및 <span data-tex="25.7\\,\\mathrm{m/s}"></span> 강풍반경의 장·단축 자료를 PTM이 재현하도록 맞춰 <span data-tex="R_{\\max}"></span>를 새로 추정합니다.</p>
          <div class="metric">상륙 시 <b>73.1 km</b> · <span data-tex="p_c=955\\,\\mathrm{hPa}"></span></div>
        </article>
        <article class="setup-item wrf">
          <div class="tag">Setup 03</div>
          <h3>WRF</h3>
          <p>NCEP FNL 자료를 초기·경계장으로 사용해 대기 물리과정을 직접 계산합니다. 눈벽과 외곽 구조가 나타납니다.</p>
          <div class="metric">4단계 nested · <b>1 km</b> 최내측</div>
        </article>
      </div>
      <div class="result-note">세 setup의 바람·기압장을 모두 SuWAT에 입력해 폭풍해일을 계산하고, 8개 관측소 자료와 비교했습니다. 폭풍해일 모형의 nested domain은 <span data-tex="18\\text{–}6\\text{–}2.9\\text{–}0.9\\,\\mathrm{km}"></span>입니다.</div>
    </div>
    <div class="slide-foot"><span>Weekly Report · 실험 setup</span><span class="page">07 / 13</span></div>
  </section>`
];
