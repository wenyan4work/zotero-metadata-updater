# Zotero Metadata Watch Plugin

> Knowledge-base design document for a Zotero plugin that automatically monitors bibliographic records and safely keeps metadata up to date.

## Status

- **Document type:** Product / architecture plan
- **Target platform:** Zotero 10+
- **Primary objective:** Maintain accurate Zotero bibliographic metadata over the publication lifecycle without silently overwriting user intent or damaging attachments, annotations, notes, collections, tags, or citation continuity.
- **Non-goal:** Rewriting metadata embedded inside PDF files.

---

## 1. Problem Statement

Bibliographic metadata in Zotero can become incorrect or stale even when the attached document itself is valid.

Three common cases motivate the plugin.

### 1.1 Incorrect metadata after PDF import

A PDF is added to Zotero and Zotero's built-in PDF recognition creates or updates a parent item, but the result is incomplete or incorrect.

Typical problems include:

- wrong title;
- incorrect authors;
- wrong DOI;
- wrong venue;
- missing publication details;
- a DOI from the reference list being mistaken for the paper's DOI;
- metadata corresponding to a preprint rather than the final publication.

Today, the user often has to find the publisher or bibliographic page manually and update the Zotero item.

### 1.2 Preprint becomes a formal publication

A paper is initially available on arXiv and has valid preprint metadata.

Later it is formally published in:

- a journal;
- a conference;
- formal proceedings;
- another archival venue.

The bibliographic record should then be updated or linked to the formal publication while preserving:

- the original Zotero item;
- the arXiv identifier;
- existing PDF attachments;
- annotations and notes;
- citation continuity.

### 1.3 Early-view / quick-preview publication becomes final

A journal may initially publish an article online before assigning its final citation details.

The item may initially lack:

- volume;
- issue;
- page range;
- article number;
- final citation year or publication date.

Later, the publisher or DOI-registration service deposits the complete citation metadata.

The Zotero item should be completed automatically when the publication identity is already known.

---

## 2. Product Principle

The plugin should act as a **local-first metadata maintenance system**, not merely as another PDF importer.

Its core function is:

> Identify the publication represented by a Zotero item, detect meaningful metadata changes in trusted external sources, and reconcile those changes with the local Zotero record without losing user edits or publication-version information.

A key distinction is:

> **Automatic discovery can be broad; automatic modification must be conservative.**

The plugin should freely search for better metadata, but only modify records when the evidence and update policy justify it.

---

## 3. Default Behavior by Use Case

| Use case                                   | Detection goal                                                                                        | Default action                                                                                              |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Incorrect metadata after PDF import        | Determine whether the parent item conflicts with the PDF or whether a stronger matching record exists | Investigate automatically; show a correction proposal if identity or existing populated fields would change |
| arXiv preprint becomes published           | Detect a verified journal/conference publication corresponding to the preprint                        | Show a publication-promotion proposal; optionally allow strict automatic promotion                          |
| Early-view article receives final citation | Detect added volume, issue, pages, article number, or final citation date for the same record         | Automatically fill verified missing, unprotected fields; review changes to existing consequential values    |

Accepted main-conference papers at ICLR, ICML, and NeurIPS use the enabled-by-default special workflow in Section 10.4: verified official metadata and item type are applied automatically in place. Other publication transitions retain the general review default.

The default user-facing promise should be:

> **Keep metadata current without silently changing what the user meant to cite.**

---

## 4. Preservation Requirements

Every metadata refresh should preserve the existing Zotero item identity whenever the update is intended to modify that item in place.

The plugin must preserve:

- Zotero item key;
- attachment keys;
- PDF attachments;
- annotations;
- notes;
- collections;
- user tags;
- citation continuity;
- manually protected metadata fields.

The following should be separate features rather than side effects of metadata updating:

- replacing PDFs;
- relocating attachments;
- duplicate merging;
- rewriting embedded PDF metadata;
- automatically deleting preprint records.

---

## 5. Data Sources

The core plugin should work without:

- paid APIs;
- subscriptions;
- a hosted backend;
- LLM inference;
- proprietary bibliographic databases.

### 5.1 Core providers

| Provider     | Primary role                                                                                           | Notes                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| **Crossref** | Published DOI metadata, DOI lookup, publication candidate search, relationship metadata                | Primary published-record provider                         |
| **arXiv**    | Preprint metadata, arXiv identifiers, author-supplied comments, DOI, and journal-reference information | Primary preprint provider                                 |
| **DataCite** | DOI resolution for records outside Crossref                                                            | DOI fallback                                              |
| **DBLP**     | Conference and computer-science publication discovery                                                  | Important for proceedings and non-DOI conference coverage |

The special conference workflow additionally uses these designated official sources:

