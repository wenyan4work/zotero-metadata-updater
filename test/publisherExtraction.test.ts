import { assert } from "chai";
import {
  extractPublisherPage,
  normalizeDOI,
} from "../src/modules/publisherExtraction";
import type { RetrievedPage } from "../src/modules/refreshTypes";

function parse(html: string): Document {
  const Parser = (
    globalThis as unknown as {
      DOMParser?: new () => DOMParser;
    }
  ).DOMParser;
  const ZoteroWindow = (
    globalThis as unknown as {
      Zotero?: { getMainWindow?: () => { DOMParser?: new () => DOMParser } };
    }
  ).Zotero?.getMainWindow?.();
  const Constructor = Parser || ZoteroWindow?.DOMParser;
  if (!Constructor) throw new Error("DOMParser is unavailable in test runtime");
  return new Constructor().parseFromString(html, "text/html");
}

function page(
  html: string,
  url = "https://journals.example/article",
): RetrievedPage {
  return { document: parse(html), url };
}

describe("publisher extraction", function () {
  it("normalizes DOI resolver values and rejects broken values", function () {
    assert.equal(
      normalizeDOI(" DOI: https://doi.org/10.1371/JOURNAL.PONE.0000308. "),
      "10.1371/journal.pone.0000308",
    );
    assert.equal(normalizeDOI("10.123"), undefined);
    assert.equal(normalizeDOI("not-a-doi"), undefined);
  });

  it("uses HighWire fields in order and maps dates, authors, and article numbers", function () {
    const result = extractPublisherPage(
      page(
        `<html><head>
          <link rel="canonical" href="/article/10.1371/journal.pone.0000308">
          <meta name="citation_doi" content="10.1371/journal.pone.0000308">
          <meta name="citation_title" content="Sharing Detailed Research Data Is Associated with Increased Citation Rate">
          <meta name="citation_author" content="Heather A. Piwowar">
          <meta name="citation_author" content="Roger S. Day">
          <meta name="citation_journal_title" content="PLOS ONE">
          <meta name="citation_date" content="Mar 21, 2007">
          <meta name="citation_online_date" content="2007-01-01">
          <meta name="citation_firstpage" content="e308">
          <meta name="citation_issn" content="1932-6203">
          <meta name="citation_publisher" content="Public Library of Science">
          <meta name="citation_abstract" content="<p>Background &amp; findings.</p>">
        </head></html>`,
        "https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0000308",
      ),
      { expectedDOI: "10.1371/journal.pone.0000308", viaDOI: true },
    );

    assert.isUndefined(result.reason);
    assert.exists(result.record);
    assert.deepEqual(result.record?.fields, {
      title:
        "Sharing Detailed Research Data Is Associated with Increased Citation Rate",
      publicationTitle: "PLOS ONE",
      date: "2007-03-21",
      pages: "e308",
      publisher: "Public Library of Science",
      DOI: "10.1371/journal.pone.0000308",
      ISSN: "1932-6203",
      url: "https://journals.plos.org/article/10.1371/journal.pone.0000308",
      abstractNote: "Background & findings.",
    });
    assert.deepEqual(result.record?.authors, [
      { firstName: "Heather A.", lastName: "Piwowar" },
      { firstName: "Roger S.", lastName: "Day" },
    ]);
  });

  it("supports conference pages with citation_inbook_title and page ranges", function () {
    const result = extractPublisherPage(
      page(
        `<html><head>
          <meta name="citation_publisher" content="PMLR">
          <meta name="citation_title" content="Learning Transferable Visual Models From Natural Language Supervision">
          <meta name="citation_author" content="Alec Radford">
          <meta name="citation_author" content="Jong Wook Kim">
          <meta name="citation_publication_date" content="2021/07/01">
          <meta name="citation_inbook_title" content="International Conference on Machine Learning">
          <meta name="citation_firstpage" content="8748">
          <meta name="citation_lastpage" content="8763">
        </head></html>`,
        "https://proceedings.mlr.press/v139/radford21a.html",
      ),
      { viaDOI: false },
    );

    assert.isUndefined(result.reason);
    assert.exists(result.record);
    assert.equal(
      result.record?.fields.proceedingsTitle,
      "International Conference on Machine Learning",
    );
    assert.equal(result.record?.fields.date, "2021-07-01");
    assert.equal(result.record?.fields.pages, "8748-8763");
  });

  it("preserves repeated creator names in publisher order", function () {
    const result = extractPublisherPage(
      page(
        `<html><head>
          <meta name="citation_title" content="Repeated Names">
          <meta name="citation_author" content="Alex Lee">
          <meta name="citation_author" content="Alex Lee">
          <meta name="citation_journal_title" content="Example Journal">
        </head></html>`,
        "https://journals.example/repeated",
      ),
      { viaDOI: false },
    );
    assert.isUndefined(result.reason);
    assert.deepEqual(result.record?.authors, [
      { firstName: "Alex", lastName: "Lee" },
      { firstName: "Alex", lastName: "Lee" },
    ]);
  });

  it("fills missing fields from JSON-LD and Dublin Core after HighWire", function () {
    const result = extractPublisherPage(
      page(
        `<html><head>
          <meta name="citation_title" content="A Complete Article">
          <meta name="citation_author" content="Doe, Jane">
          <meta name="citation_publisher" content="Example Press">
          <meta name="dc.date" content="2024">
          <meta name="dc.description" content="DC abstract.">
          <script type="application/ld+json">{
            "@context":"https://schema.org",
            "@type":"ScholarlyArticle",
            "headline":"A Complete Article",
            "datePublished":"2024-04-05",
            "author":[{"@type":"Person","givenName":"Jane","familyName":"Doe"}],
            "isPartOf":{"@type":"Periodical","name":"Example Journal"},
            "publisher":{"@type":"Organization","name":"Example Press","url":"https://journals.example/"},
            "identifier":{"propertyID":"DOI","value":"10.5555/example"},
            "abstract":"Schema abstract."
          }</script>
        </head></html>`,
      ),
      { viaDOI: false },
    );

    assert.isUndefined(result.reason);
    assert.equal(result.record?.fields.title, "A Complete Article");
    assert.equal(result.record?.fields.publicationTitle, "Example Journal");
    assert.equal(result.record?.fields.date, "2024-04-05");
    assert.equal(result.record?.fields.DOI, "10.5555/example");
    assert.equal(result.record?.fields.abstractNote, "Schema abstract.");
  });

  it("rejects competing DOI metadata and untrusted venue-only pages", function () {
    const conflict = extractPublisherPage(
      page(
        `<html><head>
          <meta name="citation_title" content="One Article">
          <meta name="citation_doi" content="10.5555/one">
          <meta name="citation_author" content="Jane Doe">
          <script type="application/ld+json">{
            "@type":"ScholarlyArticle",
            "headline":"One Article",
            "identifier":"https://doi.org/10.5555/two"
          }</script>
        </head></html>`,
      ),
      { viaDOI: false },
    );
    assert.equal(conflict.reason, "doi-mismatch");

    const uncertain = extractPublisherPage(
      page(
        `<html><head>
          <meta name="citation_title" content="One Article">
          <meta name="citation_author" content="Jane Doe">
          <meta name="citation_journal_title" content="Example Journal">
          <meta name="citation_publisher" content="Example Press">
        </head></html>`,
        "https://unknown.example/article",
      ),
      { viaDOI: false },
    );
    assert.equal(uncertain.reason, "uncertain-publisher");
  });

  it("returns explicit published-version links from repositories and skips references", function () {
    const result = extractPublisherPage(
      page(
        `<html><body>
          <a href="https://publisher.example/article">Published version</a>
          <div id="references"><a href="https://doi.org/10.5555/reference">DOI</a></div>
          <meta name="citation_title" content="Repository Copy">
          <meta name="citation_author" content="Jane Doe">
        </body></html>`,
        "https://pubmed.ncbi.nlm.nih.gov/12345/",
      ),
      { expectedDOI: "10.5555/article", viaDOI: false },
    );

    assert.equal(result.reason, "uncertain-publisher");
    assert.deepEqual(result.publicationLinks, [
      "https://publisher.example/article",
    ]);
  });

  it("skips challenge and non-article pages", function () {
    const challenge = extractPublisherPage(
      page(
        `<html><head><title>Just a moment...</title></head><body>Checking your browser</body></html>`,
        "https://journals.example/article",
      ),
      { viaDOI: false },
    );
    assert.equal(challenge.reason, "unsupported-page");

    const nonArticle = extractPublisherPage(
      page(
        `<html><head><meta property="og:title" content="A page"></head><body>Welcome</body></html>`,
        "https://journals.example/",
      ),
      { viaDOI: false },
    );
    assert.equal(nonArticle.reason, "unsupported-page");
  });
});
