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

Compatible lockfile updates reduced the npm audit report from 41 findings to 5
(3 high, 1 moderate, 1 low). The production-only audit reports no findings.
These counts include affected parent packages, not five independent flaws.

The remaining development-tool findings are:

- `adm-zip`, through `zotero-plugin-scaffold`: crafted ZIP input can cause excessive
  memory allocation ([advisory](https://github.com/advisories/GHSA-xcpc-8h2w-3j85)).
- `serialize-javascript`, through `mocha`: crafted objects can cause code execution
  or excessive CPU use ([code execution](https://github.com/advisories/GHSA-5c6j-r48x-rmvq),
  [CPU use](https://github.com/advisories/GHSA-qj8w-gfj5-8c6v)).
- `diff`, through `mocha`: crafted patch input can cause denial of service
  ([advisory](https://github.com/advisories/GHSA-73rr-hh4g-fpgx)).

npm recommends scaffold 0.9.1 and Mocha 12, outside the currently declared
compatibility ranges. Those upgrades need separate scaffold/runtime validation;
no forced upgrades or cross-major overrides were applied. These findings remain
open for development/CI tooling and are not an all-clear security assessment.