| Conference                  | Official metadata source                        | Required verification                                                    |
| --------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------ |
| ICLR                        | OpenReview                                      | Accepted main-conference record, not merely a submission                 |
| ICML                        | PMLR (`proceedings.mlr.press`)                  | Paper belongs to the main ICML proceedings volume, not a workshop volume |
| NeurIPS (historically NIPS) | Official proceedings (`proceedings.neurips.cc`) | Matching main-conference proceedings record                              |

These sources supply the publication metadata bundle for Section 10.4; general DOI providers or aggregators do not substitute for an unavailable official record.

### 5.2 Optional provider

| Provider     | Role                                                          | Policy                                                  |
| ------------ | ------------------------------------------------------------- | ------------------------------------------------------- |
| **OpenAlex** | Broader discovery, linkage evidence, bibliographic enrichment | Optional; should not be required for core functionality |

### 5.3 Authority should be field-specific

Do **not** establish a single universal provider ranking.

Instead:

- use arXiv as the authoritative description of an arXiv version;
- use DOI-registration metadata as the main source for a corresponding published record;
- use DBLP as strong corroboration for computer-science publication identity and conference metadata;
- use aggregators mainly for discovery and corroboration rather than unrestricted field replacement;
- use the designated official conference source for verified ICLR, ICML, and NeurIPS promotions under Section 10.4;
- allow other targeted publisher-page retrieval as an explicit fallback.

---

## 6. Publication Identity Model

The plugin should explicitly model three different concepts.

### 6.1 Zotero item

The stable local record.

It owns:

- attachments;
- annotations;
- notes;
- collections;
- tags;
- local user edits.

### 6.2 Publication records

A scientific work may have multiple bibliographic manifestations:

- arXiv preprint;
- conference publication;
- journal publication;
- revised journal extension;
- correction or erratum.

These records can be related without being interchangeable.

### 6.3 Attached document

The local PDF has its own version identity.

For example:

```text
Zotero item:       stable existing item key
Preferred citation: published journal article
Related preprint:   arXiv:XXXX.XXXXX
Attached document:  original arXiv v2 PDF
```

Updating the preferred citation must **not** imply that the attached PDF has changed into the final publisher version.

---

## 7. Promotion Policies

Users should be able to choose how preprints and formal publications are represented.

### Policy A — Update the existing item in place

Recommended for users who conceptually maintain one Zotero record per paper.

Behavior:

- preserve the existing item key;
- retain the arXiv identifier;
- retain publication history;
- update the preferred citation to the formal publication;
- leave the attached preprint PDF unchanged unless explicitly requested.

### Policy B — Keep versions as separate Zotero items

Recommended when version-specific citation matters.

Behavior:

- preserve the original preprint item;
- create or identify a separate published item;
- link the two records;
- optionally associate attachments appropriately;
- do not silently merge the records.

Automatic promotion should require explicit opt-in even when Policy A is selected, except for the special conference workflow in Section 10.4. Its single option is enabled by default and selects automatic in-place promotion for qualifying ICLR, ICML, and NeurIPS papers. This is an explicit exception to both the general review/opt-in default and Policy B: users who want separate versions for these papers must disable the special option. Field locks and intervening user edits remain protected.

---

## 8. Internal State Model

The plugin should maintain independent state dimensions.

```text
Identity:
    unresolved
    verified
    ambiguous

Publication:
    preprint
    early-view
    published
    unknown

Watch:
    enabled
    paused

Last outcome:
    unchanged
    proposal
    applied
    provider-error
```

Do not infer `early-view` solely from missing volume, issue, or pages.

Use positive evidence when possible.

---

# 9. Workflow A — Validate Newly Imported PDFs

## 9.1 Goal

Check whether Zotero's initial PDF recognition produced the correct parent metadata.

## 9.2 Sequence

```text
PDF added or attached
        ↓
Wait for Zotero import / recognition activity to settle
        ↓
Re-read attachment and parent item
        ↓
Extract identifying evidence locally
        ↓
Retrieve bibliographic candidates
        ↓
Validate candidate identity
        ↓
Generate safe patch or review proposal
```

## 9.3 Evidence extraction priority

Prefer low-cost, high-specificity evidence:

1. existing DOI;
2. arXiv identifier;
3. stable publication URL;
4. title;
5. authors;
6. text from the first pages of the PDF;
7. additional local PDF extraction if necessary.

OCR should not be required for the initial release.

## 9.4 DOI extraction rule

Never assume that the first DOI appearing in a PDF identifies the paper.

A scientific PDF may contain many DOIs in:

- the references;
- headers;
- footers;
- editorial notices;
- supplementary information.

Candidate DOI extraction should preserve context.

Example evidence:

```text
DOI candidate:
    10.xxxx/abcd

Location:
    first-page header

Nearby text:
    journal name + publication notice

Evidence weight:
    high
```

A DOI found in the bibliography should receive a much lower identity score.

## 9.5 Existing Zotero DOI is not automatically trusted

A wrong DOI may already have been assigned by an earlier recognition process.

The plugin should validate it against:

- PDF title;
- authors;
- publication text;
- other identifiers.

---

