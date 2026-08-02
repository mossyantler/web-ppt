# SPEC (AI context): onething skill refinement

status: SHIPPED — 12 decisions written into `~/.claude/skills/onething/SKILL.md` on 2026-08-02
source: `onething-skill-refine.md` (Korean human original — this file is derived from it, never the reverse)
goal: refine the `onething` skill to match the user's interaction style.
user profile: non-developer. Root problem = "outsourcing of code" — user loses track of what exists in own product.

## DECISIONS

D1 glossary-on-demand
- Gloss a term inline only on FIRST appearance. Never re-gloss automatically.
- Accumulate a glossary section at the bottom of the human spec.
- Re-explain a term only when the user explicitly asks.

D2 map + per-question location marker
- Before the question loop: show a ≤5-line "map" of the relevant structure as STEPS, not code.
  Invite questions about the map itself before proceeding.
- Every question header carries a one-line position marker (e.g. `📍 map step ②`).
- Supersedes any "never reveal investigation results" rule: structure IS the point, but rationed.

D3 seven-question checkpoints
- After every 7 answered questions, STOP and let the user choose: continue / pause / re-explain / revise.
- Never auto-continue past a checkpoint.

D4 delegation brake
- Track consecutive "you decide" answers. On the 3rd in a row, pause once: list the last 3 AI-made
  decisions (one line each), ask once whether the questions were too hard, then resume. No nagging.

D5 comprehension check at checkpoints only
- No per-question comprehension probing (feels like an exam).
- At each checkpoint ask once: "anything here you want re-explained?" Re-explain the picked item.

D6 revision cascade
- On revising an earlier decision: apply immediately, then find downstream questions whose premise broke
  and RE-ASK them one at a time (same one-question-per-turn rule).
- Record the change trail via `- **이력**:` lines. Never silently overwrite.

D7 two spec files per topic
- `docs/specs/<slug>.md` — Korean, plain language, FULL decision text (never summarized), glossary at bottom.
- `docs/specs/<slug>.ai.md` — English, compressed, machine-oriented (this file). For cross-session recovery.
- Cadence defined in D12.

D8 scope stops at planning
- onething covers planning/agreement only. Ends by naming the spec paths + asking "start implementing?".
- Implementation pacing is explicitly NOT decided by this skill.

D9 learning mode = separate skill
- "Learn existing code one piece at a time" is NOT part of onething. Split into its own future skill.
- Rationale: dialogue direction is inverted (AI explains a piece → user asks). Mixing would blur the rules.

D10 activation = propose, don't auto-start
- Never auto-enter. On a decision-heavy request (new feature, structural change, multi-file work),
  ASK ONCE "run this as onething, one at a time?" and WAIT.
- Explicit `/onething` starts immediately, no asking.

D11 precedence over automation skills
- While onething is active, NEVER fire autopilot / ultrawork / ralph / team on my own judgement,
  even if their keywords appear in conversation.
- EXCEPTION: an explicit user request to switch ends onething — save progress to the human spec first,
  then hand off.
- History: first agreed as hard block; user re-asked, revised to "block by default, user may switch".

D12 spec write cadence (token cost)
- HUMAN spec: written at checkpoints (every 7), on user pause, and on skill switch. NOT per decision.
- AI spec: written ONCE, after all questions close, by READING the finished human spec — not from
  conversation memory. Human file is the original; this file is the derivative.
- Exception: if the conversation grows long enough that early context may be compacted, save the human
  spec immediately instead of waiting for the checkpoint.
- On resume, read the HUMAN spec only — the AI spec may not exist yet.
- Cost: 24 file edits → 3 for a 12-decision session.
- History: (1) both files per decision → (2) AI file batched at checkpoints → (3) both batched, AI file
  generated once from the finished human file.
- Rejected: shrinking option counts per question — small savings, makes choosing harder, and the options
  are the core value of the skill.

## OPEN (deferred, separate topics)
- implementation-phase pacing rules
- name + rules for the code-learning skill (see D9)

## RESOLVED-BY-MERGE
- old "checkpoint interval" question absorbed into D3 (=7).
