## Summary

<!-- Smallest visual that makes the point: pseudocode, call tree, file tree, Mermaid or diff. -->

## Evidence

<!-- dbq is a CLI with no frontend: evidence is a test run or command output, not a screenshot. -->

- **Before:** <!-- failing test or command output, with its exit code -->
  **After:** <!-- passing test or command output, with its exit code -->

<!-- If a guard changed, show the query that is now refused (exit 3 before any connection) or now allowed. -->

## Merge Danger

**Door:** <!-- one-way or two-way -->

**Blast Radius:** <!-- one word -->

<!-- Optional: ramifications, e.g. changed exit codes or error `code`s, TOON output shape, new accepted query forms. -->

## Checklist

- [ ] `dbq` still never writes: no flag, env var or config field unlocks writes.
- [ ] Guard changes have a passing-corpus test and an adversarial test in `tests/guards/`; none skipped.
- [ ] No raw user string reaches `src/engines/`; engines get a validated query plan.
- [ ] `pnpm typecheck` and `pnpm test` pass.
- [ ] A changed design decision has a dated revision in `docs/specs/`.