# 10. Workflow B — Detect Preprint-to-Publication Transitions

## 10.1 Primary evidence path

For a known arXiv item:

```text
Known arXiv ID
      ↓
Retrieve current arXiv metadata
      ↓
Check author-supplied DOI / journal-reference fields
      ↓
Retrieve candidate published record
      ↓
Validate relationship and bibliographic consistency
```

An explicit arXiv-to-publication relationship is strong evidence.

## 10.2 Secondary discovery path

If no explicit relationship exists:

```text
arXiv metadata
      ↓
Crossref title + author search
      ↓
DBLP search where relevant
      ↓
Optional OpenAlex search
      ↓
Candidate ranking
      ↓
Identity validation
```

## 10.3 Promotion safeguards

### A DOI does not automatically mean formal publication

An arXiv DOI such as:

```text
10.48550/arXiv....
```

identifies the arXiv record itself and must not be treated as the journal DOI.

### A related publication is not always a replacement

Possible relationships include:

- conference precursor;
- journal extension;
- correction;
- supplement;
- commentary;
- substantially revised work.

The plugin must distinguish:

```text
same publication lifecycle
```

from:

```text
related but distinct work
```

### Multiple plausible candidates require review

Never auto-select a publication solely because it is the highest-ranked fuzzy title match.

### Non-DOI publications must be supported

A conference publication may be legitimate even without a DOI.

The plugin should retain a stable provider identifier and verified proceedings URL rather than inventing a DOI.

---

## 10.4 Special processing for ICLR, ICML, and NeurIPS

A single preference, **“Special processing for ICLR, ICML, and NeurIPS,”** controls all three conferences and is **enabled by default**. It applies only to accepted main-conference papers. Disabling it bypasses this workflow and retains the general metadata workflow; it does not undo previous updates.

### Detection and routing

1. When an arXiv identifier is available, retrieve arXiv comments first. If no identifier is available, comments are unavailable, or comments are inconclusive, inspect locally available PDF full text. Missing or unreadable PDFs leave detection unresolved; OCR and remote PDF uploads are not required.
2. Require affirmative evidence that this paper was accepted or published at ICLR, ICML, or NeurIPS, recognizing the historical name NIPS. Capture the evidence context and conference/year when present. Conference mentions in references, “submitted to,” “under review,” and affiliated workshop acceptance do not qualify.
3. Route ICLR to OpenReview, ICML to PMLR, and NeurIPS to its official proceedings website. Verify accepted status for ICLR and main-conference proceedings membership for ICML and NeurIPS.
4. Verify that the official record describes the same paper using available identifiers, title, authors, and conference/year evidence. Do not select a candidate solely because it is the best fuzzy title match. Conflicting acceptance evidence or multiple plausible records require review, not automatic promotion.

```text
Option enabled
    ↓
arXiv comments → local PDF full text if unavailable or inconclusive
    ↓
Affirmative main-conference acceptance/publication evidence
    ↓
ICLR → OpenReview | ICML → PMLR | NeurIPS/NIPS → official proceedings
    ↓
Verify official publication status and paper identity
    ↓
Re-read item and check protected fields / concurrent edits
    ↓
Apply Conference Paper type + official metadata atomically
```

### Application and failure behavior

- Automatically update the existing item to Zotero **Conference Paper** (`conferencePaper`) and apply the verified official metadata together in one Zotero transaction. Do not save the type change before the official metadata is available and verified.
- Map available official citation fields to supported Zotero fields, including title, creators, proceedings title, conference name, publication date/year, publisher, volume, pages, DOI, and canonical publication URL as supplied. Do not invent absent values or erase valid local data because a source omits a field.
- This workflow authorizes automatic type and citation-metadata changes as an exception to Section 16's general review defaults. It does not override field locks or intervening user edits. If a protected field or concurrent edit prevents a coherent promotion, leave the entire bundle unapplied and require review.
- Preserve the item key, attachment keys and files, annotations, notes, tags, collections, related-item relationships, citation continuity, and arXiv identifier. Preserve values that cannot be represented after type conversion in the retained history rather than silently discarding them. The attached PDF may remain the preprint version.
- Record acceptance evidence, the official source, and before/after values in update history; use the existing conditional undo policy. Repeated checks of unchanged source data must not produce duplicate updates or notifier loops.
- Missing official records, delayed proceedings publication, malformed responses, or provider failures leave the item unchanged and eligible for retry through the existing retry/watch policy. Do not fall back to a different provider to authorize this special promotion. Recheck the option before applying; disabling it prevents pending special-workflow writes.

---

# 11. Workflow C — Complete Early-View Citation Metadata

This is the safest automatic-update workflow because the publication identity is usually already established.

## 11.1 Process

For a verified DOI:

```text
Known DOI
   ↓
Retrieve latest provider record
   ↓
Normalize citation-relevant fields
   ↓
Compare with previous provider snapshot
   ↓
Detect meaningful changes
   ↓
Apply safe missing-field updates
```

