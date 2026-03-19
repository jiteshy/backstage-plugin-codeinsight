---
name: lead-review
description: Invoke the tech-lead-reviewer agent for an architectural review. Use when the user says /lead-review, is transitioning between build phases, or wants an ad-hoc check that everything aligns with the plan and architecture.
disable-model-invocation: true
---

## Current State
- Branch: !`git branch --show-current`
- Changed files since last commit: !`git diff --name-only HEAD`
- Recent commits: !`git log --oneline -10`

Use the `tech-lead-reviewer` agent to perform a comprehensive review with the following context:

**Review Scope**
If `$ARGUMENTS` is provided, treat it as the specific focus area (e.g. "Phase 1 complete", "CIG builder", "DB schema"). Otherwise, infer the scope from the recent commits and changed files above.

**What to evaluate**
1. **Plan alignment** — Does the work completed match the build plan for the current phase? Are acceptance criteria met?
2. **Architecture compliance** — Is the framework-agnostic core constraint respected? No `@backstage/*` imports in `core/` or `adapters/`. All I/O behind interfaces. Config injected via constructor.
3. **Key decisions adherence** — Are established decisions (CIG via Tree-sitter, unified `ci_artifacts` table, composite SHA, content-addressed LLM cache, pgvector, modular prompts) correctly implemented or planned?
4. **Gap detection** — What is missing, underspecified, or deferred that could become a problem in the next phase?
5. **Phase transition readiness** — Is this phase genuinely shippable? What must be resolved before moving on?

**Deliverable**
Produce a full tech lead review using the standard review format, ending with a clear verdict:
- **Green** — ready to proceed to next phase
- **Yellow** — proceed with noted caveats (list them)
- **Red** — stop, specific blockers must be resolved first (list them)
