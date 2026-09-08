import { normalizeDOI } from "./publisherExtraction";
import {
  RefreshError,
  type Author,
  type PublisherRecord,
} from "./refreshTypes";

const CROSSREF_API = "https://api.crossref.org/works/";
const DOI_API = "https://doi.org/";
const MAX_TITLE = 2_000;
const MAX_VENUE = 2_000;
const MAX_NAME = 500;
const MAX_SHORT = 200;
const MAX_PUBLISHER = 2_000;
const MAX_PAGES = 200;
const MAX_ABSTRACT = 50_000;
const TEXT_BOUNDARY_ELEMENTS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "br",
  "caption",
  "dd",
  "div",
  "dl",
  "dt",
  "figcaption",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "jats:label",
  "jats:list-item",
  "jats:p",
  "jats:sec",
  "jats:title",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
]);

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown, limit: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const raw = value.trim();
  if (!raw || raw.length > limit) return undefined;
  return plainText(raw, limit);
}

function firstString(value: unknown, limit: number): string | undefined {
  if (Array.isArray(value)) {
    for (const candidate of value) {
      const text = stringValue(candidate, limit);
      if (text) return text;
    }
    return undefined;
  }
  return stringValue(value, limit);
}

function domParser(): (new () => DOMParser) | undefined {
  const globalObject = globalThis as unknown as {
    DOMParser?: new () => DOMParser;
    Zotero?: {
      getMainWindow?: () => { DOMParser?: new () => DOMParser };
    };
  };
  if (globalObject.DOMParser) return globalObject.DOMParser;
  try {
    return globalObject.Zotero?.getMainWindow?.()?.DOMParser;
  } catch {
    return undefined;
  }
}

/**
 * Convert Crossref's JATS/HTML-ish strings into bounded plain text. Parsing
 * happens in an inert document, and nodes which can carry executable or
 * externally loaded content are removed before text is read.
 */
function plainText(value: string, limit: number): string | undefined {
  const Parser = domParser();
  if (!Parser) return undefined;
  let text: string;
  try {
    const document = new Parser().parseFromString(
      `<body>${value}</body>`,
      "text/html",
    );
    for (const element of Array.from(
      document.querySelectorAll(
        "script,style,template,iframe,object,embed,svg,math,link,meta,base,noscript",
      ) as unknown as ArrayLike<Element>,
    )) {
      element.remove();
    }
    const body = document.body;
    if (!body) return undefined;
    for (const element of Array.from(
      body.querySelectorAll("*") as unknown as ArrayLike<Element>,
    )) {
      const name = (element.localName || element.tagName).toLowerCase();
      if (TEXT_BOUNDARY_ELEMENTS.has(name)) {
        element.before(document.createTextNode(" "));
        element.after(document.createTextNode(" "));
      }
    }
    text = body.textContent || "";
  } catch {
    return undefined;
  }
  const withoutControls = Array.from(text, (character) => {
    const code = character.charCodeAt(0);
    return code <= 8 ||
      code === 11 ||
      code === 12 ||
      (code >= 14 && code <= 31) ||
      code === 127
      ? " "
      : character;
  }).join("");
  const normalized = withoutControls.replace(/[\s\u00a0]+/g, " ").trim();
  return normalized && normalized.length <= limit ? normalized : undefined;
}

function fail(
  reason: "unsupported-page" | "doi-mismatch" | "incomplete",
): never {
  throw new RefreshError(reason);
}

function normalizedExpectedDOI(value: string): string {
  const doi = normalizeDOI(value);
  if (!doi) fail("doi-mismatch");
  return doi;
}

function isSupportedType(message: UnknownRecord): boolean {
  const type = stringValue(message.type, 100)?.toLowerCase();
  if (type === "journal-article" || type === "proceedings-article") {
    return true;
  }
  if (type !== "posted-content") return false;
  return stringValue(message.subtype, 100)?.toLowerCase() === "preprint";
}