## 11.2 Candidate fields

Typical additions:

- volume;
- issue;
- page range;
- article number;
- publication date;
- final citation year.

## 11.3 Do not use provider indexing timestamps as the update trigger

Indexing timestamps may change for unrelated reasons.

Instead, compute a hash over normalized citation-relevant metadata.

For example:

```text
citation_hash = hash(
    title,
    creators,
    container_title,
    volume,
    issue,
    pages_or_article_number,
    publication_date,
    DOI
)
```

Only meaningful citation changes should generate update proposals.

## 11.4 Date handling

Retain multiple source dates internally when available:

- online publication date;
- issue publication date;
- deposited date;
- print date.

The displayed Zotero citation date should follow an explicit policy.

A change in citation year should require review by default.

---

# 12. Matching Engine

The matching engine is the most important component in the system.

The scheduler, provider clients, and UI should all be thin layers around it.

## 12.1 Three independent decisions

For every candidate, determine:

### 1. Identity

Does this external record describe:

- the same publication;
- a verified later version;
- or merely a related work?

### 2. Improvement

Does the candidate contain metadata that is:

- more complete;
- more authoritative;
- more current;
- or demonstrably corrective?

### 3. Permission

Even if the new value is better, is the plugin allowed to modify this field automatically?

A high identity score must **not** automatically authorize overwriting user-edited metadata.

---

## 13. Candidate Evidence

Potential evidence dimensions:

- exact DOI match;
- exact arXiv identifier;
- explicit Crossref relationship;
- explicit arXiv journal reference;
- title similarity;
- normalized title equality;
- author overlap;
- author ordering;
- first-author / corresponding-author consistency;
- publication year;
- venue;
- publication type;
- DBLP identifier;
- publisher URL;
- competing candidate quality.

Avoid presenting an internal heuristic rank as a mathematically calibrated probability.

For example, do not display:

```text
99.7% confidence
```

unless the system has actually been calibrated against a representative labeled dataset.

Prefer:

```text
Identity evidence: Strong
Reason:
- exact arXiv identifier
- explicit journal DOI supplied by arXiv
- title match
- author list match
```

---

# 14. Field-Level Three-Way Merge

For every managed metadata field, retain:

```text
B = baseline value last accepted or written by the plugin
L = current local Zotero value
R = newly retrieved remote value
```

Apply merge logic such as:

```text
if field_is_locked:
    keep L

elif semantically_equivalent(L, R):
    no_change

elif identity_is_uncertain:
    request_review

elif L != B:
    # user or another process changed the local value
    request_review

elif R is empty and L is nonempty:
    preserve L

elif update_policy_allows_auto_apply:
    apply R

else:
    request_review
```

---

## 15. Unknown Provenance for Existing Libraries

When the plugin is installed into an existing Zotero library, populated fields do not have known provenance.

The plugin must **not** assume that existing values were generated automatically.

For initially observed fields:

```text
provenance = unknown
```

A populated title, author list, year, DOI, or venue should therefore be treated conservatively.

---

# 16. Recommended Default Update Policy

| Proposed change                                                    | Default behavior                       |
| ------------------------------------------------------------------ | -------------------------------------- |
| Fill missing volume / issue / pages for verified same record       | Automatic                              |
| Fill missing article number                                        | Automatic                              |
| Fill missing formal DOI after verified publication transition      | Review                                 |
| Replace existing title                                             | Review                                 |
| Replace existing creator list                                      | Review                                 |
| Change citation year                                               | Review                                 |
| Change DOI                                                         | Review                                 |
| Change Zotero item type                                            | Review                                 |
| Promote preprint to publication via explicit verified relationship | Review; optional strict automatic mode |
| Replace record based only on fuzzy matching                        | Never automatic in v1                  |
| Delete metadata because provider returned an empty field           | Never automatic                        |

Section 10.4 is the explicit exception: with the special option enabled (the default), verified main-conference ICLR, ICML, and NeurIPS promotions automatically apply the item type and available official citation fields as one bundle. Ambiguity, protected fields, concurrent edits, and empty remote values retain their safeguards.

---

# 17. Atomic Publication-Transition Bundles

Preprint-to-publication promotion should be handled as a coherent metadata bundle.

Avoid independent field mixing such as:

```text
title       ← journal record
authors     ← old preprint
venue       ← journal record
date        ← another provider
pages       ← missing
```

unless the reconciliation engine explicitly determines that this field-level combination is valid.

For identity-changing transitions, the system should prefer a coherent source record and expose deviations explicitly.

---

# 18. Proposed Architecture

