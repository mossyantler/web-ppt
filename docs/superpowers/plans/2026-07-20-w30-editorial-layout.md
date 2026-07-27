# W30 Editorial Layout Implementation Plan

> **For Codex:** Execute this plan with the `executing-plans` workflow and verify every completion claim with fresh evidence.

**Goal:** Keep every slide's wording, order, and document structure unchanged while replacing card-heavy components with a flatter editorial presentation layout.

**Architecture:** Make one CSS-only override pass inside the existing W30 deck source. Preserve the existing design tokens, 1280×720 stage, title/closing slides, and original PDF. Validate scope by hashing the HTML with the entire `<style>` block removed before and after the edit.

**Tech Stack:** Static HTML/CSS, existing `deck-stage` web component, Chrome headless PDF export, Poppler image/text inspection.

---

### Task 1: Lock the content boundary

**Files:**
- Verify: `_workspace/2026-07-20-001/index.html`

- [x] Record the SHA-256 hash of the HTML with the `<style>` block removed.
- [x] Confirm the deck has seven slides and save the pre-edit count.

### Task 2: Apply the editorial layout pass

**Files:**
- Modify: `_workspace/2026-07-20-001/index.html`

- [x] Add a clearly labeled CSS-only override block before `</style>`.
- [x] Flatten slide 2 activity cards into two ruled editorial columns.
- [x] Flatten slide 3 paper/purpose/scope cards into a split reading-note layout.
- [x] Flatten slide 4 equation cards into two ruled formula columns.
- [x] Restyle slide 5 as an academic table with minimal rules.
- [x] Restyle slide 6 as a metric-and-notes editorial split.
- [x] Leave slides 1 and 7 layout styles unchanged.

### Task 3: Verify scope and browser layout

**Files:**
- Verify: `_workspace/2026-07-20-001/index.html`
- Create: `_workspace/2026-07-20-001/qa/layout-only/`

- [x] Recompute the non-style HTML hash and require an exact match.
- [x] Render all seven slides at 1280×720.
- [x] Inspect all seven slide images for overflow, overlap, clipping, and unintended changes to slides 1 and 7.
- [x] Iterate on CSS only if any visual defect is found.

### Task 4: Export the layout-only PDF

**Files:**
- Create: `WeeklyReport_2026-07-20_W30_layout.pdf`

- [x] Export a new seven-page PDF without overwriting the existing PDF.
- [x] Verify page count and page dimensions against the original PDF; verify the current source wording in extracted text because the original PDF predates the approved content rewrite.
- [x] Inspect the PDF contact sheet as the final presentation surface.
