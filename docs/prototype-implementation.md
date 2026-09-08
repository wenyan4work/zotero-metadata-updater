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
- Isolated Zotero suite passes 43 tests, including PLOS DOI and PMLR URL live
  checks, real transaction rollback, attachment/PDF bytes and annotations,
  unsaved Extra edits, and multi-window cancellation/deadlines.
- Independent review of `9a0df9f` identified five issues: DOI identity across
  indirect links, DOI suffix punctuation, non-scholarly pages, page-range versus
  article-number precedence, and acceptance/creation date misuse. All have
  focused regressions and fixes. Re-review approved `bf7aee9`, including a
  subsequent encoded publisher-URL DOI fix.
- Replaced the upstream template updater with a reserved `.invalid` development
  URL and disabled scaffold manifest rewriting. Zotero 10 rejected absent and
  empty update URLs; the reserved URL installs and all 43 tests pass.
  Independent review approved the final manifest/config snapshot and confirmed
  the non-empty URL requirement in installed Zotero code.
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
identifier and version; no release publishing or functioning automatic update
endpoint is configured. Zotero requires a non-empty updater URL, so this build
uses `https://publisher-metadata-refresh.invalid/update.json`.
Automatic update checks may still run and fail against that reserved address.

## Settings and Crossref extension

- Adds Zotero Settings checkboxes `updateAbstract` and `crossrefFallback`, both
  enabled by default. Options are captured once per manual batch; changes apply
  to the next batch. Disabled abstract updates preserve empty abstracts too.
- Keeps DOI resolution then item-URL publisher retrieval. If neither succeeds,
  Crossref receives the exact item DOI (or an explicit DOI item URL). There is no
  title search or DOI discovery from arbitrary page content.
- Eligible fallback batches reserve one request and 30 seconds for Crossref
  within the existing ten-request, 120-second item limit. Publisher retrieval
  gets nine requests and 90 seconds. Disabled/ineligible fallback retains the
  original publisher budget. User cancellation stops both stages.
- Crossref records pass DOI/type/title validation, map only supported fields,
  and use the same transaction and concurrent-edit protections. Source links
  identify Crossref; API URLs are never written to the item's URL field.
- Parent owns settings, shared interfaces, transport, resolver, UI, integration
  tests and documentation. Crossref worker owns only parser and its fixtures/tests;
  its committed changes are integrated before full validation and review.
- Crossref worker commit `c7607ec` was integrated as `47385fd`; the clean,
  task-created worker checkout was removed after integration.
- `npm run build` and `npm run lint:check` pass. Final isolated Zotero 10.0.1
  suite passes 65 tests, including live PLOS/PMLR and exact-DOI Crossref requests,
  a recorded Crossref response, actual Settings checkbox bindings, abstract
  preservation, and real attachment/annotation/transaction preservation.
- First suite run exposed two test-fixture issues (an insufficient publisher
  success fixture and an already-updated item reused for preservation assertions).
  Both were corrected; the final suite passes. An initial sandboxed test runner
  could not launch Zotero and was stopped before the desktop-permitted run.
- Independent review approved `8a6ed5a` and the recorded-fixture/generated-types
  delta through `9ebeea2`, with no confirmed findings. Chinese labels received
  static review; the Settings interaction test used the runtime's default locale.
  Rapid shutdown during a pending pane registration lacks a dedicated race test.
- Production package: `.scaffold/build/publisher-metadata-refresh.xpi`.
  No push, default-branch merge, release, or personal-profile modification.