```text
                  ┌────────────────────┐
                  │ Zotero item events │
                  └─────────┬──────────┘
                            │
                  ┌─────────▼──────────┐
                  │ Scheduled watches  │
                  └─────────┬──────────┘
                            │
                  ┌─────────▼──────────┐
                  │ Evidence extractor │
                  └─────────┬──────────┘
                            │
             ┌──────────────▼──────────────┐
             │       Provider layer         │
             │ Crossref / arXiv / DataCite │
             │ DBLP / optional OpenAlex    │
             └──────────────┬──────────────┘
                            │
                  ┌─────────▼──────────┐
                  │ Matching engine    │
                  └─────────┬──────────┘
                            │
                  ┌─────────▼──────────┐
                  │ Diff / merge policy│
                  └─────────┬──────────┘
                       ┌────┴────┐
                       │         │
                ┌──────▼───┐ ┌───▼─────────┐
                │Auto apply│ │Review queue │
                └──────┬───┘ └───┬─────────┘
                       │         │
                       └────┬────┘
                            │
                  ┌─────────▼──────────┐
                  │ History / rollback │
                  └────────────────────┘
```

---

# 19. Suggested Code Structure

Use TypeScript.

```text
src/
  zotero/
    events.ts
    items.ts
    attachments.ts
    extraction.ts
    writes.ts
    undo.ts
    compatibility.ts

  providers/
    crossref.ts
    arxiv.ts
    datacite.ts
    dblp.ts
    openalex.ts

  core/
    identifiers.ts
    normalization.ts
    matching.ts
    lifecycle.ts
    diff.ts
    merge.ts
    policy.ts

  watch/
    queue.ts
    scheduler.ts
    retries.ts
    rate-limit.ts

  storage/
    database.ts
    snapshots.ts
    provenance.ts
    history.ts
    proposals.ts

  ui/
    item-status.ts
    review-queue.ts
    settings.ts
    history.ts

tests/
  fixtures/
  providers/
  matching/
  lifecycle/
  merge/
  integration/
```

The `core/` directory should contain mostly pure logic so that it can be heavily unit tested without launching Zotero.

---

# 20. Zotero Integration

The plugin should rely on Zotero-supported APIs rather than directly modifying Zotero's SQLite database.

Integration areas include:

- Zotero notifier events;
- reading item metadata;
- reading attachment text where available;
- item mutation APIs;
- transaction-safe saves;
- plugin menus and panes;
- Zotero's undo integration.

## 20.1 Import race handling

The plugin should not compete with Zotero's own PDF metadata recognition.

When a PDF is added:

1. observe the event;
2. wait for recognition-related changes to settle;
3. re-read the parent relationship;
4. inspect the final current state;
5. then begin plugin validation.

A fixed time delay alone is not a correctness mechanism.

Immediately before applying a proposal, re-read the Zotero item.

---

# 21. Concurrent Modification Protection

A provider request may take seconds.

During that period, the user or Zotero may change the item.

Every proposal should therefore be generated against a snapshot:

```text
proposal_base_revision
```

Before applying:

```text
current = reload_zotero_item()

if relevant_fields(current) != proposal_base_fields:
    invalidate proposal
    recompute diff
else:
    apply
```

Never apply a stale patch blindly.

---

# 22. Feedback-Loop Prevention

The plugin will observe Zotero item changes, including its own writes.

Avoid infinite update loops by recording expected writes.

Example:

```text
pending_write:
    item_key
    fields
    expected_after_values
    operation_id
```

When the notifier fires, recognize matching plugin-generated changes.

Do not globally disable Zotero notifications.

---

# 23. Plugin-Owned Persistent State

Do not add custom tables directly to Zotero's own database.

Maintain plugin state separately.

Suggested stored information:

```text
watched_item
  zotero_item_key
  identity_state
  publication_state
  watch_state

  verified_identifiers
    doi
    arxiv
    dblp
    datacite

  last_successful_check
  next_check
  last_provider_error

  source_snapshots
  citation_hashes

  field_provenance
  field_locks

  rejected_proposals
  applied_operations
```

---

# 24. Durable History and Undo

Native Zotero undo should be used where supported, but the plugin should also maintain its own durable history.

Example history entry:

```text
operation:
    id
    item_key
    timestamp
    source
    reason
    evidence

before:
    title
    creators
    DOI
    publicationTitle
    volume
    issue
    pages
    date

after:
    ...

fields_changed:
    ...

publication_transition:
    arxiv -> journal
```

## 24.1 Conditional rollback

Rollback must not erase later user edits.

For each field:

```text
if current_value == plugin_applied_value:
    restore previous_value
else:
    leave current_value unchanged
    flag conflict
```

---

# 25. Crash Recovery

Because Zotero data and plugin state may live in separate stores, updates need a recoverable operation protocol.

Suggested sequence:

```text
1. Record intended operation as PREPARED
2. Write Zotero metadata
3. Verify resulting Zotero state
4. Mark operation COMMITTED
5. Update provenance / provider snapshot
```

On startup:

```text
find incomplete operations
    ↓
compare expected Zotero state with actual state
    ↓
finalize or recover
```

---

# 26. Watch Scheduler

The desktop plugin should monitor items while Zotero is running and resume overdue jobs when Zotero starts again.

