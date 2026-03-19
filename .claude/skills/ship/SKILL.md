---
name: ship
description: Run the full review-test-commit workflow on recent changes. Use when the user says /ship or wants to review, test, and commit their work in one command.
disable-model-invocation: true
---

## Current State
- Branch: !`git branch --show-current`
- Changed files: !`git diff --name-only HEAD`
- Staged files: !`git diff --cached --name-only`

Run the following steps in sequence. Wait for each to complete before starting the next.

**Step 0 — Branch Check**
Check the current branch. If on `main` (or `master`), create a feature branch before proceeding. Derive the branch name from the work being committed (e.g., `feat/phase-1.2-backstage-scaffold`). If already on a non-main branch, stay on it and proceed.

**Step 1 — Lint**
Run the project's lint command (try `npm run lint`, `yarn lint`, or `pnpm lint` — use whichever matches the project's package manager). If lint errors are found, fix them automatically where safe (formatting, simple rule violations). For errors that require logic changes, fix them and note what was changed. Re-run lint after fixes to confirm it passes. Do not proceed to Step 2 until lint is clean.

**Step 2 — Code Review**
Use the `code-reviewer` agent to review all changed files listed above. The review should check for correctness, adherence to the framework-agnostic core constraint, Backstage best practices (for plugin-layer code), and alignment with the CodeInsight architecture.

**Step 3 — Unit Tests**
Use the `unit-test-writer` agent to write unit tests for any new or significantly changed code identified in Step 2. Skip files that already have adequate test coverage.

**Step 4 — Commit & Push**
Use the `git-commit-pusher` agent to stage and commit the changes (including any new test files from Step 3) with a proper conventional commit message. After committing, push the branch to the remote repository using `git push -u origin <branch-name>`.

**Step 5 — Update Build Plan**
Read `docs/build-plan.md` and mark any tasks that were completed in this commit as done by changing `- [ ]` to `- [x]`. Base this strictly on what was actually implemented — infer from the committed files and the code review output from Step 2. Do not mark tasks as complete speculatively. If an entire phase section is now fully checked off, add a `**✓ Complete**` note on the line after its heading. Commit this build-plan update as a separate commit with message `docs: update build-plan completion status`.

If lint in Step 1 cannot be fixed automatically, stop and report the errors to the user before proceeding.
If the code review in Step 2 finds critical issues, stop and report them to the user before proceeding to Steps 3, 4, and 5.
