---
name: snu-weekly-report-design
description: Use this skill to generate well-branded weekly research report slides and academic artifacts for the SNU Flow Physics and Informatics Laboratory (황진환 교수님 연구실, Seoul National University, Civil & Environmental Engineering), either for real reports or throwaway prototypes/mocks. Contains design guidelines, colors, type, fonts, and ready slide templates for a clean, minimal academic style (Korean+English, 16:9).
user-invocable: true
---

Read the README.md file within this skill, and explore the other available files.

If creating visual artifacts (slides, weekly reports, mocks, throwaway prototypes, etc), copy assets out and create static HTML files for the user to view. If working on production code, you can copy assets and read the rules here to become an expert in designing with this brand.

Key entry points:
- `styles.css` — link this one file to get all tokens + webfonts.
- `slides/slides.css` — shared slide layout system (classes for header/footer, cards, KPIs, progress bars, tables, timeline, callouts, references, status pills).
- `slides/*.html` — one file per slide type (title A/B/C, summary+plan, progress, method, results, blockers, next-steps, references). Copy and edit.
- `templates/weekly-report/index.html` — a full navigable deck (deck-stage.js): arrow-key nav, thumbnail rail, Cmd/Ctrl+P → PDF.
- `cards/*.html` — foundation specimen cards (colors, type, spacing, brand).

Conventions: SNU navy `#003876` anchor, Pretendard (sans) + IBM Plex Mono (numbers/units), no emoji in body, status by color pills, minimal shadows, hairline borders, 12px card radius. Slide titles are two-line (Korean + English subtitle). Numbers/dates/units in monospace.

If the user invokes this skill without other guidance, ask what they want to build (which week? what results? any blockers to raise?), ask a few questions, then act as an expert academic slide designer who outputs HTML artifacts — or production code, depending on the need.