No always-on cloud server should be required.

## 26.1 Suggested default intervals

These are plugin policy defaults rather than provider requirements.

| State                        | Suggested interval                    |
| ---------------------------- | ------------------------------------- |
| Newly imported PDF           | Immediately after recognition settles |
| Recent preprint              | Weekly                                |
| Older unchanged preprint     | Monthly, then potentially quarterly   |
| Early-view publication       | Weekly initially                      |
| Older early-view publication | Monthly                               |
| Stable published record      | Every 90 days or manual only          |
| Provider failure             | Exponential backoff                   |

---

# 27. Queue Design

The scheduler should use a persistent queue.

Required properties:

- job deduplication;
- provider-aware rate limiting;
- cancellation;
- startup jitter;
- bounded concurrency;
- exponential backoff;
- retry classification;
- persistent due dates.

Distinguish:

```text
CHECK_SUCCESS_NO_CHANGE
```

from:

```text
CHECK_FAILED
```

A failed API request must never be interpreted as evidence that the metadata is unchanged.

---

# 28. API Efficiency

Prefer exact identifier lookups whenever possible.

Example:

```text
DOI lookup
```

is preferable to:

```text
title + author search
```

when the DOI is already verified.

Similarly:

```text
arXiv ID lookup
```

should be cheaper and more reliable than repeatedly searching all bibliographic providers.

Broad fuzzy searches should run less frequently than deterministic identifier checks.

---

# 29. Privacy

The default plugin should be privacy-minimizing.

Do not send:

- complete PDFs;
- notes;
- annotations;
- collection names;
- unrelated library metadata.

Prefer queries containing only:

- DOI;
- arXiv ID;
- title;
- author names;
- publication year where necessary.

The onboarding flow should disclose when title/author searches are sent to external providers.

Optional API keys must be excluded from diagnostic logs.

---

# 30. Multi-Device Behavior

For v1, assume **one automatic writer**.

Other Zotero installations may operate in:

```text
review-only
```

mode.

Plugin-local history, field locks, and scheduling state must not be assumed to synchronize across devices unless a dedicated synchronization design is implemented.

Multi-device coordination is a later feature.

---

# 31. User Interface

The interface should make every consequential decision understandable.

## 31.1 Item status pane

Example:

```text
Metadata Watch

Status:              Watching
Publication state:   Early-view publication
Identity:            Verified
Verified DOI:        10.xxxx/xxxx
Last successful check: 2026-09-07
Next check:          2026-09-14

Pending:
  Volume and article number are now available
```

Controls:

- Check now
- Pause watching
- Resume watching
- Review changes
- Lock fields
- View update history

---

## 31.2 Conference-processing preference

Show one checkbox labeled **“Special processing for ICLR, ICML, and NeurIPS”**, checked by default. Explain that it automatically updates accepted main-conference papers in place using OpenReview, PMLR, or official NeurIPS proceedings, including changing the item type to Conference Paper after verification. Explain that disabling it restores the general workflow and is necessary when separate preprint/publication records are preferred.

The item status pane should distinguish unresolved detection, waiting for official metadata/retry, needs review, and an applied conference promotion. Link applied changes to their official source and update history.

---

# 32. Review Queue

Group pending proposals into categories:

```text
Metadata corrections
Publication updates
Citation completions
Ambiguous matches
```

A proposal should show:

```text
Current value
Proposed value
Source
Retrieval time
Identity evidence
Reason for change
Field protection state
Impact on citation
```

Example:

```text
Publication update

Evidence:
✓ Exact arXiv identifier
✓ arXiv lists publication DOI
✓ DOI record title matches
✓ Authors match

Changes:
Type:        Preprint → Journal Article
Journal:     — → Journal of Example Science
Volume:      — → 18
Issue:       — → 4
Pages:       — → 521–538
DOI:         — → 10.xxxx/example

PDF attachment:
unchanged
```

---

# 33. Rejected Proposal Memory

If a user rejects a proposal, do not show the same proposal every week.

Store a proposal fingerprint.

For example:

```text
fingerprint = hash(
    candidate_identifier,
    relevant_candidate_metadata,
    relationship_type
)
```

Only reopen the proposal if:

- the candidate changes;
- stronger evidence becomes available;
- bibliographic metadata materially changes.

The same principle applies after undoing an automatic update.

---

# 34. Security

Treat remote metadata as untrusted input.

Required protections:

- sanitize rendered HTML;
- do not execute provider-supplied markup;
- constrain automatic URL fetching;
- avoid arbitrary file access;
- redact credentials;
- validate identifier formats;
- bound response sizes;
- time out network requests;
- validate redirects where relevant.

---

# 35. Development Roadmap

## Stage 0 — Zotero integration proof

Build a minimal plugin that can:

- observe item changes;
- identify an attached PDF;
- read parent metadata;
- modify one metadata field safely;
- preserve keys and annotations;
- integrate with Zotero undo;
- detect its own writes.

### Exit criterion

