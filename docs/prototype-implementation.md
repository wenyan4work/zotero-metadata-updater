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

- Implementation integrated; extraction worker commit `95e5f99` retained by
  cherry-pick as `c7efee2`. Clean worker worktree removed after integration.
- Installed Zotero 10.0.1 / Gecko 140.14 confirmed. Native cancellable timers are
  used because the legacy `Zotero.setTimeout` type entry is absent at runtime.
- `npm run build`, `npm run lint:check`, and test type checking pass.
- Isolated Zotero suite passes 42 tests, including PLOS DOI and PMLR URL live
  checks, real transaction rollback, attachment/PDF bytes and annotations,
  unsaved Extra edits, and multi-window cancellation/deadlines.
- Independent review of `9a0df9f` identified five issues: DOI identity across
  indirect links, DOI suffix punctuation, non-scholarly pages, page-range versus
  article-number precedence, and acceptance/creation date misuse. All have
  focused regressions and fixes. Final re-review pending.
- Removed the upstream template update URL from the installable manifest.
- Initial sandbox runs could not write the scaffold notifier cache or launch
  Zotero. Build/test execution used environment-approved desktop permissions;
  the test profile/data remained isolated and the global process-kill command
  was overridden with `/usr/bin/true`.

## Validation commands

```sh
npm run build
npm run lint:check
PUBLISHER_LIVE_SMOKE=1 \
ZOTERO_PLUGIN_ZOTERO_BIN_PATH=/Applications/Zotero.app/Contents/MacOS/zotero \
ZOTERO_PLUGIN_KILL_COMMAND=/usr/bin/true npm test
```

`npm test` type-checks tests and runs the scaffold with `--exit-on-finish`.
Its generated profile and database are `.scaffold/test/profile` and
`.scaffold/test/data`. No personal profile or library was used.

## Prototype limits

Publisher recognition and structured-metadata coverage are conservative and
best effort. Unsupported/challenged pages are skipped. No manual rollback/history
is provided. DNS addresses are checked before each request; DNS rebinding
resistance is not independently verified because connection resolution remains
controlled by Gecko. The packaged artifact retains the scaffold's development
identifier and version; no release publishing or automatic update endpoint is
configured.
