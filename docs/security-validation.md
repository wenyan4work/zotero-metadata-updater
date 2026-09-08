# Security validation

The refresh transport uses an anonymous XMLHttpRequest adapter instead of
Zotero's URL-logging HTTP helper. It disables response caching, validates each
redirect separately, bounds requests and response size, and exposes only fixed
failure reasons. URL parameters needed by providers are retained for retrieval.
This protects plugin logging; it does not control operating-system diagnostics,
network infrastructure, or publisher logs.

Author lists from HighWire, JSON-LD, and Dublin Core are parsed atomically.
A malformed entry prevents that source from replacing existing creators with a
partial list. Complete alternative metadata sources remain eligible.

## Dependency audit

Upgrading `zotero-plugin-scaffold` to 0.9.1 and Mocha to 12.0.0 brings in
patched versions of `adm-zip`, `serialize-javascript`, and `diff`. Both
`npm audit` and `npm audit --omit=dev` report zero known vulnerabilities as of
2026-09-07. Development requires Node.js 22.18+ within 22.x, 24.11+ within 24.x,
or 26+, matching the locked tool dependencies.

This audit result covers known dependency advisories, not a guarantee of runtime
security. DNS rebinding resistance and native Gecko credential/cache suppression
remain unverified.
