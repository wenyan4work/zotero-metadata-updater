# Manual publisher refresh implementation

Target: Zotero 10.0.1. Manual item context-menu command only; DOI first, URL
fallback, publisher metadata only, immediate non-empty bibliographic/abstract
updates preserving item identity and user-managed data. No type conversion.

## Ownership and dependencies

- Integration branch: `codex/manual-publisher-refresh`, based on `4b9fb0b`.
- Parent owns shared types, transport/resolution, lifecycle/UI, write pipeline,
  lockfile, build settings, integration tests and final integration.
- Extraction worker owns `src/modules/publisherExtraction.ts` and
  `test/publisherExtraction.test.ts` plus extraction fixtures only. Starts from
  committed shared contracts; no shared-file edits without coordination.
- Independent reviewer examines the frozen integrated commit and tests.

## Acceptance

- No startup/import requests; sequential cancellable batches, one globally.
- DOI authority and URL/publication-link fallback; bounded public-only requests.
- HighWire, JSON-LD, Dublin Core extraction without page script execution.
- Re-read and compare fields inside per-item transaction; no unrelated writes.
- Build, lint, scaffold tests in an isolated profile, live journal/conference
  smoke checks, and independent review. Record failures and prerequisites.

## Status

- Planning and clean-base inspection complete. Implementation in progress.
