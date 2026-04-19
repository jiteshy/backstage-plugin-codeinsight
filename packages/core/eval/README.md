# @codeinsight/eval

Evaluation harness for CodeInsight. Scores doc, diagram, and QnA output against
a hand-curated gold set of repositories.

## Running

    pnpm eval:run                  # all gold repos, current pipeline
    pnpm eval:run -- --repo small  # single repo
    pnpm eval:baseline             # lock a baseline report
    pnpm eval:compare -- --baseline eval/reports/2026-04-19-baseline.json

## Adding a fixture

Copy `fixtures/_template/` to `fixtures/<new-slug>/` and fill in the JSON files.
Each fixture is pinned to a specific commit SHA for reproducibility.

See `docs/superpowers/specs/2026-04-19-codeinsight-v2-design.md` §5 for schemas.
