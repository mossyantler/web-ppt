# demo-annotated — 이름표가 붙은 시험용 덱

W31 리포트(`_workspace/2026-07-27-001/index.html`)를 adopt CLI 로 통과시켜 만든 사본이다.
원본은 그대로 있고, 이 덱만 `data-el`·`data-box`·`data-node-id` 를 갖는다.

```bash
node tools/adopt/index.js _workspace/2026-07-27-001/index.html \
  --out=_workspace/demo-annotated/index.html
```

**왜 두는가.** 편집기는 이름표가 붙은 덱에서만 요소를 고를 수 있는데(§4), 실제 리포트에는
아직 이름표가 없다. 이름표 붙이기를 화면에서 하는 일은 M3-9 이고, 그때까지 선택·편집을
사람이 확인할 수 있는 덱이 하나는 있어야 한다.

13 개 섹션 전부에 이름표가 붙었고, 그중 12 개에 어휘 밖 노드가 남아 있다
(`GET /deck/demo-annotated/outline` 의 `blockers`). 그 상태가 정상이다 —
**이름표가 있다는 것과 문법에 흠이 없다는 것은 다른 말**이고, 잠금 정책은 M3-9 이 정한다.

발표용 산출물이 아니다. 지워도 위 명령으로 다시 만든다.
