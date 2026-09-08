import {
  type Author,
  type ExtractionContext,
  type PageExtraction,
  type PublisherRecord,
  type RefreshField,
  type RefreshFields,
  type RetrievedPage,
} from "./refreshTypes";

/**
 * DOI syntax is deliberately kept narrow here.  The resolver is responsible
 * for deciding whether a DOI is reachable; extraction only needs a stable,
 * comparable representation of the identifier.
 */
const DOI_PATTERN = /10\.\d{4,9}\/[._;()/:A-Z0-9-]+/i;
const DOI_SEARCH_PATTERN = /10\.\d{4,9}\/[._;()/:A-Z0-9-]+/gi;

const KNOWN_PUBLISHER_DOMAINS = [
  "acm.org",
  "aclanthology.org",
  "acs.org",
  "academic.oup.com",
  "aip.org",
  "allenpress.com",
  "annualreviews.org",
  "aps.org",
  "bmj.com",
  "cambridge.org",
  "cell.com",
  "degruyter.com",
  "emerald.com",
  "frontiersin.org",
  "ieee.org",
  "iop.org",
  "jamanetwork.com",
  "journals.plos.org",
  "journals.aps.org",
  "link.springer.com",
  "mdpi.com",
  "nature.com",
  "nejm.org",
  "oup.com",
  "pnas.org",
  "proceedings.neurips.cc",
  "mlr.press",
  "royalsocietypublishing.org",
  "rsc.org",
  "sagepub.com",
  "sciencedirect.com",
  "scirp.org",
  "springer.com",
  "tandfonline.com",
  "usenix.org",
  "wiley.com",
  "worldscientific.com",
] as const;

const REPOSITORY_OR_AGGREGATOR_DOMAINS = [
  "academia.edu",
  "api.crossref.org",
  "arxiv.org",
  "biorxiv.org",
  "core.ac.uk",
  "crossref.org",
  "doi.org",
  "dx.doi.org",
  "europepmc.org",
  "figshare.com",
  "hal.science",
  "jstor.org",
  "medrxiv.org",
  "ncbi.nlm.nih.gov",
  "osf.io",
  "pubmed.ncbi.nlm.nih.gov",
  "researchgate.net",
  "semanticscholar.org",
  "ssrn.com",
  "zenodo.org",
] as const;

type SourceKind = "highwire" | "schema.org" | "dublin-core";
type Metadata = Record<string, string[]>;
type UnknownRecord = Record<string, unknown>;

function elements(document: Document, selector: string): Element[] {
  return Array.from(
    document.querySelectorAll(selector) as unknown as ArrayLike<Element>,
  );
}

interface InternalCandidate {
  source: SourceKind;
  fields: RefreshFields;
  authors: Author[];
  doiValues: string[];
  title?: string;
  publicationDate?: string;
  onlineDate?: string;
  pageRange?: string;
  articleNumber?: string;
  articleLike: boolean;
  evidence: string[];
  publisherNames: string[];
  publisherURLs: string[];
}

interface CanonicalInfo {
  canonicalURL?: string;
  schemaURLs: string[];
  highwireURLs: string[];
  doiValues: string[];
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function plainText(value: unknown, document?: Document, limit = 50_000) {
  const raw = asString(value);
  if (!raw) return undefined;

  let text = raw;
  if (document && /[<&]/.test(raw)) {
    const element = document.createElement("div");
    // Assigning inert metadata to a detached element decodes entities and
    // strips markup without evaluating scripts from the fetched page.
    element.innerHTML = raw;
    text = (element.textContent || "").replace(/<[^>]*>/g, " ");
  } else {
    text = raw
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => {
        return String.fromCodePoint(parseInt(code, 16));
      })
      .replace(/&#(\d+);/g, (_match, code: string) => {
        return String.fromCodePoint(parseInt(code, 10));
      });
  }

  const normalized = text.replace(/[\s\u00a0]+/g, " ").trim();
  if (!normalized || normalized.length > limit) return undefined;
  return normalized;
}

function normalizedMetaName(value: string) {
  return value.trim().toLowerCase();
}

function collectMetadata(document: Document): Metadata {
  const result: Metadata = Object.create(null) as Metadata;
  for (const element of elements(document, "meta")) {
    const name =
      element.getAttribute("name") ||
      element.getAttribute("property") ||
      element.getAttribute("itemprop");
    const content =
      element.getAttribute("content") ?? element.getAttribute("value");
    if (!name || content === null) continue;
    const key = normalizedMetaName(name);
    if (!key) continue;
    (result[key] ||= []).push(content);
  }
  return result;
}

function metadataValues(metadata: Metadata, keys: string[]) {
  const values: string[] = [];
  for (const key of keys) {
    values.push(...(metadata[normalizedMetaName(key)] || []));
  }
  return values;
}

