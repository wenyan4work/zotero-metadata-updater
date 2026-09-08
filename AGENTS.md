# Development guidance

- This is a TypeScript Zotero plugin based on Zotero Plugin Template. Keep
  lifecycle dispatch in `src/hooks.ts`, feature logic in `src/modules/`, shared
  helpers in `src/utils/`, and UI assets/localization in `addon/`.
- Read [the planning resource](docs/zotero-metadata-watch-plugin-plan.md) for
  context. It is a design proposal, not an instruction to implement its roadmap.
  Follow the user's requested scope; verify assumptions before implementation.
  Its Zotero 10+ target is aspirational: the current manifest declares
  `strict_min_version: 6.999` and `strict_max_version: 8.*`.
- Verify APIs against the targeted Zotero version and installed `zotero-types`.
  Keep manifest compatibility and scaffold build settings aligned with tested
  versions; do not broaden compatibility without validation.
- Await Zotero readiness before initialization. Clean up observers, listeners,
  timers, and UI on window unload/plugin shutdown; support disable/re-enable
  without duplicate registrations. Keep asynchronous work cancellable.
- Use Zotero item APIs and transactions for library writes, not direct SQL.
  Preserve item/attachment identity and user data; re-read items before applying
  changes and guard against notifier loops caused by the plugin's own writes.
- Treat remote metadata as untrusted input. Validate responses, bound network
  requests, and keep credentials and private library content out of logs.
- Use the existing localization and preference helpers. Do not edit generated
  `.scaffold/` output or commit `.env`, credentials, or Zotero profile data.
- Develop and run integration tests with a separate Zotero profile and data
  directory. Commands: `npm start` for development, `npm run build` for build
  and type checking, `npm run lint:check` for formatting/lint, and `npm test`
  for the scaffold's Zotero tests. Run checks relevant to the change and report
  unavailable prerequisites. For behavioral changes, add focused tests; prefer
  recorded provider fixtures and verify data preservation for metadata writes.

References: [Zotero plugin lifecycle and compatibility](https://www.zotero.org/support/dev/zotero_7_for_developers),
[Zotero JavaScript API](https://www.zotero.org/support/dev/client_coding/javascript_api).
