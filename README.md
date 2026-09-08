# Publisher Metadata Refresh

A manual Zotero 10 prototype that updates existing journal articles, conference
papers, and preprints from publisher metadata, with exact-DOI Crossref fallback.

Select one or more records, right-click, and choose **Update Metadata from
Publisher**. Available bibliographic fields, authors, and abstracts are applied
immediately. The results panel shows changed fields, source links, and reasons
for skipped or failed records. **Cancel remaining** stops pending work; already
committed updates remain saved.

## Settings

In Zotero Settings, open **Publisher Metadata Refresh**. **Update abstracts** and
**Use Crossref when publisher retrieval fails** are enabled by default. Changes
apply to the next manual batch without restarting Zotero. Turning off abstract
updates preserves existing abstracts, including empty ones, for both sources.
Crossref receives only the DOI; no title/author searches are performed.

## Retrieval and preservation

- Resolve the DOI first; if it is missing, broken, inaccessible, or unverifiable,
  try the item's URL. A matching publisher DOI wins over the local title/authors.
- Repository and aggregator pages supply only explicit publication links. Their
  metadata is never used to update an item. No title search is performed.
- If publisher retrieval fails, optionally query Crossref using the item DOI or
  an explicit DOI item URL. Only supported records with a matching DOI and title
  are accepted. The results panel identifies Crossref as the source.
- Read HighWire citation tags, Schema.org JSON-LD, then Dublin Core from inert
  HTML. Unknown publisher provenance, conflicting identities, access challenges,
  and unsupported pages are skipped. Coverage is best effort, not universal.
- Never erase a local field because it is missing remotely. Preserve item type,
  keys, Extra, tags, collections, notes, relations, attachments, annotations, and
  creation dates. Non-author creators remain intact.
- Compare the original record with fresh data immediately before each
  transactional update. A concurrent edit causes a skip, not an overwrite.
- No startup/import checks, background monitoring, PDF changes, type conversion,
  persistent history, or plugin undo. The prototype has no automatic update
  endpoint.

Requests use public HTTP(S) addresses with DNS and redirect validation, a 30-second
request timeout, a 120-second item deadline, at most ten requests per item, and
5 MB per response. When Crossref fallback is eligible, publisher attempts receive
nine requests and 90 seconds, reserving one request and 30 seconds for Crossref.
Page scripts and unrestricted Zotero translators are not run.

## Development and validation

Use Node.js/npm and `npm ci`. The manifest targets Zotero `10.0`–`10.*`; the
prototype is validated against the installed Zotero 10.0.1 (Gecko 140). Earlier
Zotero versions are not claimed to be supported.

```sh
npm run build
npm run lint:check
npx tsc --noEmit -p test/tsconfig.json
ZOTERO_PLUGIN_ZOTERO_BIN_PATH=/Applications/Zotero.app/Contents/MacOS/zotero \
ZOTERO_PLUGIN_KILL_COMMAND=/usr/bin/true npm test
```

The scaffold recreates `.scaffold/test/profile` and `.scaffold/test/data` for each
test run. It launches with `-no-remote`. The kill-command override prevents the
scaffold from terminating other Zotero processes; its own child exits when tests
finish. Never point development or integration tests at a personal profile or data
directory. For `npm start`, use the isolated paths described in `.env.example`.

Tests cover extraction fixtures, transport limits, DOI/URL fallback, real Zotero
transactions and preservation, abstract options, the settings pane, Crossref
JSON mapping and failures, cancellation, and window registration. Two
publisher-head fixtures were captured from PLOS and PMLR; other edge cases use
synthetic fixtures. Live network smoke tests are optional:

```sh
PUBLISHER_LIVE_SMOKE=1 \
ZOTERO_PLUGIN_ZOTERO_BIN_PATH=/Applications/Zotero.app/Contents/MacOS/zotero \
ZOTERO_PLUGIN_KILL_COMMAND=/usr/bin/true npm test
```

Live tests read publisher pages without changing library records. They may fail
when a provider is offline, blocks automated access, or changes its markup.

Implementation notes: [prototype implementation](docs/prototype-implementation.md).
The older [metadata watcher proposal](docs/zotero-metadata-watch-plugin-plan.md)
is background design context, not this prototype's scope.