function firstText(
  metadata: Metadata,
  keys: string[],
  document: Document,
  limit = 50_000,
) {
  for (const value of metadataValues(metadata, keys)) {
    const normalized = plainText(value, document, limit);
    if (normalized) return normalized;
  }
  return undefined;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

/** Normalize a DOI-like value for identity comparisons and Zotero writes. */
export function normalizeDOI(value: string): string | undefined {
  if (typeof value !== "string") return undefined;

  let input = value
    .replace(/&amp;/gi, "&")
    .replace(/^\s*["'“”‘’([{<]+/, "")
    .trim();
  input = input.replace(/^doi\s*:\s*/i, "");
  input = input.replace(/^(?:https?:\/\/)?(?:dx\.)?doi\.org\//i, "");

  const match = input.match(DOI_PATTERN);
  if (!match) return undefined;
  let doi = match[0].trim().replace(/[.,;:!?]+$/g, "");
  doi = doi.replace(/[\])}>]+$/g, "");
  if (!/^10\.\d{4,9}\/[._;()/:A-Z0-9-]+$/i.test(doi)) {
    return undefined;
  }
  return doi.toLowerCase();
}

function findDOIs(value: unknown) {
  const raw = asString(value);
  if (!raw) return [];
  const values: string[] = [];
  for (const match of raw.matchAll(DOI_SEARCH_PATTERN)) {
    const doi = normalizeDOI(match[0]);
    if (doi) values.push(doi);
  }
  return uniqueStrings(values);
}

function normalizeDate(value: unknown, document: Document) {
  const text = plainText(value, document, 200);
  if (!text) return undefined;

  const iso = text.match(
    /^(1[5-9]\d{2}|20\d{2}|21\d{2})(?:[-/.](\d{1,2})(?:[-/.](\d{1,2}))?)?(?:\b|T)/,
  );
  if (iso) {
    const year = iso[1];
    if (!iso[2]) return year;
    const month = Number(iso[2]);
    if (month < 1 || month > 12) return undefined;
    if (!iso[3]) return `${year}-${String(month).padStart(2, "0")}`;
    const day = Number(iso[3]);
    if (!validCalendarDay(Number(year), month, day)) return undefined;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(
      2,
      "0",
    )}`;
  }

  const months: Record<string, string> = {
    jan: "01",
    january: "01",
    feb: "02",
    february: "02",
    mar: "03",
    march: "03",
    apr: "04",
    april: "04",
    may: "05",
    jun: "06",
    june: "06",
    jul: "07",
    july: "07",
    aug: "08",
    august: "08",
    sep: "09",
    sept: "09",
    september: "09",
    oct: "10",
    october: "10",
    nov: "11",
    november: "11",
    dec: "12",
    december: "12",
  };
  const named = text.match(
    /\b([A-Za-z]{3,9})\s+(\d{1,2})(?:,)?\s+(1[5-9]\d{2}|20\d{2}|21\d{2})\b/,
  );
  const reversed = text.match(
    /\b(\d{1,2})\s+([A-Za-z]{3,9})\s+(1[5-9]\d{2}|20\d{2}|21\d{2})\b/,
  );
  const monthName = named || reversed;
  if (monthName) {
    const month = months[monthName[named ? 1 : 2].toLowerCase()];
    const day = Number(monthName[named ? 2 : 1]);
    const year = monthName[3];
    if (!month || !validCalendarDay(Number(year), Number(month), day))
      return undefined;
    return `${year}-${month}-${String(day).padStart(2, "0")}`;
  }

  const year = text.match(/\b(1[5-9]\d{2}|20\d{2}|21\d{2})\b/);
  return year?.[1];
}

function validCalendarDay(year: number, month: number, day: number): boolean {
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function firstDate(metadata: Metadata, keys: string[], document: Document) {
  for (const value of metadataValues(metadata, keys)) {
    const date = normalizeDate(value, document);
    if (date) return date;
  }
  return undefined;
}

function normalizePagePart(value: unknown, document: Document) {
  const text = plainText(value, document, 100);
  if (!text) return undefined;
  return text.replace(/^pages?\.?\s*/i, "").replace(/^pp?\.\s*/i, "");
}

function pageRange(
  first: unknown,
  last: unknown,
  document: Document,
): string | undefined {
  const firstPage = normalizePagePart(first, document);
  const lastPage = normalizePagePart(last, document);
  if (firstPage && lastPage) {
    return firstPage === lastPage ? firstPage : `${firstPage}-${lastPage}`;
  }
  return firstPage;
}

function firstIdentifier(
  values: unknown[],
  document: Document,
  kind: "issn" | "isbn",
) {
  for (const value of values) {
    const text = plainText(value, document, 200);
    if (!text) continue;
    if (kind === "issn") {
      const match = text.match(/\b\d{4}[-\s]?\d{3}[\dXx]\b/);
      if (match) {
        const digits = match[0].replace(/[-\s]/g, "");
        return `${digits.slice(0, 4)}-${digits.slice(4)}`.toUpperCase();
      }
    } else {
      const digits = text.replace(/[\s-]/g, "");
      if (/^(?:\d{9}[\dXx]|\d{13})$/.test(digits)) return digits;
    }
  }
  return undefined;
}

function splitPersonName(
  value: string,
  document: Document,
): Author | undefined {
  const name = plainText(value, document, 500);
  if (!name) return undefined;
  if (name.includes(",")) {
    const [last, ...rest] = name.split(",");
    const lastName = plainText(last, document, 300);
    const firstName = plainText(rest.join(","), document, 300);
    if (lastName && firstName) return { firstName, lastName };
    if (lastName) return { lastName };
  }
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return { lastName: parts[0] };
  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts[parts.length - 1],
  };
}

function authorFromSchema(
  value: unknown,
  document: Document,
): Author | undefined {
  if (typeof value === "string") return splitPersonName(value, document);
  if (!isRecord(value)) return undefined;

  const name = plainText(value.name, document, 500);
  const types = schemaArray(value["@type"])
    .map((entry) => schemaText(entry, document, 100)?.toLowerCase())
    .filter((entry): entry is string => Boolean(entry));
  const familyName = plainText(value.familyName, document, 300);
  const givenName = plainText(value.givenName, document, 300);
  if (types.includes("organization") || types.includes("corporation")) {
    if (name) return { lastName: name, fieldMode: 1 };
    if (familyName) return { lastName: familyName, fieldMode: 1 };
  }
  if (familyName)
    return givenName
      ? { firstName: givenName, lastName: familyName }
      : { lastName: familyName };
  return name ? splitPersonName(name, document) : undefined;
}

function dedupeAuthors(authors: Author[]) {
  // Keep the publisher's declared order and multiplicity. Two contributors
  // can legitimately share a display name, so deduplicating here would lose
  // creators from the Zotero record.
  return authors.slice();
}

function schemaArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value === undefined ? [] : [value];
}

function schemaText(
  value: unknown,
  document: Document,
  limit = 50_000,
): string | undefined {
  if (typeof value === "string" || typeof value === "number") {
    return plainText(String(value), document, limit);
  }
  if (isRecord(value)) {
    for (const key of ["name", "text", "value", "@value"]) {
      const text = schemaText(value[key], document, limit);
      if (text) return text;
    }
  }
  return undefined;
}

function schemaTypeNames(node: UnknownRecord) {
  return schemaArray(node["@type"])
    .map((value) => (typeof value === "string" ? value.toLowerCase() : ""))
    .filter(Boolean);
}

function isArticleNode(node: UnknownRecord) {
  return schemaTypeNames(node).some(
    (type) =>
      type === "article" ||
      type === "scholarlyarticle" ||
      type === "newsarticle" ||
      type === "techarticle" ||
      type === "blogposting" ||
      type.endsWith("article"),
  );
}

function walkSchema(value: unknown, output: UnknownRecord[], depth = 0) {
  if (depth > 6) return;
  if (Array.isArray(value)) {
    for (const item of value) walkSchema(item, output, depth + 1);
    return;
  }
  if (!isRecord(value)) return;
  if (isArticleNode(value)) output.push(value);
  for (const key of [
    "@graph",
    "mainEntity",
    "mainEntityOfPage",
    "subjectOf",
    "item",
  ]) {
    if (key in value) walkSchema(value[key], output, depth + 1);
  }
}

function schemaPublisher(value: unknown, document: Document) {
  const names: string[] = [];
  const urls: string[] = [];
  for (const entry of schemaArray(value)) {
    if (typeof entry === "string") {
      const text = plainText(entry, document, 500);
      if (text) names.push(text);
      continue;
    }
    if (!isRecord(entry)) continue;
    const name = schemaText(entry.name, document, 500);
    if (name) names.push(name);
    for (const key of ["url", "sameAs"]) {
      for (const url of schemaArray(entry[key])) {
        if (typeof url === "string") urls.push(url);
      }
    }
  }
  return { names, urls };
}

function schemaIdentifiers(
  node: UnknownRecord,
  document: Document,
): { dois: string[]; issn?: string; isbn?: string } {
  const identifiers: unknown[] = [];
  for (const key of ["identifier", "sameAs"])
    identifiers.push(...schemaArray(node[key]));
  const dois: string[] = [];
  const issnValues: unknown[] = [];
  const isbnValues: unknown[] = [];
  for (const identifier of identifiers) {
    if (typeof identifier === "string") {
      dois.push(...findDOIs(identifier));
      if (
        /issn/i.test(identifier) ||
        /\b\d{4}[-\s]?\d{3}[\dXx]\b/.test(identifier)
      ) {
        issnValues.push(identifier);
      }
      if (
        /isbn/i.test(identifier) ||
        /(?:\d[-\s]?){9,12}[\dXx\d]/.test(identifier)
      ) {
        isbnValues.push(identifier);
      }
      continue;
    }
    if (!isRecord(identifier)) continue;
    const value =
      identifier.value ??
      identifier["@value"] ??
      identifier.name ??
      identifier.url;
    const propertyID = schemaText(
      identifier.propertyID,
      document,
      100,
    )?.toLowerCase();
    if (propertyID?.includes("doi")) dois.push(...findDOIs(value));
    else if (propertyID?.includes("issn")) issnValues.push(value);
    else if (propertyID?.includes("isbn")) isbnValues.push(value);
    else {
      dois.push(...findDOIs(value));
      if (propertyID) {
        if (propertyID.includes("issn")) issnValues.push(value);
        if (propertyID.includes("isbn")) isbnValues.push(value);
      }
    }
  }
  return {
    dois: uniqueStrings(dois),
    issn: firstIdentifier(issnValues, document, "issn"),
    isbn: firstIdentifier(isbnValues, document, "isbn"),
  };
}

function schemaPageData(node: UnknownRecord, document: Document) {
  const pageRangeValue = schemaText(node.pagination, document, 100);
  const range =
    pageRangeValue ||
    pageRange(node.pageStart, node.pageEnd, document) ||
    schemaText(node.page, document, 100);
  const articleNumber =
    schemaText(node.articleNumber, document, 100) ||
    schemaText(node.elocationId, document, 100) ||
    schemaText(node.eLocationID, document, 100);
  return { range, articleNumber };
}

function buildSchemaCandidate(
  node: UnknownRecord,
  document: Document,
  pageURL: string,
): InternalCandidate {
  const title =
    schemaText(node.headline, document, 2_000) ||
    schemaText(node.name, document, 2_000) ||
    schemaText(node.alternativeHeadline, document, 2_000);
  const authors = dedupeAuthors(
    schemaArray(node.author)
      .map((author) => authorFromSchema(author, document))
      .filter((author): author is Author => Boolean(author)),
  );
  const publisher = schemaPublisher(node.publisher, document);
  const identifiers = schemaIdentifiers(node, document);
  const types = schemaTypeNames(node);
  const isPartOf = schemaArray(node.isPartOf).find(isRecord);
  const isPartOfName = isPartOf
    ? schemaText(isPartOf.name, document, 2_000)
    : undefined;
  const isConference = types.some(
    (type) => type.includes("conference") || type.includes("proceedings"),
  );
  const publicationTitle =
    schemaText(node.journalTitle, document, 2_000) ||
    schemaText(node.periodicalName, document, 2_000) ||
    (!isConference ? isPartOfName : undefined);
  const proceedingsTitle =
    schemaText(node.proceedingsTitle, document, 2_000) ||
    schemaText(node.conferenceTitle, document, 2_000) ||
    (isConference ? isPartOfName : undefined);
  const dates = [node.datePublished, node.dateCreated, node.dateIssued]
    .map((value) => normalizeDate(value, document))
    .filter((value): value is string => Boolean(value));
  const pages = schemaPageData(node, document);
  const fields: RefreshFields = {};
  if (title) fields.title = title;
  if (publicationTitle) fields.publicationTitle = publicationTitle;
  if (proceedingsTitle) fields.proceedingsTitle = proceedingsTitle;
  if (dates[0]) fields.date = dates[0];
  const volume = schemaText(node.volumeNumber ?? node.volume, document, 100);
  const issue = schemaText(node.issueNumber ?? node.issue, document, 100);
  if (volume) fields.volume = volume;
  if (issue) fields.issue = issue;
  if (pages.range) fields.pages = pages.range;
  if (publisher.names[0]) fields.publisher = publisher.names[0];
  if (identifiers.issn) fields.ISSN = identifiers.issn;
  if (identifiers.isbn) fields.ISBN = identifiers.isbn;
  const abstractNote =
    schemaText(node.abstract, document, 50_000) ||
    schemaText(node.description, document, 50_000);
  if (abstractNote) fields.abstractNote = abstractNote;
  const url = schemaText(node.url, document, 2_000);
  if (url) fields.url = url;
  const resolvedURL = url && safeHTTPURL(url, pageURL);
  const doiValues = uniqueStrings([...identifiers.dois, ...findDOIs(url)]);
  if (resolvedURL && !samePageHost(resolvedURL, pageURL)) {
    doiValues.splice(0, doiValues.length, ...identifiers.dois);
  }
  if (doiValues[0]) fields.DOI = doiValues[0];

  return {
    source: "schema.org",
    fields,
    authors,
    doiValues,
    title,
    publicationDate: dates[0],
    pageRange: pages.range,
    articleNumber: pages.articleNumber,
    articleLike: true,
    evidence: ["schema.org"],
    publisherNames: publisher.names,
    publisherURLs: publisher.urls,
  };
}

function parseSchemaCandidates(document: Document, pageURL: string) {
  const candidates: InternalCandidate[] = [];
  for (const script of elements(
    document,
    'script[type^="application/ld+json"], script[type="application/json"]',
  )) {
    const raw = script.textContent?.trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(
        raw.replace(/^<!--|-->$/g, "").trim(),
      ) as unknown;
      const nodes: UnknownRecord[] = [];
      walkSchema(parsed, nodes);
      for (const node of nodes) {
        candidates.push(buildSchemaCandidate(node, document, pageURL));
      }
    } catch {
      // A malformed JSON-LD block is untrusted page content. Other metadata
      // blocks remain usable, so parsing continues without logging it.
    }
  }
  return candidates;
}

function highwireCandidate(
  metadata: Metadata,
  document: Document,
  pageURL: string,
): InternalCandidate {
  const title = firstText(metadata, ["citation_title"], document, 2_000);
  const authors = dedupeAuthors(
    metadataValues(metadata, ["citation_author"])
      .map((value) => splitPersonName(value, document))
      .filter((author): author is Author => Boolean(author)),
  );
  const publicationDate = firstDate(
    metadata,
    ["citation_publication_date", "citation_date", "citation_issue_date"],
    document,
  );
  const onlineDate = firstDate(
    metadata,
    ["citation_online_date", "citation_accepted_date"],
    document,
  );
  const firstPage = firstText(metadata, ["citation_firstpage"], document, 100);
  const lastPage = firstText(metadata, ["citation_lastpage"], document, 100);
  const range = pageRange(firstPage, lastPage, document);
  const articleNumber = firstText(
    metadata,
    [
      "citation_article_number",
      "citation_elocation_id",
      "citation_e_location_id",
    ],
    document,
    100,
  );
  const doiValues = uniqueStrings(
    metadataValues(metadata, ["citation_doi"]).flatMap(findDOIs),
  );
  const fields: RefreshFields = {};
  if (title) fields.title = title;
  const publicationTitle = firstText(
    metadata,
    ["citation_journal_title"],
    document,
    2_000,
  );
  const proceedingsTitle = firstText(
    metadata,
    [
      "citation_conference_title",
      "citation_proceedings_title",
      "citation_inproceedings_title",
      "citation_inbook_title",
    ],
    document,
    2_000,
  );
  if (publicationTitle) fields.publicationTitle = publicationTitle;
  if (proceedingsTitle) fields.proceedingsTitle = proceedingsTitle;
  if (publicationDate || onlineDate)
    fields.date = publicationDate || onlineDate;
  const volume = firstText(metadata, ["citation_volume"], document, 100);
  const issue = firstText(metadata, ["citation_issue"], document, 100);
  if (volume) fields.volume = volume;
  if (issue) fields.issue = issue;
  if (range) fields.pages = range;
  else if (articleNumber) fields.pages = articleNumber;
  const publisher = firstText(
    metadata,
    ["citation_publisher"],
    document,
    2_000,
  );
  if (publisher) fields.publisher = publisher;
  if (doiValues[0]) fields.DOI = doiValues[0];
  const issn = firstIdentifier(
    metadataValues(metadata, ["citation_issn"]),
    document,
    "issn",
  );
  const isbn = firstIdentifier(
    metadataValues(metadata, ["citation_isbn"]),
    document,
    "isbn",
  );
  if (issn) fields.ISSN = issn;
  if (isbn) fields.ISBN = isbn;
  const abstractNote = firstText(
    metadata,
    ["citation_abstract"],
    document,
    50_000,
  );
  if (abstractNote) fields.abstractNote = abstractNote;
  const highwireURLs = metadataValues(metadata, [
    "citation_fulltext_html_url",
    "citation_abstract_html_url",
  ])
    .map((value) => plainText(value, document, 2_000))
    .filter((value): value is string => Boolean(value));
  if (highwireURLs[0]) fields.url = highwireURLs[0];
  const pageDOIs = uniqueStrings([
    ...doiValues,
    ...highwireURLs
      .map((value) => safeHTTPURL(value, pageURL))
      .filter((value): value is string => Boolean(value))
      .filter((value) => samePageHost(value, pageURL))
      .flatMap(findDOIs),
  ]);

  const articleLike = Object.keys(metadata).some((key) =>
    key.startsWith("citation_"),
  );
  return {
    source: "highwire",
    fields,
    authors,
    doiValues: pageDOIs,
    title,
    publicationDate,
    onlineDate,
    pageRange: range,
    articleNumber,
    articleLike,
    evidence: ["highwire"],
    publisherNames: publisher ? [publisher] : [],
    publisherURLs: [],
  };
}

function dublinCoreCandidate(
  metadata: Metadata,
  document: Document,
): InternalCandidate {
  const title = firstText(
    metadata,
    ["dc.title", "dcterms.title", "dc:title", "dctitle"],
    document,
    2_000,
  );
  const authors = dedupeAuthors(
    metadataValues(metadata, [
      "dc.creator",
      "dcterms.creator",
      "dc.contributor.author",
    ])
      .map((value) => splitPersonName(value, document))
      .filter((author): author is Author => Boolean(author)),
  );
  const date = firstDate(
    metadata,
    ["dcterms.issued", "dcterms.created", "dc.date", "dcterms.date"],
    document,
  );
  const publicationTitle = firstText(
    metadata,
    ["dc.source", "dcterms.source"],
    document,
    2_000,
  );
  const publisher = firstText(
    metadata,
    ["dc.publisher", "dcterms.publisher"],
    document,
    2_000,
  );
  const descriptions = metadataValues(metadata, [
    "dcterms.abstract",
    "dc.description",
  ]);
  const abstractNote = descriptions
    .map((value) => plainText(value, document, 50_000))
    .find((value): value is string => Boolean(value));
  const identifierValues = metadataValues(metadata, [
    "dc.identifier",
    "dcterms.identifier",
  ]);
  const doiValues = uniqueStrings(identifierValues.flatMap(findDOIs));
  const fields: RefreshFields = {};
  if (title) fields.title = title;
  if (publicationTitle) fields.publicationTitle = publicationTitle;
  if (date) fields.date = date;
  if (publisher) fields.publisher = publisher;
  if (doiValues[0]) fields.DOI = doiValues[0];
  const issn = firstIdentifier(identifierValues, document, "issn");
  const isbn = firstIdentifier(identifierValues, document, "isbn");
  if (issn) fields.ISSN = issn;
  if (isbn) fields.ISBN = isbn;
  if (abstractNote) fields.abstractNote = abstractNote;
  const url = identifierValues
    .map((value) => plainText(value, document, 2_000))
    .find((value) => /^https?:\/\//i.test(value || ""));
  if (url) fields.url = url;

  const articleLike = Boolean(
    title &&
    (authors.length ||
      date ||
      publicationTitle ||
      publisher ||
      doiValues.length),
  );
  return {
    source: "dublin-core",
    fields,
    authors,
    doiValues,
    title,
    publicationDate: date,
    articleLike,
    evidence: ["dublin-core"],
    publisherNames: publisher ? [publisher] : [],
    publisherURLs: [],
  };
}

function safeHTTPURL(value: unknown, base: string): string | undefined {
  const raw = asString(value)?.trim();
  if (!raw) return undefined;
  try {
    const url = new URL(raw, base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    if (url.username || url.password) return undefined;
    url.hash = "";
    return url.href;
  } catch {
    return undefined;
  }
}

function urlLike(value: string) {
  return /^(?:https?:\/\/|\/|#)/i.test(value.trim());
}

function pageHost(value: string) {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

function samePageHost(left: string, right: string) {
  const leftHost = pageHost(left);
  const rightHost = pageHost(right);
  return Boolean(leftHost && rightHost && leftHost === rightHost);
}

function hostMatches(host: string | undefined, domain: string) {
  return Boolean(host && (host === domain || host.endsWith(`.${domain}`)));
}

function isKnownPublisherHost(host: string | undefined) {
  return KNOWN_PUBLISHER_DOMAINS.some((domain) => hostMatches(host, domain));
}

function isRepositoryHost(host: string | undefined) {
  if (!host) return false;
  if (
    REPOSITORY_OR_AGGREGATOR_DOMAINS.some((domain) => hostMatches(host, domain))
  ) {
    return true;
  }
  return /(^|[.-])(repository|eprints|dspace)([.-]|$)/i.test(host);
}

function canonicalInfo(
  document: Document,
  pageURL: string,
  metadata: Metadata,
): CanonicalInfo {
  const canonicalCandidates: string[] = [];
  for (const link of elements(document, "link[href]")) {
    const rel = (link.getAttribute("rel") || "").toLowerCase().split(/\s+/);
    if (rel.includes("canonical")) {
      const url = safeHTTPURL(link.getAttribute("href"), pageURL);
      if (url && samePageHost(url, pageURL)) canonicalCandidates.push(url);
    }
  }
  const canonicalURL = canonicalCandidates[0];
  const schemaURLs = metadataValues(metadata, ["schema:url"])
    .map((value) => safeHTTPURL(value, pageURL))
    .filter((value): value is string =>
      Boolean(value && samePageHost(value, pageURL)),
    )
    .filter((value): value is string => Boolean(value));
  const highwireURLs = metadataValues(metadata, [
    "citation_fulltext_html_url",
    "citation_abstract_html_url",
  ])
    .map((value) => safeHTTPURL(value, pageURL))
    .filter((value): value is string =>
      Boolean(value && samePageHost(value, pageURL)),
    )
    .filter((value): value is string => Boolean(value));
  const doiValues = uniqueStrings([
    ...[pageURL, ...canonicalCandidates].flatMap(findDOIs),
  ]);
  return { canonicalURL, schemaURLs, highwireURLs, doiValues };
}

function linkIsInReferenceBlock(element: Element) {
  let current: Element | null = element;
  for (
    let depth = 0;
    current && depth < 8;
    depth += 1, current = current.parentElement
  ) {
    const marker = [
      current.id,
      current.className,
      current.getAttribute("aria-label"),
      current.getAttribute("role"),
    ]
      .filter((value): value is string => typeof value === "string")
      .join(" ")
      .toLowerCase();
    if (
      /(^|[\s_-])(reference|references|bibliograph|citation|citations)([\s_-]|$)/.test(
        marker,
      )
    ) {
      return true;
    }
    if (current.tagName.toLowerCase() === "references") return true;
  }
  return false;
}

const PUBLICATION_LINK_WORDS =
  /\b(?:publisher|published|official|version\s+of\s+record|journal|proceedings|full\s*text|article\s+page|view\s+article|doi)\b/i;

function collectPublicationLinks(
  document: Document,
  pageURL: string,
  expectedDOI?: string,
) {
  const links: string[] = [];
  for (const element of elements(document, "a[href], link[href]")) {
    if (linkIsInReferenceBlock(element)) continue;
    const href = safeHTTPURL(element.getAttribute("href"), pageURL);
    if (!href) continue;
    const rel = (element.getAttribute("rel") || "").toLowerCase();
    const label = [
      element.textContent || "",
      element.getAttribute("aria-label") || "",
      element.getAttribute("title") || "",
      rel,
    ]
      .join(" ")
      .replace(/[\s\u00a0]+/g, " ")
      .trim();
    const linkedDOI = normalizeDOI(href);
    if (expectedDOI && linkedDOI && linkedDOI !== expectedDOI) continue;
    const targetHost = pageHost(href);
    const isDOILink = Boolean(linkedDOI && hostMatches(targetHost, "doi.org"));
    const explicitPublisherRel = /(^|\s)publisher(?:\s|$)/.test(rel);
    const explicitWords = PUBLICATION_LINK_WORDS.test(label);
    const expectedDOILink = Boolean(
      isDOILink && expectedDOI && linkedDOI === expectedDOI,
    );
    const knownPublisherTarget = isKnownPublisherHost(targetHost);
    if (!(explicitPublisherRel || explicitWords || expectedDOILink)) continue;
    if (isDOILink && !explicitWords && !expectedDOILink) continue;
    if (
      !isDOILink &&
      !knownPublisherTarget &&
      !explicitPublisherRel &&
      !explicitWords
    )
      continue;
    if (!links.includes(href)) links.push(href);
  }

  for (const value of metadataValues(collectMetadata(document), [
    "published_version",
    "published-version",
    "version_of_record",
    "citation_publisher_url",
  ])) {
    const href = safeHTTPURL(value, pageURL);
    if (!href) continue;
    const linkedDOI = normalizeDOI(href);
    if (expectedDOI && linkedDOI && linkedDOI !== expectedDOI) continue;
    if (!links.includes(href)) links.push(href);
  }
  return links;
}

function normalizedIdentityTitle(value: string) {
  return value
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .slice(0, 500);
}

function candidateScore(candidate: InternalCandidate) {
  return (
    (candidate.title ? 4 : 0) +
    candidate.authors.length * 2 +
    candidate.doiValues.length * 3 +
    Object.keys(candidate.fields).length +
    (candidate.articleLike ? 2 : 0)
  );
}

function selectSchemaCandidate(candidates: InternalCandidate[]) {
  if (!candidates.length) return undefined;
  return candidates
    .slice()
    .sort((left, right) => candidateScore(right) - candidateScore(left))[0];
}

function fail(
  publicationLinks: string[],
  reason: PageExtraction["reason"],
): PageExtraction {
  return { publicationLinks, reason };
}

function challengePage(document: Document) {
  const title = document.title || "";
  const body = document.body?.textContent || "";
  const text = `${title} ${body.slice(0, 8_000)}`.toLowerCase();
  return [
    "access denied",
    "403 forbidden",
    "just a moment",
    "checking your browser",
    "verify you are human",
    "robot check",
    "captcha",
    "cf-chl-",
    "sign in to continue",
    "login required",
  ].some((marker) => text.includes(marker));
}

function sameOrganization(left: string, right: string) {
  const normalize = (value: string) =>
    value
      .toLocaleLowerCase()
      .replace(/&amp;/g, "&")
      .replace(/[^\p{L}\p{N}]+/gu, "");
  const a = normalize(left);
  const b = normalize(right);
  return Boolean(a && b && (a === b || a.includes(b) || b.includes(a)));
}

function hasSameOriginPublisherEvidence(
  document: Document,
  metadata: Metadata,
  candidates: InternalCandidate[],
  pageURL: string,
) {
  let origin: string;
  try {
    origin = new URL(pageURL).origin;
  } catch {
    return false;
  }
  for (const candidate of candidates) {
    for (const value of candidate.publisherURLs) {
      if (!urlLike(value)) continue;
      const url = safeHTTPURL(value, pageURL);
      if (url && new URL(url).origin === origin) return true;
    }
  }
  for (const element of elements(document, "a[href], link[href]")) {
    const rel = (element.getAttribute("rel") || "").toLowerCase();
    if (!/(^|\s)publisher(?:\s|$)/.test(rel)) continue;
    const url = safeHTTPURL(element.getAttribute("href"), pageURL);
    if (url && new URL(url).origin === origin) return true;
  }
  for (const value of metadataValues(metadata, [
    "article:publisher",
    "publisher:url",
  ])) {
    if (!urlLike(value)) continue;
    const url = safeHTTPURL(value, pageURL);
    if (url && new URL(url).origin === origin) return true;
  }
  const publisherNames = uniqueStrings(
    candidates.flatMap((candidate) => candidate.publisherNames),
  );
  const siteNames = metadataValues(metadata, [
    "og:site_name",
    "application-name",
    "twitter:site",
  ])
    .map((value) => plainText(value, document, 500))
    .filter((value): value is string => Boolean(value));
  return publisherNames.some((publisher) =>
    siteNames.some((site) => sameOrganization(publisher, site)),
  );
}

function validateIdentity(
  candidates: InternalCandidate[],
  pageDOIs: string[],
  context: ExtractionContext,
) {
  const doiValues = uniqueStrings([
    ...candidates.flatMap((candidate) => candidate.doiValues),
    ...pageDOIs,
  ]);
  if (doiValues.length > 1)
    return { reason: "doi-mismatch" as const, doiValues };

  const titledCandidates = candidates.filter((candidate) => candidate.title);
  const titleValues = uniqueStrings(
    titledCandidates.map((candidate) =>
      normalizedIdentityTitle(candidate.title || ""),
    ),
  );
  if (titleValues.length > 1) {
    const allSameDOI = titledCandidates.every(
      (candidate) =>
        candidate.doiValues.length === 1 &&
        candidate.doiValues[0] === doiValues[0],
    );
    if (!allSameDOI) return { reason: "ambiguous" as const, doiValues };
  }

  const expected = normalizeDOI(context.expectedDOI || "");
  if (context.viaDOI) {
    if (context.expectedDOI !== undefined && !expected) {
      return { reason: "doi-mismatch" as const, doiValues };
    }
    if (expected && doiValues[0] !== expected) {
      return { reason: "doi-mismatch" as const, doiValues };
    }
    if (!expected && !doiValues.length) {
      return { reason: "doi-mismatch" as const, doiValues };
    }
  }
  return { doiValues };
}

function mergeRecord(
  page: RetrievedPage,
  candidates: InternalCandidate[],
  schemaCandidate: InternalCandidate | undefined,
  canonical: CanonicalInfo,
  identityDOIs: string[],
  context: ExtractionContext,
): PublisherRecord {
  const highwire = candidates.find(
    (candidate) => candidate.source === "highwire",
  );
  const dc = candidates.find((candidate) => candidate.source === "dublin-core");
  const ordered = [highwire, schemaCandidate, dc].filter(
    (candidate): candidate is InternalCandidate => Boolean(candidate),
  );
  const fields: RefreshFields = {};
  const fieldNames: RefreshField[] = [
    "title",
    "publicationTitle",
    "proceedingsTitle",
    "volume",
    "issue",
    "pages",
    "publisher",
    "ISSN",
    "ISBN",
    "abstractNote",
  ];
  for (const field of fieldNames) {
    const value = ordered
      .map((candidate) => candidate.fields[field])
      .find(Boolean);
    if (value) fields[field] = value;
  }

  const publicationDate = ordered
    .map((candidate) => candidate.publicationDate)
    .find(Boolean);
  const onlineDate = ordered
    .map((candidate) => candidate.onlineDate)
    .find(Boolean);
  if (publicationDate || onlineDate)
    fields.date = publicationDate || onlineDate;

  const canonicalURL = canonical.canonicalURL;
  const candidateSchemaURL = safeHTTPURL(
    canonical.schemaURLs[0] || schemaCandidate?.fields.url,
    page.url,
  );
  const schemaURL =
    candidateSchemaURL && samePageHost(candidateSchemaURL, page.url)
      ? candidateSchemaURL
      : undefined;
  const candidateHighwireURL = safeHTTPURL(
    canonical.highwireURLs[0] || highwire?.fields.url,
    page.url,
  );
  const highwireURL =
    candidateHighwireURL && samePageHost(candidateHighwireURL, page.url)
      ? candidateHighwireURL
      : undefined;
  const sourceURL =
    canonicalURL || schemaURL || highwireURL || safeHTTPURL(page.url, page.url);
  if (sourceURL) fields.url = sourceURL;

  const expected = normalizeDOI(context.expectedDOI || "");
  const doi = identityDOIs[0] || (context.viaDOI ? expected : undefined);
  if (doi) fields.DOI = doi;

  const authors = ordered.find(
    (candidate) => candidate.authors.length,
  )?.authors;
  const evidence = uniqueStrings(
    ordered.flatMap((candidate) => candidate.evidence),
  );
  if (canonicalURL) evidence.push("canonical");
  if (doi) evidence.push("doi-confirmed");

  return {
    fields,
    ...(authors?.length ? { authors } : {}),
    sourceURL: page.url,
    retrievedAt: new Date().toISOString(),
    evidence: uniqueStrings(evidence),
  };
}

/**
 * Extract publisher metadata from an already retrieved, inert document.
 *
 * This function intentionally performs no I/O.  Resolution, redirect
 * validation, request budgets, cancellation, and retries belong to the
 * refresh coordinator.
 */
export function extractPublisherPage(
  page: RetrievedPage,
  context: ExtractionContext,
): PageExtraction {
  const source = safeHTTPURL(page.url, page.url);
  if (!source) return fail([], "invalid-url");
  const metadata = collectMetadata(page.document);
  const publicationLinks = collectPublicationLinks(
    page.document,
    source,
    normalizeDOI(context.expectedDOI || ""),
  );
  const host = pageHost(source);
  if (isRepositoryHost(host)) {
    return fail(publicationLinks, "uncertain-publisher");
  }
  if (
    /\.pdf(?:$|[?#])/i.test(source) ||
    page.document.contentType === "application/pdf"
  ) {
    return fail(publicationLinks, "unsupported-page");
  }
  if (challengePage(page.document))
    return fail(publicationLinks, "unsupported-page");

  const highwire = highwireCandidate(metadata, page.document, source);
  const schemaCandidates = parseSchemaCandidates(page.document, source);
  const dc = dublinCoreCandidate(metadata, page.document);
  const candidates = [highwire, ...schemaCandidates, dc];
  const articleCandidates = candidates.filter(
    (candidate) =>
      candidate.articleLike && (candidate.title || candidate.doiValues.length),
  );
  if (!articleCandidates.length)
    return fail(publicationLinks, "unsupported-page");
  if (!articleCandidates.some((candidate) => candidate.title)) {
    return fail(publicationLinks, "incomplete");
  }
  const hasRecordSignal = articleCandidates.some(
    (candidate) =>
      candidate.authors.length > 0 ||
      candidate.doiValues.length > 0 ||
      candidate.publicationDate ||
      candidate.onlineDate ||
      candidate.fields.publicationTitle ||
      candidate.fields.proceedingsTitle ||
      candidate.fields.publisher ||
      candidate.fields.abstractNote,
  );
  if (!hasRecordSignal) return fail(publicationLinks, "incomplete");

  const canonical = canonicalInfo(page.document, source, metadata);
  const identity = validateIdentity(
    articleCandidates,
    canonical.doiValues,
    context,
  );
  if (identity.reason) return fail(publicationLinks, identity.reason);

  const trustedByDOI = context.viaDOI && identity.doiValues.length > 0;
  const trustedByURL =
    isKnownPublisherHost(host) ||
    hasSameOriginPublisherEvidence(
      page.document,
      metadata,
      articleCandidates,
      source,
    );
  if (!trustedByDOI && !trustedByURL) {
    return fail(publicationLinks, "uncertain-publisher");
  }

  const schemaCandidate = selectSchemaCandidate(schemaCandidates);
  const record = mergeRecord(
    page,
    articleCandidates,
    schemaCandidate,
    canonical,
    identity.doiValues,
    context,
  );
  if (!record.fields.title) return fail(publicationLinks, "incomplete");
  return { record, publicationLinks };
}
