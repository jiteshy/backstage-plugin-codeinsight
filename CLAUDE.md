# CLAUDE.md

This file provides guidance to Claude Code when working in this repository. For full technical context read `docs/llm-context.md`. For the phase-by-phase task list see `docs/build-plan.md`.

## Commands

```bash
pnpm install                          # install all workspace deps
pnpm --filter <package> build         # build a specific package
pnpm --filter <package> test          # run tests for a package
pnpm --filter <package> test -- --testPathPattern=<file>  # run a single test file
pnpm lint                             # lint all packages
pnpm --filter <package> lint          # lint a specific package
pnpm db:migrate                       # run Knex migrations
```

## Git Commit Rules

- **No `Co-Authored-By` trailers** — never add `Co-Authored-By`, `Co-authored-by`, or any AI/Claude co-author attribution to commit messages.

## Hard Rules — Never Break These

1. **Zero `@backstage/*` imports in `core/` or `adapters/`** — if core needs something from Backstage, it must go through an interface defined in core.

2. **Config is always injected** — services receive config as constructor params. Never `process.env` or Backstage `ConfigReader` in core/adapters.

3. **All I/O behind interfaces** — LLM, embeddings, vector store, repo, storage, and job queue are TypeScript interfaces defined in core. Core never instantiates concrete adapters.

4. **HTTP handlers are thin** — route handlers only call a service method and serialize. Zero business logic in route files.

5. **No `tenant_id` in DB tables** — deployment is always self-hosted (one Postgres per deployment), so infrastructure isolation is sufficient.

## Custom Agents & Skills

Project-scoped agents in `.claude/agents/`:
- `unit-test-writer` — invoked after writing new code
- `code-reviewer` — invoked after completing a feature or phase
- `tech-lead-reviewer` — invoked at phase boundaries or for architecture review; Backstage expert
- `git-commit-pusher` — invoked when a logical chunk of work is ready to commit

Skills in `.claude/skills/`:
- `/ship` — lint → code review → write tests → commit in one command
- `/lead-review [focus]` — full tech lead review with Green/Yellow/Red phase-transition verdict