Demonstrate that a metadata edit:

- preserves Zotero item key;
- preserves attachment key;
- preserves annotations;
- survives normal Zotero operation;
- does not create notification loops.

---

## Stage 1 — Deterministic refresh engine

Implement:

- Crossref DOI lookup;
- DataCite DOI fallback;
- normalized metadata representation;
- field-level diff;
- field locks;
- baseline/provenance storage;
- review UI;
- rollback/history.

Start with the easiest scenario:

> known DOI + same publication + newly available citation fields.

### Exit criterion

An early-view article can safely gain final citation fields without any background watcher.

---

## Stage 2 — Publication lifecycle workflows

Implement:

- arXiv provider;
- arXiv identifier recognition;
- author-supplied DOI/journal-reference detection;
- explicit publication relationship validation;
- preprint-to-publication proposal;
- in-place versus separate-version policy.

### Exit criterion

The three primary user scenarios work through manual "Check Metadata" actions.

---

## Stage 3 — Discovery and conference coverage

Implement:

- Crossref candidate search;
- DBLP provider;
- the Section 10.4 conference preference, arXiv-comment/local-PDF acceptance detection, and OpenReview/PMLR/NeurIPS official-source adapters;
- verified atomic in-place conference promotion with preservation, history, and retry safeguards;
- non-DOI publication handling;
- fuzzy title/author matching;
- ambiguity detection;
- candidate review.

Optional:

- OpenAlex enrichment.

### Exit criterion

The plugin safely handles:

- title changes;
- multiple plausible publications;
- conference papers;
- non-DOI records;
- journal extensions.

The Section 38.1 conference scenarios pass, including all three official-source routes, enabled-by-default behavior, disabled bypass, and no partial type change when metadata is unavailable.

---

## Stage 4 — Automatic maintenance

Implement:

- persistent scheduler;
- retry queue;
- rate-limit adapters;
- automatic safe-field completion;
- startup recovery;
- notification policy;
- dry-run library audit.

### Exit criterion

The plugin can operate unattended without silently making risky identity changes.

---

# 36. Testing Strategy

Use recorded provider fixtures as the primary reproducible test corpus.

Live API tests should supplement fixture tests, not replace them.

---

## 37. Identity Tests

Include:

- PDF containing dozens of reference DOIs;
- incorrect DOI already stored in Zotero;
- changed preprint title;
- reordered authors;
- slightly changed author names;
- two papers with nearly identical titles;
- conference paper versus journal extension;
- erratum;
- supplementary article;
- commentary;
- publisher correction.

---

# 38. Lifecycle Tests

Include:

- arXiv record with formal journal DOI;
- arXiv record without journal reference;
- arXiv DOI versus journal DOI;
- conference paper without DOI;
- early-view article gaining volume and issue;
- early-view article gaining an article number;
- article-number-only publication;
- final page range appearing later;
- citation year changing after final assignment.

---

## 38.1 Special conference workflow acceptance tests

Use recorded arXiv comments, local PDF text, and official-provider fixtures to verify:

- ICLR acceptance routes to an accepted OpenReview main-conference record; ICML routes to a main ICML PMLR volume; NeurIPS and historical NIPS route to official NeurIPS proceedings.
- The single option defaults to enabled. Disabled mode bypasses special detection, provider requests, and promotion while leaving the general workflow available; disabling during a pending lookup prevents its write.
- Conclusive arXiv comments take priority; absent identifiers, unavailable comments, and inconclusive comments fall back to local PDF full text. Missing/unreadable PDF text leaves detection unresolved.
- Workshop acceptances, submission/under-review notices, and conference mentions in references do not qualify. Conflicting evidence, rejected/withdrawn OpenReview records, wrong proceedings membership, and ambiguous identity never cause automatic promotion.
- A verified match updates `conferencePaper` and available official metadata in one transaction. A failed write rolls back the entire bundle; unavailable/delayed proceedings, provider errors, and malformed responses leave both type and metadata unchanged and permit retry.
- Successful promotion preserves item/attachment keys, PDFs, annotations, notes, tags, collections, relationships, and the arXiv identifier. Missing remote values do not erase valid local data; type-incompatible values remain recoverable in history.
- Field locks and edits made during lookup prevent conflicting automatic promotion. History and conditional undo remain valid; repeated unchanged checks and self-generated notifier events cause no duplicate writes.

---

# 39. Integrity Tests

For every metadata update, verify preservation of:

- item key;
- attachment keys;
- annotations;
- notes;
- collections;
- tags;
- related-item relationships;
- user-protected fields.

Also test:

- a user edit after proposal generation;
- duplicate published item already in the library;
- undo after later manual edits;
- promotion when the attached PDF remains a preprint.

---

# 40. Operational Tests

Include:

- offline startup;
- provider timeout;
- HTTP 429;
- malformed JSON/XML;
- partial provider responses;
- missing attachment file;
- read-only library;
- repeated Zotero notifier events;
- Zotero shutdown during a write;
- large imports;
- queue restart after crash.

