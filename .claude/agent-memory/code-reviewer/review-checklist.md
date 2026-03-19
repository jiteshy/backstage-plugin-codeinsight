# Review Checklist - CodeInsight Specific

## Every Review
- [ ] Zero `@backstage/*` in `packages/core/` and `packages/adapters/` (grep check)
- [ ] All new data types include `tenantId: string`
- [ ] All interface methods that touch DB take `tenantId` as first param
- [ ] Config never read directly (no `process.env`, no `ConfigReader` in core)
- [ ] New DB-facing types match schema in `docs/llm-context.md`

## Phase-Specific
- Phase 1.3: Migrations must include `tenant_id` columns, PKs, FKs, indexes per schema
- Phase 1.6: CIG builder must use zero LLM calls (Tree-sitter only)
- Phase 2+: LLM cache key = `SHA256(prompt_file_sha + input_sha + model_name)`
- Phase 2+: Multi-file composite SHA = `SHA256(sorted "filepath:sha" pairs)`
- Phase 2+: Delta threshold at 40% must be checked
