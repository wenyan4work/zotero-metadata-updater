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
  it("compares encoded publisher-path identifiers with raw metadata without double decoding", function () {
    for (const doi of [
      "10.5555/example(123)",
      "10.5555/part<290::aid>3.0;2-p",
      "10.5555/literal%28x%29",
      "10.5555/part&section",
    ]) {
      const encodedURL = `https://onlinelibrary.wiley.com/doi/${encodeURIComponent(doi)}`;
      const result = extractPublisherPage(
        page(
          `<html><head><meta name="citation_title" content="An article"><meta name="citation_journal_title" content="A journal"><meta name="citation_doi" content="${doi}"></head></html>`,
          encodedURL,
        ),
        { viaDOI: true, expectedDOI: doi },
      );
      assert.isUndefined(result.reason, doi);
      assert.equal(result.record?.fields.DOI, doi);
    }
  });

  it("round-trips opaque DOI suffixes and encoded resolver links", function () {
    for (const doi of [
      "10.5555/example(123)",
      "10.5555/nested(a(b))",
      "10.5555/terminal.",
      "10.5555/part<290::aid>3.0;2-p",
    ]) {
      assert.equal(normalizeDOI(doi), doi);
      assert.equal(
        normalizeDOI(`https://doi.org/${encodeURIComponent(doi)}`),
        doi,
      );
      const result = extractPublisherPage(
        page(
          `<html><head><meta name="citation_title" content="An article"><meta name="citation_journal_title" content="PLOS ONE"><meta name="citation_doi" content="${doi}"></head></html>`,
          "https://journals.plos.org/article",
        ),
        { viaDOI: true, expectedDOI: doi },
      );
      assert.equal(result.record?.fields.DOI, doi);
    }
    assert.isUndefined(normalizeDOI("10.5555/a broken suffix"));
  });

  it("rejects publisher blogs, news and generic articles without scholarly evidence", function () {
    for (const type of [
      "BlogPosting",
      "NewsArticle",
      "Article",
      ["Article", "NewsArticle"],
    ]) {
      const result = extractPublisherPage(
        page(
          `<html><head><script type="application/ld+json">${JSON.stringify({ "@type": type, headline: "Publisher news", author: { name: "News Author" } })}</script></head></html>`,
          "https://www.nature.com/blog/news",
        ),
        { viaDOI: false },
      );
      assert.isUndefined(result.record, String(type));
      assert.equal(result.reason, "unsupported-page", String(type));
    }
  });

  it("uses schema article numbers only when no source provides pages", function () {
    const schema = {
      "@type": "ScholarlyArticle",
      headline: "An article",
      author: { name: "An Author" },
      articleNumber: "e123",
    };
    const result = extractPublisherPage(
      page(
        `<html><head><script type="application/ld+json">${JSON.stringify(schema)}</script></head></html>`,
        "https://journals.plos.org/article",
      ),
      { viaDOI: false },
    );
    assert.equal(result.record?.fields.pages, "e123");
    const withRange = extractPublisherPage(
      page(
        `<html><head><meta name="citation_title" content="An article"><meta name="citation_journal_title" content="PLOS ONE"><meta name="citation_article_number" content="e123"><script type="application/ld+json">${JSON.stringify({ ...schema, pagination: "10-20" })}</script></head></html>`,
        "https://journals.plos.org/article",
      ),
      { viaDOI: false },
    );
    assert.equal(withRange.record?.fields.pages, "10-20");
  });

  it("does not substitute acceptance or creation dates for publication dates", function () {
    const html = `<html><head><meta name="citation_title" content="An article"><meta name="citation_journal_title" content="PLOS ONE"><meta name="citation_accepted_date" content="2020-01-01"><meta name="dcterms.title" content="An article"><meta name="dcterms.created" content="2019-01-01"><meta name="dcterms.source" content="PLOS ONE"><script type="application/ld+json">{"@type":"ScholarlyArticle","headline":"An article","dateCreated":"2018-01-01"}</script></head></html>`;
    const result = extractPublisherPage(
      page(html, "https://journals.plos.org/article"),
      { viaDOI: false },
    );
    assert.exists(result.record);
    assert.isUndefined(result.record?.fields.date);
    const issued = extractPublisherPage(
      page(
        html.replace(
          "</head>",
          '<meta name="citation_issue_date" content="2022-04-01"><meta name="citation_publication_date" content="2021-02-01"><meta name="citation_online_date" content="2020-03-01"></head>',
        ),
        "https://journals.plos.org/article",
      ),
      { viaDOI: false },
    );
    assert.equal(issued.record?.fields.date, "2022-04-01");
  });

  it("omits impossible dates and retains valid leap days", function () {
    for (const [date, expected] of [
      ["2025-02-30", undefined],
      ["February 29, 2025", undefined],
      ["February 29, 2024", "2024-02-29"],
    ]) {
      const result = extractPublisherPage(
        page(
          `<html><head><meta name="citation_title" content="An article"><meta name="citation_journal_title" content="PLOS ONE"><meta name="citation_date" content="${date}"></head></html>`,
          "https://journals.plos.org/article",
        ),
        { viaDOI: false },
      );
      assert.equal(result.record?.fields.date, expected);
    }
  });

  it("normalizes DOI resolver values and rejects broken values", function () {
    assert.equal(
      normalizeDOI(" DOI: https://doi.org/10.1371/JOURNAL.PONE.0000308 "),
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
        "https://journals.plos.org/repeated",
      ),
      { viaDOI: false },
    );
    assert.isUndefined(result.reason);
    assert.deepEqual(result.record?.authors, [
      { firstName: "Alex", lastName: "Lee" },
      { firstName: "Alex", lastName: "Lee" },
    ]);
  });

  it("drops each metadata source's author list when any declared author is invalid", function () {
    const cases = [
      {
        name: "HighWire",
        html: `<html><head>
          <meta name="citation_title" content="HighWire Article">
          <meta name="citation_journal_title" content="Example Journal">
          <meta name="citation_author" content="Valid Author">
          <meta name="citation_author" content=" ">
        </head></html>`,
      },
      {
        name: "JSON-LD",
        html: `<html><head><script type="application/ld+json">${JSON.stringify({
          "@type": "ScholarlyArticle",
          headline: "Schema Article",
          author: [{ name: "Valid Author" }, {}],
          isPartOf: { "@type": "Periodical", name: "Example Journal" },
        })}</script></head></html>`,
      },
      {
        name: "Dublin Core",
        html: `<html><head>
          <meta name="dc.title" content="Dublin Core Article">
          <meta name="dc.source" content="Example Journal">
          <meta name="dc.date" content="2024">
          <meta name="dc.creator" content="Valid Author">
          <meta name="dc.creator" content="">
        </head></html>`,
      },
    ];

    for (const candidate of cases) {
      const result = extractPublisherPage(
        page(candidate.html, "https://journals.plos.org/article"),
        { viaDOI: false },
      );
      assert.isUndefined(result.reason, candidate.name);
      assert.exists(result.record, candidate.name);
      assert.isUndefined(result.record?.authors, candidate.name);
    }
  });

  it("uses a complete alternative author list when one source is incomplete", function () {
    const result = extractPublisherPage(
      page(
        `<html><head>
          <meta name="citation_title" content="Complete Article">
          <meta name="citation_journal_title" content="Example Journal">
          <meta name="citation_author" content="Truncated Author">
          <meta name="citation_author" content="">
          <script type="application/ld+json">${JSON.stringify({
            "@type": "ScholarlyArticle",
            headline: "Complete Article",
            author: [
              {
                "@type": "Person",
                givenName: "Complete",
                familyName: "Author",
              },
            ],
            isPartOf: { "@type": "Periodical", name: "Example Journal" },
          })}</script>
        </head></html>`,
        "https://journals.plos.org/article",
      ),
      { viaDOI: false },
    );

    assert.isUndefined(result.reason);
    assert.deepEqual(result.record?.authors, [
      { firstName: "Complete", lastName: "Author" },
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
