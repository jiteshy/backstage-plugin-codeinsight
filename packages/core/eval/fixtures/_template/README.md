# Fixture: <slug>

Steps to curate:

1. Pick a pinned commit SHA on the target repo. Paste into `repo.json`.
2. Clone locally, skim directory tree + README. Draft 3–6 overview bullets.
3. Identify 3–5 subsystems with at least one real file path each.
4. List external deps from package.json / go.mod / etc.
5. For diagrams: pick labels you expect to see in a C4-style system diagram. Entities for ER.
6. Write 10–15 QA pairs by reading real code. Each pair has at least one expected file.

DO NOT commit aspirational expectations — everything must be verifiable by reading the pinned repo.
