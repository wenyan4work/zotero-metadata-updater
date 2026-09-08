/** Data-only contracts. Remote data must never be passed wholesale to Zotero. */
export const REFRESH_FIELDS = [
  "title",
  "publicationTitle",
  "proceedingsTitle",
  "date",
  "volume",
  "issue",
  "pages",
  "publisher",
  "DOI",
  "ISSN",
  "ISBN",
  "url",
  "abstractNote",
] as const;
export type RefreshField = (typeof REFRESH_FIELDS)[number];
export type RefreshFields = Partial<Record<RefreshField, string>>;
export interface Author {
  firstName?: string;
  lastName: string;
  fieldMode?: number;
}
export interface Creator extends Author {
  creatorType: string;
}
export interface PublisherRecord {
  fields: RefreshFields;
  authors?: Author[];
  sourceURL: string;
  retrievedAt: string;
  evidence: string[];
}
export interface ItemSnapshot {
  id: number;
  libraryID: number;
  key: string;
  itemType: string;
  fields: RefreshFields;
  creators: Creator[];
}
export interface FieldPatch {
  fields: RefreshFields;
  creators?: Creator[];
  changedFields: string[];
}
export type Outcome =
  | "updated"
  | "unchanged"
  | "skipped"
  | "failed"
  | "cancelled";
export type Reason =
  | "unsupported"
  | "not-editable"
  | "missing-link"
  | "invalid-url"
  | "unavailable"
  | "timeout"
  | "too-large"
  | "budget"
  | "unsupported-page"
  | "uncertain-publisher"
  | "ambiguous"
  | "doi-mismatch"
  | "incomplete"
  | "concurrent-edit"
  | "write-failed"
  | "cancelled";
export interface ItemResult {
  id: number;
  title: string;
  outcome: Outcome;
  reason?: Reason;
  sourceURL?: string;
  retrievedAt?: string;
  changedFields: string[];
}
export class RefreshError extends Error {
  constructor(public reason: Reason) {
    super(reason);
  }
}
export interface RetrievedPage {
  document: Document;
  url: string;
}
export interface ExtractionContext {
  /** DOI resolver's final article URL supplies provenance, but page must confirm DOI. */
  expectedDOI?: string;
  viaDOI: boolean;
}
export interface PageExtraction {
  record?: PublisherRecord;
  /** Only explicitly labeled publication links, never bibliography references. */
  publicationLinks: string[];
  reason?: Reason;
}