---

# 41. Metrics

Evaluate each workflow separately.

Useful metrics:

```text
false identity match rate
false promotion rate
useful update recall
automatic-update precision
review acceptance rate
review rejection rate
provider requests per checked item
median provider latency
rollback correctness
stale-proposal conflict rate
```

Do not enable fuzzy automatic publication promotion merely because a small benchmark looks good.

---

# 42. Recommended v1 Scope

Include:

- Crossref;
- arXiv;
- DataCite;
- DBLP;
- enabled-by-default special processing for accepted main-conference ICLR, ICML, and NeurIPS papers via their designated official sources;
- local identifier extraction;
- PDF-text-assisted identity checking;
- deterministic same-DOI refresh;
- preprint publication detection;
- field-level provenance;
- field locks;
- review queue;
- safe automatic citation completion;
- persistent scheduler;
- rollback/history;
- dry-run library audit.

Do not require:

- LLM matching;
- cloud backend;
- PDF replacement;
- automatic duplicate merging;
- embedded-PDF metadata rewriting;
- mandatory OpenAlex access;
- OCR;
- multi-device writer coordination.

---

# 43. Key Design Rule

The defining feature of the plugin should be **safe persistent reconciliation**.

The desired behavior is:

```text
Straightforward citation completion
    → automatic

Strongly evidenced publication transition
    → review by default, except verified Section 10.4 conference promotions

Verified ICLR / ICML / NeurIPS promotion with special option enabled
    → automatic in-place type + metadata bundle (option enabled by default)

Ambiguous identity
    → never silently modify

User-edited or protected field
    → preserve

Provider returns incomplete data
    → never erase valid local metadata
```

This distinguishes the plugin from conventional metadata importers.

---

# 44. Future Extensions

Potential later features:

- OpenAlex enrichment and citation graph;
- Semantic Scholar as an opt-in provider;
- Zotero-translator-based publisher-page comparison;
- DOI registry relationship graphs;
- multi-device synchronization of plugin state;
- configurable metadata authority rules;
- collection-specific watch policies;
- publisher-specific early-view lifecycle adapters;
- OCR for scanned PDFs;
- optional PDF replacement workflow;
- explicit preprint/published-version graph UI;
- CLI or diagnostic mode for bulk library auditing;
- exportable metadata provenance reports.

---

# 45. Open Design Questions

Before implementation, resolve:

1. Which Zotero APIs provide the most reliable signal that PDF recognition has completed?
2. How should article numbers map to Zotero/CSL fields across publication types?
3. Which publication-date policy should be the default when online and issue dates differ?
4. Which fields should be automatically locked after a user manually edits them?
5. How should creator-list differences be classified when the published version changes author order or membership?
6. How should conference-to-journal extensions be distinguished from direct publication transitions?
7. Should automatic preprint promotion ever be enabled globally, or only per collection / per item?
8. How should plugin state be migrated across Zotero versions?
9. Which provider responses are safe to cache long term under their metadata licensing terms?
10. How should publisher-page translator results be ranked relative to Crossref and DBLP metadata?

---

# 46. Reference Links

- OpenReview accepted-record retrieval: <https://docs.openreview.net/how-to-guides/data-retrieval-and-modification/how-to-get-all-notes-for-submissions-reviews-rebuttals-etc>
- PMLR proceedings: <https://proceedings.mlr.press/>
- NeurIPS official proceedings: <https://proceedings.neurips.cc/>
- Zotero PDF metadata retrieval: <https://www.zotero.org/support/retrieve_pdf_metadata>
- Zotero JavaScript API: <https://www.zotero.org/support/dev/client_coding/javascript_api>
- Zotero changelog: <https://www.zotero.org/support/changelog>
- Crossref REST API: <https://www.crossref.org/documentation/retrieve-metadata/rest-api/>
- Crossref REST API usage guidance: <https://www.crossref.org/documentation/retrieve-metadata/rest-api/tips-for-using-the-crossref-rest-api/>
- Crossref preprint relationships: <https://www.crossref.org/blog/leaving-the-house-where-preprints-go/>
- arXiv API documentation: <https://info.arxiv.org/help/api/user-manual.html>
- arXiv API terms of use: <https://info.arxiv.org/help/api/tou.html>
- DataCite API: <https://support.datacite.org/docs/api>
- DBLP metadata licensing: <https://blog.dblp.org/2019/11/24/licence-change-to-cc-0/>
- OpenAlex pricing / API access: <https://help.openalex.org/access/pricing/>

---

## Summary

The plugin should not try to answer only:

> "What metadata can I find for this PDF?"

It should answer the harder long-term question:

> **"What bibliographic object does this Zotero item represent, how has that publication evolved since I saved it, and which metadata changes can be applied without changing the user's intended record?"**

That identity- and provenance-aware model is the core architectural decision for a reliable Zotero metadata watcher.