function crossrefDate(value: unknown): string | undefined {
  if (!isRecord(value) || !Array.isArray(value["date-parts"])) return undefined;
  for (const rawParts of value["date-parts"]) {
    if (!Array.isArray(rawParts) || rawParts.length < 1) continue;
    const year = rawParts[0];
    const month = rawParts[1];
    const day = rawParts[2];
    if (
      typeof year !== "number" ||
      !Number.isInteger(year) ||
      year < 1500 ||
      year > 2199
    )
      continue;
    if (month === undefined) return String(year);
    if (
      typeof month !== "number" ||
      !Number.isInteger(month) ||
      month < 1 ||
      month > 12
    )
      continue;
    if (day === undefined) return `${year}-${String(month).padStart(2, "0")}`;
    if (
      typeof day !== "number" ||
      !Number.isInteger(day) ||
      day < 1 ||
      day > daysInMonth(year, month)
    )
      continue;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(
      2,
      "0",
    )}`;
  }
  return undefined;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function firstDate(message: UnknownRecord): string | undefined {
  for (const key of ["published-print", "published-online", "published"]) {
    const date = crossrefDate(message[key]);
    if (date) return date;
  }
  return undefined;
}

function crossrefAuthors(value: unknown): Author[] | undefined {
  if (!Array.isArray(value) || !value.length) return undefined;
  const authors: Author[] = [];
  for (const valueForAuthor of value) {
    if (!isRecord(valueForAuthor)) return undefined;
    const family =
      valueForAuthor.family === undefined
        ? undefined
        : stringValue(valueForAuthor.family, MAX_NAME);
    const given =
      valueForAuthor.given === undefined
        ? undefined
        : stringValue(valueForAuthor.given, MAX_NAME);
    const name =
      valueForAuthor.name === undefined
        ? undefined
        : stringValue(valueForAuthor.name, MAX_NAME);
    if (
      (valueForAuthor.family !== undefined && !family) ||
      (valueForAuthor.given !== undefined && !given) ||
      (valueForAuthor.name !== undefined && !name)
    )
      return undefined;
    if (family) {
      authors.push({
        ...(given ? { firstName: given } : {}),
        lastName: family,
      });
    } else if (name) {
      authors.push({ lastName: name, fieldMode: 1 });
    } else {
      return undefined;
    }
  }
  return authors;
}

function identifier(value: unknown, kind: "ISSN" | "ISBN"): string | undefined {
  if (!Array.isArray(value)) return undefined;
  for (const candidate of value) {
    const text = stringValue(candidate, 200);
    if (!text) continue;
    if (kind === "ISSN") {
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

function pageValue(value: unknown): string | undefined {
  const text = stringValue(value, MAX_PAGES);
  if (!text) return undefined;
  const page = text.replace(/^pages?\.?\s*/i, "").replace(/^pp?\.\s*/i, "");
  return page || undefined;
}

function doiURL(doi: string): string {
  return `${DOI_API}${doi.split("/").map(encodeURIComponent).join("/")}`;
}

/** Build the exact Crossref REST endpoint for a normalized DOI. */
export function crossrefURL(doi: string): string {
  const normalized = normalizedExpectedDOI(doi);
  return `${CROSSREF_API}${encodeURIComponent(normalized)}`;
}

/**
 * Validate and map a Crossref REST `works/{doi}` response into the refresh
 * contract. This parser does no network I/O; transport and cancellation are
 * owned by the resolver.
 */
export function extractCrossrefRecord(
  data: unknown,
  doi: string,
): PublisherRecord {
  const expectedDOI = normalizedExpectedDOI(doi);
  if (!isRecord(data)) fail("unsupported-page");
  if (data.status !== "ok" || data["message-type"] !== "work")
    fail("unsupported-page");
  const message = data.message;
  if (!isRecord(message) || !isSupportedType(message)) fail("unsupported-page");

  const messageDOI = normalizeDOI(
    typeof message.DOI === "string" ? message.DOI : "",
  );
  if (!messageDOI || messageDOI !== expectedDOI) fail("doi-mismatch");

  const title = firstString(message.title, MAX_TITLE);
  if (!title) fail("incomplete");

  const type = stringValue(message.type, 100)?.toLowerCase();
  const venue = firstString(message["container-title"], MAX_VENUE);
  const fields: PublisherRecord["fields"] = {
    title,
    DOI: expectedDOI,
    url: doiURL(expectedDOI),
  };
  if (venue) {
    if (type === "proceedings-article") fields.proceedingsTitle = venue;
    else fields.publicationTitle = venue;
  }

  const date = firstDate(message);
  if (date) fields.date = date;
  const volume = firstString(message.volume, MAX_SHORT);
  if (volume) fields.volume = volume;
  const issue = firstString(message.issue, MAX_SHORT);
  if (issue) fields.issue = issue;
  const pages = pageValue(message.page) || pageValue(message["article-number"]);
  if (pages) fields.pages = pages;
  const publisher = firstString(message.publisher, MAX_PUBLISHER);
  if (publisher) fields.publisher = publisher;
  const issn = identifier(message.ISSN, "ISSN");
  if (issn) fields.ISSN = issn;
  const isbn = identifier(message.ISBN, "ISBN");
  if (isbn) fields.ISBN = isbn;
  const abstractNote = stringValue(message.abstract, MAX_ABSTRACT);
  if (abstractNote) fields.abstractNote = abstractNote;

  const authors = crossrefAuthors(message.author);
  return {
    fields,
    ...(authors ? { authors } : {}),
    sourceURL: crossrefURL(expectedDOI),
    retrievedAt: new Date().toISOString(),
    evidence: ["Crossref exact DOI"],
  };
}
